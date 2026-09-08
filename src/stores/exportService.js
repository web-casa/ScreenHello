import '@leafer-in/export';
import { observable, runInAction } from 'mobx';
import { browserPlatform } from '../platform/browserPlatform';
import { normalizeWorkspaceName } from '@utils/stylePreset';
import { validateExportSettings, exportSettingsKey, MAX_PREVIEW_PIXELS, compressionTimeoutMs, compressedDownloadPixelLimit } from '@utils/exportSettings';
import { waitWithSignal } from '@utils/exportAsync';

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

const defaultPngEncoderFactory = async () => {
    const { PngEncoder } = await import('@utils/pngEncoder');
    return new PngEncoder();
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
        pngEncoderFactory = defaultPngEncoderFactory,
        nativeWebpSupport = defaultNativeWebpSupport,
        webExportSafety = false,
    } = {}) {
        this.root = root;
        this.platform = platform;
        this.now = now;
        this.avifEncoderFactory = avifEncoderFactory;
        this.webpEncoderFactory = webpEncoderFactory;
        this.pngEncoderFactory = pngEncoderFactory;
        this.nativeWebpSupport = nativeWebpSupport;
        // Fixed per service, never read from requests, projects or presets.
        Object.defineProperty(this, '_webExportSafety', { value: webExportSafety === true });
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
        this._pngEncoder = null;
        this._contexts = new Set();
        this._stage = observable.box('idle');
        this._prepared = null;
        this._stopPrepared = root.renderTaskTracker?.subscribe(() => {
            if (this._prepared && !root.renderTaskTracker.matches(this._prepared.stamp)) this.discardPrepared('stale');
        });
    }

    get isDisposed() {
        return this._disposed;
    }

    compressedPixelLimit(format) {
        return compressedDownloadPixelLimit(format, this._webExportSafety);
    }

    get isBusy() {
        return this._busyState.get();
    }

    get stage() { return this._stage.get(); }
    get isHandingOff() { return this.stage === 'handing-off'; }
    _setStage(value) { runInAction(() => this._stage.set(value)); }

    isPreparedCurrent(token) {
        return Boolean(token && this._prepared?.token === token && !this._disposed
            && (!this._prepared.stamp || this.root.renderTaskTracker.matches(this._prepared.stamp)));
    }

    discardPrepared(stage = 'idle', token) {
        if (token && this._prepared?.token !== token) return;
        this._prepared = null;
        if (!this.isHandingOff) this._setStage(stage);
    }

    deactivate() {
        this.discardPrepared('stale');
        for (const context of this._contexts) {
            if (context.requireActive && !context.handingOff) context.controller.abort(exportError('export-stale'));
        }
    }

    // Internal capability, not a public Blob-injection API. The UI owns display URLs.
    async prepareImage(request = {}) {
        if (this.isBusy) throw exportError('export-busy');
        const settings = validateExportSettings(request);
        request = { ...request, ...settings, ...(request.size ? { size: { ...request.size } } : {}) };
        this.discardPrepared('preparing');
        return this._enqueue(async context => {
            const rendered = await this._renderImage({ ...request, ...settings, preview: true }, context);
            if (request.verifyPreview) {
                const { validateExportPreview } = await import('../utils/exportPreview');
                this._assertCurrent(context);
                await validateExportPreview(rendered, context.controller.signal);
            }
            const result = Object.freeze({ ...rendered, settings: Object.freeze({ ...settings }),
                summary: Object.freeze({ ...rendered.summary, warnings: Object.freeze([...rendered.summary.warnings]) }) });
            this._assertCurrent(context);
            const token = Object.freeze({});
            this._prepared = { token, result, settings: result.settings, stamp: context.stamp, baseName: request.baseName };
            this._setStage('ready');
            return Object.freeze({ token, result, settings: result.settings });
        }, request.signal, request);
    }

    async downloadPreparedImage(token, request = {}) {
        if (this.isBusy) throw exportError('export-busy');
        const prepared = this._prepared;
        if (!prepared || prepared.token !== token
            || (request.settings !== undefined && exportSettingsKey(request.settings) !== exportSettingsKey(prepared.settings))) {
            throw exportError('export-stale');
        }
        if (prepared.stamp && !this.root.renderTaskTracker.matches(prepared.stamp)) throw exportError('export-stale');
        // Validate actual prepared dimensions, not the current scene or an
        // untrusted request.size. Output dimensions already include ratio.
        this._validateRequest({ ...prepared.settings, ratio: 1,
            size: { width: prepared.result.width, height: prepared.result.height } });
        return this._enqueue(async context => {
            context.stamp = prepared.stamp;
            context.frozen = true;
            return this._handoff(prepared.result, { ...request, baseName: prepared.baseName }, context);
        }, request.signal, request);
    }

    /** @param {ExportRequest} [request] */
    async exportImage(request = {}) {
        const settings = validateExportSettings(request);
        request = { ...request, ...settings, ...(request.size ? { size: { ...request.size } } : {}) };
        return this._enqueue((context) => this._renderImage({ ...request, ...settings }, context), request.signal, request);
    }

    /** @param {ExportRequest} [request] */
    async downloadImage(request = {}) {
        const settings = validateExportSettings(request);
        request = { ...request, ...settings, ...(request.size ? { size: { ...request.size } } : {}) };
        return this._enqueue(async (context) => {
            const result = await this._renderImage({ ...request, ...settings }, context);
            return this._handoff(result, request, context);
        }, request.signal, request);
    }

    async _handoff(result, request, context) {
        this._assertCurrent(context);
        await this.root.deviceLicense?.request(this.root.option?.frame, { signal: context.controller.signal });
        this._assertCurrent(context);
        const filename = this._filename(request.baseName, result.format, result.pixelRatio);
        context.handingOff = true;
        this._setStage('handing-off');
        const prepared = this._prepared?.result === result ? this._prepared : null;
        try {
            // After this call the platform owns the write. Keep busy until it settles.
            await this.platform.export.download(result.blob, filename);
        } catch (error) {
            if (prepared && this._prepared === prepared && !this._disposed
                && (!prepared.stamp || this.root.renderTaskTracker.matches(prepared.stamp))
                && (!context.requireActive || this.root.isActive !== false)) {
                context.keepPrepared = true;
                this._setStage('ready');
            }
            if (isExportCancelled(error)) throw error;
            throw exportError('export-download-failed', error);
        }
        this._prepared = null;
        return { ...result, filename, current: !this._disposed && !this.root.isDisposed
            && (!context.requireActive || this.root.isActive !== false)
            && (!context.stamp || this.root.renderTaskTracker.matches(context.stamp, { paint: false })) };
    }

    /** @param {ExportRequest} [request] */
    copyImage(request = {}) {
        const nextRequest = { ...request, format: 'png', compression: undefined, quality: undefined, paletteColors: undefined, preview: false };
        return this._enqueue(async (context) => {
            const result = await this._renderImage(nextRequest, context);
            this._assertCurrent(context);
            await this.root.deviceLicense?.request(this.root.option?.frame, { signal: context.controller.signal });
            this._assertCurrent(context);
            try {
                await this.platform.clipboard.writeImage(result.blob);
            } catch (error) {
                this._assertCurrent(context);
                throw exportError('export-clipboard-failed', error);
            }
            this._assertCurrent(context);
            return result;
        }, request.signal, request);
    }

    /** @param {ExportRequest} [request] */
    exportCanvas(request = {}) {
        return this._enqueue(async context => {
            await this._prepareScene(request, context);
            return this._renderCanvas(request, context);
        }, request.signal, request);
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        this._generation += 1;
        this._stopPrepared?.();
        this._prepared = null;
        for (const context of this._contexts) if (!context.handingOff) context.controller.abort(exportError('export-cancelled'));
        try { this._pngEncoder?.dispose(); } catch { /* Continue owner cleanup. */ }
        this._pngEncoder = null;
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

    _enqueue(task, signal, request = {}) {
        const controller = new AbortController();
        const abort = () => { if (!context.handingOff) controller.abort(exportError('export-cancelled')); };
        const context = { generation: this._generation, signal: controller.signal, controller, requireActive: request.requireActive };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        this._contexts.add(context);
        this._pendingOperations += 1;
        runInAction(() => this._busyState.set(true));
        const operation = this._tail
            .catch(() => undefined)
            .then(async () => {
                this._assertCurrent(context);
                const tracker = request.target ? null : this.root.renderTaskTracker;
                tracker?.flushEdits();
                context.stamp = tracker?.stamp();
                context.unsubscribe = tracker?.subscribe(() => {
                    if (!context.handingOff && !this.root.renderTaskTracker.matches(context.stamp, { paint: !!context.frozen })) {
                        controller.abort(exportError('export-stale'));
                    }
                });
                this._setStage('preparing');
                return task(context);
            });
        const trackedOperation = operation.catch(error => {
            if (!context.handingOff && typeof context.signal.reason?.code === 'string') error = context.signal.reason;
            if (!context.keepPrepared) {
                this._prepared = null;
                this._setStage(error?.code === 'export-stale' ? 'stale' : 'failed');
            }
            throw error;
        }).finally(() => {
            context.unsubscribe?.();
            signal?.removeEventListener('abort', abort);
            this._contexts.delete(context);
            this._pendingOperations = Math.max(0, this._pendingOperations - 1);
            runInAction(() => this._busyState.set(this._pendingOperations > 0));
            if (!['ready', 'stale', 'failed'].includes(this.stage)) this._setStage('idle');
        });
        this._tail = trackedOperation.then(() => undefined, () => undefined);
        return trackedOperation;
    }

    _assertCurrent({ generation, signal, requireActive, stamp, frozen }) {
        if (this._disposed || generation !== this._generation || signal?.aborted) {
            throw typeof signal?.reason?.code === 'string' ? signal.reason : exportError('export-cancelled');
        }
        if (requireActive && this.root.isActive === false) throw exportError('export-stale');
        if (stamp && !this.root.renderTaskTracker.matches(stamp, { paint: !!frozen })) throw exportError('export-stale');
    }

    async _prepareScene(request, context) {
        this._validateRequest(request);
        const tree = this._tree(request.target);
        const tracker = request.target ? null : this.root.renderTaskTracker;
        if (tracker?.waitForExport) context.stamp = await tracker.waitForExport(tree, context.stamp, context.signal);
        this._assertCurrent(context);
    }

    async _capture(request, context, format, options) {
        const capture = async () => {
            context.frozen = true;
            this._assertCurrent(context);
            const result = await this._tree(request.target).export(format, options);
            // Always return late canvases to their owner for cleanup. The caller
            // checks freshness before reading or handing the result off.
            return result;
        };
        const tracker = request.target ? null : this.root.renderTaskTracker;
        return tracker?.withCapture(capture) ?? capture();
    }

    _validateRequest(request) {
        const settings = validateExportSettings(request);
        const { format, ratio } = settings;

        const sourceSize = request.target ? request.size : (request.size ?? this.root.option?.frameConf);
        if (!sourceSize) throw exportError('export-size-too-large');
        const width = Math.ceil(Number(sourceSize.width) * ratio);
        const height = Math.ceil(Number(sourceSize.height) * ratio);
        this._assertSize(width, height);
        if (request.preview && width * height > MAX_PREVIEW_PIXELS) {
            throw exportError('export-preview-size-too-large');
        }
        if (settings.compression && width * height > this.compressedPixelLimit(format)) {
            if (this._webExportSafety && format === 'avif') throw exportError('export-web-avif-compression-size-too-large');
            throw exportError('export-compression-size-too-large');
        }
        if (format === 'avif' && width * height > MAX_AVIF_EXPORT_PIXELS) {
            throw exportError('export-avif-size-too-large');
        }
        return { ...settings, width, height };
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
        await this._prepareScene(request, context);
        const settings = validateExportSettings(request);
        if (settings.compression || request.preview) return this._renderCompressed(request, context);
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
                result = await this._capture(request, context,
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

    async _getPngEncoder(context) {
        if (!this._pngEncoder) {
            const encoder = await this.pngEncoderFactory();
            if (!encoder?.encode || !encoder?.dispose) throw exportError('export-png-unavailable');
            if (this._disposed) { encoder.dispose(); throw exportError('export-cancelled'); }
            this._pngEncoder = encoder;
        }
        this._assertCurrent(context);
        return this._pngEncoder;
    }

    async _canvasBlob(canvas, format, quality, context) {
        const mime = FORMAT_MIME_TYPES[format][0];
        const blob = await waitWithSignal(new Promise((resolve, reject) => {
            try { canvas.toBlob(resolve, mime, quality); }
            catch (error) { reject(exportError('export-encode-failed', error)); }
        }), context.signal);
        this._assertCurrent(context);
        if (!isBlob(blob) || blob.size <= 0 || !FORMAT_MIME_TYPES[format].includes(blob.type.toLowerCase())) {
            throw exportError('export-result-invalid');
        }
        return blob;
    }

    async _encodeCanvas(canvas, dimensions, settings, context, releaseCanvas) {
        const { format, compression, quality, paletteColors } = settings;
        if (format === 'jpg' || (format === 'png' && !compression)) {
            return this._canvasBlob(canvas, format, format === 'jpg' ? (quality ?? 90) / 100 : undefined, context);
        }
        if (format === 'webp' && !compression && await this._supportsNativeWebp(context)) {
            return this._canvasBlob(canvas, 'webp', 0.9, context);
        }
        const encoder = format === 'png' ? await this._getPngEncoder(context)
            : format === 'webp' ? await this._getWebpEncoder(context) : await this._getAvifEncoder(context);
        const pixels = canvas.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, dimensions.width, dimensions.height)?.data;
        // getImageData owns its buffer; a direct download no longer needs the
        // source Canvas while the Worker processes that transferred copy.
        releaseCanvas?.();
        const blob = await encoder.encode({ pixels, ...dimensions, compression, quality, paletteColors, signal: context.signal });
        this._assertCurrent(context);
        if (!isBlob(blob) || blob.size <= 0 || !FORMAT_MIME_TYPES[format].includes(blob.type.toLowerCase())) {
            throw exportError('export-result-invalid');
        }
        return blob;
    }

    async _renderCompressed(request, context) {
        const settings = validateExportSettings(request);
        const { format, ratio, width, height } = this._validateRequest(request);
        const startedAt = this.now();
        const lease = await this._renderCanvas(request, context,
            ['jpg', 'webp'].includes(format) ? { fill: '#ffffff' } : {});
        const timer = setTimeout(() => context.controller.abort(exportError('export-compression-timeout')), compressionTimeoutMs(width, height));
        let operationError;
        let output;
        try {
            // Both comparison and output originate from this ONE complete scene.
            const needsReference = request.preview || (format === 'png' && settings.compression === 'lossless');
            const referenceBlob = needsReference
                ? await this._encodeCanvas(lease.canvas, { width, height }, { format, ratio }, context) : null;
            let blob = referenceBlob;
            let noGain = false;
            if (settings.compression === 'lossless' && format === 'png') {
                if (!request.preview) lease.release();
                const encoder = await this._getPngEncoder(context);
                blob = await encoder.encode({ png: await referenceBlob.arrayBuffer(), width, height, compression: 'lossless', signal: context.signal });
                if (!isBlob(blob) || blob.size <= 0 || blob.type !== 'image/png') throw exportError('export-result-invalid');
                noGain = blob.size >= referenceBlob.size;
                if (noGain) blob = referenceBlob;
            } else if (settings.compression) {
                blob = await this._encodeCanvas(lease.canvas, { width, height }, settings, context, request.preview ? undefined : lease.release);
            }
            this._assertCurrent(context);
            output = {
                blob, referenceBlob, format, mimeType: blob.type, pixelRatio: ratio, width, height,
                durationMs: Math.max(0, this.now() - startedAt),
                settings,
                summary: {
                    referenceBytes: referenceBlob?.size ?? null, outputBytes: blob.size,
                    savedBytes: referenceBlob ? referenceBlob.size - blob.size : null,
                    savingsPercent: referenceBlob ? (1 - blob.size / referenceBlob.size) * 100 : null,
                    noGain, warnings: request.target ? [] : this.root.renderTaskTracker?.warnings ?? [],
                },
            };
        } catch (error) {
            operationError = error;
        }
        clearTimeout(timer);
        try { lease.release(); }
        catch (error) { if (operationError) operationError.releaseCause = error; else operationError = error; }
        if (operationError) throw operationError;
        return output;
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
        const { ratio, width, height } = this._validateRequest({ ...request, format: 'png', compression: undefined, quality: undefined, paletteColors: undefined });
        this._assertCurrent(context);
        let result;
        try {
            // Readback hints must be present when Leafer creates the context;
            // supplying them to a later getContext() cannot reconfigure it.
            result = await this._capture(request, context, 'canvas', {
                pixelRatio: ratio, ...renderOptions,
                contextSettings: {
                    ...this._tree(request.target).leafer?.config?.contextSettings,
                    ...renderOptions.contextSettings,
                    willReadFrequently: true,
                },
            });
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
