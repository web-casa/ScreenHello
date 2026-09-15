import { CompressionProbe } from './client.js';
import { MAX_PIXELS, MAX_EDGE } from './contract.js';
import photoUrl from '../../../src/assets/demo.jpg?url&no-inline';

const canvasBlob = (canvas, type = 'image/png', quality) => new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob?.type === type ? resolve(blob) : reject(new Error(`fixture-encode-${type}`)), type, quality);
});
const dataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
});
const releaseCanvas = (canvas) => { canvas.width = canvas.height = 0; };
async function decode(blob) {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    let canvas;
    try {
        image.src = url;
        await image.decode();
        canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        return { canvas, context };
    } catch (error) { if (canvas) releaseCanvas(canvas); throw error; }
    finally { image.src = ''; URL.revokeObjectURL(url); }
}
async function sourceCanvas(kind, width, height, opaque) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
        || width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) throw new Error('compression-pixel-budget');
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (opaque) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); }
    if (kind === 'photo') {
        const photo = new Image(); photo.src = photoUrl;
        try { await photo.decode(); ctx.drawImage(photo, 0, 0, width, height); }
        catch (error) { releaseCanvas(canvas); throw error; }
        finally { photo.src = ''; }
    } else if (kind === 'noise') {
        const data = ctx.createImageData(width, height);
        let seed = 123456;
        for (let i = 0; i < data.data.length; i += 4) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            data.data.set([seed & 255, (seed >>> 8) & 255, (seed >>> 16) & 255, 255], i);
        }
        ctx.putImageData(data, 0, 0);
    } else if (kind === 'transparent') {
        ctx.clearRect(0, 0, width, height);
    } else if (kind === 'few-colors') {
        ctx.fillStyle = '#345678'; ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#12be67'; ctx.fillRect(0, 0, Math.floor(width / 2), height);
    } else {
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, '#cb35c8'); gradient.addColorStop(1, '#37de9f');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, height / 2, width, height / 2);
        ctx.shadowColor = 'rgba(0, 0, 0, .45)'; ctx.shadowBlur = 12;
        ctx.fillStyle = 'rgba(24, 121, 205, .5)'; ctx.fillRect(16, 20, width - 32, height / 4);
        ctx.shadowBlur = 0; ctx.fillStyle = '#f14363';
        ctx.font = '14px sans-serif'; ctx.fillText('ScreenHello 1px ABC abc 0123456789', 8, height / 2 - 4);
        ctx.fillStyle = '#204b83'; ctx.fillRect(8, height - 10, width - 16, 1);
    }
    return { canvas, ctx };
}
function pixelMetrics(actual, expected) {
    let rgb = 0, alpha = 0, different = 0, zeroAlpha = 0;
    for (let i = 0; i < actual.length; i += 4) {
        let changed = false;
        for (let c = 0; c < 3; c++) { rgb += Math.abs(actual[i + c] - expected[i + c]); changed ||= actual[i + c] !== expected[i + c]; }
        alpha += Math.abs(actual[i + 3] - expected[i + 3]);
        different += Number(changed || actual[i + 3] !== expected[i + 3]);
        zeroAlpha += Number(actual[i + 3] === 0);
    }
    const count = actual.length / 4;
    return { rgbMae: rgb / (count * 3), alphaMae: alpha / count, differentPixels: different, zeroAlpha };
}

async function run({ mode = 'png-lossy', kind = 'screenshot', width = 512, height = 320,
    colors = 256, quality = 80, repeat = 1, includeBytes = true, show = false, onPhase } = {}) {
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > 6) throw new Error('fixture-repeat-invalid');
    if (mode === 'jpg-lossy' && (!Number.isInteger(quality) || quality < 1 || quality > 100)) throw new Error('compression-quality-invalid');
    await onPhase?.('source');
    const source = await sourceCanvas(kind, width, height, mode.startsWith('webp-') || mode === 'jpg-lossy');
    const probe = new CompressionProbe();
    let decoded;
    let maxUiGapMs = 0;
    let lastTick = performance.now();
    const heartbeat = setInterval(() => {
        const now = performance.now(); maxUiGapMs = Math.max(maxUiGapMs, now - lastTick); lastTick = now;
    }, 16);
    try {
        const baseline = await canvasBlob(source.canvas);
        const expected = source.ctx.getImageData(0, 0, width, height).data;
        const samples = [];
        let result;
        for (let index = 0; index < repeat; index++) {
            await onPhase?.('encoding');
            const request = { mode, width, height, colors, quality };
            if (mode === 'png-lossless') request.png = await baseline.arrayBuffer();
            else request.pixels = expected.slice().buffer;
            if (mode === 'jpg-lossy') {
                const start = performance.now();
                const blob = await canvasBlob(source.canvas, 'image/jpeg', quality / 100);
                result = { blob, encodeMs: performance.now() - start, totalMs: performance.now() - start };
            } else result = await probe.encode(request);
            samples.push({ encodeMs: result.encodeMs, totalMs: result.totalMs, bytes: result.blob.size });
        }
        await onPhase?.('decode');
        const decodeStarted = performance.now();
        decoded = await decode(result.blob);
        const metrics = pixelMetrics(decoded.context.getImageData(0, 0, width, height).data, expected);
        const decodeCompareMs = performance.now() - decodeStarted;
        // The benchmark samples while both full-sized canvases are still alive.
        await onPhase?.('decode');
        if (show) {
            const container = document.getElementById('comparison');
            container.replaceChildren();
            for (const [label, blob] of [['Before', baseline], ['After', result.blob]]) {
                const figure = document.createElement('figure'); figure.style.cssText = 'display:inline-block;margin:8px;background:#ccc';
                const caption = document.createElement('figcaption'); caption.textContent = `${label}: ${blob.size} bytes (${mode}, ${colors} colors)`;
                const img = new Image(); img.src = await dataUrl(blob); img.alt = label;
                figure.append(caption, img); container.append(figure);
            }
        }
        return { mode, kind, width, height, colors, quality, samples, baselineBytes: baseline.size,
            outputBytes: result.blob.size, decodedWidth: decoded.canvas.width, decodedHeight: decoded.canvas.height,
            decodeCompareMs, maxUiGapMs, ...metrics,
            ...(includeBytes ? { baseline: await dataUrl(baseline), output: await dataUrl(result.blob) } : {}) };
    } finally {
        clearInterval(heartbeat); probe.dispose(); releaseCanvas(source.canvas); if (decoded) releaseCanvas(decoded.canvas);
        await onPhase?.('released');
    }
}

async function cancellation(mode, timeout = false) {
    const probe = new CompressionProbe({ timeoutMs: timeout ? 1 : 30_000 });
    const source = await sourceCanvas('noise', 1024, 1024, true);
    const controller = new AbortController();
    const request = { mode, width: 1024, height: 1024, colors: 256 };
    if (mode === 'png-lossless') request.png = await (await canvasBlob(source.canvas)).arrayBuffer();
    else request.pixels = source.ctx.getImageData(0, 0, 1024, 1024).data.buffer;
    releaseCanvas(source.canvas);
    const started = performance.now();
    let computationStarted = false;
    const promise = probe.encode(request, { signal: controller.signal,
        onStarted: () => { computationStarted = true; if (!timeout) controller.abort(); },
    });
    try { await promise; throw new Error('fixture-cancellation-not-observed'); }
    catch (error) {
        if (!['compression-cancelled', 'compression-timeout'].includes(error.message)) throw error;
        const durationMs = performance.now() - started;
        const retry = { mode: 'png-lossy', width: 1, height: 1, colors: 64, pixels: new Uint8Array([30, 60, 90, 255]).buffer };
        probe.timeoutMs = 30_000;
        const retried = await probe.encode(retry);
        return { error: error.message, durationMs, computationStarted,
            detached: (request.pixels || request.png).byteLength === 0, retryBytes: retried.blob.size };
    } finally { probe.dispose(); }
}

async function optimiseRawFixture(bytes, width, height) {
    const probe = new CompressionProbe();
    try {
        const result = await probe.encode({ mode: 'png-lossless', png: new Uint8Array(bytes).buffer, width, height });
        return dataUrl(result.blob);
    } finally { probe.dispose(); }
}
async function mountScene() {
    const { mountI18nHarness } = await import('../../fixtures/i18n-harness.jsx');
    const { RenderTaskTracker } = await import('../../../src/stores/renderTaskTracker.js');
    const harness = mountI18nHarness(document.getElementById('scene'));
    globalThis.__compressionScene = harness;
    const deadline = performance.now() + 10_000;
    while (!harness.runtimes.first || !harness.runtimes.second) {
        if (performance.now() > deadline) throw new Error('fixture-scene-timeout');
        await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    for (const runtime of Object.values(harness.runtimes)) runtime.renderTaskTracker = new RenderTaskTracker();
}
globalThis.__compressionProbe = { run, cancellation, optimiseRawFixture, mountScene };
