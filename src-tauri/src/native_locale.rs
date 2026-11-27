use serde::Deserialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
pub(crate) enum NativeLocale {
    #[default]
    #[serde(rename = "zh-CN")]
    ZhCn = 0,
    #[serde(rename = "en-US")]
    EnUs = 1,
    #[serde(rename = "zh-TW")]
    ZhTw = 2,
    #[serde(rename = "de-DE")]
    DeDe = 3,
    #[serde(rename = "ko-KR")]
    KoKr = 4,
    #[serde(rename = "es-ES")]
    EsEs = 5,
    #[serde(rename = "pt-PT")]
    PtPt = 6,
}

impl NativeLocale {
    #[cfg(test)]
    const ALL: [Self; 7] = [
        Self::ZhCn,
        Self::EnUs,
        Self::ZhTw,
        Self::DeDe,
        Self::KoKr,
        Self::EsEs,
        Self::PtPt,
    ];
}

impl TryFrom<u8> for NativeLocale {
    type Error = ();

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::ZhCn),
            1 => Ok(Self::EnUs),
            2 => Ok(Self::ZhTw),
            3 => Ok(Self::DeDe),
            4 => Ok(Self::KoKr),
            5 => Ok(Self::EsEs),
            6 => Ok(Self::PtPt),
            _ => Err(()),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NativeTextKey {
    #[allow(dead_code)] // Constructed under #[cfg(feature = "mac-app-store")]
    AuthorizeSaveDirectory,
    ExitNotReadyMessage,
    TrayShow,
    TrayCapturePrimary,
    Quit,
    OpenProjectTitle,
    OpenImagesTitle,
    SaveProjectTitle,
    FilterProject,
    ExportPresetTitle,
    FilterPreset,
    ExportPngTitle,
    FilterPng,
    ExportJpegTitle,
    FilterJpeg,
    ExportWebpTitle,
    FilterWebp,
    ExportAvifTitle,
    FilterAvif,
    ExportGifTitle,
    FilterGif,
    ExportWebmTitle,
    FilterWebm,
    ExportBatchTitle,
    FilterZip,
    FilterImages,
    CaptureConsentMessage,
    CaptureConsentTitle,
    AllowOnce,
    Cancel,
    DisplayLabel,
    UntitledWindow,
}

impl NativeTextKey {
    #[cfg(test)]
    const ALL: [Self; 32] = [
        Self::AuthorizeSaveDirectory,
        Self::ExitNotReadyMessage,
        Self::TrayShow,
        Self::TrayCapturePrimary,
        Self::Quit,
        Self::OpenProjectTitle,
        Self::OpenImagesTitle,
        Self::SaveProjectTitle,
        Self::FilterProject,
        Self::ExportPresetTitle,
        Self::FilterPreset,
        Self::ExportPngTitle,
        Self::FilterPng,
        Self::ExportJpegTitle,
        Self::FilterJpeg,
        Self::ExportWebpTitle,
        Self::FilterWebp,
        Self::ExportAvifTitle,
        Self::FilterAvif,
        Self::ExportGifTitle,
        Self::FilterGif,
        Self::ExportWebmTitle,
        Self::FilterWebm,
        Self::ExportBatchTitle,
        Self::FilterZip,
        Self::FilterImages,
        Self::CaptureConsentMessage,
        Self::CaptureConsentTitle,
        Self::AllowOnce,
        Self::Cancel,
        Self::DisplayLabel,
        Self::UntitledWindow,
    ];
}

#[derive(Default)]
struct LocaleSession {
    locale: NativeLocale,
    epoch: Option<String>,
    last_sequence: u64,
}

#[derive(Default)]
pub(crate) struct NativeLocaleState {
    session: Mutex<LocaleSession>,
}

impl NativeLocaleState {
    fn current(&self) -> NativeLocale {
        self.session
            .lock()
            .map(|state| state.locale)
            .unwrap_or(NativeLocale::ZhCn)
    }

    fn set_for_owner(
        &self,
        owner: &str,
        locale: NativeLocale,
        epoch: Option<&str>,
        sequence: Option<u64>,
    ) -> Result<bool, String> {
        if owner != "main" {
            return Err("desktop-locale-owner-invalid".into());
        }
        let mut state = self
            .session
            .lock()
            .map_err(|_| "desktop-locale-state-unavailable".to_owned())?;
        if let (Some(epoch), Some(sequence)) = (epoch, sequence) {
            if !crate::native_files::valid_token(epoch) || sequence == 0 {
                return Err("desktop-locale-sequence-invalid".into());
            }
            if state.epoch.as_deref() == Some(epoch) {
                if sequence <= state.last_sequence {
                    return Ok(false);
                }
                state.last_sequence = sequence;
            } else {
                state.epoch = Some(epoch.to_owned());
                state.last_sequence = sequence;
            }
        }
        state.locale = locale;
        Ok(true)
    }
}

pub(crate) fn text<R: Runtime>(app: &AppHandle<R>, key: NativeTextKey) -> &'static str {
    translate(app.state::<NativeLocaleState>().current(), key)
}

pub(crate) fn translate(locale: NativeLocale, key: NativeTextKey) -> &'static str {
    match locale {
        NativeLocale::ZhCn => match key {
            NativeTextKey::AuthorizeSaveDirectory => "请选择目标文件所在文件夹，以授权安全保存",
            NativeTextKey::ExitNotReadyMessage => "编辑器尚未就绪，退出可能丢失未保存内容。仍要退出吗？",
            NativeTextKey::TrayShow => "显示 ScreenHello",
            NativeTextKey::TrayCapturePrimary => "截取主屏幕",
            NativeTextKey::Quit => "退出",
            NativeTextKey::OpenProjectTitle => "打开 ScreenHello 项目",
            NativeTextKey::OpenImagesTitle => "选择本地图片",
            NativeTextKey::SaveProjectTitle => "保存 ScreenHello 项目",
            NativeTextKey::FilterProject => "ScreenHello 项目",
            NativeTextKey::ExportPresetTitle => "导出 ScreenHello 风格预设",
            NativeTextKey::FilterPreset => "ScreenHello 风格预设",
            NativeTextKey::ExportPngTitle => "导出 PNG 图片",
            NativeTextKey::FilterPng => "PNG 图片",
            NativeTextKey::ExportJpegTitle => "导出 JPEG 图片",
            NativeTextKey::FilterJpeg => "JPEG 图片",
            NativeTextKey::ExportWebpTitle => "导出 WebP 图片",
            NativeTextKey::FilterWebp => "WebP 图片",
            NativeTextKey::ExportAvifTitle => "导出 AVIF 图片",
            NativeTextKey::FilterAvif => "AVIF 图片",
            NativeTextKey::ExportGifTitle => "导出 GIF 动图",
            NativeTextKey::FilterGif => "GIF 动图",
            NativeTextKey::ExportWebmTitle => "导出 WebM 视频",
            NativeTextKey::FilterWebm => "WebM 视频",
            NativeTextKey::ExportBatchTitle => "导出批量图片",
            NativeTextKey::FilterZip => "ZIP 压缩包",
            NativeTextKey::FilterImages => "图片",
            NativeTextKey::CaptureConsentMessage => {
                "允许本次读取显示器和窗口标题，并截取您选择的一个来源吗？图片仅在本机处理。"
            }
            NativeTextKey::CaptureConsentTitle => "ScreenHello — 截图授权",
            NativeTextKey::AllowOnce => "允许本次",
            NativeTextKey::Cancel => "取消",
            NativeTextKey::DisplayLabel => "显示器",
            NativeTextKey::UntitledWindow => "未命名窗口",
        },
        NativeLocale::EnUs => match key {
            NativeTextKey::AuthorizeSaveDirectory => {
                "Select the destination file’s folder to allow safe saving"
            }
            NativeTextKey::ExitNotReadyMessage => {
                "The editor is not ready. Quitting may lose unsaved changes. Quit anyway?"
            }
            NativeTextKey::TrayShow => "Show ScreenHello",
            NativeTextKey::TrayCapturePrimary => "Capture primary display",
            NativeTextKey::Quit => "Quit",
            NativeTextKey::OpenProjectTitle => "Open ScreenHello project",
            NativeTextKey::OpenImagesTitle => "Choose local images",
            NativeTextKey::SaveProjectTitle => "Save ScreenHello project",
            NativeTextKey::FilterProject => "ScreenHello project",
            NativeTextKey::ExportPresetTitle => "Export ScreenHello style preset",
            NativeTextKey::FilterPreset => "ScreenHello style preset",
            NativeTextKey::ExportPngTitle => "Export PNG image",
            NativeTextKey::FilterPng => "PNG image",
            NativeTextKey::ExportJpegTitle => "Export JPEG image",
            NativeTextKey::FilterJpeg => "JPEG image",
            NativeTextKey::ExportWebpTitle => "Export WebP image",
            NativeTextKey::FilterWebp => "WebP image",
            NativeTextKey::ExportAvifTitle => "Export AVIF image",
            NativeTextKey::FilterAvif => "AVIF image",
            NativeTextKey::ExportGifTitle => "Export animated GIF",
            NativeTextKey::FilterGif => "GIF image",
            NativeTextKey::ExportWebmTitle => "Export WebM video",
            NativeTextKey::FilterWebm => "WebM video",
            NativeTextKey::ExportBatchTitle => "Export batch images",
            NativeTextKey::FilterZip => "ZIP archive",
            NativeTextKey::FilterImages => "Images",
            NativeTextKey::CaptureConsentMessage => {
                "Allow this request to read display and window titles and capture one selected source? Images stay on this device."
            }
            NativeTextKey::CaptureConsentTitle => "ScreenHello — Capture permission",
            NativeTextKey::AllowOnce => "Allow once",
            NativeTextKey::Cancel => "Cancel",
            NativeTextKey::DisplayLabel => "Display",
            NativeTextKey::UntitledWindow => "Untitled window",
        },
        NativeLocale::ZhTw => match key {
            NativeTextKey::AuthorizeSaveDirectory => "請選擇目標檔案所在的資料夾，以授權安全儲存",
            NativeTextKey::ExitNotReadyMessage => "編輯器尚未就緒，結束可能會遺失未儲存的內容。仍要結束嗎？",
            NativeTextKey::TrayShow => "顯示 ScreenHello",
            NativeTextKey::TrayCapturePrimary => "擷取主螢幕",
            NativeTextKey::Quit => "結束",
            NativeTextKey::OpenProjectTitle => "開啟 ScreenHello 專案",
            NativeTextKey::OpenImagesTitle => "選擇本機圖片",
            NativeTextKey::SaveProjectTitle => "儲存 ScreenHello 專案",
            NativeTextKey::FilterProject => "ScreenHello 專案",
            NativeTextKey::ExportPresetTitle => "匯出 ScreenHello 風格預設",
            NativeTextKey::FilterPreset => "ScreenHello 風格預設",
            NativeTextKey::ExportPngTitle => "匯出 PNG 圖片",
            NativeTextKey::FilterPng => "PNG 圖片",
            NativeTextKey::ExportJpegTitle => "匯出 JPEG 圖片",
            NativeTextKey::FilterJpeg => "JPEG 圖片",
            NativeTextKey::ExportWebpTitle => "匯出 WebP 圖片",
            NativeTextKey::FilterWebp => "WebP 圖片",
            NativeTextKey::ExportAvifTitle => "匯出 AVIF 圖片",
            NativeTextKey::FilterAvif => "AVIF 圖片",
            NativeTextKey::ExportGifTitle => "匯出 GIF 動圖",
            NativeTextKey::FilterGif => "GIF 動圖",
            NativeTextKey::ExportWebmTitle => "匯出 WebM 影片",
            NativeTextKey::FilterWebm => "WebM 影片",
            NativeTextKey::ExportBatchTitle => "匯出批次圖片",
            NativeTextKey::FilterZip => "ZIP 壓縮檔",
            NativeTextKey::FilterImages => "圖片",
            NativeTextKey::CaptureConsentMessage => {
                "允許本次讀取顯示器與視窗標題，並擷取您選擇的一個來源嗎？圖片僅會在此裝置處理。"
            }
            NativeTextKey::CaptureConsentTitle => "ScreenHello — 螢幕擷取授權",
            NativeTextKey::AllowOnce => "僅允許這一次",
            NativeTextKey::Cancel => "取消",
            NativeTextKey::DisplayLabel => "顯示器",
            NativeTextKey::UntitledWindow => "未命名視窗",
        },
        NativeLocale::DeDe => match key {
            NativeTextKey::AuthorizeSaveDirectory => {
                "Wählen Sie den Ordner der Zieldatei aus, um sicheres Speichern zu erlauben"
            }
            NativeTextKey::ExitNotReadyMessage => {
                "Der Editor ist noch nicht bereit. Beim Beenden können ungespeicherte Änderungen verloren gehen. Trotzdem beenden?"
            }
            NativeTextKey::TrayShow => "ScreenHello anzeigen",
            NativeTextKey::TrayCapturePrimary => "Hauptbildschirm aufnehmen",
            NativeTextKey::Quit => "Beenden",
            NativeTextKey::OpenProjectTitle => "ScreenHello-Projekt öffnen",
            NativeTextKey::OpenImagesTitle => "Lokale Bilder auswählen",
            NativeTextKey::SaveProjectTitle => "ScreenHello-Projekt speichern",
            NativeTextKey::FilterProject => "ScreenHello-Projekt",
            NativeTextKey::ExportPresetTitle => "ScreenHello-Stilvorlage exportieren",
            NativeTextKey::FilterPreset => "ScreenHello-Stilvorlage",
            NativeTextKey::ExportPngTitle => "PNG-Bild exportieren",
            NativeTextKey::FilterPng => "PNG-Bild",
            NativeTextKey::ExportJpegTitle => "JPEG-Bild exportieren",
            NativeTextKey::FilterJpeg => "JPEG-Bild",
            NativeTextKey::ExportWebpTitle => "WebP-Bild exportieren",
            NativeTextKey::FilterWebp => "WebP-Bild",
            NativeTextKey::ExportAvifTitle => "AVIF-Bild exportieren",
            NativeTextKey::FilterAvif => "AVIF-Bild",
            NativeTextKey::ExportGifTitle => "GIF-Animation exportieren",
            NativeTextKey::FilterGif => "GIF-Animation",
            NativeTextKey::ExportWebmTitle => "WebM-Video exportieren",
            NativeTextKey::FilterWebm => "WebM-Video",
            NativeTextKey::ExportBatchTitle => "Stapelbilder exportieren",
            NativeTextKey::FilterZip => "ZIP-Archiv",
            NativeTextKey::FilterImages => "Bilder",
            NativeTextKey::CaptureConsentMessage => {
                "Dieser Anfrage einmalig erlauben, Bildschirm- und Fenstertitel zu lesen und eine ausgewählte Quelle aufzunehmen? Bilder bleiben auf diesem Gerät."
            }
            NativeTextKey::CaptureConsentTitle => "ScreenHello — Aufnahmeberechtigung",
            NativeTextKey::AllowOnce => "Einmal erlauben",
            NativeTextKey::Cancel => "Abbrechen",
            NativeTextKey::DisplayLabel => "Bildschirm",
            NativeTextKey::UntitledWindow => "Unbenanntes Fenster",
        },
        NativeLocale::KoKr => match key {
            NativeTextKey::AuthorizeSaveDirectory => {
                "안전한 저장을 허용하려면 대상 파일이 있는 폴더를 선택하세요"
            }
            NativeTextKey::ExitNotReadyMessage => {
                "편집기가 아직 준비되지 않았습니다. 종료하면 저장하지 않은 변경 사항이 손실될 수 있습니다. 그래도 종료할까요?"
            }
            NativeTextKey::TrayShow => "ScreenHello 표시",
            NativeTextKey::TrayCapturePrimary => "기본 화면 캡처",
            NativeTextKey::Quit => "종료",
            NativeTextKey::OpenProjectTitle => "ScreenHello 프로젝트 열기",
            NativeTextKey::OpenImagesTitle => "로컬 이미지 선택",
            NativeTextKey::SaveProjectTitle => "ScreenHello 프로젝트 저장",
            NativeTextKey::FilterProject => "ScreenHello 프로젝트",
            NativeTextKey::ExportPresetTitle => "ScreenHello 스타일 프리셋 내보내기",
            NativeTextKey::FilterPreset => "ScreenHello 스타일 프리셋",
            NativeTextKey::ExportPngTitle => "PNG 이미지 내보내기",
            NativeTextKey::FilterPng => "PNG 이미지",
            NativeTextKey::ExportJpegTitle => "JPEG 이미지 내보내기",
            NativeTextKey::FilterJpeg => "JPEG 이미지",
            NativeTextKey::ExportWebpTitle => "WebP 이미지 내보내기",
            NativeTextKey::FilterWebp => "WebP 이미지",
            NativeTextKey::ExportAvifTitle => "AVIF 이미지 내보내기",
            NativeTextKey::FilterAvif => "AVIF 이미지",
            NativeTextKey::ExportGifTitle => "GIF 애니메이션 내보내기",
            NativeTextKey::FilterGif => "GIF 이미지",
            NativeTextKey::ExportWebmTitle => "WebM 동영상 내보내기",
            NativeTextKey::FilterWebm => "WebM 동영상",
            NativeTextKey::ExportBatchTitle => "일괄 이미지 내보내기",
            NativeTextKey::FilterZip => "ZIP 압축 파일",
            NativeTextKey::FilterImages => "이미지",
            NativeTextKey::CaptureConsentMessage => {
                "이번 요청에서 디스플레이 및 창 제목을 읽고 선택한 소스 하나를 캡처하도록 허용할까요? 이미지는 이 기기에만 머뭅니다."
            }
            NativeTextKey::CaptureConsentTitle => "ScreenHello — 캡처 권한",
            NativeTextKey::AllowOnce => "한 번만 허용",
            NativeTextKey::Cancel => "취소",
            NativeTextKey::DisplayLabel => "디스플레이",
            NativeTextKey::UntitledWindow => "제목 없는 창",
        },
        NativeLocale::EsEs => match key {
            NativeTextKey::AuthorizeSaveDirectory => {
                "Seleccione la carpeta del archivo de destino para permitir un guardado seguro"
            }
            NativeTextKey::ExitNotReadyMessage => {
                "El editor aún no está listo. Salir podría perder los cambios no guardados. ¿Salir de todos modos?"
            }
            NativeTextKey::TrayShow => "Mostrar ScreenHello",
            NativeTextKey::TrayCapturePrimary => "Capturar pantalla principal",
            NativeTextKey::Quit => "Salir",
            NativeTextKey::OpenProjectTitle => "Abrir proyecto de ScreenHello",
            NativeTextKey::OpenImagesTitle => "Elegir imágenes locales",
            NativeTextKey::SaveProjectTitle => "Guardar proyecto de ScreenHello",
            NativeTextKey::FilterProject => "Proyecto de ScreenHello",
            NativeTextKey::ExportPresetTitle => "Exportar preajuste de estilo de ScreenHello",
            NativeTextKey::FilterPreset => "Preajuste de estilo de ScreenHello",
            NativeTextKey::ExportPngTitle => "Exportar imagen PNG",
            NativeTextKey::FilterPng => "Imagen PNG",
            NativeTextKey::ExportJpegTitle => "Exportar imagen JPEG",
            NativeTextKey::FilterJpeg => "Imagen JPEG",
            NativeTextKey::ExportWebpTitle => "Exportar imagen WebP",
            NativeTextKey::FilterWebp => "Imagen WebP",
            NativeTextKey::ExportAvifTitle => "Exportar imagen AVIF",
            NativeTextKey::FilterAvif => "Imagen AVIF",
            NativeTextKey::ExportGifTitle => "Exportar GIF animado",
            NativeTextKey::FilterGif => "Imagen GIF",
            NativeTextKey::ExportWebmTitle => "Exportar vídeo WebM",
            NativeTextKey::FilterWebm => "Vídeo WebM",
            NativeTextKey::ExportBatchTitle => "Exportar imágenes por lotes",
            NativeTextKey::FilterZip => "Archivo ZIP",
            NativeTextKey::FilterImages => "Imágenes",
            NativeTextKey::CaptureConsentMessage => {
                "¿Permitir esta vez leer los títulos de pantallas y ventanas y capturar una fuente seleccionada? Las imágenes permanecen en este dispositivo."
            }
            NativeTextKey::CaptureConsentTitle => "ScreenHello — Permiso de captura",
            NativeTextKey::AllowOnce => "Permitir una vez",
            NativeTextKey::Cancel => "Cancelar",
            NativeTextKey::DisplayLabel => "Pantalla",
            NativeTextKey::UntitledWindow => "Ventana sin título",
        },
        NativeLocale::PtPt => match key {
            NativeTextKey::AuthorizeSaveDirectory => {
                "Selecione a pasta do ficheiro de destino para autorizar a gravação segura"
            }
            NativeTextKey::ExitNotReadyMessage => {
                "O editor ainda não está pronto. Sair pode perder alterações não guardadas. Sair na mesma?"
            }
            NativeTextKey::TrayShow => "Mostrar o ScreenHello",
            NativeTextKey::TrayCapturePrimary => "Capturar ecrã principal",
            NativeTextKey::Quit => "Sair",
            NativeTextKey::OpenProjectTitle => "Abrir projeto ScreenHello",
            NativeTextKey::OpenImagesTitle => "Escolher imagens locais",
            NativeTextKey::SaveProjectTitle => "Guardar projeto ScreenHello",
            NativeTextKey::FilterProject => "Projeto ScreenHello",
            NativeTextKey::ExportPresetTitle => "Exportar predefinição de estilo ScreenHello",
            NativeTextKey::FilterPreset => "Predefinição de estilo ScreenHello",
            NativeTextKey::ExportPngTitle => "Exportar imagem PNG",
            NativeTextKey::FilterPng => "Imagem PNG",
            NativeTextKey::ExportJpegTitle => "Exportar imagem JPEG",
            NativeTextKey::FilterJpeg => "Imagem JPEG",
            NativeTextKey::ExportWebpTitle => "Exportar imagem WebP",
            NativeTextKey::FilterWebp => "Imagem WebP",
            NativeTextKey::ExportAvifTitle => "Exportar imagem AVIF",
            NativeTextKey::FilterAvif => "Imagem AVIF",
            NativeTextKey::ExportGifTitle => "Exportar GIF animado",
            NativeTextKey::FilterGif => "Imagem GIF",
            NativeTextKey::ExportWebmTitle => "Exportar vídeo WebM",
            NativeTextKey::FilterWebm => "Vídeo WebM",
            NativeTextKey::ExportBatchTitle => "Exportar imagens em lote",
            NativeTextKey::FilterZip => "Arquivo ZIP",
            NativeTextKey::FilterImages => "Imagens",
            NativeTextKey::CaptureConsentMessage => {
                "Permitir desta vez ler os títulos de ecrãs e janelas e capturar uma origem selecionada? As imagens permanecem neste dispositivo."
            }
            NativeTextKey::CaptureConsentTitle => "ScreenHello — Permissão de captura",
            NativeTextKey::AllowOnce => "Permitir uma vez",
            NativeTextKey::Cancel => "Cancelar",
            NativeTextKey::DisplayLabel => "Ecrã",
            NativeTextKey::UntitledWindow => "Janela sem título",
        },
    }
}

#[tauri::command]
pub(crate) fn desktop_set_locale(
    window: WebviewWindow,
    locale: NativeLocale,
    epoch: Option<String>,
    sequence: Option<u64>,
) -> Result<(), String> {
    let applied = window.state::<NativeLocaleState>().set_for_owner(
        window.label(),
        locale,
        epoch.as_deref(),
        sequence,
    )?;
    if !applied {
        return Ok(());
    }
    crate::desktop_system::refresh_tray_menu(window.app_handle())
        .map_err(|_| "desktop-locale-tray-unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    const EPOCH_A: &str = "0123456789abcdef0123456789abcdef0123456789abcdef";
    const EPOCH_B: &str = "fedcba9876543210fedcba9876543210fedcba9876543210";

    #[test]
    fn only_main_can_change_application_locale() {
        let state = NativeLocaleState::default();
        assert_eq!(state.current(), NativeLocale::ZhCn);
        for owner in ["", "other", "Main"] {
            assert_eq!(
                state.set_for_owner(owner, NativeLocale::EnUs, Some(EPOCH_A), Some(1)),
                Err("desktop-locale-owner-invalid".into())
            );
            assert_eq!(state.current(), NativeLocale::ZhCn);
        }
        let mut seq = 1;
        for locale in NativeLocale::ALL {
            assert!(state
                .set_for_owner("main", locale, Some(EPOCH_A), Some(seq))
                .unwrap());
            seq += 1;
            assert_eq!(state.current(), locale);
            assert!(state
                .set_for_owner("other", NativeLocale::ZhCn, Some(EPOCH_A), Some(seq))
                .is_err());
            assert_eq!(state.current(), locale);
        }
    }

    #[test]
    fn stale_locale_sequence_is_ignored_and_new_epoch_resets_ordering() {
        let state = NativeLocaleState::default();
        assert!(state
            .set_for_owner("main", NativeLocale::EnUs, Some(EPOCH_A), Some(2))
            .unwrap());
        assert_eq!(state.current(), NativeLocale::EnUs);
        // Out-of-order delayed older update in same epoch must not clobber newer locale
        assert!(!state
            .set_for_owner("main", NativeLocale::DeDe, Some(EPOCH_A), Some(1))
            .unwrap());
        assert_eq!(state.current(), NativeLocale::EnUs);
        // WebView reload starts a fresh epoch with sequence = 1
        assert!(state
            .set_for_owner("main", NativeLocale::KoKr, Some(EPOCH_B), Some(1))
            .unwrap());
        assert_eq!(state.current(), NativeLocale::KoKr);
    }

    #[test]
    fn locale_contract_covers_all_seven_locales_and_rejects_invalid_values() {
        for (raw, expected) in [
            ("\"zh-CN\"", NativeLocale::ZhCn),
            ("\"en-US\"", NativeLocale::EnUs),
            ("\"zh-TW\"", NativeLocale::ZhTw),
            ("\"de-DE\"", NativeLocale::DeDe),
            ("\"ko-KR\"", NativeLocale::KoKr),
            ("\"es-ES\"", NativeLocale::EsEs),
            ("\"pt-PT\"", NativeLocale::PtPt),
        ] {
            assert_eq!(serde_json::from_str::<NativeLocale>(raw).unwrap(), expected);
        }
        for invalid in ["\"../file\"", "\"fr-FR\"", "\"zh\"", "\"\""] {
            assert!(serde_json::from_str::<NativeLocale>(invalid).is_err());
        }
    }

    #[test]
    fn every_native_key_has_non_empty_translation_across_all_seven_locales() {
        assert_eq!(NativeTextKey::ALL.len(), 32);
        for locale in NativeLocale::ALL {
            for key in NativeTextKey::ALL {
                let value = translate(locale, key);
                assert!(
                    !value.trim().is_empty(),
                    "empty native translation for {locale:?} / {key:?}"
                );
                if locale != NativeLocale::ZhCn && locale != NativeLocale::ZhTw {
                    assert_ne!(
                        value,
                        translate(NativeLocale::ZhCn, key),
                        "untranslated key {key:?} in {locale:?}"
                    );
                }
            }
        }
        assert_eq!(
            translate(NativeLocale::EnUs, NativeTextKey::Cancel),
            "Cancel"
        );
        assert_eq!(
            translate(NativeLocale::ZhTw, NativeTextKey::TrayCapturePrimary),
            "擷取主螢幕"
        );
        assert_eq!(
            translate(NativeLocale::DeDe, NativeTextKey::Quit),
            "Beenden"
        );
        assert_eq!(translate(NativeLocale::KoKr, NativeTextKey::Quit), "종료");
        assert_eq!(translate(NativeLocale::EsEs, NativeTextKey::Quit), "Salir");
        assert_eq!(
            translate(NativeLocale::PtPt, NativeTextKey::TrayCapturePrimary),
            "Capturar ecrã principal"
        );
    }
}
