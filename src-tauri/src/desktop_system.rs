use serde::Serialize;
use std::sync::Mutex;
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

#[derive(Default)]
pub(crate) struct DesktopSystemState {
    availability: Mutex<Availability>,
    subscriber: Mutex<Option<SystemSubscriber>>,
    pending: Mutex<Option<SystemEventSource>>,
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
            single_instance: "ready",
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
        let _ = show_main_window(app);
        let subscriber = match self.subscriber.lock() {
            Ok(subscriber) => match subscriber.as_ref() {
                Some(subscriber) => subscriber.clone(),
                None => {
                    if let Ok(mut pending) = self.pending.lock() {
                        *pending = Some(source);
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
        if let Ok(mut current) = self.subscriber.lock() {
            if current.as_ref().is_some_and(|candidate| {
                candidate.owner == subscriber.owner && candidate.token == subscriber.token
            }) {
                *current = None;
            }
        }
        if let Ok(current) = self.subscriber.lock() {
            if current.is_none()
                || current.as_ref().is_some_and(|candidate| {
                    candidate.owner == subscriber.owner && candidate.token == subscriber.token
                })
            {
                if let Ok(mut pending) = self.pending.lock() {
                    *pending = Some(source);
                }
            }
        }
    }

    fn subscribe(
        &self,
        owner: String,
        token: String,
        channel: Channel<SystemEvent>,
    ) -> Result<(), String> {
        let source = {
            let mut subscriber = self
                .subscriber
                .lock()
                .map_err(|_| error_code("desktop-system-state-unavailable"))?;
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| error_code("desktop-system-state-unavailable"))?;
            *subscriber = Some(SystemSubscriber {
                owner,
                token: token.clone(),
                channel: channel.clone(),
            });
            pending.take()
        };
        if let Some(source) = source {
            let event = SystemEvent {
                schema_version: 1,
                action: "capture-primary",
                source,
            };
            if channel.send(event).is_err() {
                let _ = self.unsubscribe_by_token(&token);
                if let Ok(mut pending) = self.pending.lock() {
                    *pending = Some(source);
                }
                return Err(error_code("desktop-system-channel-unavailable"));
            }
        }
        Ok(())
    }

    fn unsubscribe(&self, owner: &str, token: &str) -> Result<bool, String> {
        let mut subscriber = self
            .subscriber
            .lock()
            .map_err(|_| error_code("desktop-system-state-unavailable"))?;
        let matches = subscriber
            .as_ref()
            .is_some_and(|subscriber| subscriber.owner == owner && subscriber.token == token);
        if matches {
            *subscriber = None;
        }
        Ok(matches)
    }

    fn unsubscribe_by_token(&self, token: &str) -> Result<bool, String> {
        let mut subscriber = self
            .subscriber
            .lock()
            .map_err(|_| error_code("desktop-system-state-unavailable"))?;
        let matches = subscriber
            .as_ref()
            .is_some_and(|subscriber| subscriber.token == token);
        if matches {
            *subscriber = None;
        }
        Ok(matches)
    }
}

fn setup_tray(app: &App) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id(TRAY_SHOW_ID, "显示 ScreenHello").build(app)?;
    let capture = MenuItemBuilder::with_id(TRAY_CAPTURE_ID, "截取主屏幕").build(app)?;
    let quit = MenuItemBuilder::with_id(TRAY_QUIT_ID, "退出").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show, &capture, &quit])
        .build()?;
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
) -> Result<(), String> {
    if !crate::native_files::valid_token(&subscription_token) {
        return Err(error_code("desktop-system-subscription-invalid"));
    }
    state.subscribe(window.label().to_owned(), subscription_token, on_event)
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
        assert_eq!(value.get("singleInstance").unwrap(), "ready");
        assert!(value.get("args").is_none());
        assert!(value.get("cwd").is_none());
    }

    #[test]
    fn subscription_replacement_and_exact_unsubscribe_are_isolated() {
        let state = DesktopSystemState::default();
        let first = Channel::new(|_| Ok(()));
        let second = Channel::new(|_| Ok(()));
        state
            .subscribe("main".to_owned(), TOKEN.to_owned(), first)
            .unwrap();
        state
            .subscribe("main".to_owned(), "a".repeat(48), second)
            .unwrap();
        assert!(!state.unsubscribe("main", TOKEN).unwrap());
        assert!(state.unsubscribe("main", &"a".repeat(48)).unwrap());
    }

    #[test]
    fn pending_event_is_coalesced_and_delivered_once() {
        let state = DesktopSystemState::default();
        *state.pending.lock().unwrap() = Some(SystemEventSource::Shortcut);
        let messages = Arc::new(Mutex::new(Vec::new()));
        let received = messages.clone();
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Json(value) = body {
                received.lock().unwrap().push(value);
            }
            Ok(())
        });
        state
            .subscribe("main".to_owned(), TOKEN.to_owned(), channel)
            .unwrap();
        let messages = messages.lock().unwrap();
        assert_eq!(messages.len(), 1);
        assert!(messages[0].contains("capture-primary"));
        assert!(state.pending.lock().unwrap().is_none());
    }
}
