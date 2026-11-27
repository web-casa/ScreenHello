import { GIFEncoder, applyPalette, quantize } from 'gifenc';

const WEBM_MIME_CANDIDATES = Object.freeze([
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
]);

const cancelError = () => Object.assign(new Error('export-cancelled'), { code: 'export-cancelled' });

const delayMismatchError = () => Object.assign(new Error('gif-delay-mismatch'), { code: 'gif-delay-mismatch' });

const resolveFrameDelaysMs = ({ totalFrames, delayMs = 40, frameDelaysMs }) => {
    const count = Math.max(1, Math.round(Number(totalFrames) || 0));
    if (frameDelaysMs != null) {
        if (!Array.isArray(frameDelaysMs) && !ArrayBuffer.isView(frameDelaysMs)) {
            throw delayMismatchError();
        }
        if (frameDelaysMs.length !== count) {
            throw delayMismatchError();
        }
        const normalized = new Array(count);
        for (let index = 0; index < count; index += 1) {
            const value = Number(frameDelaysMs[index]);
            if (!Number.isInteger(value) || value < 20 || value % 10 !== 0) {
                throw delayMismatchError();
            }
            normalized[index] = value;
        }
        return normalized;
    }
    const uniform = Math.max(20, Math.round((Number(delayMs) || 40) / 10) * 10);
    return Array.from({ length: count }, () => uniform);
};

const sleepUntil = (deadlineMs, signal, nowFn) => {
    if (signal?.aborted) return Promise.reject(cancelError());
    const remaining = deadlineMs - nowFn();
    if (remaining <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
        let timer = null;
        const onAbort = () => {
            if (timer != null) clearTimeout(timer);
            reject(cancelError());
        };
        signal?.addEventListener?.('abort', onAbort, { once: true });
        timer = setTimeout(() => {
            signal?.removeEventListener?.('abort', onAbort);
            resolve();
        }, remaining);
    });
};

export function probeWebmMimeType() {
    if (typeof globalThis.MediaRecorder !== 'function') return null;
    if (typeof globalThis.MediaRecorder.isTypeSupported !== 'function') return null;
    for (const mime of WEBM_MIME_CANDIDATES) {
        try {
            if (globalThis.MediaRecorder.isTypeSupported(mime)) return mime;
        } catch {
            // Ignore browser-specific MIME probe errors.
        }
    }
    return null;
}

/**
 * 同步直接编码 GIF89a（供 Node 单测或无 Worker 环境回退使用）。
 */
export function encodeGifDirect({ width, height, delayMs = 40, frameDelaysMs, frames, maxColors = 192, signal, onProgress }) {
    if (signal?.aborted) throw cancelError();
    const totalFrames = frames.length;
    const delays = resolveFrameDelaysMs({ totalFrames, delayMs, frameDelaysMs });
    const gif = GIFEncoder();
    for (let index = 0; index < totalFrames; index += 1) {
        if (signal?.aborted) throw cancelError();
        const rgba = frames[index];
        const palette = quantize(rgba, maxColors, { format: 'rgb565' });
        const indexed = applyPalette(rgba, palette, 'rgb565');
        gif.writeFrame(indexed, width, height, {
            palette,
            delay: delays[index],
            repeat: 0,
        });
        onProgress?.((index + 1) / totalFrames, index + 1, totalFrames);
    }
    gif.finish();
    const bytes = gif.bytes();
    return new Blob([bytes], { type: 'image/gif' });
}

/**
 * 在独立 Module Worker 中流式编码 GIF89a，带逐帧背压和 AbortSignal 立即终止。
 * @param {object} options
 * @param {number} options.width
 * @param {number} options.height
 * @param {number} options.totalFrames
 * @param {number} [options.delayMs]
 * @param {number[]} [options.frameDelaysMs]
 * @param {(frameIndex: number) => Uint8ClampedArray | Promise<Uint8ClampedArray>} options.renderFrameRgba
 * @param {number} [options.maxColors]
 * @param {AbortSignal} [options.signal]
 * @param {(ratio: number, done: number, total: number) => void} [options.onProgress]
 */
export async function encodeGifInWorker({
    width,
    height,
    totalFrames,
    delayMs = 40,
    frameDelaysMs,
    renderFrameRgba,
    maxColors = 192,
    signal,
    onProgress,
}) {
    if (signal?.aborted) throw cancelError();
    const delays = resolveFrameDelaysMs({ totalFrames, delayMs, frameDelaysMs });
    if (typeof Worker !== 'function') {
        // Stream frames incrementally without buffering all uncompressed RGBA frames in memory.
        const gif = GIFEncoder();
        for (let index = 0; index < totalFrames; index += 1) {
            if (signal?.aborted) throw cancelError();
            const rgba = await renderFrameRgba(index);
            if (signal?.aborted) throw cancelError();
            const palette = quantize(rgba, maxColors, { format: 'rgb565' });
            const indexed = applyPalette(rgba, palette, 'rgb565');
            gif.writeFrame(indexed, width, height, {
                palette,
                delay: delays[index],
                repeat: 0,
            });
            onProgress?.((index + 1) / totalFrames, index + 1, totalFrames);
        }
        gif.finish();
        return new Blob([gif.bytes()], { type: 'image/gif' });
    }

    const worker = new Worker(new URL('../workers/gifEncoder.worker.js', import.meta.url), { type: 'module' });
    let terminated = false;
    const terminate = () => {
        if (terminated) return;
        terminated = true;
        try { worker.terminate(); } catch { /* ignore */ }
    };

    const waitForMessage = (expectedType, expectedIndex = null) => new Promise((resolve, reject) => {
        if (signal?.aborted) {
            terminate();
            reject(cancelError());
            return;
        }
        const cleanup = () => {
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
            signal?.removeEventListener?.('abort', onAbort);
        };
        const onAbort = () => {
            cleanup();
            terminate();
            reject(cancelError());
        };
        const onError = (err) => {
            cleanup();
            terminate();
            reject(Object.assign(new Error(err?.message || 'gif-worker-error'), { code: 'gif-encode-failed' }));
        };
        const onMessage = (event) => {
            const data = event?.data;
            if (!data) return;
            if (data.type === 'error') {
                cleanup();
                terminate();
                reject(Object.assign(new Error(data.message || 'gif-encode-failed'), { code: 'gif-encode-failed' }));
                return;
            }
            if (data.type === expectedType) {
                if (expectedIndex != null && data.index !== expectedIndex) {
                    cleanup();
                    terminate();
                    reject(Object.assign(new Error('gif-frame-index-mismatch'), { code: 'gif-encode-failed' }));
                    return;
                }
                cleanup();
                resolve(data);
            }
        };
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        signal?.addEventListener?.('abort', onAbort, { once: true });
    });

    try {
        const readyPromise = waitForMessage('ready');
        worker.postMessage({ type: 'init', width, height, totalFrames, delayMs, frameDelaysMs: delays, maxColors });
        await readyPromise;

        for (let index = 0; index < totalFrames; index += 1) {
            if (signal?.aborted) throw cancelError();
            const rgba = await renderFrameRgba(index);
            if (signal?.aborted) throw cancelError();
            const copy = new Uint8ClampedArray(rgba);
            const ackPromise = waitForMessage('progress', index);
            worker.postMessage({ type: 'frame', index, rgbaBuffer: copy.buffer }, [copy.buffer]);
            await ackPromise;
            onProgress?.((index + 1) / totalFrames, index + 1, totalFrames);
        }

        const donePromise = waitForMessage('done');
        worker.postMessage({ type: 'finish' });
        const result = await donePromise;
        return new Blob([result.buffer], { type: 'image/gif' });
    } finally {
        terminate();
    }
}

/**
 * 通过 Canvas captureStream + MediaRecorder 本地录制 WebM 视频（严格基于 MIME 探测与单调时钟对齐）。
 */
export async function encodeWebmFromCanvas({
    width,
    height,
    fps = 24,
    durationMs,
    totalFrames,
    drawFrame,
    signal,
    onProgress,
    documentRef = typeof document !== 'undefined' ? document : null,
    now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()),
}) {
    if (signal?.aborted) throw cancelError();
    const mimeType = probeWebmMimeType();
    if (!mimeType || !documentRef) {
        throw Object.assign(new Error('webm-unsupported'), { code: 'webm-unsupported' });
    }

    const frameCount = Math.max(1, Math.round(Number(totalFrames) || 1));
    const safeFps = Math.max(1, Number(fps) || 24);
    const targetDurationMs = Number(durationMs) > 0
        ? Number(durationMs)
        : (frameCount / safeFps) * 1000;
    const streamFps = Math.max(1, Math.min(60, (frameCount * 1000) / targetDurationMs));

    const canvas = documentRef.createElement('canvas');
    let stream = null;
    let recorder = null;
    let onAbort = null;
    try {
        canvas.width = width;
        canvas.height = height;
        if (typeof canvas.captureStream !== 'function') {
            throw Object.assign(new Error('webm-unsupported'), { code: 'webm-unsupported' });
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw Object.assign(new Error('motion-context-unavailable'), { code: 'motion-context-unavailable' });
        }

        stream = canvas.captureStream(streamFps);
        recorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: 4_000_000,
        });
        const chunks = [];
        recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) chunks.push(event.data);
        };

        const stoppedPromise = new Promise((resolve, reject) => {
            recorder.onstop = () => resolve();
            recorder.onerror = (err) => reject(Object.assign(new Error(err?.error?.message || 'webm-encode-failed'), { code: 'webm-encode-failed' }));
        });

        onAbort = () => {
            if (recorder && recorder.state !== 'inactive') {
                try { recorder.stop(); } catch { /* ignore */ }
            }
        };
        signal?.addEventListener?.('abort', onAbort, { once: true });

        recorder.start();
        const startMs = now();
        const slotMs = targetDurationMs / frameCount;
        for (let index = 0; index < frameCount; index += 1) {
            if (signal?.aborted) throw cancelError();
            drawFrame(ctx, index);
            onProgress?.((index + 1) / frameCount, index + 1, frameCount);
            await sleepUntil(startMs + (index + 1) * slotMs, signal, now);
        }
        if (signal?.aborted) throw cancelError();
        if (recorder.state !== 'inactive') recorder.stop();
        await stoppedPromise;
        if (signal?.aborted) throw cancelError();
        const totalBytes = chunks.reduce((sum, chunk) => sum + (chunk?.size || 0), 0);
        if (chunks.length === 0 || totalBytes === 0) {
            throw Object.assign(new Error('webm-encode-failed'), { code: 'webm-encode-failed' });
        }
        return new Blob(chunks, { type: mimeType.split(';')[0] || 'video/webm' });
    } finally {
        if (onAbort) signal?.removeEventListener?.('abort', onAbort);
        stream?.getTracks?.().forEach((track) => {
            try { track.stop(); } catch { /* ignore */ }
        });
        canvas.width = 0;
        canvas.height = 0;
    }
}
