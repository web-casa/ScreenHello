// Pure settings contract shared by stores and scalar Workers. No DOM or codec imports.
export const EXPORT_FORMATS = ['png', 'jpg', 'webp', 'avif'];
export const EXPORT_RATIOS = [1, 2, 3];
// Full comparison previews retain two encodings plus decoded display surfaces.
// Direct downloads do not allocate that comparison; keep the budgets separate.
export const MAX_PREVIEW_PIXELS = 1_048_576;
export const MAX_COMPRESSED_PIXELS = 4_194_304;
// Internal standalone-Web rollout policy. Library/desktop callers keep the
// physical codec budget; project settings never decide this runtime policy.
export const compressedDownloadPixelLimit = (format, webExportSafety = false) =>
    webExportSafety && format === 'avif' ? MAX_PREVIEW_PIXELS : MAX_COMPRESSED_PIXELS;
export const WEB_AVIF_LIMIT_MESSAGE = '网页版 AVIF 压缩暂时最多支持约 105 万像素。请主动选择 PNG、JPG 或 WebP；不会自动缩小图片或更换格式。';
export const COMPRESSION_TIMEOUT_MS = 30_000;
export const MAX_COMPRESSION_TIMEOUT_MS = 120_000;
// Four times as many pixels also need a bounded, proportionate CPU budget.
// Validation at each caller still rejects invalid geometry before allocation.
export const compressionTimeoutMs = (width, height) => Math.min(MAX_COMPRESSION_TIMEOUT_MS,
    COMPRESSION_TIMEOUT_MS * Math.max(1, Math.ceil(width * height / MAX_PREVIEW_PIXELS)));
export const PNG_PALETTE_COLORS = [256, 128, 64];
export const LOSSY_QUALITY_PRESETS = Object.freeze({ jpg: [90, 80, 60], webp: [90, 80, 60], avif: [80, 60, 40] });
const DEFAULT_QUALITY = { jpg: 90, webp: 90, avif: 60 };
const error = code => Object.assign(new Error(code), { code });

export function validateExportSettings(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('export-settings-invalid');
    if (value.compression === null || value.quality === null || value.paletteColors === null) throw error('export-settings-invalid');
    const format = value.format ?? 'png';
    const ratio = Number(value.ratio ?? 1);
    if (!EXPORT_FORMATS.includes(format)) throw error('export-format-unsupported');
    if (!EXPORT_RATIOS.includes(ratio)) throw error('export-ratio-unsupported');
    const compression = value.compression ?? 'standard';
    if (!['standard', 'lossless', 'lossy'].includes(compression)
        || (compression === 'lossless' && !['png', 'webp'].includes(format))) throw error('export-settings-invalid');
    const settings = { format, ratio };
    if (compression === 'standard') {
        if (value.quality !== undefined || value.paletteColors !== undefined) throw error('export-settings-invalid');
        return settings; // Keep legacy serialized defaults byte-for-byte compatible.
    }
    settings.compression = compression;
    if (compression === 'lossy' && format === 'png') {
        if (value.quality !== undefined) throw error('export-settings-invalid');
        const paletteColors = value.paletteColors ?? 256;
        if (!PNG_PALETTE_COLORS.includes(paletteColors)) throw error('export-settings-invalid');
        return { ...settings, paletteColors };
    }
    if (value.paletteColors !== undefined) throw error('export-settings-invalid');
    if (compression === 'lossy') {
        const quality = value.quality ?? DEFAULT_QUALITY[format];
        if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw error('export-settings-invalid');
        return { ...settings, quality };
    }
    if (value.quality !== undefined) throw error('export-settings-invalid');
    return settings;
}

// Loading an older or newer file must preserve its readable image, never infer
// consent to lossy compression from an orphan quality/palette field.
export function normalizeExportSettings(value = {}) {
    const base = {
        format: EXPORT_FORMATS.includes(value?.format) ? value.format : 'png',
        ratio: EXPORT_RATIOS.includes(Number(value?.ratio)) ? Number(value.ratio) : 1,
    };
    if (value?.compression == null || value.compression === 'standard') return base;
    try { return validateExportSettings(value); }
    catch { return base; }
}

export function exportSettingsWarnings(value) {
    if (value?.compression === undefined) return [];
    try { validateExportSettings(value); return []; }
    catch { return ['export-settings-reset']; }
}

export const exportSettingsKey = value => JSON.stringify(validateExportSettings(value));
