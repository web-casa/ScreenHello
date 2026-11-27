import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { chromium, firefox, webkit } from '@playwright/test';
import { createPngFixture } from '../../fixtures/createPngFixture.js';

const url = process.env.SCREENHELLO_COMPRESSION_URL || 'http://127.0.0.1:4196/';
const directory = new URL('../../../artifacts/compression-evidence/', import.meta.url);
await mkdir(directory, { recursive: true });
const output = [];
for (const [name, launcher] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await launcher.launch();
    try {
        const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
        await page.goto(url);
        await page.evaluate(() => globalThis.__compressionProbe.mountScene());
        await page.evaluate(() => document.querySelectorAll('.shoteasy-app').forEach(el => { el.style.height = '500px'; }));
        const first = page.getByTestId('locale-first');
        await first.locator('.shoteasy-upload-card input[type=file]').setInputFiles({
            name: 'C0.png', mimeType: 'image/png', buffer: createPngFixture(128, 96),
        });
        await page.waitForFunction(() => globalThis.__compressionScene.runtimes.first.editor.app?.tree);
        await first.getByTestId('add-image-input').setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: createPngFixture(64, 64) });
        const result = await page.evaluate(async () => {
            const { first: runtime, second } = globalThis.__compressionScene.runtimes;
            const secondBefore = JSON.stringify(second.editor.serializeProject());
            runtime.option.setHdrEnabled(true);
            const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
            const ready = async () => {
                let timer;
                const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('fixture-render-timeout')), 10_000); });
                try {
                    await Promise.race([timeout, (async () => {
                        await nextFrame(); await runtime.renderTaskTracker.waitForIdle(); await nextFrame();
                        await runtime.renderTaskTracker.waitForIdle(); await nextFrame();
                        await new Promise(resolve => runtime.editor.app.tree.waitViewCompleted(resolve));
                    })()]);
                } finally { clearTimeout(timer); }
            };
            await ready();
            const beforeShape = await runtime.exportService.exportImage({ format: 'png', ratio: 1 });
            runtime.editor.addShape({ id: 'c0-visible-annotation', type: 'SquareFill', x: 24, y: 24, width: 55, height: 35, fill: '#ff1245', zIndex: 10 });
            await ready();
            const docBefore = JSON.stringify(runtime.editor.serializeProject());
            const lease = await runtime.exportService.exportCanvas({ ratio: 1 });
            let baseline;
            try {
                baseline = await new Promise((resolve, reject) => lease.canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('snapshot-encode-failed')), 'image/png'));
            } finally { lease.release(); }
            const blobData = blob => new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
            const optimised = await globalThis.__compressionProbe.optimiseRawFixture([...new Uint8Array(await baseline.arrayBuffer())], lease.width, lease.height);
            const same = JSON.stringify(runtime.editor.serializeProject()) === docBefore && JSON.stringify(second.editor.serializeProject()) === secondBefore;
            const result = { images: runtime.imageStore.list.length, shapes: runtime.editor.shapes.size, hdr: runtime.option.hdrEnabled,
                canvasLeases: runtime.exportService._canvasLeases.size, unchangedDocuments: same,
                baseline: await blobData(baseline), beforeShape: await blobData(beforeShape.blob), optimised };
            globalThis.__compressionScene.unmount();
            return result;
        });
        const fromUrl = value => Buffer.from(value.split(',')[1], 'base64');
        const before = PNG.sync.read(fromUrl(result.beforeShape));
        const baseline = PNG.sync.read(fromUrl(result.baseline));
        const optimised = PNG.sync.read(fromUrl(result.optimised));
        assert.equal(result.images, 2); assert.equal(result.shapes, 1); assert.equal(result.hdr, true);
        assert.equal(result.canvasLeases, 0); assert.equal(result.unchangedDocuments, true);
        assert.notDeepEqual(before.data, baseline.data, 'annotation must change the captured output');
        assert.deepEqual(baseline.data, optimised.data, 'complete captured tree changed under lossless optimization');
        await writeFile(new URL(`${name}-complete-scene.png`, directory), fromUrl(result.optimised));
        output.push({ name, images: result.images, shapes: result.shapes, hdr: result.hdr, canvasLeases: 0,
            unchangedDocuments: true, pixelExact: true, width: baseline.width, height: baseline.height });
        console.log(`${name}: complete two-image + annotation + HDR snapshot / ownership passed`);
    } finally { await browser.close(); }
}
await writeFile(new URL('scene.json', directory), JSON.stringify(output, null, 2));
