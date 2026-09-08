import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadExportPreview, validateExportPreview, formatExportBytes, canPreviewAvif } from '../../src/utils/exportPreview.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const blob = new Blob(['fixture'], { type: 'image/png' });
function harness(decode = async () => {}) {
    const image = { naturalWidth: 20, naturalHeight: 10, decode: vi.fn(decode), remove: vi.fn(), removeAttribute: vi.fn() };
    const urls = { createObjectURL: vi.fn(() => 'blob:owned'), revokeObjectURL: vi.fn() };
    return { image, urls, options: { createImage: () => image, createBitmap: null, urls, width: 20, height: 10 } };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('C2 bounded preview decode and display ownership', () => {
    it('probes only the built-in tiny AVIF and releases its bitmap and surface', async () => {
        const bitmap = { width: 2, height: 1, close: vi.fn() };
        const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), remove: vi.fn() };
        const createBitmap = vi.fn(async blob => {
            expect(blob.type).toBe('image/avif'); expect(blob.size).toBeLessThan(1024);
            expect(Buffer.from(await blob.arrayBuffer()).subarray(4, 12).toString()).toBe('ftypavif');
            return bitmap;
        });
        expect(await canPreviewAvif({ createBitmap, createCanvas: () => canvas })).toBe(true);
        expect(bitmap.close).toHaveBeenCalledTimes(1);
        expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
        expect(canvas.remove).toHaveBeenCalledTimes(1);
    });
    it('reports unavailable on native AVIF rejection without throwing an export failure', async () => {
        expect(await canPreviewAvif({ createBitmap: async () => { throw new Error('unsupported'); } })).toBe(false);
    });
    it('probes the HTMLImage path when bitmap decoding is absent and revokes its URL', async () => {
        const h = harness(); h.image.naturalWidth = 2; h.image.naturalHeight = 1;
        expect(await canPreviewAvif(h.options)).toBe(true);
        expect(h.urls.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:owned');
    });
    it.each(['timeout', 'cancel'])('bounds the probe and closes a late bitmap after %s', async reason => {
        vi.useFakeTimers();
        const pending = deferred(); const controller = new AbortController();
        const bitmap = { width: 2, height: 1, close: vi.fn() };
        const job = canPreviewAvif({ createBitmap: () => pending.promise, signal: controller.signal });
        const assertion = reason === 'cancel' ? expect(job).rejects.toHaveProperty('code', 'export-cancelled') : expect(job).resolves.toBe(false);
        if (reason === 'cancel') controller.abort();
        else await vi.advanceTimersByTimeAsync(3000);
        await assertion;
        pending.resolve(bitmap); await Promise.resolve();
        expect(bitmap.close).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('never decodes an already cancelled probe', async () => {
        const controller = new AbortController(); controller.abort(); const createBitmap = vi.fn();
        await expect(canPreviewAvif({ signal: controller.signal, createBitmap })).rejects.toHaveProperty('code', 'export-cancelled');
        expect(createBitmap).not.toHaveBeenCalled();
    });
    it('holds a decoded lease until released, with idempotent URL cleanup', async () => {
        const h = harness();
        const lease = await loadExportPreview(blob, h.options);
        expect(lease.image).toBe(h.image);
        expect(h.urls.revokeObjectURL).not.toHaveBeenCalled();
        lease.release(); lease.release();
        expect(h.urls.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:owned');
        expect(h.image.removeAttribute).toHaveBeenCalledWith('src');
    });
    it.each(['unsupported', 'dimensions', 'timeout', 'cancel'])('releases display resources on %s', async failure => {
        const pending = deferred();
        const h = harness(() => pending.promise);
        const controller = new AbortController();
        vi.useFakeTimers();
        const job = loadExportPreview(blob, { ...h.options, signal: controller.signal, timeoutMs: 50 });
        const assertion = expect(job).rejects.toHaveProperty('code', failure === 'timeout' ? 'export-preview-timeout' : failure === 'cancel' ? 'export-cancelled' : 'export-preview-unsupported');
        if (failure === 'unsupported') pending.reject(new Error('decode failed'));
        if (failure === 'dimensions') { h.image.naturalWidth = 99; pending.resolve(); }
        if (failure === 'timeout') await vi.advanceTimersByTimeAsync(50);
        if (failure === 'cancel') controller.abort();
        await assertion;
        expect(h.urls.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:owned');
        pending.resolve(); // A late decode must not recreate a lease.
        await Promise.resolve();
        expect(h.urls.createObjectURL).toHaveBeenCalledTimes(1);
    });
    it('does not allocate for an already cancelled request', async () => {
        const h = harness(); const controller = new AbortController(); controller.abort();
        await expect(loadExportPreview(blob, { ...h.options, signal: controller.signal })).rejects.toHaveProperty('code', 'export-cancelled');
        expect(h.urls.createObjectURL).not.toHaveBeenCalled();
    });
    it('validates comparison sides serially and only once when PNG no-gain reuses its reference', async () => {
        const active = new Set(); let peak = 0; let count = 0;
        vi.stubGlobal('URL', { createObjectURL: () => { const id = `blob:${++count}`; active.add(id); peak = Math.max(peak, active.size); return id; }, revokeObjectURL: id => active.delete(id) });
        vi.stubGlobal('Image', class {
            naturalWidth = 20; naturalHeight = 10;
            async decode() {} remove() {} removeAttribute() {}
        });
        await validateExportPreview({ width: 20, height: 10, blob, referenceBlob: new Blob(['second']) });
        expect(count).toBe(2); expect(peak).toBe(1); expect(active.size).toBe(0);
        await validateExportPreview({ width: 20, height: 10, blob, referenceBlob: blob });
        expect(count).toBe(3); expect(active.size).toBe(0);
    });
    it('formats actual bytes using binary units and instance locale', () => {
        expect(formatExportBytes(999, 'en-US')).toBe('999 B');
        expect(formatExportBytes(1536, 'en-US')).toBe('1.5 KiB');
        expect(formatExportBytes(1536, 'de-DE')).toBe('1,5 KiB');
        expect(formatExportBytes(1048576, 'en-US')).toBe('1 MiB');
    });

    it('explicitly closes each validation bitmap and does not create display URLs', async () => {
        const bitmaps = [];
        vi.stubGlobal('createImageBitmap', vi.fn(async () => {
            const bitmap = { width: 20, height: 10, close: vi.fn() };
            bitmaps.push(bitmap); return bitmap;
        }));
        const urls = { createObjectURL: vi.fn() }; vi.stubGlobal('URL', urls);
        await validateExportPreview({ width: 20, height: 10, blob, referenceBlob: new Blob(['other']) });
        expect(bitmaps).toHaveLength(2);
        bitmaps.forEach(bitmap => expect(bitmap.close).toHaveBeenCalledTimes(1));
        expect(urls.createObjectURL).not.toHaveBeenCalled();
    });
    it.each([true, false])('owns the display canvas and closes its bitmap when drawing succeeds=%s', async success => {
        const bitmap = { width: 20, height: 10, close: vi.fn() };
        const context = { drawImage: vi.fn(() => { if (!success) throw new Error('canvas failure'); }) };
        const canvas = { width: 0, height: 0, getContext: type => type === '2d' ? context : null, remove: vi.fn() };
        const options = { width: 20, height: 10, createBitmap: async () => bitmap, createCanvas: () => canvas };
        if (success) {
            const lease = await loadExportPreview(blob, options);
            expect(lease.image).toBe(canvas);
            expect(canvas.width).toBe(20); expect(canvas.height).toBe(10);
            lease.release(); lease.release();
        } else await expect(loadExportPreview(blob, options)).rejects.toHaveProperty('code', 'export-preview-unsupported');
        expect(bitmap.close).toHaveBeenCalledTimes(1);
        expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
        expect(canvas.remove).toHaveBeenCalledTimes(1);
    });
    it('requests a resettable CPU-backed preview surface', async () => {
        const bitmap = { width: 20, height: 10, close: vi.fn() };
        const context = { drawImage: vi.fn() };
        const canvas = { width: 0, height: 0, getContext: vi.fn(() => context), remove: vi.fn() };
        const lease = await loadExportPreview(blob, { width: 20, height: 10, createBitmap: async () => bitmap, createCanvas: () => canvas });
        expect(canvas.getContext).toHaveBeenCalledExactlyOnceWith('2d', { willReadFrequently: true });
        expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(bitmap, 0, 0);
        lease.release(); lease.release();
        expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
    });
    it.each(['cancel', 'timeout', 'dimensions', 'unsupported'])('closes bitmap validation on %s, including late resolution', async failure => {
        vi.useFakeTimers();
        const pending = deferred();
        const bitmap = { width: failure === 'dimensions' ? 21 : 20, height: 10, close: vi.fn() };
        vi.stubGlobal('createImageBitmap', vi.fn(() => pending.promise));
        const controller = new AbortController();
        const job = validateExportPreview({ width: 20, height: 10, blob, referenceBlob: blob }, controller.signal);
        const assertion = expect(job).rejects.toHaveProperty('code', failure === 'cancel' ? 'export-cancelled' : failure === 'timeout' ? 'export-preview-timeout' : 'export-preview-unsupported');
        if (failure === 'cancel') controller.abort();
        if (failure === 'timeout') await vi.advanceTimersByTimeAsync(10_000);
        if (failure === 'dimensions') pending.resolve(bitmap);
        if (failure === 'unsupported') pending.reject(new Error('decode unavailable'));
        await assertion;
        pending.resolve(bitmap); await Promise.resolve();
        expect(bitmap.close).toHaveBeenCalledTimes(failure === 'unsupported' ? 0 : 1);
    });
    it('closes a resolved bitmap when abort wins the promise-continuation microtask gap', async () => {
        const bitmap = { width: 20, height: 10, close: vi.fn() };
        vi.stubGlobal('createImageBitmap', () => Promise.resolve(bitmap));
        const controller = new AbortController();
        const job = validateExportPreview({ width: 20, height: 10, blob, referenceBlob: blob }, controller.signal);
        queueMicrotask(() => controller.abort());
        await expect(job).rejects.toHaveProperty('code', 'export-cancelled');
        expect(bitmap.close).toHaveBeenCalledTimes(1);
    });
});
