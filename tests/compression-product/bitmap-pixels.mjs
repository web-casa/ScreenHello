// Diagnostic only: the product experiment failed its RSS gate and was reverted.
// Worker readback: consume a transferred snapshot, never the editor's
// Canvas. Both graphic resources are released even if reading pixels fails.
export function consumeBitmapPixels(bitmap, width, height) {
    let canvas;
    try {
        if (typeof ImageBitmap !== 'function' || !(bitmap instanceof ImageBitmap) || bitmap.width !== width || bitmap.height !== height
            || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
            || width > 8192 || height > 8192 || width * height > 4_194_304) throw new Error('avif-input-invalid');
        if (typeof OffscreenCanvas !== 'function') throw new Error('avif-bitmap-readback-unavailable');
        canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb', alpha: true });
        if (!context) throw new Error('avif-bitmap-readback-unavailable');
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, width, height).data;
    } finally {
        if (typeof ImageBitmap === 'function' && bitmap instanceof ImageBitmap) bitmap.close();
        if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
}

export async function createReadbackBitmap(canvas) {
    // Opaque canvas bitmap roundtrips differ in Chromium. Preserve the original
    // readback for those hosts, wide gamut, and unverified/missing capabilities.
    if (typeof createImageBitmap !== 'function' || typeof ImageBitmap !== 'function'
        || typeof OffscreenCanvasRenderingContext2D !== 'function') return null;
    const attributes = canvas.getContext('2d')?.getContextAttributes?.();
    if (attributes?.alpha !== true || attributes.colorSpace !== 'srgb') return null;
    try { return await createImageBitmap(canvas); }
    catch { return null; } // Snapshot unavailable: retain the owned source for RGBA fallback.
}
