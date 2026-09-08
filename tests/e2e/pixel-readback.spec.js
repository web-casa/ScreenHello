import { expect, test } from '@playwright/test';

test('diagnostic bitmap candidate and its fallback preserve RGBA and AVIF bytes (not a product gate)', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    const results = await page.evaluate(async () => {
        const { AvifEncoder } = await import('/src/utils/avifEncoder.js');
        const { createReadbackBitmap } = await import('/tests/compression-product/bitmap-pixels.mjs');
        const results = [];
        for (const colorSpace of ['srgb', 'display-p3']) {
            for (const alpha of [true, false]) {
                const canvas = document.createElement('canvas');
                canvas.width = 513; canvas.height = 257;
                const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace, alpha });
                const attributes = context.getContextAttributes();
                const data = context.createImageData(canvas.width, canvas.height);
                let state = 12345;
                for (let i = 0; i < data.data.length; i++) {
                    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
                    data.data[i] = state >>> 24;
                }
                context.putImageData(data, 0, 0);
                context.fillStyle = 'color(display-p3 1 0.15 0.05 / 0.3)';
                context.fillRect(20, 20, 150, 150);
                context.font = '23px sans-serif'; context.fillStyle = '#18acee80';
                context.fillText('ScreenHello 半透明', 10, 48);
                const original = context.getImageData(0, 0, canvas.width, canvas.height).data;
                const bitmap = await createReadbackBitmap(canvas);
                const worker = new Worker('/tests/fixtures/pixel-readback.worker.js', { type: 'module' });
                const encoder = new AvifEncoder();
                try {
                    const actual = bitmap ? await new Promise((resolve, reject) => {
                        const timer = setTimeout(() => reject(new Error('readback-timeout')), 20_000);
                        worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
                        worker.onmessage = ({ data }) => { clearTimeout(timer); resolve(data); };
                        try { worker.postMessage({ bitmap, width: canvas.width, height: canvas.height }, [bitmap]); }
                        catch (error) { clearTimeout(timer); reject(error); }
                    }) : { pixels: context.getImageData(0, 0, canvas.width, canvas.height).data, closed: true };
                    if (actual.error) throw new Error(actual.error);
                    let mismatches = 0;
                    for (let i = 0; i < original.length; i++) if (original[i] !== actual.pixels[i]) mismatches++;
                    const options = { width: canvas.width, height: canvas.height, compression: 'lossy', quality: 60 };
                    const first = new Uint8Array(await (await encoder.encode({ ...options, pixels: original })).arrayBuffer());
                    const second = new Uint8Array(await (await encoder.encode({ ...options, pixels: actual.pixels })).arrayBuffer());
                    results.push({ colorSpace, actualColorSpace: attributes.colorSpace, alpha, mismatches,
                        optimized: !!bitmap, expectedOptimized: attributes.alpha === true && attributes.colorSpace === 'srgb',
                        closed: actual.closed, detached: !bitmap || bitmap.width === 0,
                        encodedEqual: first.length === second.length && first.every((byte, i) => byte === second[i]) });
                } finally { bitmap?.close(); worker.terminate(); encoder.dispose(); canvas.width = 0; canvas.height = 0; }
            }
        }
        return results;
    });
    expect(results).toHaveLength(4);
    for (const result of results) expect(result, JSON.stringify(result)).toMatchObject({ mismatches: 0, closed: true, detached: true, encodedEqual: true, optimized: result.expectedOptimized });
});

test('diagnostic WebCodecs probe records pixel compatibility, not product acceptance', async ({ page }, testInfo) => {
    await page.goto('/');
    const results = await page.evaluate(async () => {
        if (typeof VideoFrame !== 'function') return { available: false, reason: 'VideoFrame unavailable' };
        const cases = [];
        for (const alpha of [true, false]) {
            const canvas = document.createElement('canvas');
            canvas.width = 513; canvas.height = 257;
            const context = canvas.getContext('2d', { willReadFrequently: true, alpha });
            const data = context.createImageData(canvas.width, canvas.height);
            let state = 12345;
            for (let i = 0; i < data.data.length; i++) {
                state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
                data.data[i] = state >>> 24;
            }
            context.putImageData(data, 0, 0);
            const original = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let frame;
            try {
                frame = new VideoFrame(canvas, { timestamp: 0, alpha: 'keep' });
                const pixels = new Uint8ClampedArray(original.length);
                const layout = await frame.copyTo(pixels, { format: 'RGBA', colorSpace: 'srgb', layout: [{ offset: 0, stride: canvas.width * 4 }] });
                let mismatches = 0;
                for (let i = 0; i < original.length; i++) if (original[i] !== pixels[i]) mismatches++;
                cases.push({ alpha, sourceFormat: frame.format, channels: original.length, layout, mismatches, pixelCompatible: mismatches === 0 });
            } catch (error) {
                cases.push({ alpha, error: error.message, pixelCompatible: false });
            } finally { frame?.close(); canvas.width = 0; canvas.height = 0; }
        }
        return { available: true, cases };
    });
    await testInfo.attach('webcodecs-readback-diagnostic', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
    // Success means observations were collected, not that this route is safe.
    if (results.available) {
        expect(results.cases).toHaveLength(2);
        for (const entry of results.cases) {
            expect(typeof entry.pixelCompatible).toBe('boolean');
            if (!entry.error) {
                expect(entry.mismatches).toBeGreaterThanOrEqual(0);
                expect(entry.mismatches).toBeLessThanOrEqual(entry.channels);
            }
        }
    } else expect(results.reason).toBe('VideoFrame unavailable');
});
