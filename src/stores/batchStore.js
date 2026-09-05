import { makeAutoObservable, observableRef, observableShallow, runInAction } from 'mobx';
import { browserPlatform } from '../platform/browserPlatform';
import { isExportCancelled } from './exportService';
import {
    MAX_BATCH_FILES,
    batchError,
    captureCurrentBatchStyleSource,
} from '@utils/batchContract';

const defaultServiceFactory = async (root) => {
    const { BatchExportService } = await import('./batchExportService');
    return new BatchExportService(root);
};

export class BatchStore {
    jobs = [];
    state = 'idle';
    presetId = null;
    archive = null;
    archiveFilename = null;
    summary = null;
    errorCode = null;

    constructor(root, { serviceFactory = defaultServiceFactory, platform = browserPlatform } = {}) {
        this.root = root;
        this.serviceFactory = serviceFactory;
        this.platform = platform;
        this._service = null;
        this._controller = null;
        this._disposed = false;
        this._jobSequence = 0;
        makeAutoObservable(this, {
            root: false,
            serviceFactory: false,
            platform: false,
            jobs: observableShallow,
            archive: observableRef,
            _service: false,
            _controller: false,
            _disposed: false,
            _jobSequence: false,
        });
    }

    _createJob(file) {
        this._jobSequence += 1;
        return {
            id: `batch-job-${this._jobSequence}`,
            file,
            name: file?.name || `image-${this._jobSequence}`,
            inputBytes: Number(file?.size) || 0,
            status: 'queued',
            errorCode: null,
            filename: null,
            bytes: null,
            width: null,
            height: null,
        };
    }

    get isRunning() {
        return this.state === 'running';
    }

    get canRetry() {
        return !this.isRunning && this.jobs.some((job) => job.status === 'failed' || job.status === 'cancelled');
    }

    selectFiles(files) {
        if (this.isRunning) throw batchError('batch-busy');
        const list = Array.from(files || []);
        if (list.length < 1 || list.length > MAX_BATCH_FILES) throw batchError('batch-file-count-invalid');
        this.jobs = list.map((file) => this._createJob(file));
        this.archive = null;
        this.archiveFilename = null;
        this.summary = null;
        this.errorCode = null;
        this.state = 'ready';
    }

    setPreset(id) {
        if (this.isRunning) return;
        this.presetId = id || null;
    }

    _updateJob(id, patch) {
        const index = this.jobs.findIndex((job) => job.id === id);
        if (index < 0) return;
        this.jobs = this.jobs.map((job, jobIndex) => jobIndex === index ? { ...job, ...patch } : job);
    }

    async _getService() {
        if (!this._service) this._service = await this.serviceFactory(this.root);
        if (this._disposed) {
            this._service?.dispose?.();
            throw batchError('batch-cancelled');
        }
        return this._service;
    }

    async start(files = null, { presetId = this.presetId } = {}) {
        if (this.isRunning || this._disposed) return false;
        if (files) this.selectFiles(files);
        if (this.jobs.length < 1 || this.jobs.length > MAX_BATCH_FILES) {
            this.errorCode = 'batch-file-count-invalid';
            return false;
        }
        this.presetId = presetId || null;
        const styleSource = this.presetId
            ? { kind: 'preset', id: this.presetId }
            : captureCurrentBatchStyleSource(this.root);
        this.jobs = this.jobs.map((item) => ({
            ...item,
            status: 'queued',
            errorCode: null,
            filename: null,
            bytes: null,
            width: null,
            height: null,
        }));
        this.archive = null;
        this.archiveFilename = null;
        this.summary = null;
        this.errorCode = null;
        this.state = 'running';
        const controller = new AbortController();
        this._controller = controller;
        try {
            const service = await this._getService();
            if (controller.signal.aborted || this._disposed) throw batchError('batch-cancelled');
            const result = await service.run({
                jobs: this.jobs.map(({ id, file }) => ({ id, file })),
                styleSource,
                signal: controller.signal,
                onUpdate: (id, patch) => runInAction(() => this._updateJob(id, patch)),
            });
            if (this._disposed) return false;
            runInAction(() => {
                this.archive = result.archive;
                this.archiveFilename = result.filename;
                this.summary = result;
                this.state = controller.signal.aborted ? 'cancelled' : 'completed';
            });
            return true;
        } catch (error) {
            if (this._disposed) return false;
            runInAction(() => {
                this.errorCode = error?.code || 'batch-failed';
                this.state = controller.signal.aborted || error?.code === 'batch-cancelled' ? 'cancelled' : 'error';
            });
            return false;
        } finally {
            if (this._controller === controller) this._controller = null;
        }
    }

    cancelCurrent() {
        if (this.isRunning) this._service?.cancelCurrent?.();
    }

    cancelAll() {
        if (!this.isRunning) return;
        this._controller?.abort();
        this._service?.cancelCurrent?.();
        this.jobs = this.jobs.map((job) => job.status === 'queued'
            ? { ...job, status: 'cancelled', errorCode: 'batch-cancelled' }
            : job);
    }

    async retryFailed() {
        if (!this.canRetry) return false;
        const files = this.jobs
            .filter((job) => job.status === 'failed' || job.status === 'cancelled')
            .map((job) => job.file);
        return this.start(files, { presetId: this.presetId });
    }

    async download() {
        if (!this.archive || !this.archiveFilename || this.isRunning) return false;
        try {
            await this.platform.export.download(this.archive, this.archiveFilename);
            return true;
        } catch (error) {
            if (isExportCancelled(error)) return false;
            this.errorCode = 'batch-download-failed';
            return false;
        }
    }

    clear() {
        if (this.isRunning) return false;
        this.jobs = [];
        this.archive = null;
        this.archiveFilename = null;
        this.summary = null;
        this.errorCode = null;
        this.state = 'idle';
        return true;
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        this._controller?.abort();
        this._service?.dispose?.();
        this._controller = null;
        this._service = null;
        this.jobs = [];
        this.archive = null;
        this.archiveFilename = null;
        this.summary = null;
    }
}
