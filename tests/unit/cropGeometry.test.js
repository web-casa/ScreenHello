import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    CROP_HANDLES,
    CROP_MIN_SIZE,
    applyCropInteraction,
    clampCropRect,
    computeViewportLayout,
    createInitialCropRect,
    finalizeCropPixels,
    fitCropToAspectRatio,
    naturalRectToStageRect,
    nudgeCropRect,
    renderCroppedBlob,
    resolveAspectRatio,
} from '@utils/cropGeometry';
import { createScreenHelloRuntime } from '@stores/index';

describe('cropGeometry', () => {
    it('computes centered viewport layout and clamps pan at zoom 1 and zoomed states', () => {
        const fit = computeViewportLayout({
            naturalWidth: 1000,
            naturalHeight: 500,
            stageWidth: 532,
            stageHeight: 400,
            zoom: 1,
            panX: 80,
            panY: -40,
            padding: 16,
        });
        expect(fit.scale).toBeCloseTo(0.5, 5);
        expect(fit.panX).toBe(0);
        expect(fit.panY).toBe(0);
        expect(fit.imageRect).toEqual({ x: 16, y: 75, width: 500, height: 250 });

        const zoomed = computeViewportLayout({
            naturalWidth: 1000,
            naturalHeight: 500,
            stageWidth: 532,
            stageHeight: 400,
            zoom: 2,
            panX: 999,
            panY: -999,
            padding: 16,
        });
        expect(zoomed.scale).toBeCloseTo(1, 5);
        expect(zoomed.panX).toBe(zoomed.maxPanX);
        expect(zoomed.panY).toBe(-zoomed.maxPanY);
        const stageCrop = naturalRectToStageRect({ x: 100, y: 50, width: 200, height: 100 }, fit);
        expect(stageCrop).toEqual({ x: 66, y: 100, width: 100, height: 50 });
    });

    it('creates, clamps, and fits aspect-ratio presets including tiny images', () => {
        expect(resolveAspectRatio('free', 800, 600)).toBeNull();
        expect(resolveAspectRatio('original', 800, 400)).toBe(2);
        expect(resolveAspectRatio('1:1', 800, 400)).toBe(1);
        expect(resolveAspectRatio('16:9', 800, 400)).toBeCloseTo(16 / 9, 6);
        expect(resolveAspectRatio('4:3', 800, 400)).toBeCloseTo(4 / 3, 6);

        const square = createInitialCropRect(800, 400, 1);
        expect(square).toEqual({ x: 200, y: 0, width: 400, height: 400 });

        const fitted = fitCropToAspectRatio({ x: 100, y: 50, width: 400, height: 300 }, 1, 800, 400);
        expect(fitted.width).toBeCloseTo(300, 4);
        expect(fitted.height).toBeCloseTo(300, 4);
        expect(fitted.x).toBeCloseTo(150, 4);

        const tiny = clampCropRect({ x: -10, y: -10, width: 2, height: 2 }, 6, 4);
        expect(tiny).toEqual({ x: 0, y: 0, width: 6, height: 4 });
    });

    it('handles free-form dragging for move and all 8 handles within bounds and minSize', () => {
        const start = { x: 100, y: 100, width: 200, height: 150 };
        const moved = applyCropInteraction({
            startRect: start,
            handle: 'move',
            dxNatural: 900,
            dyNatural: -900,
            naturalWidth: 800,
            naturalHeight: 600,
        });
        expect(moved).toEqual({ x: 600, y: 0, width: 200, height: 150 });

        for (const handle of CROP_HANDLES) {
            const shrunk = applyCropInteraction({
                startRect: start,
                handle,
                dxNatural: handle.includes('w') ? 500 : -500,
                dyNatural: handle.includes('n') ? 500 : -500,
                naturalWidth: 800,
                naturalHeight: 600,
            });
            expect(shrunk.width).toBeGreaterThanOrEqual(CROP_MIN_SIZE);
            expect(shrunk.height).toBeGreaterThanOrEqual(CROP_MIN_SIZE);
            expect(shrunk.x).toBeGreaterThanOrEqual(0);
            expect(shrunk.y).toBeGreaterThanOrEqual(0);
            expect(shrunk.x + shrunk.width).toBeLessThanOrEqual(800);
            expect(shrunk.y + shrunk.height).toBeLessThanOrEqual(600);
        }
    });

    it('preserves locked aspect ratios for corner and edge handles without leaving image bounds', () => {
        const ratio = 16 / 9;
        const start = { x: 120, y: 80, width: 320, height: 180 };
        for (const handle of CROP_HANDLES) {
            const next = applyCropInteraction({
                startRect: start,
                handle,
                dxNatural: handle.includes('w') ? -40 : 40,
                dyNatural: handle.includes('n') ? -25 : 25,
                naturalWidth: 800,
                naturalHeight: 600,
                ratio,
            });
            expect(next.width / next.height).toBeCloseTo(ratio, 3);
            expect(next.x).toBeGreaterThanOrEqual(-1e-6);
            expect(next.y).toBeGreaterThanOrEqual(-1e-6);
            expect(next.x + next.width).toBeLessThanOrEqual(800 + 1e-6);
            expect(next.y + next.height).toBeLessThanOrEqual(600 + 1e-6);
        }
    });

    it('nudges selection via keyboard and finalizes exact integer pixels', () => {
        const nudged = nudgeCropRect({ x: 10, y: 10, width: 100, height: 80 }, {
            dx: -20,
            dy: 15,
            naturalWidth: 200,
            naturalHeight: 150,
        });
        expect(nudged).toEqual({ x: 0, y: 25, width: 100, height: 80 });

        const pixels = finalizeCropPixels({ x: 199.6, y: 149.4, width: 12.2, height: 8.7 }, 200, 150);
        expect(pixels.x).toBeGreaterThanOrEqual(0);
        expect(pixels.y).toBeGreaterThanOrEqual(0);
        expect(pixels.width).toBeGreaterThanOrEqual(1);
        expect(pixels.height).toBeGreaterThanOrEqual(1);
        expect(pixels.x + pixels.width).toBeLessThanOrEqual(200);
        expect(pixels.y + pixels.height).toBeLessThanOrEqual(150);
    });

    it('renders a cropped PNG blob and always clears canvas backing dimensions', async () => {
        const canvas = {
            width: 0,
            height: 0,
            getContext: vi.fn(() => ({ drawImage: vi.fn() })),
            toBlob: vi.fn((callback, type) => callback(new Blob(['png'], { type }))),
        };
        const documentRef = { createElement: vi.fn(() => canvas) };
        const result = await renderCroppedBlob(
            { naturalWidth: 400, naturalHeight: 300 },
            { x: 50.2, y: 40.8, width: 120.4, height: 80.1 },
            { documentRef },
        );
        expect(result.x).toBe(50);
        expect(result.y).toBe(41);
        expect(result.width).toBe(120);
        expect(result.height).toBe(80);
        expect(result.blob.type).toBe('image/png');
        expect(canvas.width).toBe(0);
        expect(canvas.height).toBe(0);

        await expect(renderCroppedBlob(
            { naturalWidth: 400, naturalHeight: 300 },
            { x: 0, y: 0, width: 400, height: 300 },
            { maxPixels: 100, documentRef },
        )).rejects.toThrow('crop-pixel-budget-exceeded');
    });
});

describe('CommandService.cropActiveImage transaction', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const stubDecodeImage = (width = 120, height = 90) => {
        class MockImage {
            set src(value) {
                this._src = value;
                this.naturalWidth = width;
                this.naturalHeight = height;
                this.width = width;
                this.height = height;
                queueMicrotask(() => this.onload?.());
            }
            get src() {
                return this._src;
            }
        }
        vi.stubGlobal('Image', MockImage);
    };

    const createMockPlatform = () => {
        let counter = 0;
        const revoked = [];
        return {
            revoked,
            platform: {
                isDesktop: false,
                file: {
                    createObjectURL: () => `blob:crop-test-${++counter}`,
                    revokeObjectURL: (url) => revoked.push(url),
                },
            },
        };
    };

    const createPngFile = () => {
        const bytes = new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x78, 0x00, 0x00, 0x00, 0x5a,
            0x08, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ]);
        return new File([bytes], 'crop.png', { type: 'image/png' });
    };

    it('commits crop + auto frame size atomically and restores both on undo without revoking original blob prematurely', async () => {
        stubDecodeImage(120, 90);
        const { platform, revoked } = createMockPlatform();
        const runtime = createScreenHelloRuntime({ platform });
        runtime.activate();
        runtime.editor.setMessage({ error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() });
        runtime.imageStore.replaceAll({
            src: 'blob:original-1',
            width: 400,
            height: 300,
            type: 'image/png',
            name: 'original.png',
            _ownsObjectUrl: true,
        });
        runtime.option.setFrameSize(560, 420);
        runtime.history.reset();

        const targetId = runtime.commands.getCropTargetId();
        expect(targetId).toBeTruthy();

        const ok = await runtime.commands.cropActiveImage(createPngFile(), { targetId });
        expect(ok).toBe(true);
        expect(runtime.imageStore.activeImage.width).toBe(120);
        expect(runtime.imageStore.activeImage.height).toBe(90);
        expect(runtime.imageStore.activeImage.src).not.toBe('blob:original-1');
        expect(revoked).not.toContain('blob:original-1');
        expect(runtime.history.canUndo).toBe(true);
        const croppedFrame = { ...runtime.option.frameConf };
        expect(croppedFrame.width).not.toBe(560);

        runtime.history.undo();
        expect(runtime.imageStore.activeImage.src).toBe('blob:original-1');
        expect(runtime.imageStore.activeImage.width).toBe(400);
        expect(runtime.option.frameConf.width).toBe(560);

        runtime.history.redo();
        expect(runtime.imageStore.activeImage.width).toBe(120);
        expect(runtime.option.frameConf.width).toBe(croppedFrame.width);

        runtime.dispose();
    });

    it('blocks cropping when the active layer is locked or multiple layers are selected', async () => {
        stubDecodeImage(120, 90);
        const { platform } = createMockPlatform();
        const runtime = createScreenHelloRuntime({ platform });
        runtime.activate();
        const errorSpy = vi.fn();
        runtime.editor.setMessage({ error: errorSpy, warning: vi.fn(), success: vi.fn(), info: vi.fn() });
        const first = runtime.imageStore.add({
            src: 'blob:layer-1',
            width: 200,
            height: 150,
            type: 'image/png',
            name: 'a.png',
            _ownsObjectUrl: true,
        });
        const second = runtime.imageStore.add({
            src: 'blob:layer-2',
            width: 200,
            height: 150,
            type: 'image/png',
            name: 'b.png',
            _ownsObjectUrl: true,
        });

        runtime.imageStore.select([first.id, second.id]);
        expect(runtime.commands.getCropTargetId()).toBeNull();
        expect(await runtime.commands.cropActiveImage(createPngFile(), { targetId: first.id })).toBe(false);

        runtime.imageStore.select([first.id]);
        runtime.imageStore.toggleLockSelected();
        expect(runtime.commands.getCropTargetId()).toBeNull();
        expect(await runtime.commands.cropActiveImage(createPngFile(), { targetId: first.id })).toBe(false);
        expect(errorSpy).toHaveBeenCalled();

        runtime.dispose();
    });
});
