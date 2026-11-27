import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const codec = vi.hoisted(() => ({ encode: vi.fn() }));
vi.mock('@jsquash/avif/codec/enc/avif_enc.js', () => ({ default: vi.fn() }));
vi.mock('@jsquash/avif/utils.js', () => ({ initEmscriptenModule: async () => codec }));

let worker;
beforeEach(async () => {
    vi.resetModules();
    codec.encode.mockReset().mockReturnValue(new Uint8Array([1, 2, 3, 4]));
    delete codec.HEAPU8;
    worker = { location: { href: 'https://screenhello.test/assets/worker.js', origin: 'https://screenhello.test' }, postMessage: vi.fn() };
    vi.stubGlobal('self', worker);
    await import('../../src/workers/avifEncoder.worker.js');
});
afterEach(() => vi.unstubAllGlobals());

const request = () => ({ id: 1, pixels: new Uint8Array([1, 2, 3, 255, 5, 6, 7, 128]).buffer,
    width: 2, height: 1, wasmUrl: 'https://screenhello.test/assets/codec.wasm', compression: 'lossy', quality: 60 });

describe('AVIF Worker consumed input ownership', () => {
    it('transfers a full independent codec output directly and can encode again without detaching the heap', async () => {
        codec.HEAPU8 = new Uint8Array(32);
        const outputs = [], delivered = [];
        codec.encode.mockImplementation(() => {
            const output = new Uint8Array([1, 2, 3, 4]); outputs.push(output); return output;
        });
        worker.postMessage.mockImplementation((message, transfers) => {
            expect(message.buffer).toBe(outputs.at(-1).buffer);
            delivered.push(structuredClone(message, { transfer: transfers }));
        });
        await worker.onmessage({ data: request() });
        await worker.onmessage({ data: request() });
        expect(outputs.map(output => output.byteLength)).toEqual([0, 0]);
        expect(delivered.map(message => [...new Uint8Array(message.buffer)])).toEqual([[1, 2, 3, 4], [1, 2, 3, 4]]);
        expect(codec.HEAPU8.byteLength).toBe(32);
    });

    it.each(['input', 'heap', 'subview', 'shared', 'unknown-heap'])(
        'copies only output bytes when direct transfer ownership is unsafe: %s', async kind => {
            const data = request();
            codec.HEAPU8 = new Uint8Array([9, 8, 7, 6]);
            const output = kind === 'input' ? new Uint8Array(data.pixels)
                : kind === 'heap' ? codec.HEAPU8
                    : kind === 'shared' ? new Uint8Array(new SharedArrayBuffer(4))
                        : kind === 'subview' ? new Uint8Array([99, 1, 2, 88]).subarray(1, 3)
                            : new Uint8Array([1, 2, 3]);
            if (kind === 'unknown-heap') delete codec.HEAPU8;
            const expected = [...output];
            codec.encode.mockReturnValue(output);
            let delivered;
            worker.postMessage.mockImplementation((message, transfers) => {
                expect(message.buffer).not.toBe(output.buffer);
                expect(message.buffer).toBeInstanceOf(ArrayBuffer);
                delivered = structuredClone(message, { transfer: transfers });
            });
            await worker.onmessage({ data });
            expect([...new Uint8Array(delivered.buffer)]).toEqual(expected);
            if (kind !== 'input') expect([...output]).toEqual(expected);
            expect(data.pixels.byteLength).toBe(0);
        }
    );

    it('detaches only consumed input after synchronous encoding without changing options or output', async () => {
        const data = request();
        codec.encode.mockImplementation(pixels => {
            expect(pixels.byteLength).toBe(8);
            // Even an aliased output must be copied before input detachment.
            return pixels.subarray(0, 4);
        });
        await worker.onmessage({ data });
        expect(data.pixels.byteLength).toBe(0);
        expect(codec.encode).toHaveBeenCalledWith(expect.any(Uint8Array), 2, 1,
            expect.objectContaining({ quality: 60, qualityAlpha: 60, speed: 8, subsample: 3, bitDepth: 8, lossless: false }));
        const [message, transfers] = worker.postMessage.mock.calls[0];
        expect(message).toMatchObject({ id: 1, ok: true });
        expect([...new Uint8Array(message.buffer)]).toEqual([1, 2, 3, 255]);
        expect(transfers).toEqual([message.buffer]);
        expect(worker.postMessage).toHaveBeenCalledOnce();
    });

    it('releases input on codec failure while preserving the reported error', async () => {
        const data = request();
        codec.encode.mockImplementation(() => { throw new Error('codec failed'); });
        await worker.onmessage({ data });
        expect(data.pixels.byteLength).toBe(0);
        expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ id: 1, ok: false, message: 'codec failed' });
    });

    it('rejects invalid dimensions before codec use and releases the transferred input', async () => {
        const data = { ...request(), width: 8193 };
        await worker.onmessage({ data });
        expect(data.pixels.byteLength).toBe(0);
        expect(codec.encode).not.toHaveBeenCalled();
        expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ id: 1, ok: false, message: 'avif-input-invalid' });
    });

    it('never attempts to detach shared memory or non-ArrayBuffer inputs', async () => {
        const clone = vi.spyOn(globalThis, 'structuredClone');
        const data = { ...request(), pixels: new SharedArrayBuffer(8) };
        await worker.onmessage({ data });
        expect(clone).not.toHaveBeenCalled();
        expect(data.pixels.byteLength).toBe(8);
        expect(codec.encode).not.toHaveBeenCalled();
        expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ id: 1, ok: false, message: 'avif-input-invalid' });
    });

    it('falls back to the existing Worker lifecycle if structuredClone is unavailable', async () => {
        vi.stubGlobal('structuredClone', undefined);
        const data = request();
        await worker.onmessage({ data });
        expect(data.pixels.byteLength).toBe(8);
        expect(worker.postMessage).toHaveBeenCalledOnce();
        expect(worker.postMessage.mock.calls[0][0]).toMatchObject({ id: 1, ok: true });
    });

    it('tolerates an already detached invalid input without a second cleanup error', async () => {
        const data = request();
        structuredClone(null, { transfer: [data.pixels] });
        await expect(worker.onmessage({ data })).resolves.toBeUndefined();
        expect(codec.encode).not.toHaveBeenCalled();
        expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ id: 1, ok: false, message: 'avif-input-invalid' });
    });
});
