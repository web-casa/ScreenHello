import oxi from '@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm?url&no-inline';
import webp from '@jsquash/webp/codec/enc/webp_enc.wasm?url&no-inline';
import avif from '@jsquash/avif/codec/enc/avif_enc.wasm?url&no-inline';
import { validateRequest, mimeForMode, TIMEOUT_MS } from './contract.js';

export class CompressionProbe {
    constructor({ timeoutMs = TIMEOUT_MS } = {}) {
        this.timeoutMs = timeoutMs;
        this.worker = null;
        this.cancel = null;
        this.disposed = false;
        this.sequence = 0;
    }
    terminate() { this.worker?.terminate(); this.worker = null; }
    dispose() {
        this.disposed = true;
        this.cancel?.();
        this.terminate();
    }
    async encode(request, { signal, onStarted } = {}) {
        if (this.disposed || signal?.aborted) throw new Error('compression-cancelled');
        if (this.cancel) throw new Error('compression-busy');
        const settings = validateRequest(request);
        this.worker ??= new Worker(new URL('./codec.worker.js', import.meta.url), { type: 'module' });
        const worker = this.worker;
        const id = ++this.sequence;
        const buffer = settings.mode === 'png-lossless' ? request.png : request.pixels;
        const started = performance.now();
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
            const abort = () => finish(new Error('compression-cancelled'));
            this.cancel = abort;
            timer = setTimeout(() => finish(new Error('compression-timeout')), this.timeoutMs);
            worker.onmessage = ({ data }) => {
                if (data?.id !== id) return;
                if (data.started === true) {
                    try { onStarted?.(); } catch (error) { finish(error); }
                    return;
                }
                if (data.error) finish(new Error(data.error));
                else if (!(data.buffer instanceof ArrayBuffer) || !data.buffer.byteLength) finish(new Error('compression-output-invalid'));
                else finish(null, data);
            };
            worker.onerror = (event) => finish(new Error(event.message || 'compression-worker-error'));
            worker.onmessageerror = () => finish(new Error('compression-message-error'));
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) { abort(); return; }
            try {
                worker.postMessage({ ...settings, id, wasm: { oxi, webp, avif },
                    [settings.mode === 'png-lossless' ? 'png' : 'pixels']: buffer }, [buffer]);
            } catch (error) { finish(error); }
        });
        if (this.disposed || signal?.aborted) throw new Error('compression-cancelled');
        return { blob: new Blob([result.buffer], { type: mimeForMode(settings.mode) }),
            encodeMs: result.encodeMs, totalMs: performance.now() - started };
    }
}
