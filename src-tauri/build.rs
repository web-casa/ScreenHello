fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_environment",
            "desktop_pick_files",
            "desktop_read_file",
            "desktop_choose_save_file",
            "desktop_write_file",
            "desktop_release_file",
            "desktop_list_capture_sources",
            "desktop_capture_source",
            "desktop_capture_primary",
            "desktop_release_capture_sources",
            "desktop_system_status",
            "desktop_subscribe_system_events",
            "desktop_unsubscribe_system_events",
        ]),
    ))
    .expect("failed to build ScreenHello desktop configuration");
}
