import { Zip, ZipPassThrough } from 'fflate';
import {
    BATCH_ARCHIVE_MIME,
    MAX_BATCH_ARCHIVE_BYTES,
    MAX_BATCH_OUTPUT_BYTES,
    batchError,
    isSafeBatchEntryName,
} from '@utils/batchContract';

export class BatchArchiveBuilder {
    constructor({ maxOutputBytes = MAX_BATCH_OUTPUT_BYTES, maxArchiveBytes = MAX_BATCH_ARCHIVE_BYTES } = {}) {
        this.maxOutputBytes = maxOutputBytes;
        this.maxArchiveBytes = maxArchiveBytes;
        this.outputBytes = 0;
        this.archiveBytes = 0;
        this.entryCount = 0;
        this._names = new Set();
        this._chunks = [];
        this._zip = null;
        this._finished = false;
        this._error = null;
        this._settle = null;
        this._done = new Promise((resolve, reject) => {
            this._settle = { resolve, reject };
        });
        this._done.catch(() => {});
    }

    get isFinished() {
        return this._finished;
    }

    _ensureZip() {
        if (this._zip) return;
        this._zip = new Zip((error, chunk, final) => {
            if (this._error) return;
            if (error) {
                this._error = batchError('batch-archive-create-failed', error);
                this._settle.reject(this._error);
                return;
            }
            if (chunk?.byteLength) {
                this.archiveBytes += chunk.byteLength;
                if (this.archiveBytes > this.maxArchiveBytes) {
                    this._error = batchError('batch-archive-budget-exceeded');
                    this._chunks = [];
                    this._zip?.terminate();
                    this._settle.reject(this._error);
                    return;
                }
                this._chunks.push(chunk);
            }
            if (final) this._settle.resolve();
        });
    }

    async add(name, blob, { signal } = {}) {
        if (this._finished) throw batchError('batch-archive-finished');
        if (this._error) throw this._error;
        if (signal?.aborted) throw batchError('batch-cancelled');
        if (!isSafeBatchEntryName(name) || this._names.has(name.toLowerCase())) {
            throw batchError('batch-entry-name-invalid');
        }
        if (!(blob instanceof Blob) || blob.size <= 0) throw batchError('batch-output-invalid');
        if (this.outputBytes + blob.size > this.maxOutputBytes) {
            throw batchError('batch-output-budget-exceeded');
        }
        let bytes;
        try {
            bytes = new Uint8Array(await blob.arrayBuffer());
        } catch (error) {
            throw batchError('batch-output-read-failed', error);
        }
        if (signal?.aborted) throw batchError('batch-cancelled');
        if (bytes.byteLength !== blob.size) throw batchError('batch-output-invalid');
        this._ensureZip();
        const entry = new ZipPassThrough(name);
        try {
            this._zip.add(entry);
            entry.push(bytes, true);
        } catch (error) {
            this._error = batchError('batch-archive-create-failed', error);
            this._chunks = [];
            this._zip?.terminate();
            this._settle.reject(this._error);
            throw this._error;
        }
        if (this._error) throw this._error;
        this.outputBytes += blob.size;
        this.entryCount += 1;
        this._names.add(name.toLowerCase());
    }

    async finish() {
        if (this._finished) throw batchError('batch-archive-finished');
        this._finished = true;
        if (this._error) throw this._error;
        if (!this._zip || this.entryCount === 0) return null;
        this._zip.end();
        await this._done;
        if (this._error) throw this._error;
        return new Blob(this._chunks, { type: BATCH_ARCHIVE_MIME });
    }

    terminate() {
        if (this._finished) return;
        this._finished = true;
        this._zip?.terminate();
        this._chunks = [];
    }
}
