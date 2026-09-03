import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebpEncoder, isWebpBuffer } from '../../src/utils/webpEncoder.js';

const webpBytes = () => new Uint8Array([
    82, 73, 70, 70,
    4, 0, 0, 0,
    87, 69, 66, 80,
]);

class FakeWorker {
    constructor(response = { ok: true, buffer: webpBytes().buffer }) {
        this.response = response;
        this.onmessage = null;
        this.onerror = null;
        this.onmessageerror = null;
        this.postMessage = vi.fn(({ id }) => {
            if (!this.response) return;
            queueMicrotask(() => this.onmessage?.({ data: { id, ...this.response } }));
        });
        this.terminate = vi.fn();
    }
}

const pixels = () => new Uint8ClampedArray([
    255, 255, 255, 255,
    0, 0, 255, 255,
]);

afterEach(() => vi.useRealTimers());

describe('WebP encoder adapter', () => {
    it('validates RIFF/WebP bytes and rejects renamed arbitrary data', () => {
        expect(isWebpBuffer(webpBytes())).toBe(true);
        expect(isWebpBuffer(new TextEncoder().encode('not-a-webp-file'))).toBe(false);
        expect(isWebpBuffer(new Uint8Array([
            82, 73, 70, 70,
            100, 0, 0, 0,
            87, 69, 66, 80,
        ]))).toBe(false);
    });

    it('transfers exact RGBA pixels, reuses one worker, and returns a WebP Blob', async () => {
        const worker = new FakeWorker();
        const encoder = new WebpEncoder({ workerFactory: () => worker, idleMs: 60_000 });

        const first = await encoder.encode({ pixels: pixels(), width: 2, height: 1 });
        const second = await encoder.encode({ pixels: pixels(), width: 2, height: 1 });

        expect(first).toBeInstanceOf(Blob);
        expect(first.type).toBe('image/webp');
        expect(first.size).toBe(webpBytes().byteLength);
        expect(second.type).toBe('image/webp');
        expect(worker.postMessage).toHaveBeenCalledTimes(2);
        expect(worker.postMessage.mock.calls[0][0]).toMatchObject({
            width: 2,
            height: 1,
            wasmUrl: expect.any(String),
        });
        expect(worker.postMessage.mock.calls[0][1]).toHaveLength(1);
        encoder.dispose();
        expect(worker.terminate).toHaveBeenCalledOnce();
    });

    it('terminates on cancellation and rejects an invalid codec result', async () => {
        const waitingWorker = new FakeWorker(null);
        const cancelled = new WebpEncoder({ workerFactory: () => waitingWorker });
        const controller = new AbortController();
        const running = cancelled.encode({ pixels: pixels(), width: 2, height: 1, signal: controller.signal });
        controller.abort();
        await expect(running).rejects.toMatchObject({ code: 'export-cancelled' });
        expect(waitingWorker.terminate).toHaveBeenCalledOnce();

        const invalidWorker = new FakeWorker({ ok: true, buffer: new Uint8Array([1, 2, 3]).buffer });
        const invalid = new WebpEncoder({ workerFactory: () => invalidWorker });
        await expect(invalid.encode({ pixels: pixels(), width: 2, height: 1 }))
            .rejects.toMatchObject({ code: 'webp-output-invalid' });
        expect(invalidWorker.terminate).toHaveBeenCalledOnce();
    });

    it('settles an active encode immediately when disposed', async () => {
        const worker = new FakeWorker(null);
        const encoder = new WebpEncoder({ workerFactory: () => worker, timeoutMs: 50 });
        const running = encoder.encode({ pixels: pixels(), width: 2, height: 1 });

        encoder.dispose();

        await expect(running).rejects.toMatchObject({ code: 'export-cancelled' });
        expect(worker.terminate).toHaveBeenCalledOnce();
    });

    it('rejects malformed pixel geometry before creating a worker', async () => {
        const factory = vi.fn(() => new FakeWorker());
        const encoder = new WebpEncoder({ workerFactory: factory });
        await expect(encoder.encode({ pixels: new Uint8ClampedArray(3), width: 1, height: 1 }))
            .rejects.toMatchObject({ code: 'webp-input-invalid' });
        expect(factory).not.toHaveBeenCalled();
    });
});
