import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeBitmapPixels, createReadbackBitmap } from '../compression-product/bitmap-pixels.mjs';

class Bitmap {
    width = 2;
    height = 1;
    close = vi.fn(() => { this.width = 0; this.height = 0; });
}
let canvas, context;
beforeEach(() => {
    vi.stubGlobal('ImageBitmap', Bitmap);
    vi.stubGlobal('OffscreenCanvasRenderingContext2D', class {});
    context = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(8) })) };
    vi.stubGlobal('OffscreenCanvas', class {
        constructor(width, height) { this.width = width; this.height = height; canvas = this; }
        getContext = vi.fn(() => context);
    });
});
afterEach(() => vi.unstubAllGlobals());

describe('owned bitmap pixel readback', () => {
    it('releases the bitmap and scratch canvas while returning independent pixels', () => {
        const bitmap = new Bitmap();
        expect(consumeBitmapPixels(bitmap, 2, 1)).toHaveLength(8);
        expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
        expect(canvas.getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true, colorSpace: 'srgb', alpha: true });
        expect(bitmap.close).toHaveBeenCalledOnce();
        expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
    });
    it('preserves readback errors and closes both owned graphics resources', () => {
        context.getImageData.mockImplementation(() => { throw new Error('readback-failed'); });
        const bitmap = new Bitmap();
        expect(() => consumeBitmapPixels(bitmap, 2, 1)).toThrow('readback-failed');
        expect(bitmap.close).toHaveBeenCalledOnce();
        expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
    });
    it('rejects invalid or oversized geometry before creating a canvas, including non-bitmaps', () => {
        const bitmap = new Bitmap();
        expect(() => consumeBitmapPixels(bitmap, 8193, 1)).toThrow('avif-input-invalid');
        expect(bitmap.close).toHaveBeenCalledOnce();
        expect(context.drawImage).not.toHaveBeenCalled();
        expect(() => consumeBitmapPixels(null, 2, 1)).toThrow('avif-input-invalid');
    });
    it('reports missing worker capabilities with deterministic cleanup', () => {
        const bitmap = new Bitmap();
        vi.stubGlobal('OffscreenCanvas', undefined);
        expect(() => consumeBitmapPixels(bitmap, 2, 1)).toThrow('avif-bitmap-readback-unavailable');
        expect(bitmap.close).toHaveBeenCalledOnce();
        vi.stubGlobal('ImageBitmap', undefined);
        expect(() => consumeBitmapPixels(null, 2, 1)).toThrow('avif-input-invalid');
    });
    it('closes graphic resources when the 2D context cannot be created', () => {
        const bitmap = new Bitmap();
        context = null;
        expect(() => consumeBitmapPixels(bitmap, 2, 1)).toThrow('avif-bitmap-readback-unavailable');
        expect(bitmap.close).toHaveBeenCalledOnce();
        expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
    });
    it.each([{ alpha: false, colorSpace: 'srgb' }, { alpha: true, colorSpace: 'display-p3' }, undefined])(
        'keeps unverified source contexts on the original readback path: %j', async attributes => {
            const create = vi.fn(); vi.stubGlobal('createImageBitmap', create);
            expect(await createReadbackBitmap({ getContext: () => ({ getContextAttributes: () => attributes }) })).toBeNull();
            expect(create).not.toHaveBeenCalled();
        }
    );
    it('falls back on missing API or rejected bitmap creation without consuming the canvas', async () => {
        const source = { getContext: () => ({ getContextAttributes: () => ({ alpha: true, colorSpace: 'srgb' }) }) };
        vi.stubGlobal('createImageBitmap', undefined);
        expect(await createReadbackBitmap(source)).toBeNull();
        vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported')));
        expect(await createReadbackBitmap(source)).toBeNull();
        const bitmap = new Bitmap(); vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
        expect(await createReadbackBitmap(source)).toBe(bitmap);
        expect(bitmap.close).not.toHaveBeenCalled();
    });
});
