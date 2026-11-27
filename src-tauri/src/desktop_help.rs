use serde::Deserialize;
use tauri::{Runtime, WebviewWindow};

// IPC accepts a closed identifier, never a URL, path or program name.
#[derive(Clone, Copy, Debug, Deserialize)]
pub(crate) enum HelpTopic {
    #[serde(rename = "help.documentation")]
    Documentation,
    #[serde(rename = "help.reportIssue")]
    ReportIssue,
    #[serde(rename = "help.github")]
    Github,
    #[serde(rename = "help.runtimePrivacy")]
    RuntimePrivacy,
}

fn help_url(owner: &str, topic: HelpTopic) -> Result<&'static str, &'static str> {
    if owner != "main" {
        return Err("desktop-help-owner-invalid");
    }
    Ok(match topic {
        HelpTopic::Documentation => "https://github.com/web-casa/ScreenHello/tree/main/DOCS",
        HelpTopic::ReportIssue => "https://github.com/web-casa/ScreenHello/issues",
        HelpTopic::Github => "https://github.com/web-casa/ScreenHello",
        HelpTopic::RuntimePrivacy => {
            "https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/data-privacy"
        }
    })
}

#[tauri::command]
pub(crate) async fn desktop_open_help<R: Runtime>(
    window: WebviewWindow<R>,
    topic: HelpTopic,
) -> Result<(), String> {
    let url = help_url(window.label(), topic).map_err(str::to_owned)?;
    // Do not block the UI on a desktop portal or browser launcher. Keep OS error
    // details (which may contain local paths) out of the IPC response.
    tauri::async_runtime::spawn_blocking(move || open::that(url))
        .await
        .map_err(|_| "desktop-help-open-failed".to_owned())?
        .map_err(|_| "desktop-help-open-failed".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_main_can_open_fixed_https_help_destinations() {
        for id in [
            "help.documentation",
            "help.reportIssue",
            "help.github",
            "help.runtimePrivacy",
        ] {
            let topic: HelpTopic = serde_json::from_value(serde_json::json!(id)).unwrap();
            assert!(help_url("main", topic).unwrap().starts_with("https://"));
            assert_eq!(
                help_url("secondary", topic),
                Err("desktop-help-owner-invalid")
            );
        }
    }

    #[test]
    fn arbitrary_urls_paths_and_identifiers_are_rejected_before_launch() {
        for input in [
            "https://evil.example",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "help.github?x=1",
            "../help.github",
            "help.privacy",
            "__proto__",
        ] {
            assert!(serde_json::from_value::<HelpTopic>(serde_json::json!(input)).is_err());
        }
        assert!(serde_json::from_value::<HelpTopic>(
            serde_json::json!({"url": "https://github.com"})
        )
        .is_err());
    }
}
