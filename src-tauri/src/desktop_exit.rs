use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{ipc::Channel, AppHandle, Manager, Runtime, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExitRequest {
    schema_version: u8,
    request_id: String,
}

#[derive(Clone)]
struct Subscriber {
    token: String,
    channel: Channel<ExitRequest>,
}

#[derive(Default)]
struct ExitSession {
    subscriber: Option<Subscriber>,
    pending: Option<(String, Option<String>)>,
    sequence: u64,
    sub_epoch: Option<String>,
    sub_last_sequence: u64,
}

#[derive(Default)]
pub(crate) struct DesktopExitState {
    session: Mutex<ExitSession>,
    approved: AtomicBool,
}

impl DesktopExitState {
    fn subscribe(
        &self,
        owner: &str,
        token: String,
        channel: Channel<ExitRequest>,
        epoch: Option<&str>,
        sequence: Option<u64>,
    ) -> Result<bool, String> {
        if owner != "main" || !crate::native_files::valid_token(&token) {
            return Err("desktop-exit-owner-invalid".into());
        }
        let mut session = self
            .session
            .lock()
            .map_err(|_| "desktop-exit-state-unavailable")?;
        if let (Some(epoch), Some(sequence)) = (epoch, sequence) {
            if !crate::native_files::valid_token(epoch) || sequence == 0 {
                return Err("desktop-exit-owner-invalid".into());
            }
            if session.sub_epoch.as_deref() == Some(epoch) {
                if sequence <= session.sub_last_sequence {
                    return Ok(false);
                }
                session.sub_last_sequence = sequence;
            } else {
                session.sub_epoch = Some(epoch.to_owned());
                session.sub_last_sequence = sequence;
            }
        }
        session.pending = None;
        session.subscriber = Some(Subscriber { token, channel });
        Ok(true)
    }

    fn unsubscribe(&self, owner: &str, token: &str) -> Result<(), String> {
        if owner != "main" {
            return Err("desktop-exit-owner-invalid".into());
        }
        let mut session = self
            .session
            .lock()
            .map_err(|_| "desktop-exit-state-unavailable")?;
        if session
            .subscriber
            .as_ref()
            .is_some_and(|subscriber| subscriber.token == token)
        {
            session.subscriber = None;
            session.pending = None;
        }
        Ok(())
    }

    fn begin(&self) -> Option<(ExitRequest, Option<Subscriber>)> {
        let mut session = self.session.lock().ok()?;
        if session.pending.is_some() {
            return None;
        }
        session.sequence = session.sequence.checked_add(1)?;
        let request_id = session.sequence.to_string();
        let subscriber = session.subscriber.clone();
        session.pending = Some((
            request_id.clone(),
            subscriber.as_ref().map(|item| item.token.clone()),
        ));
        Some((
            ExitRequest {
                schema_version: 1,
                request_id,
            },
            subscriber,
        ))
    }

    fn use_native_fallback(&self, request_id: &str) -> bool {
        let Ok(mut session) = self.session.lock() else {
            return false;
        };
        if let Some((id, token)) = session.pending.as_mut() {
            if id == request_id {
                *token = None;
                return true;
            }
        }
        false
    }

    fn resolve(
        &self,
        owner: &str,
        token: Option<&str>,
        request_id: &str,
        allow: bool,
    ) -> Result<(), String> {
        if owner != "main" {
            return Err("desktop-exit-owner-invalid".into());
        }
        let mut session = self
            .session
            .lock()
            .map_err(|_| "desktop-exit-state-unavailable")?;
        if !session
            .pending
            .as_ref()
            .is_some_and(|(id, expected)| id == request_id && expected.as_deref() == token)
        {
            return Err("desktop-exit-request-invalid".into());
        }
        session.pending = None;
        self.approved.store(allow, Ordering::Release);
        Ok(())
    }

    pub(crate) fn take_approval(&self) -> bool {
        self.approved.swap(false, Ordering::AcqRel)
    }
}

pub(crate) fn request_exit<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<DesktopExitState>();
    let Some((request, subscriber)) = state.begin() else {
        return;
    };
    let _ = crate::desktop_system::show_main_window(app);
    if let Some(subscriber) = subscriber {
        if subscriber.channel.send(request.clone()).is_ok() {
            return;
        }
    }
    // A missing subscriber or failed delivery must not silently discard data.
    // Only an explicit native confirmation can approve this fallback request.
    if !state.use_native_fallback(&request.request_id) {
        return;
    }
    let app_handle = app.clone();
    let mut dialog = app
        .dialog()
        .message(crate::native_locale::text(
            app,
            crate::native_locale::NativeTextKey::ExitNotReadyMessage,
        ))
        .title("ScreenHello")
        .buttons(MessageDialogButtons::OkCancelCustom(
            crate::native_locale::text(app, crate::native_locale::NativeTextKey::Quit).into(),
            crate::native_locale::text(app, crate::native_locale::NativeTextKey::Cancel).into(),
        ));
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.parent(&window);
    }
    dialog.show(move |allow| {
        if app_handle
            .state::<DesktopExitState>()
            .resolve("main", None, &request.request_id, allow)
            .is_ok()
            && allow
        {
            app_handle.exit(0);
        }
    });
}

#[tauri::command]
pub(crate) fn desktop_subscribe_exit_requests(
    window: WebviewWindow,
    state: State<'_, DesktopExitState>,
    subscription_token: String,
    on_event: Channel<ExitRequest>,
    epoch: Option<String>,
    sequence: Option<u64>,
) -> Result<bool, String> {
    state.subscribe(
        window.label(),
        subscription_token,
        on_event,
        epoch.as_deref(),
        sequence,
    )
}

#[tauri::command]
pub(crate) fn desktop_unsubscribe_exit_requests(
    window: WebviewWindow,
    state: State<'_, DesktopExitState>,
    subscription_token: String,
) -> Result<(), String> {
    state.unsubscribe(window.label(), &subscription_token)
}

#[tauri::command]
pub(crate) fn desktop_resolve_exit_request(
    window: WebviewWindow,
    state: State<'_, DesktopExitState>,
    subscription_token: String,
    request_id: String,
    allow: bool,
) -> Result<(), String> {
    state.resolve(
        window.label(),
        Some(&subscription_token),
        &request_id,
        allow,
    )?;
    if allow {
        window.app_handle().exit(0);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef";
    const EPOCH_A: &str = "111111111111111111111111111111111111111111111111";
    const EPOCH_B: &str = "222222222222222222222222222222222222222222222222";

    #[test]
    fn approval_requires_a_native_request_current_subscription_and_main_owner() {
        let state = DesktopExitState::default();
        assert!(state
            .subscribe("other", TOKEN.into(), Channel::new(|_| Ok(())), None, None)
            .is_err());
        assert!(state
            .subscribe("main", "bad".into(), Channel::new(|_| Ok(())), None, None)
            .is_err());
        state
            .subscribe("main", TOKEN.into(), Channel::new(|_| Ok(())), None, None)
            .unwrap();
        assert!(state.resolve("main", Some(TOKEN), "1", true).is_err());
        let (request, _) = state.begin().unwrap();
        assert!(state.begin().is_none());
        assert!(state
            .resolve("other", Some(TOKEN), &request.request_id, true)
            .is_err());
        assert!(state
            .resolve("main", Some("bad"), &request.request_id, true)
            .is_err());
        assert!(!state.take_approval());
        state
            .resolve("main", Some(TOKEN), &request.request_id, true)
            .unwrap();
        assert!(state.take_approval());
        assert!(!state.take_approval());
        assert!(state
            .resolve("main", Some(TOKEN), &request.request_id, true)
            .is_err());
    }

    #[test]
    fn cancellation_replacement_and_cleanup_invalidate_old_requests() {
        let state = DesktopExitState::default();
        state
            .subscribe(
                "main",
                TOKEN.into(),
                Channel::new(|_| Ok(())),
                Some(EPOCH_A),
                Some(1),
            )
            .unwrap();
        let (first, _) = state.begin().unwrap();
        state
            .resolve("main", Some(TOKEN), &first.request_id, false)
            .unwrap();
        assert!(!state.take_approval());
        let (old, _) = state.begin().unwrap();
        let replacement = "a".repeat(48);
        assert!(state
            .subscribe(
                "main",
                replacement.clone(),
                Channel::new(|_| Ok(())),
                Some(EPOCH_A),
                Some(2),
            )
            .unwrap());
        // Stale delayed subscribe in the same epoch must not replace the active subscriber
        assert!(!state
            .subscribe(
                "main",
                TOKEN.into(),
                Channel::new(|_| Ok(())),
                Some(EPOCH_A),
                Some(1),
            )
            .unwrap());
        let (current, _) = state.begin().unwrap();
        state.unsubscribe("main", TOKEN).unwrap();
        assert!(state
            .resolve("main", Some(TOKEN), &old.request_id, true)
            .is_err());
        state.unsubscribe("main", &replacement).unwrap();
        assert!(state
            .resolve("main", Some(&replacement), &current.request_id, true)
            .is_err());
        assert!(!state.take_approval());

        // Reload starts a new epoch and accepts sequence = 1
        assert!(state
            .subscribe(
                "main",
                TOKEN.into(),
                Channel::new(|_| Ok(())),
                Some(EPOCH_B),
                Some(1),
            )
            .unwrap());
    }

    #[test]
    fn native_fallback_cannot_be_approved_by_frontend_or_replayed() {
        let state = DesktopExitState::default();
        state
            .subscribe("main", TOKEN.into(), Channel::new(|_| Ok(())), None, None)
            .unwrap();
        let (request, _) = state.begin().unwrap();
        assert!(state.use_native_fallback(&request.request_id));
        assert!(state
            .resolve("main", Some(TOKEN), &request.request_id, true)
            .is_err());
        state
            .resolve("main", None, &request.request_id, false)
            .unwrap();
        assert!(!state.take_approval());
        let (next, _) = state.begin().unwrap();
        assert_ne!(request.request_id, next.request_id);
        assert!(state.use_native_fallback(&next.request_id));
        state.resolve("main", None, &next.request_id, true).unwrap();
        assert!(state.take_approval());
    }
}
