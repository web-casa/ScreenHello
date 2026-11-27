use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::Path,
    sync::Mutex,
};
use tauri::{App, Manager, Runtime, State};

const MARKER_FILE_NAME: &str = "desktop-state-v1.json";
const MARKER_SCHEMA_VERSION: u8 = 1;
const RESPONSE_SCHEMA_VERSION: u8 = 1;
const MAX_MARKER_BYTES: u64 = 1024;
const MAX_APP_VERSION_BYTES: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum MarkerStatus {
    Initialized,
    Ready,
    Migrated,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopStateStatus {
    schema_version: u8,
    status: MarkerStatus,
    data_schema_version: u8,
}

impl DesktopStateStatus {
    fn new(status: MarkerStatus) -> Self {
        Self {
            schema_version: RESPONSE_SCHEMA_VERSION,
            status,
            data_schema_version: MARKER_SCHEMA_VERSION,
        }
    }

    fn unavailable() -> Self {
        Self::new(MarkerStatus::Unavailable)
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedMarker {
    schema_version: u8,
    last_seen_app_version: String,
}

#[derive(Clone, Copy)]
enum PersistMode {
    Create,
    Replace,
}

pub(crate) struct DesktopState {
    status: Mutex<DesktopStateStatus>,
}

impl Default for DesktopState {
    fn default() -> Self {
        Self {
            status: Mutex::new(DesktopStateStatus::unavailable()),
        }
    }
}

impl DesktopState {
    pub(crate) fn initialize<R: Runtime>(&self, app: &App<R>) {
        // This marker is deliberately independent from the WebView profile and
        // its IndexedDB. It establishes a safe future migration boundary
        // without scanning or rewriting the user's projects, drafts, or cache.
        let next = app
            .path()
            .app_data_dir()
            .map_err(|_| ())
            .and_then(|directory| reconcile_marker(&directory, env!("CARGO_PKG_VERSION")))
            .unwrap_or_else(|_| DesktopStateStatus::unavailable());
        if let Ok(mut status) = self.status.lock() {
            *status = next;
        }
    }

    fn status(&self) -> Result<DesktopStateStatus, String> {
        self.status
            .lock()
            .map(|status| status.clone())
            .map_err(|_| "desktop-state-unavailable".to_owned())
    }
}

fn valid_app_version(value: &str) -> bool {
    if value.is_empty()
        || value.len() > MAX_APP_VERSION_BYTES
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'+' | b'-'))
    {
        return false;
    }
    let core_end = value.find(['-', '+']).unwrap_or(value.len());
    let core = &value[..core_end];
    if core.split('.').count() != 3
        || !core
            .split('.')
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return false;
    }
    let mut suffix = &value[core_end..];
    if let Some(prerelease) = suffix.strip_prefix('-') {
        let prerelease_end = prerelease.find('+').unwrap_or(prerelease.len());
        if !valid_version_identifiers(&prerelease[..prerelease_end]) {
            return false;
        }
        suffix = &prerelease[prerelease_end..];
    }
    if let Some(build) = suffix.strip_prefix('+') {
        return valid_version_identifiers(build);
    }
    suffix.is_empty()
}

fn valid_version_identifiers(value: &str) -> bool {
    !value.is_empty()
        && value.split('.').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
}

fn marker_path(directory: &Path) -> std::path::PathBuf {
    directory.join(MARKER_FILE_NAME)
}

fn read_marker(path: &Path) -> Result<Option<PersistedMarker>, ()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(()),
    };
    if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > MAX_MARKER_BYTES {
        return Err(());
    }
    let file = File::open(path).map_err(|_| ())?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_MARKER_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ())?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_MARKER_BYTES {
        return Err(());
    }
    let marker: PersistedMarker = serde_json::from_slice(&bytes).map_err(|_| ())?;
    if marker.schema_version != MARKER_SCHEMA_VERSION
        || !valid_app_version(&marker.last_seen_app_version)
    {
        return Err(());
    }
    Ok(Some(marker))
}

fn write_marker(path: &Path, marker: &PersistedMarker, mode: PersistMode) -> Result<(), ()> {
    let parent = path.parent().filter(|parent| parent.is_dir()).ok_or(())?;
    let bytes = serde_json::to_vec(marker).map_err(|_| ())?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_MARKER_BYTES {
        return Err(());
    }
    let mut temporary = tempfile::Builder::new()
        .prefix(".screenhello-state-")
        .suffix(".tmp")
        .tempfile_in(parent)
        .map_err(|_| ())?;
    temporary
        .write_all(&bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| ())?;
    match mode {
        PersistMode::Create => temporary.persist_noclobber(path),
        PersistMode::Replace => temporary.persist(path),
    }
    .map(|_| ())
    .map_err(|_| ())
}

fn reconcile_existing_marker(
    path: &Path,
    marker: PersistedMarker,
    app_version: &str,
) -> Result<DesktopStateStatus, ()> {
    if marker.last_seen_app_version == app_version {
        return Ok(DesktopStateStatus::new(MarkerStatus::Ready));
    }
    write_marker(
        path,
        &PersistedMarker {
            schema_version: MARKER_SCHEMA_VERSION,
            last_seen_app_version: app_version.to_owned(),
        },
        PersistMode::Replace,
    )?;
    Ok(DesktopStateStatus::new(MarkerStatus::Migrated))
}

fn reconcile_marker(directory: &Path, app_version: &str) -> Result<DesktopStateStatus, ()> {
    if !valid_app_version(app_version) {
        return Err(());
    }
    fs::create_dir_all(directory).map_err(|_| ())?;
    let path = marker_path(directory);
    match read_marker(&path)? {
        Some(marker) => reconcile_existing_marker(&path, marker, app_version),
        None => {
            let marker = PersistedMarker {
                schema_version: MARKER_SCHEMA_VERSION,
                last_seen_app_version: app_version.to_owned(),
            };
            match write_marker(&path, &marker, PersistMode::Create) {
                Ok(()) => Ok(DesktopStateStatus::new(MarkerStatus::Initialized)),
                Err(()) => read_marker(&path)?
                    .ok_or(())
                    .and_then(|marker| reconcile_existing_marker(&path, marker, app_version)),
            }
        }
    }
}

#[tauri::command]
pub(crate) fn desktop_state_status(
    state: State<'_, DesktopState>,
) -> Result<DesktopStateStatus, String> {
    state.status()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_marker_is_created_then_reused() {
        let directory = tempfile::tempdir().unwrap();
        let initialized = reconcile_marker(directory.path(), "1.0.0").unwrap();
        assert_eq!(initialized.status, MarkerStatus::Initialized);
        let marker = serde_json::from_slice::<serde_json::Value>(
            &fs::read(marker_path(directory.path())).unwrap(),
        )
        .unwrap();
        assert_eq!(marker["schemaVersion"], 1);
        assert_eq!(marker["lastSeenAppVersion"], "1.0.0");

        let ready = reconcile_marker(directory.path(), "1.0.0").unwrap();
        assert_eq!(ready.status, MarkerStatus::Ready);
    }

    #[test]
    fn app_version_acceptance_is_bounded_to_semver_shape() {
        assert!(valid_app_version("1.0.0"));
        assert!(valid_app_version("1.0.0-rc.1+build.7"));
        for value in [
            "",
            "1.0",
            "one.0.0",
            "1.0.0-",
            "1.0.0+",
            "1.0.0+build+again",
        ] {
            assert!(!valid_app_version(value));
        }
    }

    #[test]
    fn known_marker_is_atomically_updated_for_a_new_app_version() {
        let directory = tempfile::tempdir().unwrap();
        reconcile_marker(directory.path(), "1.0.0").unwrap();
        let migrated = reconcile_marker(directory.path(), "1.1.0").unwrap();
        assert_eq!(migrated.status, MarkerStatus::Migrated);
        let marker = serde_json::from_slice::<serde_json::Value>(
            &fs::read(marker_path(directory.path())).unwrap(),
        )
        .unwrap();
        assert_eq!(marker["schemaVersion"], 1);
        assert_eq!(marker["lastSeenAppVersion"], "1.1.0");
        assert!(fs::read_dir(directory.path()).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")));
    }

    #[test]
    fn malformed_or_unknown_markers_are_not_replaced() {
        let directory = tempfile::tempdir().unwrap();
        let path = marker_path(directory.path());
        for bytes in [
            b"{invalid".as_slice(),
            b"{\"schemaVersion\":2,\"lastSeenAppVersion\":\"2.0.0\"}".as_slice(),
            b"{\"schemaVersion\":1,\"lastSeenAppVersion\":\"1.0.0\",\"futureField\":true}"
                .as_slice(),
            b"{\"schemaVersion\":1,\"lastSeenAppVersion\":\"not-a-semver\"}".as_slice(),
            b"{\"schemaVersion\":1,\"lastSeenAppVersion\":\"../../private\"}".as_slice(),
        ] {
            fs::write(&path, bytes).unwrap();
            assert!(reconcile_marker(directory.path(), "1.0.0").is_err());
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_marker_is_not_followed_or_replaced() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        fs::write(outside.path(), b"outside-marker").unwrap();
        let path = marker_path(directory.path());
        symlink(outside.path(), &path).unwrap();

        assert!(reconcile_marker(directory.path(), "1.0.0").is_err());
        assert_eq!(fs::read(outside.path()).unwrap(), b"outside-marker");
        assert!(fs::symlink_metadata(path).unwrap().file_type().is_symlink());
    }

    #[test]
    fn status_payload_is_bounded_and_has_no_storage_detail() {
        let value = serde_json::to_value(DesktopStateStatus::unavailable()).unwrap();
        let object = value.as_object().unwrap();
        assert_eq!(object.len(), 3);
        assert_eq!(object.get("schemaVersion").unwrap(), 1);
        assert_eq!(object.get("status").unwrap(), "unavailable");
        assert_eq!(object.get("dataSchemaVersion").unwrap(), 1);
        assert!(object.get("path").is_none());
        assert!(object.get("error").is_none());
        assert!(object.get("lastSeenAppVersion").is_none());
    }
}
