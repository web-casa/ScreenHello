//! Checked logical-point to output-pixel conversion for ScreenCaptureKit.
#[cfg(any(test, all(target_os = "macos", feature = "screen-capture-kit")))]
pub(crate) fn pixel_dimensions(
    width: f64,
    height: f64,
    scale: f64,
    budget: u64,
) -> Result<(u32, u32), &'static str> {
    if !width.is_finite()
        || !height.is_finite()
        || !scale.is_finite()
        || width <= 0.0
        || height <= 0.0
        || scale <= 0.0
        || scale > 8.0
    {
        return Err("desktop-capture-source-unavailable");
    }
    let w = (width * scale).ceil();
    let h = (height * scale).ceil();
    if w > u32::MAX as f64 || h > u32::MAX as f64 || w * h > budget as f64 {
        return Err("desktop-capture-too-large");
    }
    Ok((w as u32, h as u32))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retina_and_fractional_dimensions_are_checked_before_allocation() {
        assert_eq!(
            pixel_dimensions(1920.0, 1080.0, 2.0, 33_177_600),
            Ok((3840, 2160))
        );
        assert_eq!(pixel_dimensions(10.1, 20.1, 1.5, 10_000), Ok((16, 31)));
        assert_eq!(
            pixel_dimensions(7680.0, 4320.0, 2.0, 33_177_600),
            Err("desktop-capture-too-large")
        );
        for value in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert!(pixel_dimensions(value, 10.0, 1.0, 1000).is_err());
            assert!(pixel_dimensions(10.0, value, 1.0, 1000).is_err());
            assert!(pixel_dimensions(10.0, 10.0, value, 1000).is_err());
        }
        assert!(pixel_dimensions(1.0, 1.0, 9.0, 1000).is_err());
    }
}
