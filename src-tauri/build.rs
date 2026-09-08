fn main() {
    println!("cargo:rerun-if-env-changed=SCREENHELLO_TEST_DRIVER_BUILD");
    if std::env::var_os("CARGO_FEATURE_DESKTOP_TEST_DRIVER").is_some() {
        assert_eq!(
            std::env::var("SCREENHELLO_TEST_DRIVER_BUILD").as_deref(),
            Ok("runner-only"),
            "desktop-test-driver requires the explicit runner-only build entry"
        );
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_environment",
            "desktop_set_locale",
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
