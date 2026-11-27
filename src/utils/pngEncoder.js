import wasmUrl from '@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm?url&no-inline';
import { MAX_COMPRESSION_TIMEOUT_MS, compressionTimeoutMs, MAX_COMPRESSED_PIXELS, validateExportSettings } from './exportSettings';
import { exportError } from './exportAsync';

export function isPngBuffer(buffer, width, height) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 45) return false;
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const end = bytes.length - 12;
    return [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)
        && view.getUint32(8) === 13 && view.getUint32(12) === 0x49484452
        && view.getUint32(16) === width && view.getUint32(20) === height
        && view.getUint32(end) === 0 && view.getUint32(end + 4) === 0x49454e44
        && view.getUint32(end + 8) === 0xae426082;
}

export class PngEncoder {
    constructor({ workerFactory = () => new Worker(new URL('../workers/pngEncoder.worker.js', import.meta.url),
        { type: 'module', name: 'screenhello-png-encoder' }), timeoutMs = MAX_COMPRESSION_TIMEOUT_MS, idleMs = 1_000 } = {}) {
        this.workerFactory = workerFactory;
        this.timeoutMs = timeoutMs;
        this.idleMs = idleMs;
        this.worker = null;
        this.cancel = null;
        this.disposed = false;
        this.sequence = 0;
        this.idleTimer = null;
    }
    terminate() { clearTimeout(this.idleTimer); this.idleTimer = null; this.worker?.terminate(); this.worker = null; }
    dispose() { this.disposed = true; this.cancel?.(); this.terminate(); }
    async encode({ png, pixels, width, height, compression, paletteColors, signal } = {}) {
        if (this.disposed || signal?.aborted) throw exportError('export-cancelled');
        if (this.cancel) throw exportError('png-encoder-busy');
        const settings = validateExportSettings({ format: 'png', compression, paletteColors });
        if (!['lossless', 'lossy'].includes(settings.compression)
            || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
            || width > 8192 || height > 8192 || width * height > MAX_COMPRESSED_PIXELS) throw exportError('png-input-invalid');
        let buffer;
        if (compression === 'lossless') {
            if (!isPngBuffer(png, width, height) || png.byteLength > MAX_COMPRESSED_PIXELS * 5) throw exportError('png-input-invalid');
            buffer = png;
        } else {
            if (!(pixels instanceof Uint8ClampedArray) || pixels.byteLength !== width * height * 4) throw exportError('png-input-invalid');
            buffer = pixels.byteOffset === 0 && pixels.byteLength === pixels.buffer.byteLength ? pixels.buffer : pixels.slice().buffer;
        }
        clearTimeout(this.idleTimer);
        this.worker ??= this.workerFactory();
        const worker = this.worker;
        const id = ++this.sequence;
        try {
            const result = await new Promise((resolve, reject) => {
                let settled = false;
                let timer;
                const finish = (error, data) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    signal?.removeEventListener('abort', abort);
                    worker.onmessage = worker.onerror = worker.onmessageerror = null;
                    this.cancel = null;
                    if (error) { this.terminate(); reject(error); } else resolve(data);
                };
                const abort = () => finish(exportError('export-cancelled'));
                this.cancel = abort;
                timer = setTimeout(() => finish(exportError('png-encode-timeout')), Math.min(this.timeoutMs, compressionTimeoutMs(width, height)));
                worker.onmessage = ({ data }) => {
                    if (data?.id !== id) return;
                    if (!data.ok || !isPngBuffer(data.buffer, width, height)) finish(exportError('png-output-invalid', data?.message));
                    else finish(null, data.buffer);
                };
                worker.onerror = event => finish(exportError('png-worker-failed', event.message));
                worker.onmessageerror = () => finish(exportError('png-worker-failed'));
                signal?.addEventListener('abort', abort, { once: true });
                if (signal?.aborted) { abort(); return; }
                try { worker.postMessage({ id, ...settings, width, height, buffer, wasmUrl }, [buffer]); }
                catch (error) { finish(exportError('png-worker-failed', error)); }
            });
            if (this.disposed || signal?.aborted) throw exportError('export-cancelled');
            return new Blob([result], { type: 'image/png' });
        } finally { if (this.worker) this.idleTimer = setTimeout(() => this.terminate(), this.idleMs); }
    }
}
