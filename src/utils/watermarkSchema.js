import { utf8ByteLength } from '@utils/codeCardSchema';

export const WATERMARK_MODES = Object.freeze(['text', 'image']);
export const WATERMARK_POSITIONS = Object.freeze([
    'top-left',
    'top',
    'top-right',
    'left',
    'center',
    'right',
    'bottom-left',
    'bottom',
    'bottom-right',
    'tile',
]);
export const WATERMARK_IMAGE_MAX_BYTES = 64 * 1024;
export const WATERMARK_IMAGE_MAX_EDGE = 256;

const WATERMARK_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export const DEFAULT_WATERMARK = Object.freeze({
    enabled: false,
    mode: 'text',
    text: 'ScreenHello',
    color: '#00000030',
    angle: 45,
    imageDataUrl: null,
    imageWidth: 0,
    imageHeight: 0,
    position: 'bottom-right',
    scale: 16,
    opacity: 65,
    margin: 24,
});

const clampInt = (value, min, max, fallback) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.round(Math.min(Math.max(num, min), max));
};

export const isValidWatermarkImageDataUrl = (value) => {
    if (typeof value !== 'string' || !value) return false;
    if (!WATERMARK_DATA_URL_PATTERN.test(value)) return false;
    return utf8ByteLength(value) <= WATERMARK_IMAGE_MAX_BYTES;
};

const unescapeXmlText = (value) => String(value ?? '')
    .replace(/&apos;/g, '\'')
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');

const decodeLegacyWatermarkSvg = (legacyWaterImg) => {
    if (typeof legacyWaterImg !== 'string' || !legacyWaterImg.startsWith('data:image/svg+xml')) {
        return null;
    }
    const comma = legacyWaterImg.indexOf(',');
    if (comma < 0) return null;
    const header = legacyWaterImg.slice(0, comma).toLowerCase();
    const payload = legacyWaterImg.slice(comma + 1);
    try {
        if (header.includes(';base64')) {
            if (typeof atob === 'function') return atob(payload);
            return null;
        }
        return decodeURIComponent(payload);
    } catch {
        return null;
    }
};

export const extractLegacyWatermarkSettings = (legacyWaterImg) => {
    const svg = decodeLegacyWatermarkSvg(legacyWaterImg);
    if (!svg) return {};
    const recovered = {};
    const angleMatch = svg.match(/transform:\s*rotate\(\s*(-?\d+(?:\.\d+)?)deg\s*\)/i);
    if (angleMatch) {
        const parsedAngle = Number(angleMatch[1]);
        if (Number.isFinite(parsedAngle)) recovered.angle = parsedAngle < 0 ? -45 : 45;
    }
    const colorMatch = svg.match(/<span\b[^>]*style="[^"]*color\s*:\s*([^;"]+)/i);
    if (colorMatch && colorMatch[1].trim()) {
        recovered.color = colorMatch[1].trim().slice(0, 48);
    }
    const textMatch = svg.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i);
    if (textMatch) {
        const decodedText = unescapeXmlText(textMatch[1]).replace(/[\r\n\t]+/g, ' ').slice(0, 80);
        if (decodedText.trim()) recovered.text = decodedText;
    }
    return recovered;
};

export function normalizeWatermark(raw, legacyWaterImg = null) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        const recovered = legacyWaterImg ? extractLegacyWatermarkSettings(legacyWaterImg) : {};
        return {
            ...DEFAULT_WATERMARK,
            ...recovered,
            enabled: Boolean(legacyWaterImg),
        };
    }

    const mode = typeof raw.mode === 'string' && WATERMARK_MODES.includes(raw.mode)
        ? raw.mode
        : DEFAULT_WATERMARK.mode;
    const position = typeof raw.position === 'string' && WATERMARK_POSITIONS.includes(raw.position)
        ? raw.position
        : DEFAULT_WATERMARK.position;
    const text = typeof raw.text === 'string'
        ? raw.text.replace(/[\r\n\t]+/g, ' ').slice(0, 80)
        : DEFAULT_WATERMARK.text;
    const color = typeof raw.color === 'string' && raw.color.trim()
        ? raw.color.trim().slice(0, 48)
        : DEFAULT_WATERMARK.color;
    const angle = Number(raw.angle) === -45 ? -45 : 45;
    const imageDataUrl = isValidWatermarkImageDataUrl(raw.imageDataUrl) ? raw.imageDataUrl : null;
    const imageWidth = imageDataUrl ? clampInt(raw.imageWidth, 1, WATERMARK_IMAGE_MAX_EDGE, 128) : 0;
    const imageHeight = imageDataUrl ? clampInt(raw.imageHeight, 1, WATERMARK_IMAGE_MAX_EDGE, 128) : 0;

    return {
        enabled: raw.enabled === true,
        mode,
        text,
        color,
        angle,
        imageDataUrl,
        imageWidth,
        imageHeight,
        position,
        scale: clampInt(raw.scale, 5, 40, DEFAULT_WATERMARK.scale),
        opacity: clampInt(raw.opacity, 10, 100, DEFAULT_WATERMARK.opacity),
        margin: clampInt(raw.margin, 0, 120, DEFAULT_WATERMARK.margin),
    };
}

/**
 * 计算单点图片/Logo 水印在画布中的边界盒 { x, y, width, height }。
 */
export function computeWatermarkPlacement(frameWidth, frameHeight, rawWatermark) {
    const wm = normalizeWatermark(rawWatermark);
    const fw = Math.max(1, Number(frameWidth) || 800);
    const fh = Math.max(1, Number(frameHeight) || 600);
    const ratio = wm.imageWidth > 0 && wm.imageHeight > 0 ? wm.imageWidth / wm.imageHeight : 1;

    const targetMax = Math.max(24, Math.round(Math.min(fw, fh) * (wm.scale / 100)));
    let width;
    let height;
    if (ratio >= 1) {
        width = targetMax;
        height = Math.max(16, Math.round(targetMax / ratio));
    } else {
        height = targetMax;
        width = Math.max(16, Math.round(targetMax * ratio));
    }
    width = Math.min(width, Math.max(24, fw - 8));
    height = Math.min(height, Math.max(24, fh - 8));

    const pad = Math.min(wm.margin, Math.max(0, Math.floor(Math.min(fw - width, fh - height) / 2)));
    const pos = wm.position;

    let x = Math.round((fw - width) / 2);
    if (pos.includes('left')) x = pad;
    else if (pos.includes('right')) x = Math.round(fw - width - pad);

    let y = Math.round((fh - height) / 2);
    if (pos.startsWith('top')) y = pad;
    else if (pos.startsWith('bottom')) y = Math.round(fh - height - pad);

    return { x, y, width, height };
}
