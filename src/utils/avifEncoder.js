import avifWasmUrl from '@jsquash/avif/codec/enc/avif_enc.wasm?url&no-inline';

export const AVIF_MIME_TYPE = 'image/avif';
export const AVIF_ENCODE_TIMEOUT_MS = 120_000;
export const AVIF_WORKER_IDLE_MS = 1_000;

const avifError = (code, cause) => {
    const error = Object.assign(new Error(code), { code });
    if (cause !== undefined) error.cause = cause;
    return error;
};

const defaultWorkerFactory = () => new Worker(
    new URL('../workers/avifEncoder.worker.js', import.meta.url),
    { type: 'module', name: 'screenhello-avif-encoder' }
);

const ascii = (bytes, offset) => String.fromCharCode(...bytes.subarray(offset, offset + 4));

export const isAvifBuffer = (value) => {
    const bytes = value instanceof Uint8Array
        ? value
        : (value instanceof ArrayBuffer ? new Uint8Array(value) : null);
    if (!bytes || bytes.byteLength < 16 || ascii(bytes, 4) !== 'ftyp') return false;
    const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (boxSize !== 0 && (boxSize < 16 || boxSize > bytes.byteLength)) return false;
    const limit = boxSize === 0 ? bytes.byteLength : boxSize;
    if (ascii(bytes, 8) === 'avif' || ascii(bytes, 8) === 'avis') return true;
    // ISO BMFF bytes 12-15 are minor_version, not a compatible brand.
    for (let offset = 16; offset + 4 <= limit; offset += 4) {
        const brand = ascii(bytes, offset);
        if (brand === 'avif' || brand === 'avis') return true;
    }
    return false;
};

const validPixels = (pixels, width, height) => Number.isInteger(width)
    && Number.isInteger(height)
    && width > 0
    && height > 0
    && pixels instanceof Uint8ClampedArray
    && pixels.byteLength === width * height * 4;

export class AvifEncoder {
    constructor({
        workerFactory = defaultWorkerFactory,
        timeoutMs = AVIF_ENCODE_TIMEOUT_MS,
        idleMs = AVIF_WORKER_IDLE_MS,
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
        if (this._disposed || signal?.aborted) throw avifError('export-cancelled');
        if (this._active) throw avifError('avif-encoder-busy');
        if (!validPixels(pixels, width, height)) throw avifError('avif-input-invalid');

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
                const onAbort = () => fail(avifError('export-cancelled'));
                const timeout = setTimeout(
                    () => fail(avifError('avif-encode-timeout')),
                    this.timeoutMs
                );
                this._cancelActive = () => fail(avifError('export-cancelled'));
                worker.onmessage = ({ data }) => {
                    if (data?.id !== id) return;
                    if (!data.ok) {
                        fail(avifError('avif-encode-failed', data?.message));
                        return;
                    }
                    cleanup();
                    resolve(data.buffer);
                };
                worker.onerror = (event) => fail(avifError('avif-worker-failed', event?.error || event?.message));
                worker.onmessageerror = (event) => fail(avifError('avif-worker-failed', event));
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
                        wasmUrl: avifWasmUrl,
                    }, [transferBuffer]);
                } catch (error) {
                    fail(avifError('avif-worker-failed', error));
                }
            });
            if (this._disposed || signal?.aborted) {
                this._terminateWorker();
                throw avifError('export-cancelled');
            }
            if (!(buffer instanceof ArrayBuffer) || !isAvifBuffer(buffer)) {
                this._terminateWorker();
                throw avifError('avif-output-invalid');
            }
            return new Blob([buffer], { type: AVIF_MIME_TYPE });
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
