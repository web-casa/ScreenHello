import webpWasmUrl from '@jsquash/webp/codec/enc/webp_enc.wasm?url&no-inline';

export const WEBP_MIME_TYPE = 'image/webp';
export const WEBP_ENCODE_TIMEOUT_MS = 120_000;
export const WEBP_WORKER_IDLE_MS = 1_000;

const webpError = (code, cause) => {
    const error = Object.assign(new Error(code), { code });
    if (cause !== undefined) error.cause = cause;
    return error;
};

const defaultWorkerFactory = () => new Worker(
    new URL('../workers/webpEncoder.worker.js', import.meta.url),
    { type: 'module', name: 'screenhello-webp-encoder' }
);

const ascii = (bytes, offset) => String.fromCharCode(...bytes.subarray(offset, offset + 4));

export const isWebpBuffer = (value) => {
    const bytes = value instanceof Uint8Array
        ? value
        : (value instanceof ArrayBuffer ? new Uint8Array(value) : null);
    if (!bytes || bytes.byteLength < 12 || ascii(bytes, 0) !== 'RIFF' || ascii(bytes, 8) !== 'WEBP') return false;
    const declaredLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8;
    return declaredLength <= bytes.byteLength;
};

const validPixels = (pixels, width, height) => Number.isInteger(width)
    && Number.isInteger(height)
    && width > 0
    && height > 0
    && pixels instanceof Uint8ClampedArray
    && pixels.byteLength === width * height * 4;

export class WebpEncoder {
    constructor({
        workerFactory = defaultWorkerFactory,
        timeoutMs = WEBP_ENCODE_TIMEOUT_MS,
        idleMs = WEBP_WORKER_IDLE_MS,
    } = {}) {
        this.workerFactory = workerFactory;
        this.timeoutMs = timeoutMs;
        this.idleMs = idleMs;
        this._worker = null;
        this._active = false;
        this._disposed = false;
        this._requestSequence = 0;
        this._idleTimer = null;
        this._cancelActive = null;
    }

    get isDisposed() {
        return this._disposed;
    }

    _getWorker() {
        if (!this._worker) this._worker = this.workerFactory();
        return this._worker;
    }

    _terminateWorker() {
        clearTimeout(this._idleTimer);
        this._idleTimer = null;
        this._worker?.terminate();
        this._worker = null;
    }

    _scheduleIdleTermination() {
        clearTimeout(this._idleTimer);
        this._idleTimer = setTimeout(() => this._terminateWorker(), this.idleMs);
    }

    async encode({ pixels, width, height, signal } = {}) {
        if (this._disposed || signal?.aborted) throw webpError('export-cancelled');
        if (this._active) throw webpError('webp-encoder-busy');
        if (!validPixels(pixels, width, height)) throw webpError('webp-input-invalid');

        clearTimeout(this._idleTimer);
        this._idleTimer = null;
        const worker = this._getWorker();
        const id = this._requestSequence + 1;
        this._requestSequence = id;
        this._active = true;
        const transferBuffer = pixels.byteOffset === 0 && pixels.byteLength === pixels.buffer.byteLength
            ? pixels.buffer
            : pixels.slice().buffer;

        try {
            const buffer = await new Promise((resolve, reject) => {
                const cleanup = () => {
                    clearTimeout(timeout);
                    signal?.removeEventListener('abort', onAbort);
                    worker.onmessage = null;
                    worker.onerror = null;
                    worker.onmessageerror = null;
                    this._cancelActive = null;
                };
                const fail = (error, { terminate = true } = {}) => {
                    cleanup();
                    if (terminate) this._terminateWorker();
                    reject(error);
                };
                const onAbort = () => fail(webpError('export-cancelled'));
                const timeout = setTimeout(
                    () => fail(webpError('webp-encode-timeout')),
                    this.timeoutMs
                );
                this._cancelActive = () => fail(webpError('export-cancelled'));
                worker.onmessage = ({ data }) => {
                    if (data?.id !== id) return;
                    if (!data.ok) {
                        fail(webpError('webp-encode-failed', data?.message));
                        return;
                    }
                    cleanup();
                    resolve(data.buffer);
                };
                worker.onerror = (event) => fail(webpError('webp-worker-failed', event?.error || event?.message));
                worker.onmessageerror = (event) => fail(webpError('webp-worker-failed', event));
                signal?.addEventListener('abort', onAbort, { once: true });
                if (signal?.aborted) {
                    onAbort();
                    return;
                }
                try {
                    worker.postMessage({
                        id,
                        pixels: transferBuffer,
                        width,
                        height,
                        wasmUrl: webpWasmUrl,
                    }, [transferBuffer]);
                } catch (error) {
                    fail(webpError('webp-worker-failed', error));
                }
            });
            if (this._disposed || signal?.aborted) {
                this._terminateWorker();
                throw webpError('export-cancelled');
            }
            if (!(buffer instanceof ArrayBuffer) || !isWebpBuffer(buffer)) {
                this._terminateWorker();
                throw webpError('webp-output-invalid');
            }
            return new Blob([buffer], { type: WEBP_MIME_TYPE });
        } finally {
            this._active = false;
            if (this._worker) this._scheduleIdleTermination();
        }
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        if (this._cancelActive) this._cancelActive();
        else this._terminateWorker();
    }
}
