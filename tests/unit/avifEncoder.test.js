import { afterEach, describe, expect, it, vi } from 'vitest';
import { AvifEncoder, isAvifBuffer } from '../../src/utils/avifEncoder.js';

const avifBytes = () => new Uint8Array([
    0, 0, 0, 20,
    102, 116, 121, 112,
    97, 118, 105, 102,
    0, 0, 0, 0,
    97, 118, 105, 102,
]);

class FakeWorker {
    constructor(response = { ok: true, buffer: avifBytes().buffer }) {
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
    255, 0, 0, 255,
    0, 0, 255, 128,
]);

afterEach(() => vi.useRealTimers());

describe('AVIF encoder adapter', () => {
    it('validates AVIF brands and rejects renamed arbitrary bytes', () => {
        expect(isAvifBuffer(avifBytes())).toBe(true);
        expect(isAvifBuffer(new TextEncoder().encode('not-an-avif-file'))).toBe(false);
        expect(isAvifBuffer(new Uint8Array([
            0, 0, 0, 20,
            102, 116, 121, 112,
            104, 101, 105, 99,
            97, 118, 105, 102,
            109, 105, 102, 49,
        ]))).toBe(false);
        expect(isAvifBuffer(new Uint8Array([
            0, 0, 0, 12,
            102, 116, 121, 112,
            104, 101, 105, 99,
            0, 0, 0, 0,
            97, 118, 105, 102,
        ]))).toBe(false);
    });

    it('transfers exact RGBA pixels, reuses one worker, and returns an AVIF Blob', async () => {
        const worker = new FakeWorker();
        const encoder = new AvifEncoder({ workerFactory: () => worker, idleMs: 60_000 });

        const first = await encoder.encode({ pixels: pixels(), width: 2, height: 1 });
        const second = await encoder.encode({ pixels: pixels(), width: 2, height: 1 });

        expect(first).toBeInstanceOf(Blob);
        expect(first.type).toBe('image/avif');
        expect(first.size).toBe(avifBytes().byteLength);
        expect(second.type).toBe('image/avif');
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

    it('reclaims an idle worker after the bounded reuse window', async () => {
        vi.useFakeTimers();
        const worker = new FakeWorker();
        const encoder = new AvifEncoder({ workerFactory: () => worker, idleMs: 1_000 });

        await encoder.encode({ pixels: pixels(), width: 2, height: 1 });
        expect(worker.terminate).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(worker.terminate).toHaveBeenCalledOnce();
    });

    it('terminates immediately on cancellation and rejects invalid output', async () => {
        const waitingWorker = new FakeWorker(null);
        const cancelled = new AvifEncoder({ workerFactory: () => waitingWorker });
        const controller = new AbortController();
        const running = cancelled.encode({ pixels: pixels(), width: 2, height: 1, signal: controller.signal });
        controller.abort();
        await expect(running).rejects.toMatchObject({ code: 'export-cancelled' });
        expect(waitingWorker.terminate).toHaveBeenCalledOnce();

        const invalidWorker = new FakeWorker({ ok: true, buffer: new Uint8Array([1, 2, 3]).buffer });
        const invalid = new AvifEncoder({ workerFactory: () => invalidWorker });
        await expect(invalid.encode({ pixels: pixels(), width: 2, height: 1 }))
            .rejects.toMatchObject({ code: 'avif-output-invalid' });
        expect(invalidWorker.terminate).toHaveBeenCalledOnce();
    });

    it('settles an active encode immediately when disposed', async () => {
        const worker = new FakeWorker(null);
        const encoder = new AvifEncoder({
            workerFactory: () => worker,
            timeoutMs: 50,
        });
        const running = encoder.encode({ pixels: pixels(), width: 2, height: 1 });

        encoder.dispose();

        await expect(running).rejects.toMatchObject({ code: 'export-cancelled' });
        expect(worker.terminate).toHaveBeenCalledOnce();
    });

    it('keeps cancellation authoritative after a worker response has resolved the inner promise', async () => {
        const worker = new FakeWorker(null);
        const encoder = new AvifEncoder({ workerFactory: () => worker, idleMs: 60_000 });
        const running = encoder.encode({ pixels: pixels(), width: 2, height: 1 });
        const { id } = worker.postMessage.mock.calls[0][0];

        worker.onmessage({ data: { id, ok: true, buffer: avifBytes().buffer } });
        encoder.dispose();

        await expect(running).rejects.toMatchObject({ code: 'export-cancelled' });
        expect(worker.terminate).toHaveBeenCalledOnce();
    });

    it('rejects malformed pixel geometry before creating a worker', async () => {
        const factory = vi.fn(() => new FakeWorker());
        const encoder = new AvifEncoder({ workerFactory: factory });
        await expect(encoder.encode({ pixels: new Uint8ClampedArray(3), width: 1, height: 1 }))
            .rejects.toMatchObject({ code: 'avif-input-invalid' });
        expect(factory).not.toHaveBeenCalled();
    });
});
