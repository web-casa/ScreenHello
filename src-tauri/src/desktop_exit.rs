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
    ) -> Result<(), String> {
        if owner != "main" || !crate::native_files::valid_token(&token) {
            return Err("desktop-exit-owner-invalid".into());
        }
        let mut session = self
            .session
            .lock()
            .map_err(|_| "desktop-exit-state-unavailable")?;
        session.pending = None;
        session.subscriber = Some(Subscriber { token, channel });
        Ok(())
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
            "编辑器尚未就绪，退出可能丢失未保存内容。仍要退出吗？",
        ))
        .title("ScreenHello")
        .buttons(MessageDialogButtons::OkCancelCustom(
            crate::native_locale::text(app, "退出").into(),
            crate::native_locale::text(app, "取消").into(),
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
) -> Result<(), String> {
    state.subscribe(window.label(), subscription_token, on_event)
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

    #[test]
    fn approval_requires_a_native_request_current_subscription_and_main_owner() {
        let state = DesktopExitState::default();
        assert!(state
            .subscribe("other", TOKEN.into(), Channel::new(|_| Ok(())))
            .is_err());
        assert!(state
            .subscribe("main", "bad".into(), Channel::new(|_| Ok(())))
            .is_err());
        state
            .subscribe("main", TOKEN.into(), Channel::new(|_| Ok(())))
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
            .subscribe("main", TOKEN.into(), Channel::new(|_| Ok(())))
            .unwrap();
        let (first, _) = state.begin().unwrap();
        state
            .resolve("main", Some(TOKEN), &first.request_id, false)
            .unwrap();
        assert!(!state.take_approval());
        let (old, _) = state.begin().unwrap();
        let replacement = "a".repeat(48);
        state
            .subscribe("main", replacement.clone(), Channel::new(|_| Ok(())))
            .unwrap();
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
    }

    #[test]
    fn native_fallback_cannot_be_approved_by_frontend_or_replayed() {
        let state = DesktopExitState::default();
        state
            .subscribe("main", TOKEN.into(), Channel::new(|_| Ok(())))
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
