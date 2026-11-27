import { describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_WATERMARK,
    WATERMARK_IMAGE_MAX_BYTES,
    computeWatermarkPlacement,
    extractLegacyWatermarkSettings,
    isValidWatermarkImageDataUrl,
    normalizeWatermark,
} from '../../src/utils/watermarkSchema.js';
import { compressWatermarkImageFile } from '../../src/utils/watermarkImage.js';
import { createWatermarkSvg } from '../../src/utils/utils.js';
import { createDocument, normalizeOption, normalizeProjectImage, validateDocument } from '../../src/utils/projectDocument.js';
import { createScreenHelloRuntime } from '../../src/stores/index.js';

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('Image / Logo watermark schema and placement', () => {
    it('validates safe raster data URLs and rejects SVG, remote URLs, or oversized payloads', () => {
        expect(isValidWatermarkImageDataUrl(TINY_PNG)).toBe(true);
        expect(isValidWatermarkImageDataUrl('https://evil.example/logo.png')).toBe(false);
        expect(isValidWatermarkImageDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false);
        expect(isValidWatermarkImageDataUrl(`data:image/png;base64,${'A'.repeat(WATERMARK_IMAGE_MAX_BYTES + 16)}`)).toBe(false);
    });

    it('preserves legacy waterImg compatibility and clamps structured watermark fields', () => {
        const legacy = normalizeOption({ waterImg: 'data:image/svg+xml;utf8,<svg/>' });
        expect(legacy.watermark.enabled).toBe(true);
        expect(legacy.watermark.mode).toBe('text');
        expect(legacy.waterImg).toBe('data:image/svg+xml;utf8,<svg/>');

        const clamped = normalizeWatermark({
            enabled: true,
            mode: 'image',
            imageDataUrl: TINY_PNG,
            imageWidth: 999,
            imageHeight: 200,
            position: 'top-left',
            scale: 200,
            opacity: 2,
            margin: -10,
        });
        expect(clamped.imageWidth).toBe(256);
        expect(clamped.scale).toBe(40);
        expect(clamped.opacity).toBe(10);
        expect(clamped.margin).toBe(0);
    });

    it('computes bounded nine-grid placement respecting aspect ratio and margin', () => {
        const br = computeWatermarkPlacement(1000, 600, {
            ...DEFAULT_WATERMARK,
            enabled: true,
            mode: 'image',
            imageDataUrl: TINY_PNG,
            imageWidth: 200,
            imageHeight: 100,
            position: 'bottom-right',
            scale: 20,
            margin: 24,
        });
        expect(br.width).toBe(120);
        expect(br.height).toBe(60);
        expect(br.x).toBe(1000 - 120 - 24);
        expect(br.y).toBe(600 - 60 - 24);

        const center = computeWatermarkPlacement(1000, 600, {
            ...DEFAULT_WATERMARK,
            enabled: true,
            mode: 'image',
            imageDataUrl: TINY_PNG,
            imageWidth: 100,
            imageHeight: 100,
            position: 'center',
            scale: 10,
        });
        expect(center.x).toBe(470);
        expect(center.y).toBe(270);
    });
});

describe('Layer visibility toggle and watermark history round-trip', () => {
    it('defaults layer.visible to true and round-trips false through projectDocument', () => {
        const defaultLayer = normalizeProjectImage({ id: 'img-1', assetId: 'a1', width: 100, height: 100 });
        expect(defaultLayer.visible).toBe(true);

        const hiddenLayer = normalizeProjectImage({ id: 'img-2', assetId: 'a2', width: 100, height: 100, visible: false });
        expect(hiddenLayer.visible).toBe(false);

        const doc = createDocument({ images: [defaultLayer, hiddenLayer] });
        const validated = validateDocument(doc);
        expect(validated.ok).toBe(true);
        expect(validated.doc.images.map((item) => item.visible)).toEqual([true, false]);
    });

    it('toggles visibility, deselects hidden layer, and restores via undo/redo', () => {
        const runtime = createScreenHelloRuntime();
        try {
            const layer = runtime.imageStore.add({
                src: TINY_PNG,
                width: 300,
                height: 200,
                name: 'shot.png',
                type: 'image/png',
            }, { select: true, commit: false });
            runtime.history.reset();

            expect(runtime.imageStore.layers.get(layer.id)?.visible).toBe(true);
            expect(runtime.imageStore.selectedIds).toEqual([layer.id]);

            expect(runtime.imageStore.toggleLayerVisibility(layer.id)).toBe(true);
            expect(runtime.imageStore.layers.get(layer.id)?.visible).toBe(false);
            expect(runtime.imageStore.selectedIds).toEqual([]);

            runtime.history.undo();
            expect(runtime.imageStore.layers.get(layer.id)?.visible).toBe(true);

            runtime.history.redo();
            expect(runtime.imageStore.layers.get(layer.id)?.visible).toBe(false);

            // Watermark image mode sets hasActiveWatermark and survives undo/redo
            expect(runtime.option.hasActiveWatermark).toBe(false);
            expect(runtime.option.setWatermark({
                enabled: true,
                mode: 'image',
                imageDataUrl: TINY_PNG,
                imageWidth: 64,
                imageHeight: 64,
                position: 'top-right',
            })).toBe(true);
            expect(runtime.option.hasActiveWatermark).toBe(true);
            expect(runtime.option.watermark.position).toBe('top-right');

            runtime.history.undo();
            expect(runtime.option.hasActiveWatermark).toBe(false);
        } finally {
            runtime.dispose();
        }
    });

    it('recovers legacy text watermark settings from historical text2Svg data URLs', () => {
        const svg = createWatermarkSvg({
            text: 'Acme & Co <Beta>',
            color: 'rgba(12, 34, 56, 0.5)',
            angleDegrees: -45,
            width: 220,
            height: 120,
        });
        const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        expect(extractLegacyWatermarkSettings(dataUrl)).toEqual({
            angle: -45,
            color: 'rgba(12, 34, 56, 0.5)',
            text: 'Acme & Co <Beta>',
        });
        const migrated = normalizeWatermark(null, dataUrl);
        expect(migrated.enabled).toBe(true);
        expect(migrated.text).toBe('Acme & Co <Beta>');
        expect(migrated.color).toBe('rgba(12, 34, 56, 0.5)');
        expect(migrated.angle).toBe(-45);
    });

    it('excludes hidden layers from interactive selection, group expansion, and fallback active selection', () => {
        const runtime = createScreenHelloRuntime();
        try {
            const first = runtime.imageStore.add({
                src: TINY_PNG,
                width: 200,
                height: 120,
                name: 'visible.png',
                type: 'image/png',
            }, { select: true, commit: false });
            const second = runtime.imageStore.add({
                src: TINY_PNG,
                width: 200,
                height: 120,
                name: 'hidden.png',
                type: 'image/png',
            }, { select: false, commit: false });
            runtime.imageStore.select([first.id, second.id]);
            runtime.imageStore.groupSelected();
            runtime.imageStore.toggleLayerVisibility(second.id);

            // Selecting hidden layer directly is ignored; selecting visible grouped sibling does not pull hidden layer in.
            runtime.imageStore.select([second.id]);
            expect(runtime.imageStore.selectedIds).toEqual([]);
            runtime.imageStore.select([first.id]);
            expect(runtime.imageStore.selectedIds).toEqual([first.id]);
            expect(runtime.imageStore.activeId).toBe(first.id);
        } finally {
            runtime.dispose();
        }
    });

    it('never falls back to opaque JPEG when compressing a transparent watermark logo', async () => {
        const originalCreateImageBitmap = globalThis.createImageBitmap;
        globalThis.createImageBitmap = vi.fn(async () => ({ width: 256, height: 256, close: vi.fn() }));
        try {
            const oversized = `data:image/png;base64,${'A'.repeat(WATERMARK_IMAGE_MAX_BYTES + 64)}`;
            const triedMimes = [];
            const makeDoc = (alphaValue) => ({
                createElement: () => ({
                    width: 0,
                    height: 0,
                    getContext: () => ({
                        clearRect: vi.fn(),
                        drawImage: vi.fn(),
                        getImageData: () => ({ data: new Uint8ClampedArray([255, 0, 0, alphaValue]) }),
                    }),
                    toDataURL: (mime) => {
                        triedMimes.push(mime);
                        if (mime === 'image/jpeg') return 'data:image/jpeg;base64,AAAA';
                        return oversized;
                    },
                }),
            });

            await expect(compressWatermarkImageFile({}, { documentRef: makeDoc(128) }))
                .rejects.toMatchObject({ code: 'watermark-image-too-large' });
            expect(triedMimes).not.toContain('image/jpeg');

            triedMimes.length = 0;
            const opaque = await compressWatermarkImageFile({}, { documentRef: makeDoc(255) });
            expect(opaque.dataUrl).toBe('data:image/jpeg;base64,AAAA');
            expect(triedMimes).toContain('image/jpeg');
        } finally {
            globalThis.createImageBitmap = originalCreateImageBitmap;
        }
    });
});
