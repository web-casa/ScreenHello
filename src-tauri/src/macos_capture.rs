//! MAS-only macOS 14+ screenshot backend. No independent IPC or permission grant.
use block2::RcBlock;
use objc2::{rc::Retained, AnyThread};
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_core_graphics::{
    CGBitmapContextCreate, CGBitmapInfo, CGColorSpace, CGContext, CGImage, CGImageAlphaInfo,
};
use objc2_foundation::{NSArray, NSError};
use objc2_screen_capture_kit::{
    SCContentFilter, SCScreenshotManager, SCShareableContent, SCStreamConfiguration,
};
use std::{sync::mpsc, time::Duration};
use xcap::image::RgbaImage;

const PIXEL_BUDGET: u64 = 7_680 * 4_320;

// Copy and convert inside the callback: no Objective-C or CG pointers cross the
// channel. The bitmap owns no Vec memory after the explicit context drop.
fn rgba(image: &CGImage, expected: (u32, u32)) -> Result<RgbaImage, String> {
    let width = CGImage::width(Some(image));
    let height = CGImage::height(Some(image));
    if width != expected.0 as usize || height != expected.1 as usize {
        return Err("desktop-capture-failed".into());
    }
    let mut bytes = vec![0u8; width * height * 4];
    let color = CGColorSpace::new_device_rgb().ok_or("desktop-capture-failed")?;
    // SAFETY: Vec has exactly width * height * 4 bytes and outlives the context.
    let context = unsafe {
        CGBitmapContextCreate(
            bytes.as_mut_ptr().cast(),
            width,
            height,
            8,
            width * 4,
            Some(&color),
            CGImageAlphaInfo::PremultipliedLast.0 | CGBitmapInfo::ByteOrder32Big.bits(),
        )
    }
    .ok_or("desktop-capture-failed")?;
    CGContext::draw_image(
        Some(&context),
        CGRect::new(
            CGPoint::new(0.0, 0.0),
            CGSize::new(width as f64, height as f64),
        ),
        Some(image),
    );
    drop(context);
    // PNG/image crate expects straight alpha, unlike the CoreGraphics bitmap.
    for pixel in bytes.chunks_exact_mut(4) {
        let alpha = pixel[3] as u32;
        for channel in &mut pixel[..3] {
            *channel = if alpha == 0 {
                0
            } else {
                (((*channel as u32) * 255 + alpha / 2) / alpha).min(255) as u8
            };
        }
    }
    RgbaImage::from_raw(expected.0, expected.1, bytes)
        .ok_or_else(|| "desktop-capture-failed".into())
}

pub(crate) fn capture(
    native_id: u32,
    window: bool,
    region: Option<(u32, u32, u32, u32)>,
) -> Result<RgbaImage, String> {
    // This check precedes every class message. Distribution config also pins 14+.
    if !objc2::available!(macos = 14.0) {
        return Err("desktop-capture-unavailable".into());
    }
    let (sender, receiver) = mpsc::channel();
    let content_callback = RcBlock::new(
        move |content: *mut SCShareableContent, error: *mut NSError| {
            if !error.is_null() || content.is_null() {
                let _ = sender.send(Err("desktop-capture-source-unavailable".into()));
                return;
            }
            // SAFETY: ScreenCaptureKit owns callback objects for the callback duration;
            // returned filters/configurations are retained and framework copies blocks.
            let prepared = unsafe { prepare(&*content, native_id, window, region) };
            let (filter, config, dimensions) = match prepared {
                Ok(value) => value,
                Err(code) => {
                    let _ = sender.send(Err(code));
                    return;
                }
            };
            let completion_sender = sender.clone();
            let callback = RcBlock::new(move |image: *mut CGImage, error: *mut NSError| {
                let result = if !error.is_null() || image.is_null() {
                    Err("desktop-capture-failed".into())
                } else {
                    // SAFETY: borrowed only during Apple's completion callback.
                    rgba(unsafe { &*image }, dimensions)
                };
                let _ = completion_sender.send(result);
            });
            unsafe {
                SCScreenshotManager::captureImageWithFilter_configuration_completionHandler(
                    &filter,
                    &config,
                    Some(&callback),
                );
            }
        },
    );
    unsafe {
        SCShareableContent::getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler(false, true, &content_callback);
    }
    // Called from the existing blocking capture worker, never from the UI thread.
    // A late callback cannot deliver to the editor after this receiver is dropped.
    receiver
        .recv_timeout(Duration::from_secs(15))
        .map_err(|_| "desktop-capture-failed".to_owned())?
}

type Prepared = (
    Retained<SCContentFilter>,
    Retained<SCStreamConfiguration>,
    (u32, u32),
);
unsafe fn prepare(
    content: &SCShareableContent,
    id: u32,
    window: bool,
    region: Option<(u32, u32, u32, u32)>,
) -> Result<Prepared, String> {
    let filter = if window {
        if region.is_some() {
            return Err("desktop-capture-region-invalid".into());
        }
        let windows = content.windows();
        let selected = windows
            .iter()
            .find(|value| value.windowID() == id)
            .ok_or("desktop-capture-source-unavailable")?;
        SCContentFilter::initWithDesktopIndependentWindow(SCContentFilter::alloc(), &selected)
    } else {
        let displays = content.displays();
        let selected = displays
            .iter()
            .find(|value| value.displayID() == id)
            .ok_or("desktop-capture-source-unavailable")?;
        SCContentFilter::initWithDisplay_excludingWindows(
            SCContentFilter::alloc(),
            &selected,
            &NSArray::new(),
        )
    };
    let rect = filter.contentRect();
    let scale = filter.pointPixelScale() as f64;
    let config = SCStreamConfiguration::new();
    config.setShowsCursor(false);
    config.setCapturesAudio(false);
    config.setIgnoreShadowsSingleWindow(true);
    let (w, h) = if let Some((x, y, w, h)) = region {
        if w == 0
            || h == 0
            || x as f64 + w as f64 > rect.size.width
            || y as f64 + h as f64 > rect.size.height
        {
            return Err("desktop-capture-region-invalid".into());
        }
        config.setSourceRect(CGRect::new(
            CGPoint::new(x as f64, y as f64),
            CGSize::new(w as f64, h as f64),
        ));
        (w as f64, h as f64)
    } else {
        (rect.size.width, rect.size.height)
    };
    let dimensions = crate::capture_geometry::pixel_dimensions(w, h, scale, PIXEL_BUDGET)
        .map_err(str::to_owned)?;
    config.setWidth(dimensions.0 as usize);
    config.setHeight(dimensions.1 as usize);
    Ok((filter, config, dimensions))
}
