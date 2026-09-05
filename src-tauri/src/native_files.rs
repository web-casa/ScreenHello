use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    Runtime, State, WebviewWindow,
};
use tauri_plugin_dialog::DialogExt;

const MAX_PROJECT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 48 * 1024 * 1024;
const MAX_EXPORT_BYTES: u64 = 128 * 1024 * 1024;
const MAX_BATCH_BYTES: u64 = 256 * 1024 * 1024;
const MAX_PICKED_IMAGES: usize = 12;
const MAX_OPEN_TARGETS: usize = 64;
const TOKEN_LENGTH: usize = 48;
const TOKEN_HEADER: &str = "x-screenhello-file-token";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum OpenKind {
    Project,
    Images,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum SaveKind {
    Project,
    Preset,
    ImagePng,
    ImageJpeg,
    ImageWebp,
    ImageAvif,
    BatchZip,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TargetKind {
    Project,
    Image,
    Save(SaveKind),
}

impl TargetKind {
    fn byte_limit(self) -> u64 {
        match self {
            Self::Project | Self::Save(SaveKind::Project | SaveKind::Preset) => MAX_PROJECT_BYTES,
            Self::Image => MAX_IMAGE_BYTES,
            Self::Save(
                SaveKind::ImagePng
                | SaveKind::ImageJpeg
                | SaveKind::ImageWebp
                | SaveKind::ImageAvif,
            ) => MAX_EXPORT_BYTES,
            Self::Save(SaveKind::BatchZip) => MAX_BATCH_BYTES,
        }
    }

    fn read_once(self) -> bool {
        matches!(self, Self::Image)
    }
}

#[derive(Clone, Debug)]
struct NativeFileTarget {
    owner: String,
    path: PathBuf,
    kind: TargetKind,
}

#[derive(Default)]
pub(crate) struct NativeFileState {
    targets: Mutex<HashMap<String, NativeFileTarget>>,
}

impl NativeFileState {
    fn insert_many(&self, entries: Vec<(String, NativeFileTarget)>) -> Result<(), String> {
        let mut targets = self
            .targets
            .lock()
            .map_err(|_| error_code("native-file-state-unavailable"))?;
        if targets.len().saturating_add(entries.len()) > MAX_OPEN_TARGETS {
            return Err(error_code("native-file-handle-limit"));
        }
        if entries.iter().any(|(token, _)| targets.contains_key(token)) {
            return Err(error_code("native-file-token-conflict"));
        }
        for (token, target) in entries {
            targets.insert(token, target);
        }
        Ok(())
    }

    fn get_owned(&self, token: &str, owner: &str) -> Result<NativeFileTarget, String> {
        let targets = self
            .targets
            .lock()
            .map_err(|_| error_code("native-file-state-unavailable"))?;
        targets
            .get(token)
            .filter(|target| target.owner == owner)
            .cloned()
            .ok_or_else(|| error_code("native-file-handle-invalid"))
    }

    fn release_owned(&self, token: &str, owner: &str) -> Result<bool, String> {
        let mut targets = self
            .targets
            .lock()
            .map_err(|_| error_code("native-file-state-unavailable"))?;
        let owned = targets
            .get(token)
            .is_some_and(|target| target.owner == owner);
        if owned {
            targets.remove(token);
        }
        Ok(owned)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PickedFile {
    token: String,
    name: String,
    mime_type: &'static str,
    size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PickFilesResponse {
    status: &'static str,
    files: Vec<PickedFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveFileResponse {
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    token: Option<String>,
}

fn error_code(code: &'static str) -> String {
    code.to_owned()
}

pub(crate) fn valid_token(token: &str) -> bool {
    token.len() == TOKEN_LENGTH
        && token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn sanitized_name(path: &Path) -> String {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_default();
    let value: String = name
        .chars()
        .filter(|character| !character.is_control())
        .take(255)
        .collect();
    if value.is_empty() {
        "local-file".to_owned()
    } else {
        value
    }
}

fn image_mime(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => Some("image/png"),
        Some("jpg" | "jpeg") => Some("image/jpeg"),
        Some("bmp") => Some("image/bmp"),
        Some("gif") => Some("image/gif"),
        Some("webp") => Some("image/webp"),
        _ => None,
    }
}

fn describe_open_path(
    kind: OpenKind,
    path: PathBuf,
    token: String,
    owner: &str,
) -> Result<(PickedFile, NativeFileTarget), String> {
    let metadata = fs::metadata(&path).map_err(|_| error_code("native-file-metadata-failed"))?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(error_code("native-file-invalid"));
    }
    let (mime_type, target_kind) = match kind {
        OpenKind::Project => {
            let is_project = path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("screenhello"));
            if !is_project {
                return Err(error_code("native-file-type-unsupported"));
            }
            (
                "application/vnd.screenhello.project+zip",
                TargetKind::Project,
            )
        }
        OpenKind::Images => (
            image_mime(&path).ok_or_else(|| error_code("native-file-type-unsupported"))?,
            TargetKind::Image,
        ),
    };
    if metadata.len() > target_kind.byte_limit() {
        return Err(error_code("native-file-too-large"));
    }
    let picked = PickedFile {
        token: token.clone(),
        name: sanitized_name(&path),
        mime_type,
        size: metadata.len(),
    };
    let target = NativeFileTarget {
        owner: owner.to_owned(),
        path,
        kind: target_kind,
    };
    Ok((picked, target))
}

fn open_dialog_title(kind: OpenKind) -> &'static str {
    match kind {
        OpenKind::Project => "打开 ScreenHello 项目",
        OpenKind::Images => "选择本地图片",
    }
}

fn save_spec(kind: SaveKind) -> (&'static str, &'static str, &'static [&'static str]) {
    match kind {
        SaveKind::Project => (
            "保存 ScreenHello 项目",
            "ScreenHello 项目",
            &["screenhello"],
        ),
        SaveKind::Preset => (
            "导出 ScreenHello 风格预设",
            "ScreenHello 风格预设",
            &["screenhello-preset"],
        ),
        SaveKind::ImagePng => ("导出 PNG 图片", "PNG 图片", &["png"]),
        SaveKind::ImageJpeg => ("导出 JPEG 图片", "JPEG 图片", &["jpg", "jpeg"]),
        SaveKind::ImageWebp => ("导出 WebP 图片", "WebP 图片", &["webp"]),
        SaveKind::ImageAvif => ("导出 AVIF 图片", "AVIF 图片", &["avif"]),
        SaveKind::BatchZip => ("导出批量图片", "ZIP 压缩包", &["zip"]),
    }
}

fn sanitize_suggested_name(value: &str, kind: SaveKind) -> String {
    let (_, _, extensions) = save_spec(kind);
    let mut name: String = value
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
            {
                '_'
            } else {
                character
            }
        })
        .take(160)
        .collect();
    name = name.trim_matches([' ', '.']).to_owned();
    let has_allowed_extension = Path::new(&name)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extensions
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        });
    if name.is_empty() {
        name = "ScreenHello".to_owned();
    }
    if !has_allowed_extension {
        name.push('.');
        name.push_str(extensions[0]);
    }
    name
}

fn ensure_save_extension(mut path: PathBuf, kind: SaveKind) -> PathBuf {
    let (_, _, extensions) = save_spec(kind);
    let has_allowed_extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extensions
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        });
    if !has_allowed_extension {
        path.set_extension(extensions[0]);
    }
    path
}

fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(|_| error_code("native-file-read-failed"))?;
    let metadata = file
        .metadata()
        .map_err(|_| error_code("native-file-metadata-failed"))?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(error_code("native-file-invalid"));
    }
    if metadata.len() > limit {
        return Err(error_code("native-file-too-large"));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| error_code("native-file-read-failed"))?;
    if bytes.is_empty() || bytes.len() as u64 > limit {
        return Err(error_code("native-file-too-large"));
    }
    Ok(bytes)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .filter(|parent| parent.is_dir())
        .ok_or_else(|| error_code("native-file-parent-invalid"))?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".screenhello-")
        .suffix(".tmp")
        .tempfile_in(parent)
        .map_err(|_| error_code("native-file-write-failed"))?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| error_code("native-file-write-failed"))?;
    temporary
        .persist(path)
        .map_err(|_| error_code("native-file-write-failed"))?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn desktop_pick_files<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, NativeFileState>,
    kind: OpenKind,
    multiple: bool,
    tokens: Vec<String>,
) -> Result<PickFilesResponse, String> {
    let maximum = if kind == OpenKind::Images && multiple {
        MAX_PICKED_IMAGES
    } else {
        1
    };
    if (kind == OpenKind::Project && multiple)
        || tokens.len() != maximum
        || tokens.iter().any(|token| !valid_token(token))
        || tokens
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != tokens.len()
    {
        return Err(error_code("native-file-picker-request-invalid"));
    }

    let owner = window.label().to_owned();
    let mut dialog = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(open_dialog_title(kind));
    dialog = match kind {
        OpenKind::Project => dialog.add_filter("ScreenHello 项目", &["screenhello"]),
        OpenKind::Images => {
            dialog.add_filter("图片", &["png", "jpg", "jpeg", "bmp", "gif", "webp"])
        }
    };
    let selected = tauri::async_runtime::spawn_blocking(move || {
        if multiple {
            dialog.blocking_pick_files()
        } else {
            dialog.blocking_pick_file().map(|path| vec![path])
        }
    })
    .await
    .map_err(|_| error_code("native-file-picker-failed"))?;
    let Some(selected) = selected else {
        return Ok(PickFilesResponse {
            status: "cancelled",
            files: Vec::new(),
        });
    };
    if selected.is_empty() || selected.len() > maximum {
        return Err(error_code("native-file-picker-response-invalid"));
    }

    let mut picked_files = Vec::with_capacity(selected.len());
    let mut targets = Vec::with_capacity(selected.len());
    for (index, selected_path) in selected.into_iter().enumerate() {
        let path = selected_path
            .into_path()
            .map_err(|_| error_code("native-file-path-invalid"))?;
        let token = tokens[index].clone();
        let (picked, target) = describe_open_path(kind, path, token.clone(), &owner)?;
        picked_files.push(picked);
        targets.push((token, target));
    }
    state.insert_many(targets)?;
    Ok(PickFilesResponse {
        status: "selected",
        files: picked_files,
    })
}

#[tauri::command]
pub(crate) async fn desktop_read_file<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, NativeFileState>,
    token: String,
) -> Result<Response, String> {
    if !valid_token(&token) {
        return Err(error_code("native-file-handle-invalid"));
    }
    let owner = window.label().to_owned();
    let target = state.get_owned(&token, &owner)?;
    if matches!(target.kind, TargetKind::Save(_)) {
        return Err(error_code("native-file-handle-invalid"));
    }
    let path = target.path.clone();
    let limit = target.kind.byte_limit();
    let bytes = tauri::async_runtime::spawn_blocking(move || read_bounded(&path, limit))
        .await
        .map_err(|_| error_code("native-file-read-failed"))??;
    if target.kind.read_once() {
        state.release_owned(&token, &owner)?;
    }
    Ok(Response::new(bytes))
}

#[tauri::command]
pub(crate) async fn desktop_choose_save_file<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, NativeFileState>,
    kind: SaveKind,
    suggested_name: String,
    token: String,
) -> Result<SaveFileResponse, String> {
    if !valid_token(&token) || suggested_name.len() > 512 {
        return Err(error_code("native-file-picker-request-invalid"));
    }
    let owner = window.label().to_owned();
    let (title, filter_name, extensions) = save_spec(kind);
    let file_name = sanitize_suggested_name(&suggested_name, kind);
    let dialog = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(title)
        .set_file_name(file_name)
        .add_filter(filter_name, extensions);
    let selected = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|_| error_code("native-file-picker-failed"))?;
    let Some(selected) = selected else {
        return Ok(SaveFileResponse {
            status: "cancelled",
            token: None,
        });
    };
    let path = ensure_save_extension(
        selected
            .into_path()
            .map_err(|_| error_code("native-file-path-invalid"))?,
        kind,
    );
    if !path.parent().is_some_and(Path::is_dir) {
        return Err(error_code("native-file-parent-invalid"));
    }
    state.insert_many(vec![(
        token.clone(),
        NativeFileTarget {
            owner,
            path,
            kind: TargetKind::Save(kind),
        },
    )])?;
    Ok(SaveFileResponse {
        status: "selected",
        token: Some(token),
    })
}

#[tauri::command]
pub(crate) async fn desktop_write_file<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, NativeFileState>,
    request: Request<'_>,
) -> Result<(), String> {
    let token = request
        .headers()
        .get(TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .filter(|value| valid_token(value))
        .ok_or_else(|| error_code("native-file-handle-invalid"))?
        .to_owned();
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(error_code("native-file-request-must-be-raw"));
    };
    let owner = window.label().to_owned();
    let target = state.get_owned(&token, &owner)?;
    if !matches!(target.kind, TargetKind::Project | TargetKind::Save(_)) || bytes.is_empty() {
        return Err(error_code("native-file-write-invalid"));
    }
    if bytes.len() as u64 > target.kind.byte_limit() {
        return Err(error_code("native-file-too-large"));
    }
    let path = target.path.clone();
    let data = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || write_atomic(&path, &data))
        .await
        .map_err(|_| error_code("native-file-write-failed"))??;
    Ok(())
}

#[tauri::command]
pub(crate) fn desktop_release_file<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, NativeFileState>,
    token: String,
) -> Result<bool, String> {
    if !valid_token(&token) {
        return Ok(false);
    }
    state.release_owned(&token, window.label())
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn tokens_are_lowercase_fixed_and_unambiguous() {
        assert!(valid_token(TOKEN));
        assert!(!valid_token("0123"));
        assert!(!valid_token(
            "0123456789ABCDEF0123456789abcdef0123456789abcdef"
        ));
        assert!(!valid_token(
            "../../etc/passwd00000000000000000000000000000000"
        ));
    }

    #[test]
    fn suggested_names_cannot_supply_paths_or_wrong_extensions() {
        assert_eq!(
            sanitize_suggested_name("../../secret.txt", SaveKind::Project),
            "_.._secret.txt.screenhello"
        );
        assert_eq!(
            sanitize_suggested_name("capture.JPEG", SaveKind::ImageJpeg),
            "capture.JPEG"
        );
        assert_eq!(
            ensure_save_extension(PathBuf::from("capture.exe"), SaveKind::ImagePng),
            PathBuf::from("capture.png")
        );
    }

    #[test]
    fn open_descriptors_enforce_type_size_and_hide_paths() {
        let directory = tempfile::tempdir().unwrap();
        let image_path = directory.path().join("visible.png");
        fs::write(&image_path, b"png").unwrap();
        let (picked, target) =
            describe_open_path(OpenKind::Images, image_path, TOKEN.to_owned(), "main").unwrap();
        let json = serde_json::to_value(&picked).unwrap();
        assert_eq!(json.get("name").unwrap(), "visible.png");
        assert_eq!(json.get("mimeType").unwrap(), "image/png");
        assert!(json.get("path").is_none());
        assert_eq!(target.owner, "main");

        let unsupported = directory.path().join("secret.txt");
        fs::write(&unsupported, b"not-image").unwrap();
        assert_eq!(
            describe_open_path(OpenKind::Images, unsupported, TOKEN.to_owned(), "main")
                .unwrap_err(),
            "native-file-type-unsupported"
        );
    }

    #[test]
    fn bounded_reads_and_atomic_replacement_preserve_expected_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source.png");
        fs::write(&source, b"12345").unwrap();
        assert_eq!(read_bounded(&source, 5).unwrap(), b"12345");
        assert_eq!(
            read_bounded(&source, 4).unwrap_err(),
            "native-file-too-large"
        );

        let destination = directory.path().join("project.screenhello");
        fs::write(&destination, b"old").unwrap();
        write_atomic(&destination, b"new-project").unwrap();
        assert_eq!(fs::read(destination).unwrap(), b"new-project");
        assert!(fs::read_dir(directory.path()).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")));
    }

    #[test]
    fn state_is_owner_scoped_releasable_and_bounded() {
        let state = NativeFileState::default();
        let target = NativeFileTarget {
            owner: "main".to_owned(),
            path: PathBuf::from("project.screenhello"),
            kind: TargetKind::Project,
        };
        state
            .insert_many(vec![(TOKEN.to_owned(), target.clone())])
            .unwrap();
        assert!(state.get_owned(TOKEN, "other").is_err());
        assert!(!state.release_owned(TOKEN, "other").unwrap());
        assert!(state.release_owned(TOKEN, "main").unwrap());
        assert!(state.get_owned(TOKEN, "main").is_err());

        let entries = (0..=MAX_OPEN_TARGETS)
            .map(|index| (format!("token-{index}"), target.clone()))
            .collect();
        assert_eq!(
            state.insert_many(entries).unwrap_err(),
            "native-file-handle-limit"
        );
    }
}
