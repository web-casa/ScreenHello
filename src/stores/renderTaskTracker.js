import { batchError } from '@utils/batchContract';
import { observable, reaction, runInAction } from 'mobx';
import { exportError, nextExportFrame, waitWithSignal } from '@utils/exportAsync';
// Verified against Leafer 2.2.9 event constants; avoid importing its DOM/canvas
// platform from a store module (unit consumers do not initialize Canvas).
const PROPERTY_CHANGE = 'property.change';
const CHILD_ADD = 'child.add';
const CHILD_REMOVE = 'child.remove';

const NON_PIXEL_ATTRIBUTES = new Set(['cursor', 'editable', 'hittable', 'hitChildren', 'id', 'name', 'editConfig']);

export class RenderTaskTracker {
    constructor() {
        this._tasks = new Set();
        this._size = observable.box(0);
        this.contentVersion = 0;
        this.paintVersion = 0;
        this.projectVersion = 0;
        this._listeners = new Set();
        this._flushers = new Set();
        this._effects = new Map();
        this._taskFailures = new Set();
        this._captureTail = Promise.resolve();
        this._disposed = false;
    }

    get size() {
        return this._size.get();
    }

    track(task) {
        const promise = Promise.resolve(task);
        this._tasks.add(promise);
        runInAction(() => this._size.set(this._tasks.size));
        const release = () => { this._tasks.delete(promise); runInAction(() => this._size.set(this._tasks.size)); };
        const content = this.contentVersion;
        promise.then(release, () => { this._taskFailures.add(content); release(); });
        return promise;
    }

    async waitForIdle(signal) {
        while (this._tasks.size > 0) {
            if (signal?.aborted) throw batchError('batch-cancelled');
            try { await waitWithSignal(Promise.allSettled([...this._tasks]), signal); }
            catch { throw batchError('batch-cancelled'); }
        }
        if (signal?.aborted) throw batchError('batch-cancelled');
    }

    bind(root) {
        this.root = root;
        this._stopReaction = reaction(() => JSON.stringify({
            document: root.editor.serializeProject(),
            imageRevision: root.imageStore.resourceRevision,
            background: root.assetStore.get(root.option.backgroundAssetId)?.url,
            theme: root.editor.theme,
            baseline: root.imageStore.baselineRevision,
        }), () => { this.contentVersion++; this._taskFailures.clear(); this._notify(); });
    }

    subscribe(listener) { this._listeners.add(listener); return () => this._listeners.delete(listener); }
    _notify() { for (const listener of this._listeners) listener(); }
    changedPaint() { if (!this._disposed) { this.paintVersion++; this._notify(); } }
    changedProject() { this.projectVersion++; this.contentVersion++; this._effects.clear(); this._taskFailures.clear(); this._notify(); }
    attachTree(tree) {
        this._detachTree?.();
        if (!tree?.on) return;
        tree.config.trackChanges = true;
        const property = event => {
            if (event.target === tree || event.target === tree.zoomLayer || NON_PIXEL_ATTRIBUTES.has(event.attrName)) return;
            this.changedPaint();
        };
        const child = () => this.changedPaint();
        tree.on(PROPERTY_CHANGE, property);
        tree.on(CHILD_ADD, child);
        tree.on(CHILD_REMOVE, child);
        this._detachTree = () => {
            tree.off(PROPERTY_CHANGE, property);
            tree.off(CHILD_ADD, child);
            tree.off(CHILD_REMOVE, child);
        };
    }
    stamp() { return { content: this.contentVersion, paint: this.paintVersion, project: this.projectVersion }; }
    matches(stamp, { paint = true } = {}) {
        return !this._disposed && stamp?.content === this.contentVersion && stamp?.project === this.projectVersion
            && (!paint || stamp.paint === this.paintVersion);
    }

    registerFlusher(flush) { this._flushers.add(flush); return () => this._flushers.delete(flush); }
    flushEdits() { for (const flush of this._flushers) flush(); }

    beginEffect(key) {
        const token = {};
        this._effects.set(key, { token, warning: null, error: null });
        return {
            fallback: code => { if (this._effects.get(key)?.token === token) { this._effects.get(key).warning = code; this.changedPaint(); } },
            fail: code => { if (this._effects.get(key)?.token === token) { this._effects.get(key).error = code; this.changedPaint(); } },
            dispose: () => { if (this._effects.get(key)?.token === token) this._effects.delete(key); },
        };
    }

    get warnings() { return [...new Set([...this._effects.values()].map(effect => effect.warning).filter(Boolean))]; }
    assertEffects() {
        if (this._taskFailures.has(this.contentVersion)) throw exportError('export-effect-failed');
        const failure = [...this._effects.values()].find(effect => effect.error);
        if (failure) throw exportError(failure.error);
    }

    // Base-snapshot exports temporarily hide annotations. Serialize that mutation
    // with final-pixel capture, not with the later encoding or platform save.
    withCapture(task) {
        const operation = this._captureTail.catch(() => {}).then(task);
        this._captureTail = operation.then(() => {}, () => {});
        return operation;
    }

    async waitForExport(tree, stamp, signal, { timeoutMs = 10_000 } = {}) {
        const controller = new AbortController();
        const abort = () => controller.abort(signal?.reason || exportError('export-cancelled'));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        const timer = setTimeout(() => controller.abort(exportError('export-render-timeout')), timeoutMs);
        const waiting = controller.signal;
        try {
            let stable = 0;
            let lastPaint = this.paintVersion;
            while (stable < 2) {
                await nextExportFrame(waiting); // React effects and pending node updates.
                if (!this.matches(stamp, { paint: false })) throw exportError('export-stale');
                this.flushEdits();
                this.root?.baseSnapshot?.flush?.();
                await waitWithSignal(Promise.allSettled([...this._tasks]), waiting);
                if (!this.matches(stamp, { paint: false })) throw exportError('export-stale');
                // viewCompleted alone can be true before a requested render.
                if (tree?.nextRender) {
                    let callback;
                    try { await waitWithSignal(new Promise(resolve => { callback = resolve; tree.nextRender(callback); }), waiting); }
                    finally { if (callback) tree.nextRender(callback, undefined, 'off'); }
                }
                if (this.size === 0 && !this.root?.baseSnapshot?.timer && tree?.viewCompleted !== false && lastPaint === this.paintVersion) stable++;
                else stable = 0;
                lastPaint = this.paintVersion;
            }
            this.assertEffects();
            return this.stamp();
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    }

    dispose() {
        this._disposed = true;
        this._stopReaction?.();
        this._detachTree?.();
        this._notify();
        this._listeners.clear();
        this._flushers.clear();
        this._effects.clear();
    }
}
