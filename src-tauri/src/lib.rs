use serde::Serialize;
use tauri::Manager;

mod desktop_capture;
mod capture_geometry;
#[cfg(all(target_os = "macos", feature = "screen-capture-kit"))]
mod macos_capture;
mod desktop_exit;
mod desktop_help;
mod desktop_state;
mod desktop_system;
mod native_files;
mod native_locale;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopEnvironment {
    schema_version: u8,
    runtime: &'static str,
    platform: &'static str,
    arch: &'static str,
    app_version: &'static str,
    debug: bool,
}

fn current_desktop_environment() -> DesktopEnvironment {
    DesktopEnvironment {
        schema_version: 1,
        runtime: "tauri",
        platform: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        app_version: env!("CARGO_PKG_VERSION"),
        debug: cfg!(debug_assertions),
    }
}

#[tauri::command]
fn desktop_environment() -> DesktopEnvironment {
    current_desktop_environment()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // The plugin binds a shared /tmp socket on macOS. MAS uses the OS app
    // lifecycle; do not request a sandbox exception for an optional integration.
    #[cfg(not(feature = "mac-app-store"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        let _ = desktop_system::show_main_window(app);
    }));
    let builder = builder
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init());

    #[cfg(feature = "desktop-test-driver")]
    let builder = {
        // This marker must remain in test binaries for the artifact reject gate.
        assert_eq!(
            std::env::var("SCREENHELLO_TEST_DRIVER_RUN").as_deref(),
            Ok("runner-only"),
            "SCREENHELLO_RUNNER_ONLY_TEST_BINARY: explicit test runtime required"
        );
        builder.plugin(tauri_plugin_wdio_webdriver::init())
    };

    builder
        .manage(native_locale::NativeLocaleState::default())
        .manage(native_files::NativeFileState::default())
        .manage(desktop_capture::CaptureSourceState::default())
        .manage(desktop_state::DesktopState::default())
        .manage(desktop_system::DesktopSystemState::default())
        .manage(desktop_exit::DesktopExitState::default())
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    desktop_exit::request_exit(window.app_handle());
                }
            }
        })
        .setup(|app| {
            app.state::<desktop_state::DesktopState>().initialize(app);
            desktop_system::setup_system_integrations(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_environment,
            desktop_help::desktop_open_help,
            desktop_state::desktop_state_status,
            native_locale::desktop_set_locale,
            native_files::desktop_pick_files,
            native_files::desktop_read_file,
            native_files::desktop_choose_save_file,
            native_files::desktop_write_file,
            native_files::desktop_release_file,
            desktop_capture::desktop_capture_capability,
            desktop_capture::desktop_list_capture_sources,
            desktop_capture::desktop_capture_source,
            desktop_capture::desktop_capture_primary,
            desktop_capture::desktop_release_capture_sources,
            desktop_system::desktop_system_status,
            desktop_system::desktop_subscribe_system_events,
            desktop_system::desktop_unsubscribe_system_events,
            desktop_exit::desktop_subscribe_exit_requests,
            desktop_exit::desktop_unsubscribe_exit_requests,
            desktop_exit::desktop_resolve_exit_request,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build ScreenHello desktop application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !app
                    .state::<desktop_exit::DesktopExitState>()
                    .take_approval()
                {
                    api.prevent_exit();
                    desktop_exit::request_exit(app);
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::current_desktop_environment;

    #[test]
    fn environment_payload_is_bounded_and_serializable() {
        let value = serde_json::to_value(current_desktop_environment()).unwrap();
        let object = value.as_object().unwrap();

        assert_eq!(object.len(), 6);
        assert_eq!(object.get("schemaVersion").unwrap(), 1);
        assert_eq!(object.get("runtime").unwrap(), "tauri");
        assert!(matches!(
            object.get("platform").and_then(|value| value.as_str()),
            Some("linux" | "macos" | "windows")
        ));
        assert!(object
            .get("arch")
            .and_then(|value| value.as_str())
            .is_some());
        assert_eq!(object.get("appVersion").unwrap(), env!("CARGO_PKG_VERSION"));
        assert!(object
            .get("debug")
            .and_then(|value| value.as_bool())
            .is_some());
        assert!(object.get("path").is_none());
        assert!(object.get("hostname").is_none());
        assert!(object.get("environment").is_none());
    }
}
