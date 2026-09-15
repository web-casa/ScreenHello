export const exportError = (code, cause) => Object.assign(new Error(code), { code, ...(cause ? { cause } : {}) });

// Abort UI waits promptly without pretending the underlying non-cancellable
// operation released its canvas; its owner still drains in the export queue.
export function waitWithSignal(promise, signal) {
    if (signal?.aborted) {
        Promise.resolve(promise).catch(() => {}); // Drain a rejection from an already-started owner.
        return Promise.reject(typeof signal.reason?.code === 'string' ? signal.reason : exportError('export-cancelled'));
    }
    return new Promise((resolve, reject) => {
        const abort = () => { cleanup(); reject(typeof signal.reason?.code === 'string' ? signal.reason : exportError('export-cancelled')); };
        const cleanup = () => signal?.removeEventListener('abort', abort);
        signal?.addEventListener('abort', abort, { once: true });
        Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
}

export function nextExportFrame(signal) {
    return new Promise((resolve, reject) => {
        const schedule = globalThis.requestAnimationFrame || (callback => setTimeout(callback, 0));
        const cancel = globalThis.cancelAnimationFrame || clearTimeout;
        let id;
        const abort = () => { cancel(id); signal?.removeEventListener('abort', abort); reject(typeof signal.reason?.code === 'string' ? signal.reason : exportError('export-cancelled')); };
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener('abort', abort, { once: true });
        id = schedule(() => { signal?.removeEventListener('abort', abort); resolve(); });
    });
}
