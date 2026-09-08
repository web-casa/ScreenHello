import { afterEach, describe, expect, it, vi } from 'vitest';
import { PNG } from 'pngjs';
import { ExportService } from '../../src/stores/exportService.js';
import { RenderTaskTracker } from '../../src/stores/renderTaskTracker.js';
import { PngEncoder } from '../../src/utils/pngEncoder.js';
import { validateExportSettings, normalizeExportSettings, MAX_COMPRESSED_PIXELS, MAX_PREVIEW_PIXELS, compressionTimeoutMs } from '../../src/utils/exportSettings.js';
import { createScreenHelloRuntime } from '../../src/stores/index.js';
import { createProjectArchive, readWorkspaceArchive } from '../../src/utils/workspaceArchive.js';
import { createStylePreset } from '../../src/utils/stylePreset.js';
import { createDocument } from '../../src/utils/projectDocument.js';
import { createPngFixture } from '../fixtures/createPngFixture.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const owners = [];
afterEach(() => { owners.splice(0).forEach(owner => owner.dispose()); vi.useRealTimers(); });
const png = (size = 64) => new Blob([new Uint8Array(size)], { type: 'image/png' });
function harness({ encoderBlob = png(16), tracker = false, download = vi.fn(async () => {}), webExportSafety = false } = {}) {
    const root = { option: { frameConf: { width: 2, height: 2 } }, isActive: true };
    if (tracker) { root.renderTaskTracker = new RenderTaskTracker(); owners.push(root.renderTaskTracker); }
    const canvas = { width: 2, height: 2,
        getContext: vi.fn(() => ({ getImageData: () => ({ data: new Uint8ClampedArray(16) }) })),
        toBlob: vi.fn((cb, mime) => cb(new Blob([new Uint8Array(64)], { type: mime }))),
    };
    const wrapper = { view: canvas, destroy: vi.fn() };
    const tree = { export: vi.fn(async () => ({ data: wrapper, width: 2, height: 2 })) };
    root.editor = { app: { tree } };
    const encoder = { encode: vi.fn(async () => encoderBlob), dispose: vi.fn() };
    const platform = { export: { download } };
    const service = new ExportService(root, { platform, pngEncoderFactory: async () => encoder, webExportSafety });
    root.exportService = service;
    owners.push(service);
    return { root, tree, service, wrapper, canvas, encoder, platform };
}

describe('HF1 standalone Web compression rollout', () => {
    it('keeps library and standard AVIF budgets while limiting only Web AVIF compression', () => {
        const web = harness({ webExportSafety: true }).service, library = harness().service;
        const request = { format: 'avif', compression: 'lossy', size: { width: 2048, height: 2048 } };
        expect(() => library._validateRequest(request)).not.toThrow();
        expect(() => web._validateRequest({ ...request, compression: undefined })).not.toThrow();
        expect(() => web._validateRequest(request)).toThrow('export-web-avif-compression-size-too-large');
        expect(web.compressedPixelLimit('avif')).toBe(MAX_PREVIEW_PIXELS);
        expect(library.compressedPixelLimit('avif')).toBe(MAX_COMPRESSED_PIXELS);
        expect(() => web._validateRequest({ ...request, size: { width: 1024, height: 1024 } })).not.toThrow();
        expect(() => web._validateRequest({ ...request, size: { width: 1024, height: 1025 } })).toThrow();
        expect(() => web._validateRequest({ ...request, size: { width: 512, height: 512 }, ratio: 2 })).not.toThrow();
        expect(() => web._validateRequest({ ...request, size: { width: 512, height: 513 }, ratio: 2 })).toThrow();
        // Canvas rounds each output edge up; comparing the raw product alone
        // would incorrectly accept this just-over-limit raster.
        expect(() => web._validateRequest({ ...request, size: { width: 1023.01, height: 1024.5 } })).toThrow();
    });
    it.each([['png', 'lossless'], ['png', 'lossy'], ['jpg', 'lossy'], ['webp', 'lossless'], ['webp', 'lossy']])(
        'retains the separate 4MP direct and 1MP preview budgets for %s/%s', (format, compression) => {
            const { service } = harness({ webExportSafety: true });
            const request = { format, compression, size: { width: 2048, height: 2048 } };
            expect(() => service._validateRequest(request)).not.toThrow();
            expect(() => service._validateRequest({ ...request, preview: true })).toThrow('export-preview-size-too-large');
            expect(() => service._validateRequest({ ...request, size: { width: 2048, height: 2049 } })).toThrow('export-compression-size-too-large');
        });
    it('rejects direct, quick-download and isolated batch targets before export allocation and ignores request policy overrides', async () => {
        const h = harness({ webExportSafety: true });
        const request = { format: 'avif', compression: 'lossy', size: { width: 2048, height: 2048 }, webExportSafety: false };
        for (const method of ['exportImage', 'downloadImage']) {
            for (const target of [undefined, h.tree]) {
                await expect(h.service[method]({ ...request, target })).rejects.toMatchObject({ code: 'export-web-avif-compression-size-too-large' });
            }
        }
        expect(h.tree.export).not.toHaveBeenCalled();
        expect(h.canvas.getContext).not.toHaveBeenCalled();
        expect(h.encoder.encode).not.toHaveBeenCalled();
        expect(h.platform.export.download).not.toHaveBeenCalled();
        expect(h.service.isBusy).toBe(false);
        expect(h.service._canvasLeases.size).toBe(0);
        expect(() => { h.service._webExportSafety = false; }).toThrow();
    });
    it('checks prepared result dimensions before handing off even when request.size understates them', async () => {
        const h = harness({ webExportSafety: true });
        const token = {};
        h.service._prepared = { token, settings: { format: 'avif', compression: 'lossy', quality: 60, ratio: 2 },
            result: { width: 2048, height: 2048, pixelRatio: 2 }, stamp: null };
        await expect(h.service.downloadPreparedImage(token, { size: { width: 1, height: 1 }, webExportSafety: false }))
            .rejects.toMatchObject({ code: 'export-web-avif-compression-size-too-large' });
        expect(h.platform.export.download).not.toHaveBeenCalled();
    });
    it('runtime policy is isolated and does not rewrite imported project or preset export settings', () => {
        const web = createScreenHelloRuntime({ webExportSafety: true });
        const library = createScreenHelloRuntime(); owners.push(web, library);
        const settings = { format: 'avif', compression: 'lossy', quality: 80, ratio: 2, webExportSafety: false };
        web.workspace.setExportSettings(settings, { replace: true });
        const preset = createStylePreset({ exportSettings: settings });
        expect(preset.exportSettings).toEqual({ format: 'avif', compression: 'lossy', quality: 80, ratio: 2 });
        expect(web.workspace.exportSettings).toEqual(preset.exportSettings);
        expect(web.exportService.compressedPixelLimit('avif')).toBe(MAX_PREVIEW_PIXELS);
        expect(library.exportService.compressedPixelLimit('avif')).toBe(MAX_COMPRESSED_PIXELS);
    });
    it('does not apply pixel ratio twice when revalidating an allowed prepared AVIF result', async () => {
        const h = harness({ webExportSafety: true }), token = {};
        h.service._prepared = { token, settings: { format: 'avif', compression: 'lossy', quality: 60, ratio: 2 },
            result: { width: 1024, height: 1024, pixelRatio: 2 }, stamp: null };
        const handoff = vi.spyOn(h.service, '_handoff').mockResolvedValue({ current: true });
        await expect(h.service.downloadPreparedImage(token)).resolves.toEqual({ current: true });
        expect(handoff).toHaveBeenCalledOnce();
    });
});

describe('C3 isolated batch targets', () => {
    it('ignores active scene changes and encodes a lossy batch target only once without a reference', async () => {
        const h = harness({ tracker: true }); const encoded = deferred();
        h.encoder.encode.mockReturnValue(encoded.promise);
        const pending = h.service.exportImage({ target: h.tree, size: { width: 2, height: 2 }, compression: 'lossy', paletteColors: 64 });
        await vi.waitFor(() => expect(h.encoder.encode).toHaveBeenCalledOnce());
        h.root.renderTaskTracker.changedProject(); h.root.renderTaskTracker.changedPaint();
        encoded.resolve(png(16));
        const result = await pending;
        expect(result.referenceBlob).toBeNull();
        expect(result.summary).toMatchObject({ outputBytes: 16, referenceBytes: null, savingsPercent: null });
        expect(h.canvas.toBlob).not.toHaveBeenCalled();
        expect(h.wrapper.destroy).toHaveBeenCalledOnce();
    });

    it('still cancels isolated target delivery when its owning service is disposed', async () => {
        const h = harness({ tracker: true }); const encoded = deferred();
        h.encoder.encode.mockReturnValue(encoded.promise);
        const pending = h.service.exportImage({ target: h.tree, size: { width: 2, height: 2 }, compression: 'lossy' });
        const assertion = expect(pending).rejects.toMatchObject({ code: 'export-cancelled' });
        await vi.waitFor(() => expect(h.encoder.encode).toHaveBeenCalled());
        h.service.dispose(); encoded.resolve(png(16));
        await assertion;
        expect(h.service._canvasLeases.size).toBe(0);
        expect(h.platform.export.download).not.toHaveBeenCalled();
    });
});

describe('C1 settings and persistence contract', () => {
    it('retains the preview CPU budget and bounds larger direct encodes to two minutes', () => {
        expect(compressionTimeoutMs(1024, 1024)).toBe(30_000);
        expect(compressionTimeoutMs(1024, 1025)).toBe(60_000);
        expect(compressionTimeoutMs(2048, 1024)).toBe(60_000);
        expect(compressionTimeoutMs(2048, 1536)).toBe(90_000);
        expect(compressionTimeoutMs(2048, 2048)).toBe(120_000);
        expect(compressionTimeoutMs(8192, 8192)).toBe(120_000);
    });
    it.each([
        { format: 'png', ratio: 3, compression: 'lossy', paletteColors: 128 },
        { format: 'webp', ratio: 1, compression: 'lossless' },
        { format: 'jpg', ratio: 2, compression: 'lossy', quality: 80 },
        { format: 'avif', ratio: 1, compression: 'lossy', quality: 40 },
    ])('roundtrips $format/$compression through archives, presets and workspace', async settings => {
        expect(normalizeExportSettings(settings)).toEqual(settings);
        expect(createStylePreset({ exportSettings: settings }).exportSettings).toEqual(settings);
        const document = createDocument({ image: { width: 64, height: 48, type: 'image/png' } });
        const blob = await createProjectArchive({ document, image: new Blob([createPngFixture()], { type: 'image/png' }), exportSettings: settings });
        expect((await readWorkspaceArchive(blob)).exportSettings).toEqual(settings);
        const runtime = createScreenHelloRuntime(); owners.push(runtime);
        runtime.workspace.setExportSettings(settings, { replace: true });
        expect(runtime.workspace.exportSettings).toEqual(settings);
        runtime.workspace.setExportSettings({ format: 'png', ratio: 1 }, { replace: true });
        expect(runtime.workspace.exportSettings).toEqual({ format: 'png', ratio: 1 });
    });
    it.each([
        { format: 'jpg', compression: 'lossless' }, { compression: 'lossy', paletteColors: 63 },
        { compression: 'lossy', quality: 80 }, { format: 'webp', compression: 'lossy', quality: '80' },
        { format: 'avif', compression: 'lossy', quality: 101 }, { compression: 'lossless', paletteColors: 64 },
        { format: 'jpg', quality: 30 }, { compression: 'unknown' },
    ])('rejects invalid live settings while tolerating loaded preferences: %j', settings => {
        expect(() => validateExportSettings(settings)).toThrow();
        expect(normalizeExportSettings(settings)).toEqual({ format: settings.format ?? 'png', ratio: 1 });
    });
    it('retains the legacy defaults and never infers lossy consent from quality alone', () => {
        expect(normalizeExportSettings({ format: 'webp', quality: 10 })).toEqual({ format: 'webp', ratio: 1 });
        expect(validateExportSettings({ format: 'jpg', compression: 'lossy' }).quality).toBe(90);
        expect(validateExportSettings({ format: 'avif', compression: 'lossy' }).quality).toBe(60);
    });
});

describe('C1 snapshot ownership and handoff', () => {
    it('adds readback hints without changing the host canvas color or alpha configuration', async () => {
        const h = harness();
        const original = Object.freeze({ alpha: false, colorSpace: 'display-p3', desynchronized: true, willReadFrequently: false });
        h.tree.leafer = { config: { contextSettings: original } };
        await h.service.exportImage({ compression: 'lossy' });
        expect(h.tree.export).toHaveBeenCalledExactlyOnceWith('canvas', {
            pixelRatio: 1, contextSettings: { ...original, willReadFrequently: true },
        });
        expect(h.tree.leafer.config.contextSettings).toBe(original);
        expect(original.willReadFrequently).toBe(false);
    });
    it('uses the isolated batch target context configuration, not the live editor configuration', async () => {
        const h = harness();
        h.tree.leafer = { config: { contextSettings: { alpha: false, colorSpace: 'display-p3' } } };
        const target = { export: vi.fn(async () => ({ data: h.wrapper, width: 2, height: 2 })),
            leafer: { config: { contextSettings: { alpha: true, colorSpace: 'srgb' } } } };
        await h.service.exportImage({ target, size: { width: 2, height: 2 }, compression: 'lossy' });
        expect(target.export).toHaveBeenCalledExactlyOnceWith('canvas', {
            pixelRatio: 1, contextSettings: { alpha: true, colorSpace: 'srgb', willReadFrequently: true },
        });
        expect(h.tree.export).not.toHaveBeenCalled();
    });
    it.each(['lossless', 'lossy'])('releases the direct %s source Canvas before Worker encoding, exactly once', async compression => {
        const h = harness();
        h.encoder.encode.mockImplementation(async () => {
            expect(h.wrapper.destroy).toHaveBeenCalledOnce();
            expect(h.canvas.width).toBe(0);
            expect(h.service._canvasLeases.size).toBe(0);
            return png(16);
        });
        await h.service.downloadImage({ compression });
        expect(h.wrapper.destroy).toHaveBeenCalledOnce();
        expect(h.platform.export.download).toHaveBeenCalledOnce();
    });
    it('a closing old UI owner cannot discard another prepared token', async () => {
        const h = harness();
        const first = await h.service.prepareImage();
        const second = await h.service.prepareImage();
        h.service.discardPrepared('idle', first.token);
        expect(h.service.isPreparedCurrent(first.token)).toBe(false);
        expect(h.service.isPreparedCurrent(second.token)).toBe(true);
        expect(h.service.stage).toBe('ready');
        h.service.discardPrepared('idle', second.token);
        expect(h.service.isPreparedCurrent(second.token)).toBe(false);
    });
    it('keeps UI decode verification inside the export queue and never yields a ready token on decode failure', async () => {
        const h = harness(); const decoding = deferred(); const controller = new AbortController();
        const revoke = vi.spyOn(URL, 'revokeObjectURL');
        const OriginalImage = globalThis.Image;
        globalThis.Image = class { naturalWidth = 2; naturalHeight = 2; decode() { return decoding.promise; } removeAttribute() {} remove() {} };
        try {
            const job = h.service.prepareImage({ verifyPreview: true, signal: controller.signal });
            const rejected = expect(job).rejects.toHaveProperty('code', 'export-cancelled');
            await vi.waitFor(() => expect(h.wrapper.destroy).toHaveBeenCalled());
            expect(h.service.isBusy).toBe(true);
            expect(h.service.stage).toBe('preparing');
            controller.abort(); await rejected;
            expect(h.service.isBusy).toBe(false);
            expect(h.service._prepared).toBe(null);
            decoding.resolve();
        } finally { globalThis.Image = OriginalImage; revoke.mockRestore(); }
    });
    it('captures one full tree, keeps a larger lossless result as no-gain, and releases the canvas', async () => {
        const h = harness({ encoderBlob: png(100) });
        const result = await h.service.exportImage({ compression: 'lossless' });
        expect(h.tree.export).toHaveBeenCalledExactlyOnceWith('canvas', {
            pixelRatio: 1, contextSettings: { willReadFrequently: true },
        });
        expect(result.blob).toBe(result.referenceBlob);
        expect(result.summary).toMatchObject({ noGain: true, savedBytes: 0 });
        expect(h.wrapper.destroy).toHaveBeenCalledOnce();
        expect(h.canvas.width).toBe(0);
    });
    it('does not relabel codec errors as no-gain', async () => {
        const h = harness(); h.encoder.encode.mockRejectedValue(new Error('broken-codec'));
        await expect(h.service.exportImage({ compression: 'lossless' })).rejects.toThrow('broken-codec');
        expect(h.wrapper.destroy).toHaveBeenCalledOnce();
        expect(h.platform.export.download).not.toHaveBeenCalled();
    });
    it('copies submitted settings instead of observing later caller mutations', async () => {
        const h = harness();
        const request = { compression: 'lossy', paletteColors: 64 };
        const operation = h.service.exportImage(request);
        request.paletteColors = 128; request.compression = 'lossless';
        const result = await operation;
        expect(result.settings).toMatchObject({ compression: 'lossy', paletteColors: 64 });
        expect(h.encoder.encode).toHaveBeenCalledWith(expect.objectContaining({ compression: 'lossy', paletteColors: 64 }));
    });
    it('keeps negative lossy savings and validates before allocating a snapshot', async () => {
        const h = harness({ encoderBlob: png(100) });
        const { result } = await h.service.prepareImage({ compression: 'lossy', paletteColors: 64 });
        expect(result.summary.savedBytes).toBe(-36);
        h.root.option.frameConf = { width: 1024, height: 1025 };
        await expect(h.service.prepareImage({ compression: 'lossless' })).rejects.toMatchObject({ code: 'export-preview-size-too-large' });
        h.root.option.frameConf = { width: 2048, height: 2049 };
        await expect(h.service.exportImage({ compression: 'lossless' })).rejects.toMatchObject({ code: 'export-compression-size-too-large' });
        expect(h.tree.export).toHaveBeenCalledOnce();
        expect(MAX_PREVIEW_PIXELS).toBe(1024 * 1024);
        expect(MAX_COMPRESSED_PIXELS).toBe(2048 * 2048);
    });
    it('direct single-image lossy download skips unused reference encoding', async () => {
        const h = harness();
        const result = await h.service.downloadImage({ compression: 'lossy', paletteColors: 64 });
        expect(result.referenceBlob).toBeNull();
        expect(result.summary).toMatchObject({ referenceBytes: null, savingsPercent: null });
        expect(h.canvas.toBlob).not.toHaveBeenCalled();
        expect(h.encoder.encode).toHaveBeenCalledOnce();
        expect(h.platform.export.download).toHaveBeenCalledOnce();
    });
    it.each(['png', 'jpg', 'webp', 'avif'])('separates preview and direct download boundaries for %s without allocating', format => {
        const h = harness();
        expect(h.service._validateRequest({ format, compression: 'lossy', size: { width: 2048, height: 2048 } })).toMatchObject({ width: 2048, height: 2048 });
        expect(() => h.service._validateRequest({ format, compression: 'lossy', size: { width: 2048, height: 2049 } })).toThrow('export-compression-size-too-large');
        expect(() => h.service._validateRequest({ format, preview: true, size: { width: 1024, height: 1025 } })).toThrow('export-preview-size-too-large');
        expect(h.service._validateRequest({ format, preview: true, size: { width: 1024, height: 1024 } })).toMatchObject({ width: 1024, height: 1024 });
        expect(() => h.service._validateRequest({ format, compression: 'lossy', ratio: 2, size: { width: 2048, height: 2048 } })).toThrow('export-compression-size-too-large');
        expect(h.tree.export).not.toHaveBeenCalled();
    });
    it('downloads the exact prepared Blob once and rejects fabricated/cross-instance tokens', async () => {
        const a = harness(), b = harness();
        const prepared = await a.service.prepareImage({ compression: 'lossless' });
        expect(Object.isFrozen(prepared.result)).toBe(true);
        await expect(b.service.downloadPreparedImage(prepared.token)).rejects.toMatchObject({ code: 'export-stale' });
        await expect(a.service.downloadPreparedImage({}, { settings: prepared.settings })).rejects.toMatchObject({ code: 'export-stale' });
        await a.service.downloadPreparedImage(prepared.token);
        expect(a.platform.export.download).toHaveBeenCalledWith(prepared.result.blob, 'ScreenHello.png');
        expect(a.tree.export).toHaveBeenCalledOnce();
        await expect(a.service.downloadPreparedImage(prepared.token)).rejects.toMatchObject({ code: 'export-stale' });
    });
    it('invalidates ready pixels on a node-only paint change', async () => {
        const h = harness({ tracker: true });
        const prepared = await h.service.prepareImage({ compression: 'lossy' });
        h.root.renderTaskTracker.changedPaint();
        expect(h.service.stage).toBe('stale');
        await expect(h.service.downloadPreparedImage(prepared.token)).rejects.toMatchObject({ code: 'export-stale' });
        expect(h.platform.export.download).not.toHaveBeenCalled();
    });
    it('keeps a still-current prepared Blob retryable after system save cancellation', async () => {
        const h = harness({ tracker: true });
        const prepared = await h.service.prepareImage({ compression: 'lossless' });
        h.platform.export.download.mockRejectedValueOnce(Object.assign(new Error('cancelled'), { code: 'export-cancelled' }));
        await expect(h.service.downloadPreparedImage(prepared.token)).rejects.toMatchObject({ code: 'export-cancelled' });
        expect(h.service.stage).toBe('ready');
        await h.service.downloadPreparedImage(prepared.token);
        expect(h.tree.export).toHaveBeenCalledOnce();
        expect(h.platform.export.download).toHaveBeenLastCalledWith(prepared.result.blob, 'ScreenHello.png');
    });
    it('rejects changed pixels during encoding and retains queue ownership until a non-cancellable codec drains', async () => {
        const h = harness({ tracker: true }); const pending = deferred();
        h.encoder.encode.mockReturnValue(pending.promise);
        const result = h.service.downloadImage({ compression: 'lossy' });
        await vi.waitFor(() => expect(h.encoder.encode).toHaveBeenCalled());
        h.root.renderTaskTracker.changedPaint();
        expect(h.service.isBusy).toBe(true);
        pending.resolve(png());
        await expect(result).rejects.toMatchObject({ code: 'export-stale' });
        expect(h.wrapper.destroy).toHaveBeenCalledOnce();
        expect(h.platform.export.download).not.toHaveBeenCalled();
    });
    it('does not cancel an irreversible platform handoff and stays busy through its settlement', async () => {
        const pending = deferred(); const download = vi.fn(() => pending.promise);
        const h = harness({ download }); const controller = new AbortController();
        const result = h.service.downloadImage({ compression: 'lossless', signal: controller.signal });
        await vi.waitFor(() => expect(h.service.isHandingOff).toBe(true));
        controller.abort();
        expect(h.service.isBusy).toBe(true);
        pending.resolve();
        await expect(result).resolves.toMatchObject({ current: true });
        expect(h.service.isBusy).toBe(false);
    });
    it('keeps forced-dispose handoff busy and suppresses late preference commits', async () => {
        const pending = deferred(); const h = harness({ download: vi.fn(() => pending.promise) });
        const result = h.service.downloadImage({ compression: 'lossless' });
        await vi.waitFor(() => expect(h.service.isHandingOff).toBe(true));
        h.service.dispose();
        expect(h.service.isBusy).toBe(true);
        pending.resolve();
        await expect(result).resolves.toMatchObject({ current: false });
    });
});

describe('C1 readiness', () => {
    it('waits for same-content effects without confusing paint completion with user edits', async () => {
        const tracker = new RenderTaskTracker(); owners.push(tracker);
        const pending = deferred(); tracker.track(pending.promise);
        const stamp = tracker.stamp();
        const result = tracker.waitForExport({}, stamp);
        tracker.changedPaint(); pending.resolve();
        await expect(result).resolves.toMatchObject({ content: stamp.content, paint: 1 });
    });
    it('fails closed for redaction failures but reports explicit HDR fallbacks', async () => {
        const tracker = new RenderTaskTracker(); owners.push(tracker);
        tracker.beginEffect('hdr').fallback('hdr-fallback');
        await expect(tracker.waitForExport({}, tracker.stamp())).resolves.toBeDefined();
        expect(tracker.warnings).toEqual(['hdr-fallback']);
        tracker.beginEffect('redaction').fail('export-effect-failed');
        await expect(tracker.waitForExport({}, tracker.stamp())).rejects.toMatchObject({ code: 'export-effect-failed' });
    });
    it('bounds an unready render and detaches its next-render callback', async () => {
        const tracker = new RenderTaskTracker(); owners.push(tracker);
        const tree = { nextRender: vi.fn(), viewCompleted: false };
        await expect(tracker.waitForExport(tree, tracker.stamp(), undefined, { timeoutMs: 15 })).rejects.toMatchObject({ code: 'export-render-timeout' });
        expect(tree.nextRender).toHaveBeenLastCalledWith(expect.any(Function), undefined, 'off');
    });
    it('invalidates document/theme changes but not viewport-only scale changes', () => {
        const runtime = createScreenHelloRuntime(); owners.push(runtime);
        const tracker = runtime.renderTaskTracker;
        const initial = tracker.stamp();
        runtime.editor.setScale(2);
        expect(tracker.matches(initial)).toBe(true);
        runtime.editor.setTheme('dark');
        expect(tracker.matches(initial)).toBe(false);
    });
});

describe('production PNG worker adapter', () => {
    function adapter() {
        const worker = { postMessage: vi.fn(), terminate: vi.fn() };
        const encoder = new PngEncoder({ workerFactory: () => worker, timeoutMs: 10, idleMs: 10 });
        owners.push(encoder);
        const request = { pixels: new Uint8ClampedArray(4), width: 1, height: 1, compression: 'lossy', paletteColors: 64 };
        return { worker, encoder, request };
    }
    it('rejects malformed output, terminates, and accepts independently decoded output on retry', async () => {
        const { worker, encoder, request } = adapter();
        const first = encoder.encode(request);
        worker.onmessage({ data: { id: 1, ok: true, buffer: new ArrayBuffer(20) } });
        await expect(first).rejects.toMatchObject({ code: 'png-output-invalid' });
        expect(worker.terminate).toHaveBeenCalledOnce();
        const second = encoder.encode(request);
        const fixture = PNG.sync.write({ width: 1, height: 1, data: Buffer.from([0, 0, 0, 0]) });
        worker.onmessage({ data: { id: 1, ok: true, buffer: new ArrayBuffer(20) } }); // Late old response.
        worker.onmessage({ data: { id: 2, ok: true, buffer: Uint8Array.from(fixture).buffer } });
        expect(PNG.sync.read(Buffer.from(await (await second).arrayBuffer())).data[3]).toBe(0);
    });
    it('times out and terminates its worker', async () => {
        const { worker, encoder, request } = adapter();
        await expect(encoder.encode(request)).rejects.toMatchObject({ code: 'png-encode-timeout' });
        expect(worker.terminate).toHaveBeenCalledOnce();
    });
});
