use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

#[derive(Clone, Copy, Deserialize)]
pub(crate) enum NativeLocale {
    #[serde(rename = "zh-CN")]
    Chinese,
    #[serde(rename = "en-US")]
    English,
}

#[derive(Default)]
pub(crate) struct NativeLocaleState(AtomicBool);

pub(crate) fn text<R: Runtime>(app: &AppHandle<R>, source: &'static str) -> &'static str {
    if !app.state::<NativeLocaleState>().0.load(Ordering::Acquire) {
        return source;
    }
    english(source)
}

fn english(source: &str) -> &str {
    match source {
        "显示 ScreenHello" => "Show ScreenHello", "截取主屏幕" => "Capture primary display", "退出" => "Quit",
        "打开 ScreenHello 项目" => "Open ScreenHello project", "选择本地图片" => "Choose local images",
        "保存 ScreenHello 项目" => "Save ScreenHello project", "ScreenHello 项目" => "ScreenHello project",
        "导出 ScreenHello 风格预设" => "Export ScreenHello style preset", "ScreenHello 风格预设" => "ScreenHello style preset",
        "导出 PNG 图片" => "Export PNG image", "PNG 图片" => "PNG image",
        "导出 JPEG 图片" => "Export JPEG image", "JPEG 图片" => "JPEG image",
        "导出 WebP 图片" => "Export WebP image", "WebP 图片" => "WebP image",
        "导出 AVIF 图片" => "Export AVIF image", "AVIF 图片" => "AVIF image",
        "导出批量图片" => "Export batch images", "ZIP 压缩包" => "ZIP archive", "图片" => "Images",
        "允许本次读取显示器和窗口标题，并截取您选择的一个来源吗？图片仅在本机处理。" => "Allow this request to read display and window titles and capture one selected source? Images stay on this device.",
        "ScreenHello — 截图授权" => "ScreenHello — Capture permission", "允许本次" => "Allow once", "取消" => "Cancel",
        "显示器" => "Display", "未命名窗口" => "Untitled window",
        _ => source,
    }
}

#[tauri::command]
pub(crate) fn desktop_set_locale(
    window: WebviewWindow,
    locale: NativeLocale,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("desktop-locale-owner-invalid".into());
    }
    window
        .state::<NativeLocaleState>()
        .0
        .store(matches!(locale, NativeLocale::English), Ordering::Release);
    crate::desktop_system::refresh_tray_menu(window.app_handle())
        .map_err(|_| "desktop-locale-tray-unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn locale_contract_is_bounded_and_user_text_is_not_translated() {
        assert!(serde_json::from_str::<NativeLocale>("\"en-US\"").is_ok());
        assert!(serde_json::from_str::<NativeLocale>("\"zh-CN\"").is_ok());
        assert!(serde_json::from_str::<NativeLocale>("\"../file\"").is_err());
        assert_eq!(english("取消"), "Cancel");
        assert_eq!(english("user-project-中文.png"), "user-project-中文.png");
    }
}
