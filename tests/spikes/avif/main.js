import { AvifEncoder, isAvifBuffer } from '../../../src/utils/avifEncoder.js';

const MAX_PIXELS = 4_194_304;

const createSourceCanvas = (width, height, transparent) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#f03a47');
    gradient.addColorStop(0.5, '#16a6a1');
    gradient.addColorStop(1, '#2435d8');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    if (transparent) context.clearRect(Math.floor(width / 2), 0, Math.ceil(width / 2), height);
    context.fillStyle = transparent ? 'rgba(255, 214, 10, 0.5)' : '#ffd60a';
    context.fillRect(Math.floor(width / 2), 0, Math.ceil(width / 2), height);
    return { canvas, context };
};

const canvasBlobSize = (canvas, type, quality) => new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
        if (blob) resolve(blob.size);
        else reject(new Error(`canvas-${type}-failed`));
    }, type, quality);
});

const meanAbsoluteError = (actual, expected, channel) => {
    let total = 0;
    let count = 0;
    for (let offset = channel; offset < actual.length; offset += 4) {
        total += Math.abs(actual[offset] - expected[offset]);
        count += 1;
    }
    return Math.round(total / count * 100) / 100;
};

const run = async ({ width = 48, height = 32, repeat = 1, qualityMetrics = false } = {}) => {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        throw new Error('invalid-dimensions');
    }
    if (width * height > MAX_PIXELS) throw new Error('pixel-budget-exceeded');
    const transparent = !qualityMetrics;
    const source = createSourceCanvas(width, height, transparent);
    const encoder = new AvifEncoder({ idleMs: 60_000 });
    const durationsMs = [];
    let blob;
    try {
        for (let iteration = 0; iteration < repeat; iteration += 1) {
            const imageData = source.context.getImageData(0, 0, width, height);
            const startedAt = performance.now();
            blob = await encoder.encode({ pixels: imageData.data, width, height });
            durationsMs.push(Math.round((performance.now() - startedAt) * 10) / 10);
        }
        const bytes = await blob.arrayBuffer();
        const url = URL.createObjectURL(blob);
        try {
            const image = new Image();
            image.src = url;
            await image.decode();
            const decoded = document.createElement('canvas');
            decoded.width = width;
            decoded.height = height;
            const decodedContext = decoded.getContext('2d', { willReadFrequently: true });
            decodedContext.drawImage(image, 0, 0);
            const actual = decodedContext.getImageData(0, 0, width, height).data;
            const alphaSampleOffset = (Math.floor(height / 2) * width + Math.floor(width * 0.75)) * 4 + 3;
            const result = {
                mimeType: blob.type,
                bytes: blob.size,
                validBrand: isAvifBuffer(bytes),
                width: image.naturalWidth,
                height: image.naturalHeight,
                durationsMs,
                crossOriginIsolated: globalThis.crossOriginIsolated,
                alphaSample: actual[alphaSampleOffset],
            };
            if (qualityMetrics) {
                const expected = source.context.getImageData(0, 0, width, height).data;
                result.rgbMae = [0, 1, 2].map((channel) => meanAbsoluteError(actual, expected, channel));
                result.alphaMae = meanAbsoluteError(actual, expected, 3);
                result.pngBytes = await canvasBlobSize(source.canvas, 'image/png');
                result.webpBytes = await canvasBlobSize(source.canvas, 'image/webp', 0.8);
            }
            decoded.width = 0;
            decoded.height = 0;
            return result;
        } finally {
            URL.revokeObjectURL(url);
        }
    } finally {
        encoder.dispose();
        source.canvas.width = 0;
        source.canvas.height = 0;
    }
};

globalThis.__screenhelloRunAvifProductionSpike = run;
globalThis.__screenhelloCancelAvifProductionSpike = async ({ width = 2048, height = 2048 } = {}) => {
    const source = createSourceCanvas(width, height, false);
    const imageData = source.context.getImageData(0, 0, width, height);
    const encoder = new AvifEncoder();
    const controller = new AbortController();
    const startedAt = performance.now();
    try {
        const running = encoder.encode({ pixels: imageData.data, width, height, signal: controller.signal });
        setTimeout(() => controller.abort(), 0);
        await running;
        return { code: 'unexpected-success' };
    } catch (error) {
        return {
            code: error?.code || error?.message,
            durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
            transferredBytesRemaining: imageData.data.byteLength,
        };
    } finally {
        encoder.dispose();
        source.canvas.width = 0;
        source.canvas.height = 0;
    }
};
if (new URLSearchParams(location.search).get('manual') !== '1') {
    globalThis.__screenhelloAvifProductionSpike = run();
    globalThis.__screenhelloAvifProductionSpike.then((result) => {
        document.querySelector('#result').textContent = JSON.stringify(result);
    }, (error) => {
        document.querySelector('#result').textContent = JSON.stringify({ error: error?.code || error?.message || 'failed' });
    });
}
