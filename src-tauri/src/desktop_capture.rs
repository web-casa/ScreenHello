use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    io::Cursor,
    process,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{ipc::Response, Manager, Runtime, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use xcap::{image::DynamicImage, Monitor, Window};

const MAX_MONITORS: usize = 16;
const MAX_WINDOWS: usize = 128;
const MAX_CAPTURE_SOURCES: usize = MAX_MONITORS + MAX_WINDOWS;
const MAX_CAPTURE_PIXELS: u64 = 7_680 * 4_320;
const MAX_CAPTURE_BYTES: usize = 48 * 1024 * 1024;
const CAPTURE_SETTLE_MILLIS: u64 = 160;
const SOURCE_INTENT_LIFETIME: Duration = Duration::from_secs(60);
const PRIMARY_INTENT_LIFETIME: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum CaptureSourceKind {
    Monitor,
    Window,
}

#[derive(Clone, Debug)]
struct CaptureTarget {
    owner: String,
    kind: CaptureSourceKind,
    native_id: u32,
    expires_at: Instant,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureSource {
    token: String,
    kind: CaptureSourceKind,
    name: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f32,
    primary: bool,
}

#[derive(Debug)]
struct CaptureSourceDraft {
    kind: CaptureSourceKind,
    native_id: u32,
    name: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f32,
    primary: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CaptureSourcesResponse {
    schema_version: u8,
    sources: Vec<CaptureSource>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CaptureRegion {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

#[derive(Default)]
pub(crate) struct CaptureSourceState {
    targets: Mutex<HashMap<String, CaptureTarget>>,
    operation_active: AtomicBool,
    consent_generation: AtomicU64,
    primary_intent: Mutex<Option<Instant>>,
}

#[derive(Debug)]
struct CaptureOperationGuard<'a> {
    active: &'a AtomicBool,
}

impl Drop for CaptureOperationGuard<'_> {
    fn drop(&mut self) {
        self.active.store(false, Ordering::Release);
    }
}

fn error_code(code: &'static str) -> String {
    code.to_owned()
}

fn valid_dimensions(width: u32, height: u32) -> bool {
    width > 0
        && height > 0
        && u64::from(width)
            .checked_mul(u64::from(height))
            .is_some_and(|pixels| pixels <= MAX_CAPTURE_PIXELS)
}

fn valid_region(region: CaptureRegion, width: u32, height: u32) -> bool {
    valid_dimensions(region.width, region.height)
        && region
            .x
            .checked_add(region.width)
            .is_some_and(|right| right <= width)
        && region
            .y
            .checked_add(region.height)
            .is_some_and(|bottom| bottom <= height)
}

fn sanitized_label(value: &str, fallback: &str) -> String {
    let label: String = value
        .chars()
        .filter(|character| !character.is_control())
        .take(120)
        .collect::<String>()
        .trim()
        .to_owned();
    if label.is_empty() {
        fallback.to_owned()
    } else {
        label
    }
}

fn random_token() -> Result<String, String> {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut bytes = [0_u8; 24];
    getrandom::fill(&mut bytes).map_err(|_| error_code("desktop-capture-random-unavailable"))?;
    let mut token = String::with_capacity(48);
    for byte in bytes {
        token.push(HEX[usize::from(byte >> 4)] as char);
        token.push(HEX[usize::from(byte & 0x0f)] as char);
    }
    Ok(token)
}

impl CaptureSourceState {
    // Only native shortcut/tray callbacks can grant this intent. No IPC grants it.
    pub(crate) fn grant_primary_intent(&self) {
        if let Ok(mut intent) = self.primary_intent.lock() {
            *intent = Some(Instant::now() + PRIMARY_INTENT_LIFETIME);
        }
    }

    fn take_primary_intent(&self, owner: &str) -> Result<(), String> {
        if owner != "main" {
            return Err(error_code("desktop-capture-consent-required"));
        }
        let intent = self
            .primary_intent
            .lock()
            .map_err(|_| error_code("desktop-capture-state-unavailable"))?
            .take();
        if intent.is_some_and(|expires| Instant::now() < expires) {
            Ok(())
        } else {
            Err(error_code("desktop-capture-consent-required"))
        }
    }

    fn begin_operation(&self) -> Result<CaptureOperationGuard<'_>, String> {
        self.operation_active
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .map_err(|_| error_code("desktop-capture-busy"))?;
        Ok(CaptureOperationGuard {
            active: &self.operation_active,
        })
    }

    fn clear_owner(&self, owner: &str) -> Result<(), String> {
        let mut targets = self
            .targets
            .lock()
            .map_err(|_| error_code("desktop-capture-state-unavailable"))?;
        if owner == "main" {
            self.consent_generation.fetch_add(1, Ordering::AcqRel);
            self.primary_intent
                .lock()
                .map_err(|_| error_code("desktop-capture-state-unavailable"))?
                .take();
        }
        targets.retain(|_, target| target.owner != owner);
        Ok(())
    }

    fn replace_owner(
        &self,
        owner: &str,
        generation: u64,
        drafts: Vec<CaptureSourceDraft>,
    ) -> Result<Vec<CaptureSource>, String> {
        if drafts.len() > MAX_CAPTURE_SOURCES {
            return Err(error_code("desktop-capture-source-limit"));
        }
        let mut targets = self
            .targets
            .lock()
            .map_err(|_| error_code("desktop-capture-state-unavailable"))?;
        // Cancellation and installation share this lock, so a stale enumeration
        // cannot install fresh credentials after its consent has been revoked.
        if generation != self.consent_generation.load(Ordering::Acquire) {
            return Err(error_code("desktop-capture-cancelled"));
        }
        let other_owner_count = targets
            .values()
            .filter(|target| target.owner != owner)
            .count();
        if other_owner_count.saturating_add(drafts.len()) > MAX_CAPTURE_SOURCES {
            return Err(error_code("desktop-capture-source-limit"));
        }

        let mut pending = Vec::with_capacity(drafts.len());
        let mut pending_tokens = HashSet::with_capacity(drafts.len());
        for draft in drafts {
            let token = (0..4)
                .find_map(|_| {
                    let candidate = random_token().ok()?;
                    (!targets.contains_key(&candidate) && !pending_tokens.contains(&candidate))
                        .then_some(candidate)
                })
                .ok_or_else(|| error_code("desktop-capture-random-unavailable"))?;
            pending_tokens.insert(token.clone());
            pending.push((token, draft));
        }

        targets.retain(|_, target| target.owner != owner);
        let mut sources = Vec::with_capacity(pending.len());
        for (token, draft) in pending {
            targets.insert(
                token.clone(),
                CaptureTarget {
                    owner: owner.to_owned(),
                    kind: draft.kind,
                    native_id: draft.native_id,
                    expires_at: Instant::now() + SOURCE_INTENT_LIFETIME,
                },
            );
            sources.push(CaptureSource {
                token,
                kind: draft.kind,
                name: draft.name,
                x: draft.x,
                y: draft.y,
                width: draft.width,
                height: draft.height,
                scale_factor: draft.scale_factor,
                primary: draft.primary,
            });
        }
        Ok(sources)
    }

    fn take_owned(&self, token: &str, owner: &str) -> Result<CaptureTarget, String> {
        let mut targets = self
            .targets
            .lock()
            .map_err(|_| error_code("desktop-capture-state-unavailable"))?;
        let is_owned = targets
            .get(token)
            .is_some_and(|target| target.owner == owner && Instant::now() < target.expires_at);
        if !is_owned {
            targets.retain(|_, target| Instant::now() < target.expires_at);
            return Err(error_code("desktop-capture-source-invalid"));
        }
        let selected = targets
            .remove(token)
            .ok_or_else(|| error_code("desktop-capture-source-invalid"))?;
        // One confirmation grants one capture, not one per enumerated window.
        targets.retain(|_, target| target.owner != owner);
        Ok(selected)
    }
}

fn list_sources(
    display_label: &str,
    untitled_label: &str,
) -> Result<Vec<CaptureSourceDraft>, String> {
    let monitors = Monitor::all().map_err(|_| error_code("desktop-capture-unavailable"))?;
    let mut sources: Vec<CaptureSourceDraft> = monitors
        .into_iter()
        .enumerate()
        .filter_map(|(index, monitor)| {
            let native_id = monitor.id().ok()?;
            let x = monitor.x().ok()?;
            let y = monitor.y().ok()?;
            let width = monitor.width().ok()?;
            let height = monitor.height().ok()?;
            if width == 0 || height == 0 {
                return None;
            }
            let primary = monitor.is_primary().ok()?;
            let scale_factor = monitor.scale_factor().ok()?;
            if !scale_factor.is_finite() || scale_factor <= 0.0 || scale_factor > 8.0 {
                return None;
            }
            let name = monitor
                .friendly_name()
                .or_else(|_| monitor.name())
                .unwrap_or_default();
            Some(CaptureSourceDraft {
                kind: CaptureSourceKind::Monitor,
                native_id,
                name: sanitized_label(&name, &format!("{} {}", display_label, index + 1)),
                x,
                y,
                width,
                height,
                scale_factor,
                primary,
            })
        })
        .take(MAX_MONITORS)
        .collect();
    sources.sort_by_key(|source| !source.primary);
    let mut primary_seen = false;
    for source in &mut sources {
        if source.primary {
            source.primary = !primary_seen;
            primary_seen = true;
        }
    }

    let own_pid = process::id();
    if let Ok(windows) = Window::all() {
        sources.extend(
            windows
                .into_iter()
                .filter_map(|window| {
                    if window.pid().ok()? == own_pid || window.is_minimized().ok()? {
                        return None;
                    }
                    let width = window.width().ok()?;
                    let height = window.height().ok()?;
                    if !valid_dimensions(width, height) {
                        return None;
                    }
                    let scale_factor = window.current_monitor().ok()?.scale_factor().ok()?;
                    if !scale_factor.is_finite() || scale_factor <= 0.0 || scale_factor > 8.0 {
                        return None;
                    }
                    Some(CaptureSourceDraft {
                        kind: CaptureSourceKind::Window,
                        native_id: window.id().ok()?,
                        name: sanitized_label(&window.title().unwrap_or_default(), untitled_label),
                        x: window.x().ok()?,
                        y: window.y().ok()?,
                        width,
                        height,
                        scale_factor,
                        primary: false,
                    })
                })
                .take(MAX_WINDOWS),
        );
    }
    if !sources
        .iter()
        .any(|source| source.kind == CaptureSourceKind::Monitor)
    {
        return Err(error_code("desktop-capture-no-display"));
    }
    Ok(sources)
}

fn encode_png(image: xcap::image::RgbaImage) -> Result<Vec<u8>, String> {
    if !valid_dimensions(image.width(), image.height()) {
        return Err(error_code("desktop-capture-too-large"));
    }
    let mut output = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image)
        .write_to(&mut output, xcap::image::ImageFormat::Png)
        .map_err(|_| error_code("desktop-capture-encode-failed"))?;
    let bytes = output.into_inner();
    if bytes.is_empty() || bytes.len() > MAX_CAPTURE_BYTES {
        return Err(error_code("desktop-capture-too-large"));
    }
    Ok(bytes)
}

fn capture_target(target: CaptureTarget, region: Option<CaptureRegion>) -> Result<Vec<u8>, String> {
    match target.kind {
        CaptureSourceKind::Monitor => {
            let monitor = Monitor::all()
                .map_err(|_| error_code("desktop-capture-unavailable"))?
                .into_iter()
                .find(|monitor| monitor.id().ok() == Some(target.native_id))
                .ok_or_else(|| error_code("desktop-capture-source-unavailable"))?;
            let width = monitor
                .width()
                .map_err(|_| error_code("desktop-capture-source-unavailable"))?;
            let height = monitor
                .height()
                .map_err(|_| error_code("desktop-capture-source-unavailable"))?;
            let image = if let Some(region) = region {
                if !valid_region(region, width, height) {
                    return Err(error_code("desktop-capture-region-invalid"));
                }
                monitor
                    .capture_region(region.x, region.y, region.width, region.height)
                    .map_err(|_| error_code("desktop-capture-failed"))?
            } else {
                if !valid_dimensions(width, height) {
                    return Err(error_code("desktop-capture-too-large"));
                }
                monitor
                    .capture_image()
                    .map_err(|_| error_code("desktop-capture-failed"))?
            };
            encode_png(image)
        }
        CaptureSourceKind::Window => {
            if region.is_some() {
                return Err(error_code("desktop-capture-region-invalid"));
            }
            let window = Window::all()
                .map_err(|_| error_code("desktop-capture-unavailable"))?
                .into_iter()
                .find(|window| window.id().ok() == Some(target.native_id))
                .ok_or_else(|| error_code("desktop-capture-source-unavailable"))?;
            let width = window
                .width()
                .map_err(|_| error_code("desktop-capture-source-unavailable"))?;
            let height = window
                .height()
                .map_err(|_| error_code("desktop-capture-source-unavailable"))?;
            if !valid_dimensions(width, height) {
                return Err(error_code("desktop-capture-too-large"));
            }
            encode_png(
                window
                    .capture_image()
                    .map_err(|_| error_code("desktop-capture-failed"))?,
            )
        }
    }
}

fn capture_primary() -> Result<Vec<u8>, String> {
    let monitors = Monitor::all().map_err(|_| error_code("desktop-capture-unavailable"))?;
    let monitor = monitors
        .iter()
        .find(|monitor| monitor.is_primary().ok() == Some(true))
        .or_else(|| monitors.first())
        .ok_or_else(|| error_code("desktop-capture-no-display"))?;
    let width = monitor
        .width()
        .map_err(|_| error_code("desktop-capture-source-unavailable"))?;
    let height = monitor
        .height()
        .map_err(|_| error_code("desktop-capture-source-unavailable"))?;
    if !valid_dimensions(width, height) {
        return Err(error_code("desktop-capture-too-large"));
    }
    encode_png(
        monitor
            .capture_image()
            .map_err(|_| error_code("desktop-capture-failed"))?,
    )
}

async fn capture_while_hidden<R, F>(
    window: WebviewWindow<R>,
    capture: F,
) -> Result<Response, String>
where
    R: Runtime,
    F: FnOnce() -> Result<Vec<u8>, String> + Send + 'static,
{
    window
        .hide()
        .map_err(|_| error_code("desktop-capture-window-unavailable"))?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(Duration::from_millis(CAPTURE_SETTLE_MILLIS));
        capture()
    })
    .await
    .map_err(|_| error_code("desktop-capture-failed"));
    let restore_result = window
        .unminimize()
        .and_then(|_| window.show())
        .and_then(|_| window.set_focus())
        .map_err(|_| error_code("desktop-capture-window-restore-failed"));
    let bytes = result??;
    restore_result?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub(crate) async fn desktop_list_capture_sources<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, CaptureSourceState>,
    request_consent: Option<bool>,
) -> Result<CaptureSourcesResponse, String> {
    if window.label() != "main" || request_consent != Some(true) {
        return Err(error_code("desktop-capture-consent-required"));
    }
    let _operation = state.begin_operation()?;
    let owner = window.label().to_owned();
    state.clear_owner(&owner)?;
    let generation = state.consent_generation.load(Ordering::Acquire);
    let prompt_window = window.clone();
    let confirmed = tauri::async_runtime::spawn_blocking(move || {
        prompt_window
            .dialog()
            .message(crate::native_locale::text(
                prompt_window.app_handle(),
                "允许本次读取显示器和窗口标题，并截取您选择的一个来源吗？图片仅在本机处理。",
            ))
            .title(crate::native_locale::text(
                prompt_window.app_handle(),
                "ScreenHello — 截图授权",
            ))
            .parent(&prompt_window)
            .buttons(MessageDialogButtons::OkCancelCustom(
                crate::native_locale::text(prompt_window.app_handle(), "允许本次").into(),
                crate::native_locale::text(prompt_window.app_handle(), "取消").into(),
            ))
            .blocking_show()
    })
    .await
    .map_err(|_| error_code("desktop-capture-consent-unavailable"))?;
    if !confirmed || generation != state.consent_generation.load(Ordering::Acquire) {
        return Err(error_code("desktop-capture-cancelled"));
    }
    let display_label = crate::native_locale::text(window.app_handle(), "显示器");
    let untitled_label = crate::native_locale::text(window.app_handle(), "未命名窗口");
    let drafts =
        tauri::async_runtime::spawn_blocking(move || list_sources(display_label, untitled_label))
            .await
            .map_err(|_| error_code("desktop-capture-unavailable"))??;
    if generation != state.consent_generation.load(Ordering::Acquire) {
        return Err(error_code("desktop-capture-cancelled"));
    }
    let sources = state.replace_owner(&owner, generation, drafts)?;
    Ok(CaptureSourcesResponse {
        schema_version: 1,
        sources,
    })
}

#[tauri::command]
pub(crate) async fn desktop_capture_source<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, CaptureSourceState>,
    token: String,
    region: Option<CaptureRegion>,
) -> Result<Response, String> {
    if !crate::native_files::valid_token(&token) {
        return Err(error_code("desktop-capture-source-invalid"));
    }
    let _operation = state.begin_operation()?;
    let target = state.take_owned(&token, window.label())?;
    capture_while_hidden(window, move || capture_target(target, region)).await
}

#[tauri::command]
pub(crate) async fn desktop_capture_primary<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, CaptureSourceState>,
) -> Result<Response, String> {
    let _operation = state.begin_operation()?;
    state.take_primary_intent(window.label())?;
    capture_while_hidden(window, capture_primary).await
}

#[tauri::command]
pub(crate) fn desktop_release_capture_sources<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, CaptureSourceState>,
) -> Result<(), String> {
    state.clear_owner(window.label())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn primary_intent_is_native_owned_short_lived_and_single_use() {
        let state = CaptureSourceState::default();
        assert!(state.take_primary_intent("main").is_err());
        state.grant_primary_intent();
        assert!(state.take_primary_intent("other").is_err());
        assert!(state.take_primary_intent("main").is_ok());
        assert!(state.take_primary_intent("main").is_err());
        *state.primary_intent.lock().unwrap() = Some(Instant::now() - Duration::from_secs(1));
        assert!(state.take_primary_intent("main").is_err());
        state.grant_primary_intent();
        state.clear_owner("main").unwrap();
        assert!(state.take_primary_intent("main").is_err());
    }

    #[test]
    fn source_intent_expires_and_consumption_revokes_the_whole_selection() {
        let state = CaptureSourceState::default();
        let target = CaptureTarget {
            owner: "main".into(),
            kind: CaptureSourceKind::Monitor,
            native_id: 1,
            expires_at: Instant::now() + SOURCE_INTENT_LIFETIME,
        };
        state
            .targets
            .lock()
            .unwrap()
            .insert("first".into(), target.clone());
        state
            .targets
            .lock()
            .unwrap()
            .insert("second".into(), target.clone());
        assert!(state.take_owned("first", "main").is_ok());
        assert!(state.take_owned("second", "main").is_err());
        state.targets.lock().unwrap().insert(
            "expired".into(),
            CaptureTarget {
                expires_at: Instant::now() - Duration::from_secs(1),
                ..target
            },
        );
        assert!(state.take_owned("expired", "main").is_err());
        assert!(state.targets.lock().unwrap().is_empty());
    }

    #[test]
    fn dimensions_and_regions_are_bounded_before_capture() {
        assert!(valid_dimensions(7_680, 4_320));
        assert!(!valid_dimensions(7_681, 4_320));
        assert!(!valid_dimensions(0, 100));
        assert!(valid_region(
            CaptureRegion {
                x: 10,
                y: 20,
                width: 100,
                height: 80,
            },
            200,
            200,
        ));
        assert!(!valid_region(
            CaptureRegion {
                x: u32::MAX,
                y: 0,
                width: 2,
                height: 1,
            },
            u32::MAX,
            1,
        ));
    }

    #[test]
    fn source_tokens_are_owner_scoped_consumed_and_never_serialize_native_ids() {
        let state = CaptureSourceState::default();
        let sources = state
            .replace_owner(
                "main",
                0,
                vec![CaptureSourceDraft {
                    kind: CaptureSourceKind::Monitor,
                    native_id: 42,
                    name: "Display".to_owned(),
                    x: -1920,
                    y: 0,
                    width: 1920,
                    height: 1080,
                    scale_factor: 1.0,
                    primary: false,
                }],
            )
            .unwrap();
        let json = serde_json::to_value(&sources[0]).unwrap();
        assert!(json.get("nativeId").is_none());
        assert_eq!(json.get("x").unwrap(), -1920);
        assert!(state.take_owned(&sources[0].token, "other").is_err());
        let target = state.take_owned(&sources[0].token, "main").unwrap();
        assert_eq!(target.native_id, 42);
        assert!(state.take_owned(&sources[0].token, "main").is_err());
    }

    #[test]
    fn source_labels_remove_controls_and_have_a_safe_fallback() {
        assert_eq!(sanitized_label("  Work\nArea  ", "fallback"), "WorkArea");
        assert_eq!(sanitized_label("\n\t", "fallback"), "fallback");
        assert!(sanitized_label(&"x".repeat(200), "fallback").len() <= 120);
    }

    #[test]
    fn cancelled_enumeration_cannot_reinstall_credentials() {
        let state = CaptureSourceState::default();
        state.clear_owner("main").unwrap();
        assert_eq!(
            state.replace_owner("main", 0, vec![]).unwrap_err(),
            "desktop-capture-cancelled"
        );
        assert!(state.targets.lock().unwrap().is_empty());
        assert!(state.replace_owner("main", 1, vec![]).is_ok());
    }

    #[test]
    fn capture_operations_are_serialized_and_release_on_drop() {
        let state = CaptureSourceState::default();
        let operation = state.begin_operation().unwrap();
        assert_eq!(state.begin_operation().unwrap_err(), "desktop-capture-busy");
        drop(operation);
        assert!(state.begin_operation().is_ok());
    }
}
