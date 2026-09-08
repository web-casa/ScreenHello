import { exportError, waitWithSignal } from './exportAsync';

// Self-generated 2x1 red/transparent-blue sample, scalar @jsquash/avif 2.1.1:
// defaultOptions + quality/qualityAlpha=60, speed=8, subsample=3. No user image,
// network request or production WASM decoder is needed for this capability probe.
const AVIF_PREVIEW_SAMPLE = 'AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUEAAAGNbWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAsaWxvYwAAAABEAAACAAEAAAABAAAB0gAAADEAAgAAAAEAAAG1AAAAHQAAAEJpaW5mAAAAAAACAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAAAaaW5mZQIAAAAAAgAAYXYwMUFscGhhAAAAABppcmVmAAAAAAAAAA5hdXhsAAIAAQABAAAAw2lwcnAAAACdaXBjbwAAABRpc3BlAAAAAAAAAAIAAAABAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgSAAAAAAABNjb2xybmNseAACAAIABoAAAAAOcGl4aQAAAAABCAAAAAxhdjFDgQAcAAAAADhhdXhDAAAAAHVybjptcGVnOm1wZWdCOmNpY3A6c3lzdGVtczphdXhpbGlhcnk6YWxwaGEAAAAAHmlwbWEAAAAAAAAAAgABBAECgwQAAgQBBYYHAAAAVm1kYXQSAAoEGAAmFTITFkAYYUAKh7ET1AXj/FGAwgrDnhIACgc4ACYQICBpMiQWQAYYYYQAQcG9p8xt2t3O0+tQB36WbMhfA0MePkqko34TtbA=';

export async function canPreviewAvif({ signal, timeoutMs = 3_000, ...adapters } = {}) {
    if (signal?.aborted) throw exportError('export-cancelled');
    const blob = new Blob([Uint8Array.from(atob(AVIF_PREVIEW_SAMPLE), character => character.charCodeAt(0))], { type: 'image/avif' });
    try {
        const lease = await loadExportPreview(blob, { ...adapters, width: 2, height: 1, signal, timeoutMs });
        lease.release();
        if (signal?.aborted) throw exportError('export-cancelled');
        return true;
    } catch (error) {
        if (signal?.aborted || error.code === 'export-cancelled') throw error;
        return false; // Failed/slow local display is not an encoding failure.
    }
}

// One decoded side at a time. Bitmaps have explicit graphics ownership; the
// HTMLImage fallback owns only display URLs, never download URLs.
export async function loadExportPreview(blob, { width, height, signal, timeoutMs = 10_000,
    createImage = () => new Image(), urls = URL, createBitmap = globalThis.createImageBitmap,
    createCanvas = () => document.createElement('canvas') } = {}) {
    if (typeof createBitmap === 'function') {
        const bitmap = await decodePreviewBitmap(blob, { width, height, signal, timeoutMs, createBitmap });
        let canvas;
        const release = () => {
            if (canvas) {
                canvas.width = canvas.height = 0;
                canvas.remove(); canvas = null;
            }
        };
        try {
            canvas = createCanvas(); canvas.width = width; canvas.height = height;
            // Prefer a CPU-backed, explicitly resettable preview surface. A
            // bitmaprenderer retained more graphics memory in the UI probe.
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) throw exportError('export-preview-unsupported');
            context.drawImage(bitmap, 0, 0);
            return { image: canvas, release };
        } catch (error) {
            release(); throw exportError('export-preview-unsupported', error);
        } finally { bitmap.close(); }
    }
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(exportError('export-preview-timeout')), timeoutMs);
    let image;
    let url;
    const release = () => {
        image?.removeAttribute('src');
        image?.remove();
        if (url) { urls.revokeObjectURL(url); url = null; }
    };
    try {
        if (controller.signal.aborted) throw exportError('export-cancelled');
        image = createImage();
        url = urls.createObjectURL(blob);
        image.src = url;
        await waitWithSignal(image.decode(), controller.signal);
        if (image.naturalWidth !== width || image.naturalHeight !== height) throw exportError('export-preview-invalid');
        return { image, release };
    } catch (error) {
        release();
        if (controller.signal.aborted) throw typeof controller.signal.reason?.code === 'string'
            ? controller.signal.reason : exportError('export-cancelled');
        throw exportError('export-preview-unsupported', error);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
}

async function decodePreviewBitmap(blob, { width, height, signal, timeoutMs = 10_000, createBitmap = globalThis.createImageBitmap }) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(exportError('export-preview-timeout')), timeoutMs);
    let bitmap;
    try {
        if (controller.signal.aborted) throw exportError('export-cancelled');
        const decoded = createBitmap.call(globalThis, blob).then(value => {
            // Take ownership before the promise continuation: an abort can
            // win between this callback and waitWithSignal's resolution.
            bitmap = value;
            if (controller.signal.aborted) { bitmap.close(); bitmap = null; throw exportError('export-cancelled'); }
            return value;
        });
        bitmap = await waitWithSignal(decoded, controller.signal);
        if (bitmap.width !== width || bitmap.height !== height) throw exportError('export-preview-invalid');
        return bitmap;
    } catch (error) {
        bitmap?.close();
        if (controller.signal.aborted) throw typeof controller.signal.reason?.code === 'string'
            ? controller.signal.reason : exportError('export-cancelled');
        throw exportError('export-preview-unsupported', error);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
}

export async function validateExportPreview(result, signal) {
    for (const blob of new Set([result.referenceBlob, result.blob])) {
        const options = { width: result.width, height: result.height, signal };
        if (typeof globalThis.createImageBitmap === 'function') {
            const bitmap = await decodePreviewBitmap(blob, options);
            bitmap.close();
        } else {
            const lease = await loadExportPreview(blob, options);
            lease.release();
        }
    }
}

export function formatExportBytes(bytes, locale) {
    if (bytes < 1024) return `${bytes} B`;
    const unit = bytes < 1024 * 1024 ? 'KiB' : 'MiB';
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(bytes / (unit === 'KiB' ? 1024 : 1024 * 1024))} ${unit}`;
}
