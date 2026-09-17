fn main() {
    println!("cargo:rerun-if-env-changed=MACOSX_DEPLOYMENT_TARGET");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos")
        && std::env::var_os("CARGO_FEATURE_SCREEN_CAPTURE_KIT").is_some()
    {
        let major = std::env::var("MACOSX_DEPLOYMENT_TARGET")
            .ok()
            .and_then(|value| value.split('.').next()?.parse::<u32>().ok());
        assert!(
            major.is_some_and(|value| value >= 14),
            "ScreenCaptureKit requires MACOSX_DEPLOYMENT_TARGET >= 14"
        );
    }

    assert!(
        !(std::env::var_os("CARGO_FEATURE_MAC_APP_STORE").is_some()
            && std::env::var_os("CARGO_FEATURE_DESKTOP_TEST_DRIVER").is_some()),
        "mac-app-store must not include the runner-only test driver"
    );
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
            "desktop_open_help",
            "desktop_state_status",
            "desktop_set_locale",
            "desktop_pick_files",
            "desktop_read_file",
            "desktop_choose_save_file",
            "desktop_write_file",
            "desktop_release_file",
            "desktop_capture_capability",
            "desktop_list_capture_sources",
            "desktop_capture_source",
            "desktop_capture_primary",
            "desktop_release_capture_sources",
            "desktop_system_status",
            "desktop_subscribe_system_events",
            "desktop_unsubscribe_system_events",
            "desktop_subscribe_exit_requests",
            "desktop_unsubscribe_exit_requests",
            "desktop_resolve_exit_request",
        ]),
    ))
    .expect("failed to build ScreenHello desktop configuration");
}
