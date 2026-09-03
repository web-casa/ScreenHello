import '@leafer-in/export';
import { observable } from 'mobx';
import { browserPlatform } from '../platform/browserPlatform';
import { EXPORT_FORMATS, EXPORT_RATIOS, normalizeWorkspaceName } from '@utils/stylePreset';

export const MAX_EXPORT_EDGE = 8_192;
export const MAX_EXPORT_PIXELS = 16_777_216;
export const MAX_AVIF_EXPORT_PIXELS = 4_194_304;

const FORMAT_MIME_TYPES = Object.freeze({
    png: ['image/png'],
    jpg: ['image/jpeg', 'image/jpg'],
    webp: ['image/webp'],
    avif: ['image/avif'],
});

const defaultAvifEncoderFactory = async () => {
    const { AvifEncoder } = await import('@utils/avifEncoder');
    return new AvifEncoder();
};

const defaultWebpEncoderFactory = async () => {
    const { WebpEncoder } = await import('@utils/webpEncoder');
    return new WebpEncoder();
};

const defaultNativeWebpSupport = async () => {
    const canvas = globalThis.document?.createElement?.('canvas');
    if (!canvas || typeof canvas.toBlob !== 'function') return false;
    canvas.width = canvas.height = 1;
    return new Promise((resolve) => {
        let settled = false;
        let timeout;
        const finish = (supported) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            canvas.width = canvas.height = 0;
            resolve(supported);
        };
        timeout = setTimeout(() => finish(false), 5_000);
        try {
            canvas.toBlob((blob) => {
                finish(blob?.type?.toLowerCase() === 'image/webp');
            }, 'image/webp', 0.9);
        } catch {
            finish(false);
        }
    });
};

const exportError = (code, cause) => {
    const error = Object.assign(new Error(code), { code });
    if (cause !== undefined) error.cause = cause;
    return error;
};

export const isExportCancelled = (error) => error?.code === 'export-cancelled';

const validDimension = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

const releaseWrapper = (wrapper) => {
    if (typeof wrapper?.destroy !== 'function') return null;
    const view = wrapper.view;
    let releaseError = null;
    try {
        wrapper.destroy();
    } catch (error) {
        releaseError = error;
    }
    try {
        if (view && typeof view === 'object' && 'width' in view && 'height' in view) {
            view.width = 0;
            view.height = 0;
        }
    } catch (error) {
        if (!releaseError) releaseError = error;
    }
    return releaseError;
};

const isBlob = (value) => {
    const BlobCtor = globalThis.Blob;
    return typeof BlobCtor === 'function' && value instanceof BlobCtor;
};

/**
 * @typedef {object} ExportRenderTarget
 * @property {(filename: string, options?: object) => Promise<object>} export
 */

/**
 * @typedef {object} ExportRequest
 * @property {ExportRenderTarget} [target] 内部隔离渲染目标；省略时使用当前 runtime tree。
 * @property {{ width: number, height: number }} [size] target 的源尺寸；传入 target 时必填。
 * @property {'png' | 'jpg' | 'webp' | 'avif'} [format]
 * @property {1 | 2 | 3} [ratio]
 * @property {AbortSignal} [signal]
 * @property {string} [baseName]
 */

/**
 * @typedef {object} ImageExportResult
 * @property {Blob} blob
 * @property {'png' | 'jpg' | 'webp' | 'avif'} format
 * @property {string} mimeType
 * @property {1 | 2 | 3} pixelRatio
 * @property {number} width
 * @property {number} height
 * @property {number} durationMs
 */

/**
 * @typedef {object} CanvasExportLease
 * @property {object} canvas 原生 Canvas view。
 * @property {number} width
 * @property {number} height
 * @property {1 | 2 | 3} pixelRatio
 * @property {() => void} release owner 完成读取后必须调用；runtime dispose 也会兜底释放。
 */

/**
 * 实例级导出服务。
 *
 * Leafer 2.2.9 在插件内部跨 tree 串行导出；这里仍保留实例队列，负责把
 * render、下载/剪贴板副作用、取消和 runtime dispose 纳入同一生命周期。
 */
export class ExportService {
    constructor(root, {
        platform = browserPlatform,
        now = () => globalThis.performance?.now?.() ?? Date.now(),
        avifEncoderFactory = defaultAvifEncoderFactory,
        webpEncoderFactory = defaultWebpEncoderFactory,
        nativeWebpSupport = defaultNativeWebpSupport,
    } = {}) {
        this.root = root;
        this.platform = platform;
        this.now = now;
        this.avifEncoderFactory = avifEncoderFactory;
        this.webpEncoderFactory = webpEncoderFactory;
        this.nativeWebpSupport = nativeWebpSupport;
        this._tail = Promise.resolve();
        this._pendingOperations = 0;
        this._busyState = observable.box(false, { deep: false });
        this._generation = 0;
        this._disposed = false;
        this._canvasLeases = new Set();
        this._avifEncoder = null;
        this._avifEncoderPromise = null;
        this._webpEncoder = null;
        this._webpEncoderPromise = null;
        this._nativeWebpSupportPromise = null;
    }

    get isDisposed() {
        return this._disposed;
    }

    get isBusy() {
        return this._busyState.get();
    }

    /** @param {ExportRequest} [request] */
    exportImage(request = {}) {
        return this._enqueue((context) => this._renderImage(request, context), request.signal);
    }

    /** @param {ExportRequest} [request] */
    downloadImage(request = {}) {
        return this._enqueue(async (context) => {
            const result = await this._renderImage(request, context);
            this._assertCurrent(context);
            const filename = this._filename(request.baseName, result.format, result.pixelRatio);
            try {
                await this.platform.export.download(result.blob, filename);
            } catch (error) {
                this._assertCurrent(context);
                throw exportError('export-download-failed', error);
            }
            this._assertCurrent(context);
            return { ...result, filename };
        }, request.signal);
    }

    /** @param {ExportRequest} [request] */
    copyImage(request = {}) {
        const nextRequest = { ...request, format: 'png' };
        return this._enqueue(async (context) => {
            const result = await this._renderImage(nextRequest, context);
            this._assertCurrent(context);
            try {
                await this.platform.clipboard.writeImage(result.blob);
            } catch (error) {
                this._assertCurrent(context);
                throw exportError('export-clipboard-failed', error);
            }
            this._assertCurrent(context);
            return result;
        }, request.signal);
    }

    /** @param {ExportRequest} [request] */
    exportCanvas(request = {}) {
        return this._enqueue((context) => this._renderCanvas(request, context), request.signal);
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        this._generation += 1;
        try {
            this._avifEncoder?.dispose?.();
        } catch {
            // dispose 是最终清理边界，不能因 codec 清理失败跳过 canvas lease。
        }
        this._avifEncoder = null;
        try {
            this._webpEncoder?.dispose?.();
        } catch {
            // 与 AVIF 相同，最终清理必须继续释放 canvas lease。
        }
        this._webpEncoder = null;
        for (const release of [...this._canvasLeases]) {
            try {
                release();
            } catch {
                // dispose 必须继续清理其他 owner；显式调用 release 时仍会向调用者报告错误。
            }
        }
        this._canvasLeases.clear();
    }

    _enqueue(task, signal) {
        const context = { generation: this._generation, signal };
        this._pendingOperations += 1;
        this._busyState.set(true);
        const operation = this._tail
            .catch(() => undefined)
            .then(async () => {
                this._assertCurrent(context);
                return task(context);
            });
        const trackedOperation = operation.finally(() => {
            this._pendingOperations = Math.max(0, this._pendingOperations - 1);
            this._busyState.set(this._pendingOperations > 0);
        });
        this._tail = trackedOperation.then(() => undefined, () => undefined);
        return trackedOperation;
    }

    _assertCurrent({ generation, signal }) {
        if (this._disposed || generation !== this._generation || signal?.aborted) {
            throw exportError('export-cancelled');
        }
    }

    _validateRequest(request) {
        const format = request.format ?? 'png';
        const ratio = Number(request.ratio ?? 1);
        if (!EXPORT_FORMATS.includes(format)) throw exportError('export-format-unsupported');
        if (!EXPORT_RATIOS.includes(ratio)) throw exportError('export-ratio-unsupported');

        const sourceSize = request.target ? request.size : (request.size ?? this.root.option?.frameConf);
        if (!sourceSize) throw exportError('export-size-too-large');
        const width = Number(sourceSize.width) * ratio;
        const height = Number(sourceSize.height) * ratio;
        this._assertSize(width, height);
        if (format === 'avif' && width * height > MAX_AVIF_EXPORT_PIXELS) {
            throw exportError('export-avif-size-too-large');
        }
        return { format, ratio, width, height };
    }

    _assertSize(width, height) {
        if (!validDimension(width)
            || !validDimension(height)
            || width > MAX_EXPORT_EDGE
            || height > MAX_EXPORT_EDGE
            || width * height > MAX_EXPORT_PIXELS) {
            throw exportError('export-size-too-large');
        }
    }

    _tree(target) {
        const tree = target ?? this.root.editor?.app?.tree;
        if (!tree || typeof tree.export !== 'function') throw exportError('export-unavailable');
        return tree;
    }

    _imageOptions(format, ratio, captureCanvas) {
        const options = {
            blob: true,
            pixelRatio: ratio,
            onCanvas: captureCanvas,
        };
        if (format === 'jpg' || format === 'webp') {
            options.quality = 0.9;
            options.fill = '#ffffff';
        }
        return options;
    }

    async _renderImage(request, context) {
        const { format, ratio, width, height } = this._validateRequest(request);
        if (format === 'avif') {
            return this._renderAvif(request, context, { format, ratio, width, height });
        }
        if (format === 'webp' && !(await this._supportsNativeWebp(context))) {
            return this._renderWebp(request, context, { format, ratio, width, height });
        }
        this._assertCurrent(context);
        const canvases = new Set();
        const startedAt = this.now();
        let operationError = null;
        let output = null;
        try {
            let result;
            try {
                result = await this._tree(request.target).export(
                    format,
                    this._imageOptions(format, ratio, (canvas) => canvases.add(canvas))
                );
            } catch (error) {
                throw exportError('export-render-failed', error);
            }
            this._assertCurrent(context);
            if (result?.error) throw exportError('export-render-failed', result.error);
            if (!isBlob(result?.data) || result.data.size <= 0) throw exportError('export-result-invalid');
            const mimeType = String(result.data.type || '').toLowerCase();
            if (!FORMAT_MIME_TYPES[format].includes(mimeType)) throw exportError('export-result-invalid');
            this._assertSize(result.width, result.height);
            if (Number(result.width) !== width || Number(result.height) !== height) {
                throw exportError('export-result-invalid');
            }
            output = {
                blob: result.data,
                format,
                mimeType,
                pixelRatio: ratio,
                width: Number(result.width),
                height: Number(result.height),
                durationMs: Math.max(0, this.now() - startedAt),
            };
        } catch (error) {
            operationError = error;
        }
        let cleanupError = null;
        for (const canvas of canvases) {
            const error = releaseWrapper(canvas);
            if (!cleanupError && error) cleanupError = error;
        }
        if (operationError) {
            if (cleanupError) {
                operationError.releaseCause = exportError('export-canvas-release-failed', cleanupError);
            }
            throw operationError;
        }
        if (cleanupError) throw exportError('export-canvas-release-failed', cleanupError);
        return output;
    }

    async _getAvifEncoder(context) {
        if (!this._avifEncoderPromise) {
            const pending = Promise.resolve()
                .then(() => this.avifEncoderFactory())
                .then((encoder) => {
                    if (!encoder || typeof encoder.encode !== 'function' || typeof encoder.dispose !== 'function') {
                        throw exportError('export-avif-unavailable');
                    }
                    if (this._disposed) {
                        try {
                            encoder.dispose();
                        } catch {
                            // 已卸载 runtime 的取消语义优先于 codec dispose 诊断。
                        }
                        throw exportError('export-cancelled');
                    }
                    this._avifEncoder = encoder;
                    return encoder;
                });
            this._avifEncoderPromise = pending;
            pending.catch(() => {
                if (this._avifEncoderPromise === pending) this._avifEncoderPromise = null;
            });
        }
        const encoder = await this._avifEncoderPromise;
        this._assertCurrent(context);
        return encoder;
    }

    async _supportsNativeWebp(context) {
        if (!this._nativeWebpSupportPromise) {
            this._nativeWebpSupportPromise = Promise.resolve()
                .then(() => this.nativeWebpSupport())
                .then(Boolean, () => false);
        }
        const supported = await this._nativeWebpSupportPromise;
        this._assertCurrent(context);
        return supported;
    }

    async _getWebpEncoder(context) {
        if (!this._webpEncoderPromise) {
            const pending = Promise.resolve()
                .then(() => this.webpEncoderFactory())
                .then((encoder) => {
                    if (!encoder || typeof encoder.encode !== 'function' || typeof encoder.dispose !== 'function') {
                        throw exportError('export-webp-unavailable');
                    }
                    if (this._disposed) {
                        try {
                            encoder.dispose();
                        } catch {
                            // 已卸载 runtime 的取消语义优先于 codec dispose 诊断。
                        }
                        throw exportError('export-cancelled');
                    }
                    this._webpEncoder = encoder;
                    return encoder;
                });
            this._webpEncoderPromise = pending;
            pending.catch(() => {
                if (this._webpEncoderPromise === pending) this._webpEncoderPromise = null;
            });
        }
        const encoder = await this._webpEncoderPromise;
        this._assertCurrent(context);
        return encoder;
    }

    async _renderWebp(request, context, { format, ratio, width, height }) {
        this._assertCurrent(context);
        const startedAt = this.now();
        const lease = await this._renderCanvas(request, context, { fill: '#ffffff' });
        let operationError = null;
        let output = null;
        try {
            this._assertCurrent(context);
            const canvasContext = lease.canvas.getContext('2d', { willReadFrequently: true });
            if (!canvasContext || typeof canvasContext.getImageData !== 'function') {
                throw exportError('export-webp-pixels-unavailable');
            }
            const imageData = canvasContext.getImageData(0, 0, width, height);
            const encoder = await this._getWebpEncoder(context);
            const blob = await encoder.encode({
                pixels: imageData?.data,
                width,
                height,
                signal: context.signal,
            });
            this._assertCurrent(context);
            if (!isBlob(blob) || blob.size <= 0 || blob.type.toLowerCase() !== 'image/webp') {
                throw exportError('export-webp-result-invalid');
            }
            output = {
                blob,
                format,
                mimeType: 'image/webp',
                pixelRatio: ratio,
                width,
                height,
                durationMs: Math.max(0, this.now() - startedAt),
            };
        } catch (error) {
            operationError = isExportCancelled(error)
                ? error
                : exportError('export-webp-failed', error);
        }
        let cleanupError = null;
        try {
            lease.release();
        } catch (error) {
            cleanupError = error;
        }
        if (operationError) {
            if (cleanupError) operationError.releaseCause = cleanupError;
            throw operationError;
        }
        if (cleanupError) throw cleanupError;
        return output;
    }

    async _renderAvif(request, context, { format, ratio, width, height }) {
        this._assertCurrent(context);
        const startedAt = this.now();
        const lease = await this._renderCanvas(request, context);
        let operationError = null;
        let output = null;
        try {
            this._assertCurrent(context);
            const canvasContext = lease.canvas.getContext('2d', { willReadFrequently: true });
            if (!canvasContext || typeof canvasContext.getImageData !== 'function') {
                throw exportError('export-avif-pixels-unavailable');
            }
            const imageData = canvasContext.getImageData(0, 0, width, height);
            const encoder = await this._getAvifEncoder(context);
            const blob = await encoder.encode({
                pixels: imageData?.data,
                width,
                height,
                signal: context.signal,
            });
            this._assertCurrent(context);
            if (!isBlob(blob) || blob.size <= 0 || blob.type.toLowerCase() !== 'image/avif') {
                throw exportError('export-avif-result-invalid');
            }
            output = {
                blob,
                format,
                mimeType: 'image/avif',
                pixelRatio: ratio,
                width,
                height,
                durationMs: Math.max(0, this.now() - startedAt),
            };
        } catch (error) {
            operationError = isExportCancelled(error)
                ? error
                : exportError('export-avif-failed', error);
        }
        let cleanupError = null;
        try {
            lease.release();
        } catch (error) {
            cleanupError = error;
        }
        if (operationError) {
            if (cleanupError) operationError.releaseCause = cleanupError;
            throw operationError;
        }
        if (cleanupError) throw cleanupError;
        return output;
    }

    async _renderCanvas(request, context, renderOptions = {}) {
        const { ratio, width, height } = this._validateRequest({ ...request, format: 'png' });
        this._assertCurrent(context);
        let result;
        try {
            result = await this._tree(request.target).export('canvas', { pixelRatio: ratio, ...renderOptions });
        } catch (error) {
            throw exportError('export-render-failed', error);
        }
        const wrapper = result?.data;
        const releaseFailure = () => {
            const error = releaseWrapper(wrapper);
            if (error) throw exportError('export-canvas-release-failed', error);
        };
        try {
            this._assertCurrent(context);
            if (result?.error) throw exportError('export-render-failed', result.error);
            const canvas = wrapper?.view;
            if (!canvas || typeof canvas.getContext !== 'function') throw exportError('export-canvas-invalid');
            this._assertSize(result.width, result.height);
            if (Number(result.width) !== width || Number(result.height) !== height) {
                throw exportError('export-canvas-invalid');
            }

            let released = false;
            const release = () => {
                if (released) return;
                released = true;
                this._canvasLeases.delete(release);
                releaseFailure();
            };
            this._canvasLeases.add(release);
            return {
                canvas,
                width: Number(result.width),
                height: Number(result.height),
                pixelRatio: ratio,
                release,
            };
        } catch (error) {
            try {
                releaseFailure();
            } catch (releaseError) {
                if (!isExportCancelled(error)) error.releaseCause = releaseError;
            }
            throw error;
        }
    }

    _filename(baseName, format, ratio) {
        const name = normalizeWorkspaceName(baseName, 'ScreenHello');
        return `${name}${ratio > 1 ? `@${ratio}` : ''}.${format}`;
    }
}
