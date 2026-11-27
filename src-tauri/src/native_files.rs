use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    Manager, Runtime, State, WebviewWindow,
};
use tauri_plugin_dialog::DialogExt;
use tempfile::NamedTempFile;

const MAX_PROJECT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 48 * 1024 * 1024;
const MAX_EXPORT_BYTES: u64 = 128 * 1024 * 1024;
const MAX_BATCH_BYTES: u64 = 256 * 1024 * 1024;
const MAX_PICKED_IMAGES: usize = 12;
const MAX_OPEN_TARGETS: usize = 64;
const TOKEN_LENGTH: usize = 48;
const TOKEN_HEADER: &str = "x-screenhello-file-token";
const SESSION_HEADER: &str = "x-screenhello-write-session";
const MAX_STREAM_CHUNK_BYTES: usize = 8 * 1024 * 1024;
const MAX_CONCURRENT_WRITE_SESSIONS: usize = 2;
const MAX_LEGACY_WRITE_INFLIGHT_BYTES: u64 = 256 * 1024 * 1024;

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
    ImageGif,
    VideoWebm,
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
                | SaveKind::ImageAvif
                | SaveKind::ImageGif
                | SaveKind::VideoWebm,
            ) => MAX_EXPORT_BYTES,
            Self::Save(SaveKind::BatchZip) => MAX_BATCH_BYTES,
        }
    }

    fn read_once(self) -> bool {
        matches!(self, Self::Image)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FileIdentity {
    #[cfg(unix)]
    dev: u64,
    #[cfg(unix)]
    ino: u64,
}

fn file_identity(metadata: &fs::Metadata) -> FileIdentity {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        FileIdentity {
            dev: metadata.dev(),
            ino: metadata.ino(),
        }
    }
    #[cfg(not(unix))]
    {
        let _ = metadata;
        FileIdentity {}
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct WriteState {
    policy: WritePolicy,
    expected_identity: Option<FileIdentity>,
}

#[derive(Clone, Debug)]
struct NativeFileTarget {
    owner: String,
    path: PathBuf,
    kind: TargetKind,
    write_state: Arc<Mutex<WriteState>>,
    read_handle: Arc<Mutex<Option<File>>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WritePolicy {
    ReplaceConfirmed,
    CreateNew,
}

impl NativeFileTarget {
    fn for_save(owner: String, selected_path: PathBuf, kind: SaveKind) -> Self {
        let path = ensure_save_extension(selected_path.clone(), kind);
        // The native dialog only confirmed the selected path, not an appended suffix.
        let policy = if path == selected_path {
            WritePolicy::ReplaceConfirmed
        } else {
            WritePolicy::CreateNew
        };
        let expected_identity = if policy == WritePolicy::ReplaceConfirmed {
            fs::symlink_metadata(&path)
                .ok()
                .filter(|meta| !meta.file_type().is_symlink() && meta.is_file())
                .map(|meta| file_identity(&meta))
        } else {
            None
        };
        Self {
            owner,
            path,
            kind: TargetKind::Save(kind),
            write_state: Arc::new(Mutex::new(WriteState {
                policy,
                expected_identity,
            })),
            read_handle: Arc::new(Mutex::new(None)),
        }
    }
}

struct StreamWriteSession {
    owner: String,
    target: NativeFileTarget,
    expected_size: u64,
    written: u64,
    temporary: NamedTempFile,
}

struct LegacyWriteBudgetGuard {
    inflight: Arc<Mutex<u64>>,
    reserved: u64,
}

impl Drop for LegacyWriteBudgetGuard {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.inflight.lock() {
            *guard = guard.saturating_sub(self.reserved);
        }
    }
}

#[derive(Default)]
pub(crate) struct NativeFileState {
    targets: Mutex<HashMap<String, NativeFileTarget>>,
    write_sessions: Mutex<HashMap<String, Arc<Mutex<Option<StreamWriteSession>>>>>,
    inflight_legacy_bytes: Arc<Mutex<u64>>,
}

impl NativeFileState {
    fn reserve_legacy_bytes(&self, size: u64) -> Result<LegacyWriteBudgetGuard, String> {
        let mut inflight = self
            .inflight_legacy_bytes
            .lock()
            .map_err(|_| error_code("native-file-state-unavailable"))?;
        if inflight.saturating_add(size) > MAX_LEGACY_WRITE_INFLIGHT_BYTES {
            return Err(error_code("native-file-write-busy"));
        }
        *inflight = inflight.saturating_add(size);
        Ok(LegacyWriteBudgetGuard {
            inflight: Arc::clone(&self.inflight_legacy_bytes),
            reserved: size,
        })
    }

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

    pub(crate) fn clear_owner(&self, owner: &str) -> Result<(), String> {
        {
            let mut targets = self
                .targets
                .lock()
                .map_err(|_| error_code("native-file-state-unavailable"))?;
            targets.retain(|_, target| target.owner != owner);
        }
        {
            let mut sessions = self
                .write_sessions
                .lock()
                .map_err(|_| error_code("native-file-state-unavailable"))?;
            sessions.retain(|_, slot| {
                slot.lock()
                    .ok()
                    .and_then(|guard| guard.as_ref().map(|session| session.owner != owner))
                    .unwrap_or(false)
            });
        }
        Ok(())
    }

    fn insert_stream_session(&self, session: StreamWriteSession) -> Result<String, String> {
        let mut sessions = self
            .write_sessions
            .lock()
            .map_err(|_| error_code("native-file-state-unavailable"))?;
        if sessions.len() >= MAX_CONCURRENT_WRITE_SESSIONS {
            return Err(error_code("native-file-write-busy"));
        }
        let session_id = (0..4)
            .find_map(|_| {
                let candidate = random_session_token().ok()?;
                (!sessions.contains_key(&candidate)).then_some(candidate)
            })
            .ok_or_else(|| error_code("native-file-state-unavailable"))?;
        sessions.insert(session_id.clone(), Arc::new(Mutex::new(Some(session))));
        Ok(session_id)
    }

    fn get_stream_session(
        &self,
        session_id: &str,
    ) -> Result<Arc<Mutex<Option<StreamWriteSession>>>, String> {
        let sessions = self
            .write_sessions
            .lock()
            .map_err(|_| error_code("native-file-state-unavailable"))?;
        sessions
            .get(session_id)
            .cloned()
            .ok_or_else(|| error_code("native-file-handle-invalid"))
    }

    fn remove_stream_session(
        &self,
        session_id: &str,
        owner: &str,
    ) -> Result<Option<StreamWriteSession>, String> {
        let slot = {
            let mut sessions = self
                .write_sessions
                .lock()
                .map_err(|_| error_code("native-file-state-unavailable"))?;
            let Some(slot) = sessions.get(session_id) else {
                return Ok(None);
            };
            let owned = slot
                .lock()
                .map_err(|_| error_code("native-file-state-unavailable"))?
                .as_ref()
                .is_some_and(|session| session.owner == owner);
            if !owned {
                return Err(error_code("native-file-handle-invalid"));
            }
            sessions.remove(session_id)
        };
        let Some(slot) = slot else {
            return Ok(None);
        };
        let session = slot
            .lock()
            .map_err(|_| error_code("native-file-state-unavailable"))?
            .take();
        Ok(session)
    }
}

fn random_session_token() -> Result<String, String> {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut bytes = [0_u8; 24];
    getrandom::fill(&mut bytes).map_err(|_| error_code("native-file-state-unavailable"))?;
    let mut token = String::with_capacity(TOKEN_LENGTH);
    for byte in bytes {
        token.push(HEX[usize::from(byte >> 4)] as char);
        token.push(HEX[usize::from(byte & 0x0f)] as char);
    }
    Ok(token)
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

fn open_regular_nofollow(path: &Path) -> Result<(File, fs::Metadata), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        use std::os::unix::io::AsRawFd;

        let file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(path)
            .map_err(|error| {
                if error.raw_os_error() == Some(libc::ELOOP) {
                    error_code("native-file-symlink-rejected")
                } else {
                    error_code("native-file-read-failed")
                }
            })?;
        let metadata = file
            .metadata()
            .map_err(|_| error_code("native-file-metadata-failed"))?;
        if !metadata.file_type().is_file() {
            return Err(error_code("native-file-invalid"));
        }
        let fd = file.as_raw_fd();
        // SAFETY: fd is an owned, open descriptor for a verified regular file.
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
        if flags < 0 {
            return Err(error_code("native-file-read-failed"));
        }
        // SAFETY: Clearing O_NONBLOCK restores standard blocking reads after type verification.
        if unsafe { libc::fcntl(fd, libc::F_SETFL, flags & !libc::O_NONBLOCK) } < 0 {
            return Err(error_code("native-file-read-failed"));
        }
        Ok((file, metadata))
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
        const FILE_SHARE_ALL: u32 = 0x0000_0001 | 0x0000_0002 | 0x0000_0004;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;

        let file = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_ALL)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)
            .map_err(|_| error_code("native-file-read-failed"))?;
        let metadata = file
            .metadata()
            .map_err(|_| error_code("native-file-metadata-failed"))?;
        if (metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
            return Err(error_code("native-file-symlink-rejected"));
        }
        if !metadata.is_file() {
            return Err(error_code("native-file-invalid"));
        }
        Ok((file, metadata))
    }
    #[cfg(not(any(unix, windows)))]
    {
        let symlink_meta =
            fs::symlink_metadata(path).map_err(|_| error_code("native-file-metadata-failed"))?;
        if symlink_meta.file_type().is_symlink() {
            return Err(error_code("native-file-symlink-rejected"));
        }
        let file = File::open(path).map_err(|_| error_code("native-file-read-failed"))?;
        let metadata = file
            .metadata()
            .map_err(|_| error_code("native-file-metadata-failed"))?;
        if !metadata.is_file() {
            return Err(error_code("native-file-invalid"));
        }
        Ok((file, metadata))
    }
}

fn describe_open_path(
    kind: OpenKind,
    path: PathBuf,
    token: String,
    owner: &str,
) -> Result<(PickedFile, NativeFileTarget), String> {
    let (file, metadata) = open_regular_nofollow(&path)?;
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
    let identity = file_identity(&metadata);
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
        write_state: Arc::new(Mutex::new(WriteState {
            policy: WritePolicy::ReplaceConfirmed,
            expected_identity: Some(identity),
        })),
        read_handle: Arc::new(Mutex::new(Some(file))),
    };
    Ok((picked, target))
}

fn open_dialog_title(kind: OpenKind) -> crate::native_locale::NativeTextKey {
    use crate::native_locale::NativeTextKey;
    match kind {
        OpenKind::Project => NativeTextKey::OpenProjectTitle,
        OpenKind::Images => NativeTextKey::OpenImagesTitle,
    }
}

fn save_spec(
    kind: SaveKind,
) -> (
    crate::native_locale::NativeTextKey,
    crate::native_locale::NativeTextKey,
    &'static [&'static str],
) {
    use crate::native_locale::NativeTextKey;
    match kind {
        SaveKind::Project => (
            NativeTextKey::SaveProjectTitle,
            NativeTextKey::FilterProject,
            &["screenhello"],
        ),
        SaveKind::Preset => (
            NativeTextKey::ExportPresetTitle,
            NativeTextKey::FilterPreset,
            &["screenhello-preset"],
        ),
        SaveKind::ImagePng => (
            NativeTextKey::ExportPngTitle,
            NativeTextKey::FilterPng,
            &["png"],
        ),
        SaveKind::ImageJpeg => (
            NativeTextKey::ExportJpegTitle,
            NativeTextKey::FilterJpeg,
            &["jpg", "jpeg"],
        ),
        SaveKind::ImageWebp => (
            NativeTextKey::ExportWebpTitle,
            NativeTextKey::FilterWebp,
            &["webp"],
        ),
        SaveKind::ImageAvif => (
            NativeTextKey::ExportAvifTitle,
            NativeTextKey::FilterAvif,
            &["avif"],
        ),
        SaveKind::ImageGif => (
            NativeTextKey::ExportGifTitle,
            NativeTextKey::FilterGif,
            &["gif"],
        ),
        SaveKind::VideoWebm => (
            NativeTextKey::ExportWebmTitle,
            NativeTextKey::FilterWebm,
            &["webm"],
        ),
        SaveKind::BatchZip => (
            NativeTextKey::ExportBatchTitle,
            NativeTextKey::FilterZip,
            &["zip"],
        ),
    }
}

fn sanitize_suggested_name(value: &str, kind: SaveKind) -> String {
    let (_, _, extensions) = save_spec(kind);
    // Suggested names can originate on another OS; recognize both separators.
    // This only changes the dialog suggestion, never the user-selected path.
    let value = value.rsplit(['/', '\\']).next().unwrap_or_default();
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
        if let Some(name) = path.file_name() {
            let mut name = name.to_os_string();
            name.push(".");
            name.push(extensions[0]);
            path.set_file_name(name);
        }
    }
    path
}

fn read_bounded_file(file: File, limit: u64) -> Result<Vec<u8>, String> {
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

#[cfg(test)]
fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let (file, _) = open_regular_nofollow(path)?;
    read_bounded_file(file, limit)
}

fn read_target(target: &NativeFileTarget) -> Result<Vec<u8>, String> {
    let limit = target.kind.byte_limit();
    let existing = target
        .read_handle
        .lock()
        .map_err(|_| error_code("native-file-state-unavailable"))?
        .take();
    if let Some(file) = existing {
        // Consumes and closes the pre-opened descriptor immediately after reading
        // so Windows never keeps a sharing lock across subsequent atomic saves.
        return read_bounded_file(file, limit);
    }
    let expected_identity = target
        .write_state
        .lock()
        .map_err(|_| error_code("native-file-state-unavailable"))?
        .expected_identity;
    let (file, metadata) = open_regular_nofollow(&target.path)?;
    if let Some(expected) = expected_identity {
        if file_identity(&metadata) != expected {
            return Err(error_code("native-file-target-changed"));
        }
    }
    read_bounded_file(file, limit)
}

fn verify_replace_target(
    path: &Path,
    expected_identity: Option<FileIdentity>,
) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err(error_code("native-file-symlink-rejected"));
            }
            if !metadata.is_file() {
                return Err(error_code("native-file-invalid"));
            }
            if let Some(expected) = expected_identity {
                if file_identity(&metadata) != expected {
                    return Err(error_code("native-file-target-changed"));
                }
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(error_code("native-file-write-failed")),
    }
}

fn create_staging_tempfile(path: &Path) -> Result<NamedTempFile, String> {
    let parent = path
        .parent()
        .filter(|parent| parent.is_dir())
        .ok_or_else(|| error_code("native-file-parent-invalid"))?;
    tempfile::Builder::new()
        .prefix(".screenhello-")
        .suffix(".tmp")
        .tempfile_in(parent)
        .map_err(|_| error_code("native-file-write-failed"))
}

fn persist_staged_tempfile(
    temporary: NamedTempFile,
    path: &Path,
    policy: WritePolicy,
    expected_identity: Option<FileIdentity>,
) -> Result<File, String> {
    if policy == WritePolicy::ReplaceConfirmed {
        verify_replace_target(path, expected_identity)?;
    }
    match policy {
        WritePolicy::ReplaceConfirmed => temporary.persist(path),
        WritePolicy::CreateNew => temporary.persist_noclobber(path),
    }
    .map_err(|error| {
        if policy == WritePolicy::CreateNew
            && error.error.kind() == std::io::ErrorKind::AlreadyExists
        {
            error_code("native-file-exists")
        } else {
            error_code("native-file-write-failed")
        }
    })
}

#[cfg(test)]
fn write_atomic(path: &Path, bytes: &[u8], policy: WritePolicy) -> Result<File, String> {
    let mut temporary = create_staging_tempfile(path)?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| error_code("native-file-write-failed"))?;
    persist_staged_tempfile(temporary, path, policy, None)
}

fn commit_staged_to_target(
    target: &NativeFileTarget,
    temporary: NamedTempFile,
) -> Result<(), String> {
    // Cloned handles share this lock. Keep blocking I/O off the UI thread,
    // verify target identity before replace, and refresh expected_identity from
    // the persisted file so subsequent Ctrl+S saves continue working cleanly.
    let mut state = target
        .write_state
        .lock()
        .map_err(|_| error_code("native-file-state-unavailable"))?;
    let persisted = persist_staged_tempfile(
        temporary,
        &target.path,
        state.policy,
        state.expected_identity,
    )?;
    let next_identity = persisted.metadata().ok().map(|meta| file_identity(&meta));
    state.policy = WritePolicy::ReplaceConfirmed;
    state.expected_identity = next_identity;
    Ok(())
}

fn write_target(target: &NativeFileTarget, bytes: &[u8]) -> Result<(), String> {
    let mut state = target
        .write_state
        .lock()
        .map_err(|_| error_code("native-file-state-unavailable"))?;
    let mut temporary = create_staging_tempfile(&target.path)?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| error_code("native-file-write-failed"))?;
    let persisted = persist_staged_tempfile(
        temporary,
        &target.path,
        state.policy,
        state.expected_identity,
    )?;
    let next_identity = persisted.metadata().ok().map(|meta| file_identity(&meta));
    state.policy = WritePolicy::ReplaceConfirmed;
    state.expected_identity = next_identity;
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
    let mut dialog =
        window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title(crate::native_locale::text(
                window.app_handle(),
                open_dialog_title(kind),
            ));
    dialog = match kind {
        OpenKind::Project => dialog.add_filter(
            crate::native_locale::text(
                window.app_handle(),
                crate::native_locale::NativeTextKey::FilterProject,
            ),
            &["screenhello"],
        ),
        OpenKind::Images => dialog.add_filter(
            crate::native_locale::text(
                window.app_handle(),
                crate::native_locale::NativeTextKey::FilterImages,
            ),
            &["png", "jpg", "jpeg", "bmp", "gif", "webp"],
        ),
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
    let read_once = target.kind.read_once();
    let bytes = tauri::async_runtime::spawn_blocking(move || read_target(&target))
        .await
        .map_err(|_| error_code("native-file-read-failed"))??;
    if read_once {
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
        .set_title(crate::native_locale::text(window.app_handle(), title))
        .set_file_name(file_name)
        .add_filter(
            crate::native_locale::text(window.app_handle(), filter_name),
            extensions,
        );
    let selected = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|_| error_code("native-file-picker-failed"))?;
    let Some(selected) = selected else {
        return Ok(SaveFileResponse {
            status: "cancelled",
            token: None,
        });
    };
    let target = NativeFileTarget::for_save(
        owner,
        selected
            .into_path()
            .map_err(|_| error_code("native-file-path-invalid"))?,
        kind,
    );
    if !target.path.parent().is_some_and(Path::is_dir) {
        return Err(error_code("native-file-parent-invalid"));
    }
    state.insert_many(vec![(token.clone(), target)])?;
    Ok(SaveFileResponse {
        status: "selected",
        token: Some(token),
    })
}

// MAS atomic replacement needs directory access, not only access to the file
// selected by NSSavePanel. Request it explicitly for each write; do not persist
// paths as if they were security-scoped bookmarks across launches.
#[cfg(any(feature = "mac-app-store", test))]
fn validate_save_directory(path: &Path, selected: Option<&Path>) -> Result<(), String> {
    let selected = selected.ok_or_else(|| error_code("native-file-save-cancelled"))?;
    let parent = path
        .parent()
        .ok_or_else(|| error_code("native-file-parent-invalid"))?;
    let parent = fs::canonicalize(parent).map_err(|_| error_code("native-file-parent-invalid"))?;
    let directory =
        fs::canonicalize(selected).map_err(|_| error_code("native-file-directory-invalid"))?;
    if !directory.is_dir() || directory != parent {
        return Err(error_code("native-file-directory-invalid"));
    }
    let parent_meta =
        fs::metadata(&parent).map_err(|_| error_code("native-file-parent-invalid"))?;
    let dir_meta =
        fs::metadata(&directory).map_err(|_| error_code("native-file-directory-invalid"))?;
    if file_identity(&parent_meta) != file_identity(&dir_meta) {
        return Err(error_code("native-file-directory-invalid"));
    }
    Ok(())
}

#[cfg(feature = "mac-app-store")]
async fn authorize_save_directory<R: Runtime>(
    window: &WebviewWindow<R>,
    path: &Path,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| error_code("native-file-parent-invalid"))?;
    let dialog = window
        .dialog()
        .file()
        .set_parent(window)
        .set_directory(parent)
        .set_title(crate::native_locale::text(
            window.app_handle(),
            crate::native_locale::NativeTextKey::AuthorizeSaveDirectory,
        ));
    let selected = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder())
        .await
        .map_err(|_| error_code("native-file-picker-failed"))?;
    let directory = selected
        .map(|value| {
            value
                .into_path()
                .map_err(|_| error_code("native-file-directory-invalid"))
        })
        .transpose()?;
    validate_save_directory(path, directory.as_deref())
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
    #[cfg(feature = "mac-app-store")]
    {
        authorize_save_directory(&window, &target.path).await?;
        // The UI may have released or replaced its handle while the panel was open.
        let current = state.get_owned(&token, &owner)?;
        if !Arc::ptr_eq(&current.write_state, &target.write_state) {
            return Err(error_code("native-file-handle-invalid"));
        }
    }
    let _budget = state.reserve_legacy_bytes(bytes.len() as u64)?;
    let data = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || write_target(&target, &data))
        .await
        .map_err(|_| error_code("native-file-write-failed"))??;
    Ok(())
}

#[tauri::command]
pub(crate) async fn desktop_write_begin<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, NativeFileState>,
    token: String,
    expected_size: u64,
) -> Result<String, String> {
    if !valid_token(&token) {
        return Err(error_code("native-file-handle-invalid"));
    }
    let owner = window.label().to_owned();
    let target = state.get_owned(&token, &owner)?;
    if !matches!(target.kind, TargetKind::Project | TargetKind::Save(_)) || expected_size == 0 {
        return Err(error_code("native-file-write-invalid"));
    }
    if expected_size > target.kind.byte_limit() {
        return Err(error_code("native-file-too-large"));
    }
    #[cfg(feature = "mac-app-store")]
    {
        authorize_save_directory(&window, &target.path).await?;
        let current = state.get_owned(&token, &owner)?;
        if !Arc::ptr_eq(&current.write_state, &target.write_state) {
            return Err(error_code("native-file-handle-invalid"));
        }
    }
    let path = target.path.clone();
    let temporary = tauri::async_runtime::spawn_blocking(move || create_staging_tempfile(&path))
        .await
        .map_err(|_| error_code("native-file-write-failed"))??;
    state.insert_stream_session(StreamWriteSession {
        owner,
        target,
        expected_size,
        written: 0,
        temporary,
    })
}

fn append_stream_chunk_blocking(
    slot: &Arc<Mutex<Option<StreamWriteSession>>>,
    owner: &str,
    chunk: &[u8],
) -> Result<(), String> {
    let mut guard = slot
        .lock()
        .map_err(|_| error_code("native-file-state-unavailable"))?;
    let Some(session) = guard.as_mut() else {
        return Err(error_code("native-file-handle-invalid"));
    };
    if session.owner != owner {
        return Err(error_code("native-file-handle-invalid"));
    }
    let next_written = session
        .written
        .checked_add(chunk.len() as u64)
        .filter(|total| *total <= session.expected_size)
        .ok_or_else(|| error_code("native-file-too-large"))?;
    session
        .temporary
        .write_all(chunk)
        .map_err(|_| error_code("native-file-write-failed"))?;
    session.written = next_written;
    Ok(())
}

#[tauri::command]
pub(crate) async fn desktop_write_chunk<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, NativeFileState>,
    request: Request<'_>,
) -> Result<(), String> {
    let session_id = request
        .headers()
        .get(SESSION_HEADER)
        .and_then(|value| value.to_str().ok())
        .filter(|value| valid_token(value))
        .ok_or_else(|| error_code("native-file-handle-invalid"))?
        .to_owned();
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(error_code("native-file-request-must-be-raw"));
    };
    if bytes.is_empty() || bytes.len() > MAX_STREAM_CHUNK_BYTES {
        return Err(error_code("native-file-write-invalid"));
    }
    let owner = window.label().to_owned();
    let slot = state.get_stream_session(&session_id)?;
    let chunk = bytes.clone();
    let owner_for_task = owner.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        append_stream_chunk_blocking(&slot, &owner_for_task, &chunk)
    })
    .await
    .map_err(|_| error_code("native-file-write-failed"))?;
    if result.is_err() {
        let _ = state.remove_stream_session(&session_id, &owner);
    }
    result
}

fn finish_stream_session(session: StreamWriteSession) -> Result<(), String> {
    if session.written != session.expected_size {
        return Err(error_code("native-file-write-invalid"));
    }
    session
        .temporary
        .as_file()
        .sync_all()
        .map_err(|_| error_code("native-file-write-failed"))?;
    commit_staged_to_target(&session.target, session.temporary)
}

#[tauri::command]
pub(crate) async fn desktop_write_finish<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, NativeFileState>,
    session_id: String,
) -> Result<(), String> {
    if !valid_token(&session_id) {
        return Err(error_code("native-file-handle-invalid"));
    }
    let owner = window.label().to_owned();
    let Some(session) = state.remove_stream_session(&session_id, &owner)? else {
        return Err(error_code("native-file-handle-invalid"));
    };
    tauri::async_runtime::spawn_blocking(move || finish_stream_session(session))
        .await
        .map_err(|_| error_code("native-file-write-failed"))?
}

#[tauri::command]
pub(crate) fn desktop_write_abort<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, NativeFileState>,
    session_id: String,
) -> Result<bool, String> {
    if !valid_token(&session_id) {
        return Ok(false);
    }
    Ok(state
        .remove_stream_session(&session_id, window.label())?
        .is_some())
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

    #[test]
    fn sandbox_save_requires_the_exact_destination_directory() {
        let directory = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let destination = directory.path().join("new.screenhello");
        assert_eq!(
            validate_save_directory(&destination, None),
            Err("native-file-save-cancelled".into())
        );
        assert_eq!(
            validate_save_directory(&destination, Some(other.path())),
            Err("native-file-directory-invalid".into())
        );
        assert!(!destination.exists());
        validate_save_directory(&destination, Some(directory.path())).unwrap();
        assert!(!destination.exists()); // Validation itself must not create or truncate.
        fs::write(&destination, b"original").unwrap();
        assert!(validate_save_directory(&destination, Some(&destination)).is_err());
        assert_eq!(fs::read(&destination).unwrap(), b"original");
    }

    #[test]
    fn failed_atomic_commit_cleans_temporary_files_and_preserves_existing_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("existing.png");
        fs::write(&path, b"original").unwrap();
        assert_eq!(
            write_atomic(&path, b"replacement", WritePolicy::CreateNew).unwrap_err(),
            "native-file-exists"
        );
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

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
            "secret.txt.screenhello"
        );
        assert_eq!(
            sanitize_suggested_name("capture.JPEG", SaveKind::ImageJpeg),
            "capture.JPEG"
        );
        assert_eq!(
            ensure_save_extension(PathBuf::from("capture.exe"), SaveKind::ImagePng),
            PathBuf::from("capture.exe.png")
        );
    }

    #[test]
    fn suggested_names_handle_foreign_paths_empty_names_and_unicode() {
        for (input, expected) in [
            (r"C:\exports\截图.PNG", "截图.PNG"),
            (r"..\folder/mixed\capture", "capture.png"),
            ("/tmp/", "ScreenHello.png"),
            ("..", "ScreenHello.png"),
            ("", "ScreenHello.png"),
            ("/tmp/截图?.png", "截图_.png"),
            ("capture\n.png", "capture_.png"),
        ] {
            assert_eq!(sanitize_suggested_name(input, SaveKind::ImagePng), expected);
        }
    }

    #[cfg(unix)]
    #[test]
    fn symlink_parent_preserves_create_new_and_confirmed_replace_policies() {
        use std::os::unix::fs::symlink;
        let directory = tempfile::tempdir().unwrap();
        let real_parent = directory.path().join("real");
        let alias = directory.path().join("alias");
        fs::create_dir(&real_parent).unwrap();
        symlink(&real_parent, &alias).unwrap();
        let destination = alias.join("capture.png");
        write_atomic(&destination, b"first", WritePolicy::CreateNew).unwrap();
        assert_eq!(
            write_atomic(&destination, b"second", WritePolicy::CreateNew).unwrap_err(),
            "native-file-exists"
        );
        assert_eq!(fs::read(real_parent.join("capture.png")).unwrap(), b"first");
        write_atomic(&destination, b"confirmed", WritePolicy::ReplaceConfirmed).unwrap();
        assert_eq!(
            fs::read(real_parent.join("capture.png")).unwrap(),
            b"confirmed"
        );
        assert_eq!(fs::read_dir(&real_parent).unwrap().count(), 1);

        let file = directory.path().join("file");
        fs::write(&file, b"keep").unwrap();
        let invalid_parent = directory.path().join("file-alias");
        symlink(&file, &invalid_parent).unwrap();
        assert_eq!(
            write_atomic(
                &invalid_parent.join("capture.png"),
                b"new",
                WritePolicy::CreateNew
            )
            .unwrap_err(),
            "native-file-parent-invalid"
        );
        assert_eq!(fs::read(&file).unwrap(), b"keep");
    }

    #[test]
    fn save_extensions_preserve_user_names_and_allowed_suffixes() {
        for (name, expected, kind) in [
            ("report.v2", "report.v2.png", SaveKind::ImagePng),
            ("v1.2.3", "v1.2.3.png", SaveKind::ImagePng),
            ("中文 文件", "中文 文件.png", SaveKind::ImagePng),
            ("capture.PNG", "capture.PNG", SaveKind::ImagePng),
            ("capture.JPEG", "capture.JPEG", SaveKind::ImageJpeg),
            ("project.v2", "project.v2.screenhello", SaveKind::Project),
        ] {
            assert_eq!(
                ensure_save_extension(PathBuf::from(name), kind),
                PathBuf::from(expected)
            );
        }
    }

    #[test]
    fn appended_save_never_overwrites_existing_or_late_created_files() {
        for create_before_selection in [true, false] {
            let directory = tempfile::tempdir().unwrap();
            let selected = directory.path().join("report.v2");
            let final_path = directory.path().join("report.v2.png");
            let legacy_path = directory.path().join("report.png");
            fs::write(&selected, b"selected-original").unwrap();
            fs::write(&legacy_path, b"legacy-original").unwrap();
            if create_before_selection {
                fs::write(&final_path, b"other-original").unwrap();
            }
            let target =
                NativeFileTarget::for_save("main".into(), selected.clone(), SaveKind::ImagePng);
            if !create_before_selection {
                // Another process creates the destination after the picker returns.
                fs::write(&final_path, b"other-original").unwrap();
            }
            assert_eq!(
                write_target(&target, b"new-export").unwrap_err(),
                "native-file-exists"
            );
            assert_eq!(
                target.write_state.lock().unwrap().policy,
                WritePolicy::CreateNew
            );
            assert_eq!(fs::read(&final_path).unwrap(), b"other-original");
            assert_eq!(fs::read(&selected).unwrap(), b"selected-original");
            assert_eq!(fs::read(&legacy_path).unwrap(), b"legacy-original");
            assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 3);
        }
    }

    #[test]
    fn successful_appended_project_save_allows_subsequent_owned_saves() {
        let directory = tempfile::tempdir().unwrap();
        let target = NativeFileTarget::for_save(
            "main".into(),
            directory.path().join("项目.v2"),
            SaveKind::Project,
        );
        let cloned_handle = target.clone();
        assert_eq!(
            target.write_state.lock().unwrap().policy,
            WritePolicy::CreateNew
        );
        write_target(&target, b"first").unwrap();
        assert_eq!(
            cloned_handle.write_state.lock().unwrap().policy,
            WritePolicy::ReplaceConfirmed
        );
        write_target(&cloned_handle, b"second").unwrap();
        assert_eq!(fs::read(&target.path).unwrap(), b"second");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn independent_save_handles_racing_for_one_new_path_cannot_clobber_the_winner() {
        let directory = tempfile::tempdir().unwrap();
        let selected = directory.path().join("report.v2");
        let first = NativeFileTarget::for_save("main".into(), selected.clone(), SaveKind::ImagePng);
        let second = NativeFileTarget::for_save("main".into(), selected, SaveKind::ImagePng);
        let barrier = std::sync::Barrier::new(2);
        let (a, b) = std::thread::scope(|scope| {
            let a = scope.spawn(|| {
                barrier.wait();
                write_target(&first, b"first")
            });
            let b = scope.spawn(|| {
                barrier.wait();
                write_target(&second, b"second")
            });
            (a.join().unwrap(), b.join().unwrap())
        });
        assert_ne!(a.is_ok(), b.is_ok());
        let (winner_bytes, failure) = if a.is_ok() {
            (b"first".as_slice(), b)
        } else {
            (b"second".as_slice(), a)
        };
        assert_eq!(failure.unwrap_err(), "native-file-exists");
        assert_eq!(fs::read(&first.path).unwrap(), winner_bytes);
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn unchanged_selected_path_keeps_confirmed_overwrite_behavior() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("项目.screenhello");
        fs::write(&path, b"old").unwrap();
        let target = NativeFileTarget::for_save("main".into(), path.clone(), SaveKind::Project);
        assert_eq!(
            target.write_state.lock().unwrap().policy,
            WritePolicy::ReplaceConfirmed
        );
        write_target(&target, b"new").unwrap();
        write_target(&target, b"newer").unwrap();
        assert_eq!(fs::read(path).unwrap(), b"newer");
    }

    #[test]
    fn failed_save_does_not_grant_overwrite_permission() {
        let directory = tempfile::tempdir().unwrap();
        let target = NativeFileTarget::for_save(
            "main".into(),
            directory.path().join("missing/project"),
            SaveKind::Project,
        );
        assert_eq!(
            write_target(&target, b"data").unwrap_err(),
            "native-file-parent-invalid"
        );
        assert_eq!(
            target.write_state.lock().unwrap().policy,
            WritePolicy::CreateNew
        );
    }

    #[cfg(unix)]
    #[test]
    fn appended_save_rejects_symlinks_without_following_them() {
        let directory = tempfile::tempdir().unwrap();
        let original = directory.path().join("original");
        fs::write(&original, b"keep").unwrap();
        let target = NativeFileTarget::for_save(
            "main".into(),
            directory.path().join("report.v2"),
            SaveKind::ImagePng,
        );
        std::os::unix::fs::symlink(&original, &target.path).unwrap();
        assert_eq!(
            write_target(&target, b"new").unwrap_err(),
            "native-file-exists"
        );
        assert_eq!(fs::read(&original).unwrap(), b"keep");
        assert!(fs::symlink_metadata(&target.path)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
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
        write_atomic(&destination, b"new-project", WritePolicy::ReplaceConfirmed).unwrap();
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
            write_state: Arc::new(Mutex::new(WriteState {
                policy: WritePolicy::ReplaceConfirmed,
                expected_identity: None,
            })),
            read_handle: Arc::new(Mutex::new(None)),
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

    #[cfg(unix)]
    #[test]
    fn open_and_replace_reject_symlinks_fifos_and_external_file_swaps() {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;

        let directory = tempfile::tempdir().unwrap();
        let real_file = directory.path().join("real.png");
        fs::write(&real_file, b"png").unwrap();

        // 1. Symlink open rejected with O_NOFOLLOW -> native-file-symlink-rejected
        let link_path = directory.path().join("link.png");
        std::os::unix::fs::symlink(&real_file, &link_path).unwrap();
        assert_eq!(
            describe_open_path(OpenKind::Images, link_path, TOKEN.to_owned(), "main").unwrap_err(),
            "native-file-symlink-rejected"
        );

        // 2. Named pipe (FIFO) open fails immediately without blocking via O_NONBLOCK
        let fifo_path = directory.path().join("pipe.png");
        let c_fifo = CString::new(fifo_path.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c_fifo.as_ptr(), 0o600) }, 0);
        assert_eq!(
            describe_open_path(OpenKind::Images, fifo_path, TOKEN.to_owned(), "main").unwrap_err(),
            "native-file-invalid"
        );

        // 3. Project open + read consumes fd, first save updates identity, external swap rejects second save
        let project_path = directory.path().join("work.screenhello");
        fs::write(&project_path, b"v1").unwrap();
        let (_, target) = describe_open_path(
            OpenKind::Project,
            project_path.clone(),
            TOKEN.to_owned(),
            "main",
        )
        .unwrap();
        assert_eq!(read_target(&target).unwrap(), b"v1");
        assert!(target.read_handle.lock().unwrap().is_none());
        write_target(&target, b"v2").unwrap();
        write_target(&target, b"v3").unwrap();
        assert_eq!(fs::read(&project_path).unwrap(), b"v3");

        // External process replaces the file with a different inode
        let external = directory.path().join("external.screenhello");
        fs::write(&external, b"intruder").unwrap();
        fs::rename(&external, &project_path).unwrap();
        assert_eq!(
            write_target(&target, b"v4").unwrap_err(),
            "native-file-target-changed"
        );
        assert_eq!(fs::read(&project_path).unwrap(), b"intruder");

        // External process replaces the target with a symlink
        fs::remove_file(&project_path).unwrap();
        std::os::unix::fs::symlink(&real_file, &project_path).unwrap();
        assert_eq!(
            write_target(&target, b"v5").unwrap_err(),
            "native-file-symlink-rejected"
        );
        assert_eq!(fs::read(&real_file).unwrap(), b"png");
    }

    #[test]
    fn streaming_write_sessions_commit_atomically_enforce_concurrency_and_clean_up_on_abort() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("batch.zip");
        let target = NativeFileTarget::for_save("main".into(), path.clone(), SaveKind::BatchZip);
        let state = NativeFileState::default();

        // Streamed write in two chunks
        let temp = create_staging_tempfile(&path).unwrap();
        let session_id = state
            .insert_stream_session(StreamWriteSession {
                owner: "main".to_owned(),
                target: target.clone(),
                expected_size: 10,
                written: 0,
                temporary: temp,
            })
            .unwrap();
        let slot = state.get_stream_session(&session_id).unwrap();
        append_stream_chunk_blocking(&slot, "main", b"hello").unwrap();
        append_stream_chunk_blocking(&slot, "main", b"world").unwrap();
        // Exceeding expected_size fails closed
        assert_eq!(
            append_stream_chunk_blocking(&slot, "main", b"!").unwrap_err(),
            "native-file-too-large"
        );
        let session = state
            .remove_stream_session(&session_id, "main")
            .unwrap()
            .unwrap();
        finish_stream_session(session).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"helloworld");

        // Concurrency budget (MAX_CONCURRENT_WRITE_SESSIONS = 2)
        let s1 = state
            .insert_stream_session(StreamWriteSession {
                owner: "main".to_owned(),
                target: target.clone(),
                expected_size: 4,
                written: 0,
                temporary: create_staging_tempfile(&path).unwrap(),
            })
            .unwrap();
        let _s2 = state
            .insert_stream_session(StreamWriteSession {
                owner: "main".to_owned(),
                target: target.clone(),
                expected_size: 4,
                written: 0,
                temporary: create_staging_tempfile(&path).unwrap(),
            })
            .unwrap();
        assert_eq!(
            state
                .insert_stream_session(StreamWriteSession {
                    owner: "main".to_owned(),
                    target: target.clone(),
                    expected_size: 4,
                    written: 0,
                    temporary: create_staging_tempfile(&path).unwrap(),
                })
                .unwrap_err(),
            "native-file-write-busy"
        );
        // Abort / clear_owner drops temp files cleanly
        assert!(state.remove_stream_session(&s1, "main").unwrap().is_some());
        state.clear_owner("main").unwrap();
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}
