import { getImage } from '@utils/utils';

const analysisError = (code) => Object.assign(new Error(code), { code });
const toHex = (value) => Math.round(value).toString(16).padStart(2, '0');
const channelLuminance = (value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
};

export function analyzeRgbaEdges(data, width, height, sourceWidth = width, sourceHeight = height) {
    if (!data || data.length < width * height * 4 || width <= 0 || height <= 0) {
        throw analysisError('suggestion-image-data-invalid');
    }
    let red = 0;
    let green = 0;
    let blue = 0;
    let weight = 0;
    const sample = (x, y) => {
        const offset = (y * width + x) * 4;
        const alpha = data[offset + 3] / 255;
        if (alpha < 0.125) return;
        red += data[offset] * alpha;
        green += data[offset + 1] * alpha;
        blue += data[offset + 2] * alpha;
        weight += alpha;
    };
    for (let x = 0; x < width; x += 1) {
        sample(x, 0);
        if (height > 1) sample(x, height - 1);
    }
    for (let y = 1; y < height - 1; y += 1) {
        sample(0, y);
        if (width > 1) sample(width - 1, y);
    }
    const rgb = weight > 0
        ? [red / weight, green / weight, blue / weight]
        : [245, 245, 245];
    const edgeColor = `#${rgb.map(toHex).join('')}`;
    const luminance = 0.2126 * channelLuminance(rgb[0])
        + 0.7152 * channelLuminance(rgb[1])
        + 0.0722 * channelLuminance(rgb[2]);
    const ratio = Math.max(1, sourceWidth) / Math.max(1, sourceHeight);
    const orientation = ratio >= 1.1 ? 'landscape' : (ratio <= 0.9 ? 'portrait' : 'square');
    const frame = orientation === 'landscape'
        ? (luminance < 0.4 ? 'windowsBarDark' : 'windowsBarLight')
        : (orientation === 'portrait' ? 'genericPhone' : 'card');
    return {
        edgeColor,
        luminance,
        orientation,
        innerBorder: {
            visible: true,
            width: 1,
            color: luminance < 0.45 ? '#ffffff99' : '#00000066',
        },
        frame,
    };
}

/** Sample a maximum 64px preview locally. No image bytes leave the browser. */
export async function analyzeImageSuggestions(src) {
    if (!src) throw analysisError('suggestion-image-missing');
    const image = await getImage(src);
    const sourceWidth = Math.round(Number(image.naturalWidth || image.width));
    const sourceHeight = Math.round(Number(image.naturalHeight || image.height));
    if (sourceWidth <= 0 || sourceHeight <= 0) throw analysisError('suggestion-image-invalid');
    const scale = Math.min(1, 64 / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = globalThis.document?.createElement?.('canvas');
    if (!canvas) throw analysisError('suggestion-canvas-unavailable');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw analysisError('suggestion-canvas-unavailable');
    try {
        context.drawImage(image, 0, 0, width, height);
        return analyzeRgbaEdges(context.getImageData(0, 0, width, height).data, width, height, sourceWidth, sourceHeight);
    } catch {
        throw analysisError('suggestion-canvas-unreadable');
    }
}
