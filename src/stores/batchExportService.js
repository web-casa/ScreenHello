import {
    BatchArchiveBuilder,
} from '@utils/batchExport';
import {
    MAX_BATCH_ARCHIVE_BYTES,
    MAX_BATCH_FILES,
    MAX_BATCH_OUTPUT_BYTES,
    batchError,
    createBatchEntryNamer,
} from '@utils/batchContract';
import { normalizeExportSettings, validateStylePreset } from '@utils/stylePreset';
import { isExportCancelled } from '@stores/exportService';

const defaultRendererFactory = async (options) => {
    const { createBatchRenderSession } = await import('@components/batch/BatchRenderSession');
    return createBatchRenderSession(options);
};

const isBlob = (value) => typeof Blob === 'function' && value instanceof Blob;

const isTrustedBackgroundUrl = (url) => {
    if (typeof url !== 'string' || !url) return false;
    if (/^(blob:|data:)/i.test(url)) return true;
    const baseHref = globalThis.location?.href;
    if (!baseHref) return !/^[a-z][a-z\d+.-]*:|^\/\//i.test(url);
    try {
        const base = new URL(baseHref);
        const resolved = new URL(url, base);
        return ['http:', 'https:'].includes(resolved.protocol) && resolved.origin === base.origin;
    } catch {
        return false;
    }
};

const fetchBackground = async (url, signal) => {
    if (!isTrustedBackgroundUrl(url) || typeof fetch !== 'function') return null;
    let response;
    try {
        response = await fetch(url, { signal });
    } catch (error) {
        if (signal?.aborted) throw batchError('batch-cancelled');
        throw batchError('batch-background-unavailable', error);
    }
    const blob = response.ok ? await response.blob() : null;
    if (!isBlob(blob) || blob.size <= 0 || (blob.type && !blob.type.startsWith('image/'))) {
        throw batchError('batch-background-unavailable');
    }
    return blob;
};

export async function resolveBatchStyle(root, source, signal) {
    if (source?.kind === 'snapshot') {
        const backgroundBlob = source.backgroundBlob || await fetchBackground(source.backgroundUrl, signal);
        if (source.option?.frameConf?.background?.type === 'image' && !backgroundBlob) {
            throw batchError('batch-background-unavailable');
        }
        return {
            option: structuredClone(source.option),
            exportSettings: normalizeExportSettings(source.exportSettings),
            backgroundBlob,
            backgroundName: source.backgroundName || 'background',
            backgroundType: source.backgroundType || backgroundBlob?.type || null,
        };
    }
    if (source?.kind === 'preset' && source.id) {
        const record = await root.draftStore.loadPreset(source.id);
        if (signal?.aborted) throw batchError('batch-cancelled');
        const validation = validateStylePreset(record?.preset);
        if (!record?.preset || !validation.ok) throw batchError('batch-preset-invalid');
        if (validation.preset.option.frameConf?.background?.type === 'image' && !record.backgroundBlob) {
            throw batchError('batch-background-unavailable');
        }
        return {
            option: validation.preset.option,
            exportSettings: validation.preset.exportSettings,
            backgroundBlob: record.backgroundBlob || null,
            backgroundName: record.backgroundName || 'background',
            backgroundType: record.backgroundType || record.backgroundBlob?.type || null,
        };
    }
    throw batchError('batch-style-invalid');
}

const archiveName = (now) => {
    const stamp = new Date(now()).toISOString().replace(/[-:]/g, '').slice(0, 13);
    return `ScreenHello-batch-${stamp}.zip`;
};

const isCancellation = (error, signal) => signal?.aborted
    || isExportCancelled(error)
    || error?.code === 'batch-cancelled';

export class BatchExportService {
    constructor(root, {
        styleResolver = resolveBatchStyle,
        rendererFactory = defaultRendererFactory,
        archiveFactory = (options) => new BatchArchiveBuilder(options),
        now = () => Date.now(),
    } = {}) {
        this.root = root;
        this.styleResolver = styleResolver;
        this.rendererFactory = rendererFactory;
        this.archiveFactory = archiveFactory;
        this.now = now;
        this._currentController = null;
        this._disposed = false;
        this._running = false;
    }

    get isRunning() {
        return this._running;
    }

    cancelCurrent() {
        this._currentController?.abort();
    }

    dispose() {
        this._disposed = true;
        this.cancelCurrent();
    }

    _assertAvailable(signal) {
        if (this._disposed || this.root.isDisposed || signal?.aborted) throw batchError('batch-cancelled');
    }

    async run({
        jobs,
        styleSource,
        signal,
        onUpdate = () => {},
        maxOutputBytes = MAX_BATCH_OUTPUT_BYTES,
        maxArchiveBytes = MAX_BATCH_ARCHIVE_BYTES,
    } = {}) {
        if (this._running) throw batchError('batch-busy');
        if (!Array.isArray(jobs) || jobs.length < 1 || jobs.length > MAX_BATCH_FILES) {
            throw batchError('batch-file-count-invalid');
        }
        this._assertAvailable(signal);
        this._running = true;
        const states = new Map(jobs.map(({ id }) => [id, 'queued']));
        const update = (id, patch) => {
            if (patch.status) states.set(id, patch.status);
            onUpdate(id, patch);
        };
        let renderer = null;
        let archive = null;
        let stoppedByBudget = false;
        try {
            const style = await this.styleResolver(this.root, styleSource, signal);
            this._assertAvailable(signal);
            renderer = await this.rendererFactory({ root: this.root, style, signal });
            this._assertAvailable(signal);
            const { format, ratio } = normalizeExportSettings(style.exportSettings);
            const nextEntryName = createBatchEntryNamer({ format, ratio });
            archive = this.archiveFactory({ maxOutputBytes, maxArchiveBytes });

            for (let index = 0; index < jobs.length; index += 1) {
                const current = jobs[index];
                if (signal?.aborted || this._disposed || this.root.isDisposed) {
                    jobs.slice(index).forEach(({ id }) => update(id, { status: 'cancelled', errorCode: 'batch-cancelled' }));
                    break;
                }
                const controller = new AbortController();
                const abortCurrent = () => controller.abort();
                signal?.addEventListener('abort', abortCurrent, { once: true });
                this._currentController = controller;
                let exported = null;
                try {
                    try {
                        update(current.id, { status: 'preparing', errorCode: null });
                        await renderer.prepare(current.file, { signal: controller.signal });
                        this._assertAvailable(signal);
                        if (controller.signal.aborted) throw batchError('batch-cancelled');
                        update(current.id, { status: 'rendering' });
                        await renderer.waitUntilReady({ signal: controller.signal });
                        this._assertAvailable(signal);
                        if (controller.signal.aborted) throw batchError('batch-cancelled');
                        update(current.id, { status: 'encoding' });
                        exported = await this.root.exportService.exportImage({
                            target: renderer.target,
                            size: renderer.size,
                            format,
                            ratio,
                            signal: controller.signal,
                            baseName: current.file.name,
                        });
                    } catch (error) {
                        if (isCancellation(error, controller.signal)) {
                            update(current.id, { status: 'cancelled', errorCode: 'batch-cancelled' });
                        } else {
                            update(current.id, { status: 'failed', errorCode: error?.code || 'batch-job-failed' });
                        }
                    } finally {
                        try {
                            await renderer.clear();
                        } catch (error) {
                            const hadExport = Boolean(exported);
                            exported = null;
                            if (hadExport) {
                                update(current.id, { status: 'failed', errorCode: error?.code || 'batch-render-release-failed' });
                            } else {
                                update(current.id, { releaseErrorCode: error?.code || 'batch-render-release-failed' });
                            }
                        }
                    }

                    if (!exported) continue;
                    try {
                        this._assertAvailable(signal);
                        if (controller.signal.aborted) throw batchError('batch-cancelled');
                        const filename = nextEntryName(current.file.name);
                        await archive.add(filename, exported.blob, { signal: controller.signal });
                        this._assertAvailable(signal);
                        if (controller.signal.aborted) throw batchError('batch-cancelled');
                        update(current.id, {
                            status: 'completed',
                            filename,
                            bytes: exported.blob.size,
                            width: exported.width,
                            height: exported.height,
                        });
                    } catch (error) {
                        if (error?.code === 'batch-output-budget-exceeded') {
                            stoppedByBudget = true;
                            update(current.id, { status: 'failed', errorCode: error.code });
                            jobs.slice(index + 1).forEach(({ id }) => update(id, {
                                status: 'cancelled',
                                errorCode: 'batch-budget-stopped',
                            }));
                            break;
                        }
                        if (isCancellation(error, signal) || controller.signal.aborted) {
                            update(current.id, { status: 'cancelled', errorCode: 'batch-cancelled' });
                            if (signal?.aborted) {
                                jobs.slice(index + 1).forEach(({ id }) => update(id, {
                                    status: 'cancelled',
                                    errorCode: 'batch-cancelled',
                                }));
                                break;
                            }
                        } else {
                            update(current.id, { status: 'failed', errorCode: error?.code || 'batch-archive-create-failed' });
                        }
                    }
                } finally {
                    signal?.removeEventListener('abort', abortCurrent);
                    if (this._currentController === controller) this._currentController = null;
                }
            }

            const blob = archive.entryCount > 0 ? await archive.finish() : null;
            const values = [...states.values()];
            return {
                archive: blob,
                filename: blob ? archiveName(this.now) : null,
                successCount: values.filter((status) => status === 'completed').length,
                failedCount: values.filter((status) => status === 'failed').length,
                cancelledCount: values.filter((status) => status === 'cancelled').length,
                outputBytes: archive.outputBytes,
                archiveBytes: blob?.size || 0,
                stoppedByBudget,
            };
        } finally {
            this._currentController = null;
            try {
                await renderer?.dispose?.();
            } finally {
                if (archive && !archive.isFinished) archive.terminate();
                this._running = false;
            }
        }
    }
}
