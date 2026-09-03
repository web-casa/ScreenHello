import { afterEach, describe, expect, it, vi } from 'vitest';
import { reaction } from 'mobx';
import {
    ExportService,
    MAX_AVIF_EXPORT_PIXELS,
    MAX_EXPORT_EDGE,
    MAX_EXPORT_PIXELS,
    isExportCancelled,
} from '../../src/stores/exportService.js';

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

const createHarness = ({
    exportImpl,
    width = 800,
    height = 600,
    avifEncoderFactory,
    webpEncoderFactory,
    nativeWebpSupport = async () => true,
} = {}) => {
    const treeExport = vi.fn(exportImpl || (async (_format, options) => {
        options.onCanvas?.({ destroy: vi.fn() });
        return {
            data: new Blob(['image'], { type: 'image/png' }),
            width: width * (options.pixelRatio || 1),
            height: height * (options.pixelRatio || 1),
        };
    }));
    const platform = {
        export: { download: vi.fn().mockResolvedValue(undefined) },
        clipboard: { writeImage: vi.fn().mockResolvedValue(undefined) },
    };
    const root = {
        editor: { app: { tree: { export: treeExport } } },
        option: { frameConf: { width, height } },
    };
    const service = new ExportService(root, {
        platform,
        now: vi.fn(() => 100),
        ...(avifEncoderFactory ? { avifEncoderFactory } : {}),
        ...(webpEncoderFactory ? { webpEncoderFactory } : {}),
        nativeWebpSupport,
    });
    return { platform, root, service, treeExport };
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('ExportService', () => {
    it('reports queued and active exports as busy for guarded application updates', async () => {
        const gate = deferred();
        const { service, treeExport } = createHarness({
            exportImpl: async (_format, options) => {
                await gate.promise;
                options.onCanvas?.({ destroy: vi.fn() });
                return { data: new Blob(['png'], { type: 'image/png' }), width: 800, height: 600 };
            },
        });

        const busyStates = [];
        const stop = reaction(() => service.isBusy, (value) => busyStates.push(value), { fireImmediately: true });
        try {
            expect(service.isBusy).toBe(false);
            const first = service.exportImage();
            const second = service.exportImage();
            expect(service.isBusy).toBe(true);
            await vi.waitFor(() => expect(treeExport).toHaveBeenCalledOnce());

            gate.resolve();
            await Promise.all([first, second]);
            expect(treeExport).toHaveBeenCalledTimes(2);
            expect(service.isBusy).toBe(false);
            expect(busyStates).toEqual([false, true, false]);
        } finally {
            stop();
        }
    });

    it('normalizes PNG export options and releases Leafer temporary canvases', async () => {
        const temporaryCanvas = { destroy: vi.fn() };
        const { service, treeExport } = createHarness({
            exportImpl: async (_format, options) => {
                options.onCanvas(temporaryCanvas);
                return {
                    data: new Blob(['png'], { type: 'image/png' }),
                    width: 1600,
                    height: 1200,
                };
            },
        });

        await expect(service.exportImage({ format: 'png', ratio: 2 })).resolves.toMatchObject({
            format: 'png',
            mimeType: 'image/png',
            pixelRatio: 2,
            width: 1600,
            height: 1200,
        });
        expect(treeExport).toHaveBeenCalledWith('png', {
            blob: true,
            pixelRatio: 2,
            onCanvas: expect.any(Function),
        });
        expect(temporaryCanvas.destroy).toHaveBeenCalledOnce();
    });

    it.each([
        ['jpg', 'image/jpeg'],
        ['webp', 'image/webp'],
    ])('keeps the reviewed white background and quality for %s', async (format, mimeType) => {
        const { service, treeExport } = createHarness({
            exportImpl: async (_format, options) => {
                options.onCanvas({ destroy: vi.fn() });
                return { data: new Blob([format], { type: mimeType }), width: 800, height: 600 };
            },
        });

        await service.exportImage({ format, ratio: 1 });

        expect(treeExport).toHaveBeenCalledWith(format, {
            blob: true,
            pixelRatio: 1,
            quality: 0.9,
            fill: '#ffffff',
            onCanvas: expect.any(Function),
        });
    });

    it('uses the local WebP encoder when Canvas silently falls back to PNG', async () => {
        const imageData = { data: new Uint8ClampedArray(2 * 4) };
        const context = { getImageData: vi.fn(() => imageData) };
        const nativeCanvas = { width: 2, height: 1, getContext: vi.fn(() => context) };
        const wrapper = { view: nativeCanvas, destroy: vi.fn() };
        const encoder = {
            encode: vi.fn(async () => new Blob(['RIFF\x04\0\0\0WEBP'], { type: 'image/webp' })),
            dispose: vi.fn(),
        };
        const { service, treeExport } = createHarness({
            width: 2,
            height: 1,
            nativeWebpSupport: async () => false,
            webpEncoderFactory: async () => encoder,
            exportImpl: async (format, options) => {
                expect(format).toBe('canvas');
                expect(options).toEqual({ pixelRatio: 1, fill: '#ffffff' });
                return { data: wrapper, width: 2, height: 1 };
            },
        });

        await expect(service.exportImage({ format: 'webp', ratio: 1 })).resolves.toMatchObject({
            format: 'webp',
            mimeType: 'image/webp',
            width: 2,
            height: 1,
        });
        expect(treeExport).toHaveBeenCalledOnce();
        expect(nativeCanvas.getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
        expect(encoder.encode).toHaveBeenCalledWith({
            pixels: imageData.data,
            width: 2,
            height: 1,
            signal: undefined,
        });
        expect(wrapper.destroy).toHaveBeenCalledOnce();
        expect(nativeCanvas).toMatchObject({ width: 0, height: 0 });

        service.dispose();
        expect(encoder.dispose).toHaveBeenCalledOnce();
    });

    it('rejects unsupported settings and unsafe output dimensions before rendering', async () => {
        const { root, service, treeExport } = createHarness();

        await expect(service.exportImage({ format: 'gif' })).rejects.toMatchObject({ code: 'export-format-unsupported' });
        await expect(service.exportImage({ ratio: 4 })).rejects.toMatchObject({ code: 'export-ratio-unsupported' });

        root.option.frameConf = { width: MAX_EXPORT_EDGE + 1, height: 1 };
        await expect(service.exportImage({ ratio: 1 })).rejects.toMatchObject({ code: 'export-size-too-large' });

        root.option.frameConf = { width: MAX_EXPORT_PIXELS / 2 + 1, height: 2 };
        await expect(service.exportImage({ ratio: 1 })).rejects.toMatchObject({ code: 'export-size-too-large' });

        root.option.frameConf = { width: Number.POSITIVE_INFINITY, height: 1 };
        await expect(service.exportImage({ ratio: 1 })).rejects.toMatchObject({ code: 'export-size-too-large' });

        await expect(service.exportImage({
            target: { export: vi.fn() },
            format: 'png',
        })).rejects.toMatchObject({ code: 'export-size-too-large' });
        expect(treeExport).not.toHaveBeenCalled();
    });

    it('routes AVIF through a native canvas and the lazy encoder without asking Leafer for AVIF', async () => {
        const imageData = { data: new Uint8ClampedArray(800 * 600 * 4) };
        const context = { getImageData: vi.fn(() => imageData) };
        const nativeCanvas = { width: 800, height: 600, getContext: vi.fn(() => context) };
        const wrapper = { view: nativeCanvas, destroy: vi.fn() };
        const encoder = {
            encode: vi.fn(async () => new Blob(['avif'], { type: 'image/avif' })),
            dispose: vi.fn(),
        };
        const avifEncoderFactory = vi.fn(async () => encoder);
        const { service, treeExport } = createHarness({
            avifEncoderFactory,
            exportImpl: async (format, options) => {
                expect(format).toBe('canvas');
                expect(options).toEqual({ pixelRatio: 1 });
                return { data: wrapper, width: 800, height: 600 };
            },
        });

        await expect(service.exportImage({ format: 'avif', ratio: 1 })).resolves.toMatchObject({
            format: 'avif',
            mimeType: 'image/avif',
            width: 800,
            height: 600,
        });
        expect(treeExport).toHaveBeenCalledOnce();
        expect(nativeCanvas.getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
        expect(context.getImageData).toHaveBeenCalledWith(0, 0, 800, 600);
        expect(avifEncoderFactory).toHaveBeenCalledOnce();
        expect(encoder.encode).toHaveBeenCalledOnce();
        const [encodeOptions] = encoder.encode.mock.calls[0];
        expect(encodeOptions).toMatchObject({
            width: 800,
            height: 600,
            signal: undefined,
        });
        expect(encodeOptions.pixels).toBe(imageData.data);
        expect(wrapper.destroy).toHaveBeenCalledOnce();
        expect(nativeCanvas).toMatchObject({ width: 0, height: 0 });

        service.dispose();
        expect(encoder.dispose).toHaveBeenCalledOnce();
    });

    it('enforces the lower AVIF pixel budget before allocating a canvas', async () => {
        const { root, service, treeExport } = createHarness();
        root.option.frameConf = { width: MAX_AVIF_EXPORT_PIXELS / 2048 + 1, height: 2048 };

        await expect(service.exportImage({ format: 'avif' }))
            .rejects.toMatchObject({ code: 'export-avif-size-too-large' });
        expect(treeExport).not.toHaveBeenCalled();
    });

    it('releases the AVIF canvas and preserves cancellation and encoder failure diagnostics', async () => {
        const allWrappers = Array.from({ length: 2 }, () => ({
            view: {
                width: 800,
                height: 600,
                getContext: vi.fn(() => ({ getImageData: () => ({ data: new Uint8ClampedArray(800 * 600 * 4) }) })),
            },
            destroy: vi.fn(),
        }));
        const pendingWrappers = [...allWrappers];
        const encoder = {
            encode: vi.fn()
                .mockRejectedValueOnce(Object.assign(new Error('cancelled'), { code: 'export-cancelled' }))
                .mockRejectedValueOnce(new Error('codec crashed')),
            dispose: vi.fn(),
        };
        const { service } = createHarness({
            avifEncoderFactory: async () => encoder,
            exportImpl: async () => ({ data: pendingWrappers.shift(), width: 800, height: 600 }),
        });

        await expect(service.exportImage({ format: 'avif' })).rejects.toSatisfy(isExportCancelled);
        await expect(service.exportImage({ format: 'avif' })).rejects.toMatchObject({
            code: 'export-avif-failed',
            cause: expect.any(Error),
        });
        expect(encoder.encode).toHaveBeenCalledTimes(2);
        expect(allWrappers.every(({ destroy }) => destroy.mock.calls.length === 1)).toBe(true);
    });

    it('disposes an AVIF encoder that resolves after its runtime was disposed', async () => {
        const encoderReady = deferred();
        const encoder = { encode: vi.fn(), dispose: vi.fn() };
        const wrapper = {
            view: {
                width: 800,
                height: 600,
                getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(800 * 600 * 4) }) }),
            },
            destroy: vi.fn(),
        };
        const avifEncoderFactory = vi.fn(() => encoderReady.promise);
        const { service } = createHarness({
            avifEncoderFactory,
            exportImpl: async () => ({ data: wrapper, width: 800, height: 600 }),
        });

        const running = service.exportImage({ format: 'avif' });
        await vi.waitFor(() => expect(avifEncoderFactory).toHaveBeenCalledOnce());
        service.dispose();
        encoderReady.resolve(encoder);

        await expect(running).rejects.toSatisfy(isExportCancelled);
        expect(encoder.encode).not.toHaveBeenCalled();
        expect(encoder.dispose).toHaveBeenCalledOnce();
        expect(wrapper.destroy).toHaveBeenCalledOnce();
    });

    it('uses an explicit render target and its declared source size', async () => {
        const { service, treeExport } = createHarness();
        const temporaryCanvas = { destroy: vi.fn() };
        const targetExport = vi.fn(async (_format, options) => {
            options.onCanvas(temporaryCanvas);
            return {
                data: new Blob(['png'], { type: 'image/png' }),
                width: 300,
                height: 150,
            };
        });

        await expect(service.exportImage({
            target: { export: targetExport },
            size: { width: 100, height: 50 },
            format: 'png',
            ratio: 3,
        })).resolves.toMatchObject({ width: 300, height: 150 });

        expect(treeExport).not.toHaveBeenCalled();
        expect(targetExport).toHaveBeenCalledOnce();
        expect(temporaryCanvas.destroy).toHaveBeenCalledOnce();
    });

    it('turns resolved Leafer errors and invalid Blob results into explicit failures', async () => {
        const leaferFailure = new Error('canvas failed');
        const first = createHarness({ exportImpl: async () => ({ data: '', error: leaferFailure }) });
        await expect(first.service.exportImage()).rejects.toMatchObject({
            code: 'export-render-failed',
            cause: leaferFailure,
        });

        const temporaryCanvas = { destroy: vi.fn() };
        const second = createHarness({
            exportImpl: async (_format, options) => {
                options.onCanvas(temporaryCanvas);
                return { data: null, width: 800, height: 600 };
            },
        });
        await expect(second.service.exportImage()).rejects.toMatchObject({ code: 'export-result-invalid' });
        expect(temporaryCanvas.destroy).toHaveBeenCalledOnce();

        const third = createHarness({
            exportImpl: async (_format, options) => {
                options.onCanvas({ destroy: vi.fn() });
                return {
                    data: new Blob(['png'], { type: 'image/png' }),
                    width: 799,
                    height: 600,
                };
            },
        });
        await expect(third.service.exportImage()).rejects.toMatchObject({ code: 'export-result-invalid' });
    });

    it('attempts every temporary-canvas cleanup when one release fails', async () => {
        const firstFailure = new Error('first destroy failed');
        const firstCanvas = { destroy: vi.fn(() => { throw firstFailure; }) };
        const secondCanvas = { destroy: vi.fn() };
        const { service } = createHarness({
            exportImpl: async (_format, options) => {
                options.onCanvas(firstCanvas);
                options.onCanvas(secondCanvas);
                return {
                    data: new Blob(['png'], { type: 'image/png' }),
                    width: 800,
                    height: 600,
                };
            },
        });

        await expect(service.exportImage()).rejects.toMatchObject({
            code: 'export-canvas-release-failed',
            cause: firstFailure,
        });
        expect(firstCanvas.destroy).toHaveBeenCalledOnce();
        expect(secondCanvas.destroy).toHaveBeenCalledOnce();
    });

    it('keeps cleanup diagnostics when render validation also fails', async () => {
        const releaseFailure = new Error('destroy failed');
        const { service } = createHarness({
            exportImpl: async (_format, options) => {
                options.onCanvas({ destroy: vi.fn(() => { throw releaseFailure; }) });
                return { data: null, width: 800, height: 600 };
            },
        });

        await expect(service.exportImage()).rejects.toMatchObject({
            code: 'export-result-invalid',
            releaseCause: {
                code: 'export-canvas-release-failed',
                cause: releaseFailure,
            },
        });
    });

    it('serializes exports and continues the queue after a failure', async () => {
        const first = deferred();
        const events = [];
        let call = 0;
        const { service, treeExport } = createHarness({
            exportImpl: async (_format, options) => {
                call += 1;
                const current = call;
                events.push(`start-${current}`);
                if (current === 1) await first.promise;
                options.onCanvas({ destroy: vi.fn() });
                events.push(`end-${current}`);
                if (current === 2) return { data: '', error: new Error('second failed') };
                return { data: new Blob(['png'], { type: 'image/png' }), width: 800, height: 600 };
            },
        });

        const one = service.exportImage();
        const two = service.exportImage();
        const three = service.exportImage();
        await vi.waitFor(() => expect(treeExport).toHaveBeenCalledTimes(1));
        first.resolve();

        await expect(one).resolves.toMatchObject({ format: 'png' });
        await expect(two).rejects.toMatchObject({ code: 'export-render-failed' });
        await expect(three).resolves.toMatchObject({ format: 'png' });
        expect(events).toEqual(['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3']);
    });

    it('does not start an aborted queued export', async () => {
        const first = deferred();
        const { service, treeExport } = createHarness({
            exportImpl: async (_format, options) => {
                if (treeExport.mock.calls.length === 1) await first.promise;
                options.onCanvas({ destroy: vi.fn() });
                return { data: new Blob(['png'], { type: 'image/png' }), width: 800, height: 600 };
            },
        });
        const controller = new AbortController();

        const running = service.exportImage();
        const queued = service.exportImage({ signal: controller.signal });
        await vi.waitFor(() => expect(treeExport).toHaveBeenCalledTimes(1));
        controller.abort();
        first.resolve();

        await expect(running).resolves.toMatchObject({ format: 'png' });
        await expect(queued).rejects.toSatisfy(isExportCancelled);
        expect(treeExport).toHaveBeenCalledOnce();
    });

    it('blocks download side effects when an active export is cancelled', async () => {
        const render = deferred();
        const temporaryCanvas = { destroy: vi.fn() };
        const { platform, service, treeExport } = createHarness({
            exportImpl: async (_format, options) => {
                await render.promise;
                options.onCanvas(temporaryCanvas);
                return { data: new Blob(['png'], { type: 'image/png' }), width: 800, height: 600 };
            },
        });
        const controller = new AbortController();

        const pending = service.downloadImage({ signal: controller.signal });
        await vi.waitFor(() => expect(treeExport).toHaveBeenCalledOnce());
        controller.abort();
        render.resolve();

        await expect(pending).rejects.toSatisfy(isExportCancelled);
        expect(platform.export.download).not.toHaveBeenCalled();
        expect(temporaryCanvas.destroy).toHaveBeenCalledOnce();
    });

    it('uses one naming contract for downloads and always copies PNG', async () => {
        const { platform, service, treeExport } = createHarness();

        await expect(service.downloadImage({ format: 'png', ratio: 3 })).resolves.toMatchObject({
            filename: 'ScreenHello@3.png',
        });
        await service.copyImage({ ratio: 2 });

        expect(platform.export.download).toHaveBeenCalledWith(expect.any(Blob), 'ScreenHello@3.png');
        expect(platform.clipboard.writeImage).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/png' }));
        expect(treeExport.mock.calls[1][0]).toBe('png');
        expect(treeExport.mock.calls[1][1]).toMatchObject({ pixelRatio: 2, blob: true });
    });

    it('returns the native canvas with an idempotent owner release', async () => {
        const nativeCanvas = { width: 1600, height: 1200, getContext: vi.fn() };
        const wrapper = { view: nativeCanvas, destroy: vi.fn() };
        const { service } = createHarness({
            exportImpl: async () => ({ data: wrapper, width: 1600, height: 1200 }),
        });

        const result = await service.exportCanvas({ ratio: 2 });
        expect(result).toMatchObject({ canvas: nativeCanvas, width: 1600, height: 1200, pixelRatio: 2 });
        expect(wrapper.destroy).not.toHaveBeenCalled();

        result.release();
        result.release();
        expect(wrapper.destroy).toHaveBeenCalledOnce();
        expect(nativeCanvas).toMatchObject({ width: 0, height: 0 });
    });

    it('releases every outstanding native-canvas lease on service dispose', async () => {
        const firstWrapper = { view: { width: 800, height: 600, getContext: vi.fn() }, destroy: vi.fn() };
        const secondWrapper = { view: { width: 800, height: 600, getContext: vi.fn() }, destroy: vi.fn() };
        const wrappers = [firstWrapper, secondWrapper];
        const { service } = createHarness({
            exportImpl: async () => ({ data: wrappers.shift(), width: 800, height: 600 }),
        });

        const first = await service.exportCanvas();
        const second = await service.exportCanvas();
        service.dispose();

        expect(firstWrapper.destroy).toHaveBeenCalledOnce();
        expect(secondWrapper.destroy).toHaveBeenCalledOnce();
        expect(firstWrapper.view).toMatchObject({ width: 0, height: 0 });
        expect(secondWrapper.view).toMatchObject({ width: 0, height: 0 });
        first.release();
        second.release();
        expect(firstWrapper.destroy).toHaveBeenCalledOnce();
        expect(secondWrapper.destroy).toHaveBeenCalledOnce();
    });

    it('rejects queued work after dispose without affecting another service', async () => {
        const firstRender = deferred();
        const first = createHarness({
            exportImpl: async (_format, options) => {
                await firstRender.promise;
                options.onCanvas({ destroy: vi.fn() });
                return { data: new Blob(['png'], { type: 'image/png' }), width: 800, height: 600 };
            },
        });
        const second = createHarness();

        const running = first.service.exportImage();
        const queued = first.service.exportImage();
        await vi.waitFor(() => expect(first.treeExport).toHaveBeenCalledOnce());
        first.service.dispose();
        firstRender.resolve();

        await expect(running).rejects.toSatisfy(isExportCancelled);
        await expect(queued).rejects.toSatisfy(isExportCancelled);
        await expect(second.service.exportImage()).resolves.toMatchObject({ format: 'png' });
        expect(first.treeExport).toHaveBeenCalledOnce();
        expect(second.treeExport).toHaveBeenCalledOnce();
    });
});
