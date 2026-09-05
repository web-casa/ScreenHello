use serde::Serialize;

mod desktop_capture;
mod desktop_system;
mod native_files;

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
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = desktop_system::show_main_window(app);
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init());

    #[cfg(feature = "desktop-test-driver")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .manage(native_files::NativeFileState::default())
        .manage(desktop_capture::CaptureSourceState::default())
        .manage(desktop_system::DesktopSystemState::default())
        .setup(|app| {
            desktop_system::setup_system_integrations(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_environment,
            native_files::desktop_pick_files,
            native_files::desktop_read_file,
            native_files::desktop_choose_save_file,
            native_files::desktop_write_file,
            native_files::desktop_release_file,
            desktop_capture::desktop_list_capture_sources,
            desktop_capture::desktop_capture_source,
            desktop_capture::desktop_capture_primary,
            desktop_capture::desktop_release_capture_sources,
            desktop_system::desktop_system_status,
            desktop_system::desktop_subscribe_system_events,
            desktop_system::desktop_unsubscribe_system_events,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run ScreenHello desktop application");
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
