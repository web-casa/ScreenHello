// C0 experiment only: these limits are NOT the production ExportService contract.
export const MAX_PIXELS = 2_097_152;
export const MAX_EDGE = 8192;
export const TIMEOUT_MS = 30_000;
export const MODES = ['png-lossless', 'png-lossy', 'webp-lossless', 'webp-lossy', 'avif-lossy'];

export function validateRequest({ mode, width, height, colors = 256, quality = 80, pixels, png } = {}) {
    if (!MODES.includes(mode)) throw new Error('compression-mode-invalid');
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
        || width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) {
        throw new Error('compression-pixel-budget');
    }
    if (mode === 'png-lossy' && ![64, 128, 256].includes(colors)) throw new Error('compression-colors-invalid');
    if (mode.endsWith('-lossy') && mode !== 'png-lossy'
        && (!Number.isInteger(quality) || quality < 1 || quality > 100)) throw new Error('compression-quality-invalid');
    if (mode === 'png-lossless') {
        if (!(png instanceof ArrayBuffer) || png.byteLength < 33 || png.byteLength > MAX_PIXELS * 5) {
            throw new Error('compression-png-invalid');
        }
        const bytes = new Uint8Array(png);
        const view = new DataView(png);
        if (![137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)
            || view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452
            || view.getUint32(16) !== width || view.getUint32(20) !== height) {
            throw new Error('compression-png-invalid');
        }
    } else if (!(pixels instanceof ArrayBuffer) || pixels.byteLength !== width * height * 4) {
        throw new Error('compression-pixels-invalid');
    }
    return { mode, width, height, colors, quality };
}

export const mimeForMode = (mode) => mode.startsWith('png-') ? 'image/png'
    : mode.startsWith('webp-') ? 'image/webp' : 'image/avif';
