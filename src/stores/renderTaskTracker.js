import { batchError } from '@utils/batchContract';

export class RenderTaskTracker {
    constructor() {
        this._tasks = new Set();
    }

    get size() {
        return this._tasks.size;
    }

    track(task) {
        const promise = Promise.resolve(task);
        this._tasks.add(promise);
        const release = () => this._tasks.delete(promise);
        promise.then(release, release);
        return promise;
    }

    async waitForIdle(signal) {
        while (this._tasks.size > 0) {
            if (signal?.aborted) throw batchError('batch-cancelled');
            await Promise.allSettled([...this._tasks]);
        }
        if (signal?.aborted) throw batchError('batch-cancelled');
    }
}
