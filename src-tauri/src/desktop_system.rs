use serde::Serialize;
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{
    ipc::Channel,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, Runtime, State, WebviewWindow,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const TRAY_SHOW_ID: &str = "screenhello-show";
const TRAY_CAPTURE_ID: &str = "screenhello-capture-primary";
const TRAY_QUIT_ID: &str = "screenhello-quit";
const PENDING_EVENT_TTL: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
enum SystemEventSource {
    Shortcut,
    Tray,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SystemEvent {
    schema_version: u8,
    action: &'static str,
    source: SystemEventSource,
}

#[derive(Clone)]
struct SystemSubscriber {
    owner: String,
    token: String,
    channel: Channel<SystemEvent>,
}

#[derive(Clone, Copy, Debug)]
struct Availability {
    shortcut: &'static str,
    tray: &'static str,
}

impl Default for Availability {
    fn default() -> Self {
        Self {
            shortcut: "unavailable",
            tray: "unavailable",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopSystemStatus {
    schema_version: u8,
    shortcut: &'static str,
    shortcut_accelerator: &'static str,
    tray: &'static str,
    single_instance: &'static str,
}

#[derive(Clone, Copy, Debug)]
struct PendingSystemEvent {
    source: SystemEventSource,
    granted_at: Instant,
}

#[derive(Default)]
struct SubscriberSlot {
    current: Option<SystemSubscriber>,
    epoch: Option<String>,
    last_sequence: u64,
}

#[derive(Default)]
pub(crate) struct DesktopSystemState {
    availability: Mutex<Availability>,
    subscriber: Mutex<SubscriberSlot>,
    pending: Mutex<Option<PendingSystemEvent>>,
}

fn error_code(code: &'static str) -> String {
    code.to_owned()
}

fn shortcut_accelerator() -> &'static str {
    if cfg!(target_os = "macos") {
        "Command+Shift+H"
    } else {
        "Ctrl+Shift+H"
    }
}

fn capture_shortcut() -> Shortcut {
    let command = if cfg!(target_os = "macos") {
        Modifiers::SUPER
    } else {
        Modifiers::CONTROL
    };
    Shortcut::new(Some(command | Modifiers::SHIFT), Code::KeyH)
}

pub(crate) fn show_main_window<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.get_webview_window("main").is_some_and(|window| {
        window.unminimize().is_ok() && window.show().is_ok() && window.set_focus().is_ok()
    })
}

impl DesktopSystemState {
    fn status(&self) -> Result<DesktopSystemStatus, String> {
        let availability = self
            .availability
            .lock()
            .map_err(|_| error_code("desktop-system-state-unavailable"))?;
        Ok(DesktopSystemStatus {
            schema_version: 1,
            shortcut: availability.shortcut,
            shortcut_accelerator: shortcut_accelerator(),
            tray: availability.tray,
            single_instance: if cfg!(feature = "mac-app-store") {
                "unavailable"
            } else {
                "ready"
            },
        })
    }

    fn set_shortcut(&self, value: &'static str) {
        if let Ok(mut availability) = self.availability.lock() {
            availability.shortcut = value;
        }
    }

    fn set_tray(&self, value: &'static str) {
        if let Ok(mut availability) = self.availability.lock() {
            availability.tray = value;
        }
    }

    fn request_capture<R: Runtime>(&self, app: &AppHandle<R>, source: SystemEventSource) {
        let granted_at = Instant::now();
        app.state::<crate::desktop_capture::CaptureSourceState>()
            .grant_primary_intent();
        let _ = show_main_window(app);
        let subscriber = match self.subscriber.lock() {
            Ok(slot) => match slot.current.as_ref() {
                Some(subscriber) => subscriber.clone(),
                None => {
                    if let Ok(mut pending) = self.pending.lock() {
                        *pending = Some(PendingSystemEvent { source, granted_at });
                    }
                    return;
                }
            },
            Err(_) => return,
        };
        let event = SystemEvent {
            schema_version: 1,
            action: "capture-primary",
            source,
        };
        if subscriber.channel.send(event).is_ok() {
            return;
        }
        if let Ok(mut slot) = self.subscriber.lock() {
            if slot.current.as_ref().is_some_and(|candidate| {
                candidate.owner == subscriber.owner && candidate.token == subscriber.token
            }) {
                slot.current = None;
            }
            if slot.current.is_none()
                || slot.current.as_ref().is_some_and(|candidate| {
                    candidate.owner == subscriber.owner && candidate.token == subscriber.token
                })
            {
                if let Ok(mut pending) = self.pending.lock() {
                    *pending = Some(PendingSystemEvent { source, granted_at });
                }
            }
        }
    }

    fn subscribe(
        &self,
        owner: String,
        token: String,
        channel: Channel<SystemEvent>,
        epoch: Option<&str>,
        sequence: Option<u64>,
    ) -> Result<bool, String> {
        let pending_event = {
            let mut slot = self
                .subscriber
                .lock()
                .map_err(|_| error_code("desktop-system-state-unavailable"))?;
            if let (Some(epoch), Some(sequence)) = (epoch, sequence) {
                if !crate::native_files::valid_token(epoch) || sequence == 0 {
                    return Err(error_code("desktop-system-subscription-invalid"));
                }
                if slot.epoch.as_deref() == Some(epoch) {
                    if sequence <= slot.last_sequence {
                        return Ok(false);
                    }
                    slot.last_sequence = sequence;
                } else {
                    slot.epoch = Some(epoch.to_owned());
                    slot.last_sequence = sequence;
                }
            }
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| error_code("desktop-system-state-unavailable"))?;
            slot.current = Some(SystemSubscriber {
                owner,
                token: token.clone(),
                channel: channel.clone(),
            });
            pending
                .take()
                .filter(|item| item.granted_at.elapsed() < PENDING_EVENT_TTL)
        };
        if let Some(item) = pending_event {
            let event = SystemEvent {
                schema_version: 1,
                action: "capture-primary",
                source: item.source,
            };
            if channel.send(event).is_err() {
                let _ = self.unsubscribe_by_token(&token);
                if item.granted_at.elapsed() < PENDING_EVENT_TTL {
                    if let Ok(mut pending) = self.pending.lock() {
                        *pending = Some(item);
                    }
                }
                return Err(error_code("desktop-system-channel-unavailable"));
            }
        }
        Ok(true)
    }

    fn unsubscribe(&self, owner: &str, token: &str) -> Result<bool, String> {
        let mut slot = self
            .subscriber
            .lock()
            .map_err(|_| error_code("desktop-system-state-unavailable"))?;
        let matches = slot
            .current
            .as_ref()
            .is_some_and(|subscriber| subscriber.owner == owner && subscriber.token == token);
        if matches {
            slot.current = None;
        }
        Ok(matches)
    }

    fn unsubscribe_by_token(&self, token: &str) -> Result<bool, String> {
        let mut slot = self
            .subscriber
            .lock()
            .map_err(|_| error_code("desktop-system-state-unavailable"))?;
        let matches = slot
            .current
            .as_ref()
            .is_some_and(|subscriber| subscriber.token == token);
        if matches {
            slot.current = None;
        }
        Ok(matches)
    }
}

fn tray_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use crate::native_locale::NativeTextKey;
    let show = MenuItemBuilder::with_id(
        TRAY_SHOW_ID,
        crate::native_locale::text(app, NativeTextKey::TrayShow),
    )
    .build(app)?;
    let capture = MenuItemBuilder::with_id(
        TRAY_CAPTURE_ID,
        crate::native_locale::text(app, NativeTextKey::TrayCapturePrimary),
    )
    .build(app)?;
    let quit = MenuItemBuilder::with_id(
        TRAY_QUIT_ID,
        crate::native_locale::text(app, NativeTextKey::Quit),
    )
    .build(app)?;
    MenuBuilder::new(app)
        .items(&[&show, &capture, &quit])
        .build()
}

pub(crate) fn refresh_tray_menu(app: &AppHandle) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id("screenhello-main") {
        tray.set_menu(Some(tray_menu(app)?))?;
    }
    Ok(())
}

fn setup_tray(app: &App) -> tauri::Result<()> {
    let menu = tray_menu(app.handle())?;
    let mut builder = TrayIconBuilder::with_id("screenhello-main")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_SHOW_ID => {
                let _ = show_main_window(app);
            }
            TRAY_CAPTURE_ID => {
                app.state::<DesktopSystemState>()
                    .request_capture(app, SystemEventSource::Tray);
            }
            TRAY_QUIT_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                let _ = show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

pub(crate) fn setup_system_integrations(app: &App) {
    let state = app.state::<DesktopSystemState>();
    let shortcut = capture_shortcut();
    let shortcut_status = app
        .global_shortcut()
        .on_shortcut(shortcut, |app, _, event| {
            if event.state == ShortcutState::Pressed {
                app.state::<DesktopSystemState>()
                    .request_capture(app, SystemEventSource::Shortcut);
            }
        })
        .map(|_| "registered")
        .unwrap_or("unavailable");
    state.set_shortcut(shortcut_status);
    let tray_status = setup_tray(app).map(|_| "ready").unwrap_or("unavailable");
    state.set_tray(tray_status);
}

#[tauri::command]
pub(crate) fn desktop_system_status(
    state: State<'_, DesktopSystemState>,
) -> Result<DesktopSystemStatus, String> {
    state.status()
}

#[tauri::command]
pub(crate) fn desktop_subscribe_system_events<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, DesktopSystemState>,
    subscription_token: String,
    on_event: Channel<SystemEvent>,
    epoch: Option<String>,
    sequence: Option<u64>,
) -> Result<bool, String> {
    if !crate::native_files::valid_token(&subscription_token) {
        return Err(error_code("desktop-system-subscription-invalid"));
    }
    state.subscribe(
        window.label().to_owned(),
        subscription_token,
        on_event,
        epoch.as_deref(),
        sequence,
    )
}

#[tauri::command]
pub(crate) fn desktop_unsubscribe_system_events<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, DesktopSystemState>,
    subscription_token: String,
) -> Result<bool, String> {
    if !crate::native_files::valid_token(&subscription_token) {
        return Ok(false);
    }
    state.unsubscribe(window.label(), &subscription_token)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tauri::ipc::InvokeResponseBody;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn status_is_bounded_and_has_no_environment_details() {
        let state = DesktopSystemState::default();
        let unavailable = serde_json::to_value(state.status().unwrap()).unwrap();
        assert_eq!(unavailable.get("shortcut").unwrap(), "unavailable");
        assert_eq!(unavailable.get("tray").unwrap(), "unavailable");
        state.set_shortcut("registered");
        state.set_tray("ready");
        let value = serde_json::to_value(state.status().unwrap()).unwrap();
        assert_eq!(value.get("schemaVersion").unwrap(), 1);
        assert_eq!(value.get("shortcut").unwrap(), "registered");
        assert_eq!(value.get("tray").unwrap(), "ready");
        assert_eq!(
            value.get("singleInstance").unwrap(),
            if cfg!(feature = "mac-app-store") {
                "unavailable"
            } else {
                "ready"
            }
        );
        assert!(value.get("args").is_none());
        assert!(value.get("cwd").is_none());
    }

    #[test]
    fn subscription_replacement_and_exact_unsubscribe_are_isolated() {
        let state = DesktopSystemState::default();
        let epoch_a = "1".repeat(48);
        let epoch_b = "2".repeat(48);
        let first = Channel::new(|_| Ok(()));
        let second = Channel::new(|_| Ok(()));
        let stale = Channel::new(|_| Ok(()));
        assert!(state
            .subscribe(
                "main".to_owned(),
                TOKEN.to_owned(),
                first,
                Some(&epoch_a),
                Some(1),
            )
            .unwrap());
        assert!(state
            .subscribe(
                "main".to_owned(),
                "a".repeat(48),
                second,
                Some(&epoch_a),
                Some(2),
            )
            .unwrap());
        // Delayed older subscribe in the same epoch must be ignored
        assert!(!state
            .subscribe(
                "main".to_owned(),
                "b".repeat(48),
                stale,
                Some(&epoch_a),
                Some(1),
            )
            .unwrap());
        assert!(!state.unsubscribe("main", TOKEN).unwrap());
        assert!(state.unsubscribe("main", &"a".repeat(48)).unwrap());
        // Fresh epoch after WebView reload resets ordering
        assert!(state
            .subscribe(
                "main".to_owned(),
                TOKEN.to_owned(),
                Channel::new(|_| Ok(())),
                Some(&epoch_b),
                Some(1),
            )
            .unwrap());
    }

    #[test]
    fn pending_event_is_coalesced_delivered_once_and_dropped_when_expired() {
        let state = DesktopSystemState::default();
        *state.pending.lock().unwrap() = Some(PendingSystemEvent {
            source: SystemEventSource::Shortcut,
            granted_at: Instant::now(),
        });
        let messages = Arc::new(Mutex::new(Vec::new()));
        let received = messages.clone();
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Json(value) = body {
                received.lock().unwrap().push(value);
            }
            Ok(())
        });
        state
            .subscribe("main".to_owned(), TOKEN.to_owned(), channel, None, None)
            .unwrap();
        assert_eq!(messages.lock().unwrap().len(), 1);
        assert!(messages.lock().unwrap()[0].contains("capture-primary"));
        assert!(state.pending.lock().unwrap().is_none());

        // Expired pending event (> 5s TTL) must be dropped silently on subscribe
        *state.pending.lock().unwrap() = Some(PendingSystemEvent {
            source: SystemEventSource::Tray,
            granted_at: Instant::now() - PENDING_EVENT_TTL - Duration::from_secs(1),
        });
        let expired_messages = Arc::new(Mutex::new(Vec::new()));
        let expired_received = expired_messages.clone();
        let channel2 = Channel::new(move |body| {
            if let InvokeResponseBody::Json(value) = body {
                expired_received.lock().unwrap().push(value);
            }
            Ok(())
        });
        state
            .subscribe("main".to_owned(), "c".repeat(48), channel2, None, None)
            .unwrap();
        assert!(expired_messages.lock().unwrap().is_empty());
        assert!(state.pending.lock().unwrap().is_none());
    }
}
