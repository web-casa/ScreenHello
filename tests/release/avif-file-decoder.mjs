import { Worker } from 'node:worker_threads';

export function decodeAvifFile(base64) {
    if (typeof base64 !== 'string' || !base64.length || base64.length > 174_764) throw new Error('avif-fixture-file-size-invalid');
    const bytes = Buffer.from(base64, 'base64');
    // Only the registered tiny synthetic AVIF, not arbitrary file decoding.
    if (!bytes.length || bytes.length > 131_072) throw new Error('avif-fixture-file-size-invalid');
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./avif-file-decoder.worker.mjs', import.meta.url), { workerData: bytes, execArgv: [] });
        let settled = false;
        const finish = (error, result) => {
            if (settled) return;
            settled = true; clearTimeout(timer);
            void worker.terminate().then(() => error ? reject(error) : resolve(result), reject);
        };
        const timer = setTimeout(() => finish(new Error('avif-file-decode-timeout')), 10_000);
        worker.once('error', error => finish(error));
        worker.once('exit', () => { if (!settled) finish(new Error('avif-file-decoder-exited')); });
        worker.once('message', result => finish(result.error ? new Error(result.error) : null, result));
    });
}
