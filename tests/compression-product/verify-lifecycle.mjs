import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit, expect as playwrightExpect } from '@playwright/test';
import { PNG } from 'pngjs';
import { unzipSync } from 'fflate';
import { startProbeServer } from '../spikes/compression/server.mjs';
import { processTreeRssMiB } from '../spikes/compression/rss.mjs';
import { MAX_COMPRESSED_PIXELS } from '../../src/utils/exportSettings.js';

const expect = playwrightExpect.configure({ timeout: 45_000 });
const width = MAX_COMPRESSED_PIXELS / 1024, height = 1024;
const png = new PNG({ width, height });
let seed = 123456;
for (let i = 0; i < png.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    png.data.set([seed & 255, seed >>> 8 & 255, seed >>> 16 & 255, 255], i);
}
const buffer = PNG.sync.write(png);
const origin = await startProbeServer(fileURLToPath(new URL('../../artifacts/compression-product/', import.meta.url)));
const reports = [];
try {
    for (const [engine, launcher] of Object.entries({ chromium, firefox, webkit })) {
        const server = await launcher.launchServer({ host: '127.0.0.1' });
        const browser = await launcher.connect(server.wsEndpoint());
        let sampler;
        try {
            const page = await browser.newPage();
            await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
            const errors = []; page.on('pageerror', error => errors.push(error.message));
            await page.goto(origin.url, { waitUntil: 'networkidle' });
            await page.getByTestId('locale-first').locator('.shoteasy-upload-card input[type=file]').setInputFiles({ name: 'noise.png', mimeType: 'image/png', buffer });
            await page.waitForFunction(() => window.__compressionProduct.runtimes.first?.editor.app?.tree);
            await page.evaluate(async ({ width, height }) => {
                const root = window.__compressionProduct.runtimes.first;
                root.option.setSize({ type: 'fixed', width, height }); root.option.setPadding(0);
                root.option.setBackground('none'); root.option.setShadowConf({ visible: false });
                await new Promise(resolve => requestAnimationFrame(resolve));
                await root.renderTaskTracker.waitForIdle();
                window.__lifecycle = { ownedUrls: new Set(), cycles: [] };
                const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
                URL.createObjectURL = blob => { const url = create(blob); window.__lifecycle.ownedUrls.add(url); return url; };
                URL.revokeObjectURL = url => { window.__lifecycle.ownedUrls.delete(url); revoke(url); };
            }, { width, height });
            // Abort only AFTER the actual codec worker is actively processing.
            for (let index = 0; index < 6; index++) {
                await page.evaluate(() => {
                    const service = window.__compressionProduct.runtimes.first.exportService;
                    const controller = new AbortController(); window.__lifecycle.controller = controller;
                    window.__lifecycle.pending = service.prepareImage({ format: 'png', ratio: 1, compression: 'lossless', verifyPreview: true, signal: controller.signal })
                        .then(() => 'unexpected success', error => error.code);
                });
                await page.waitForFunction(() => Boolean(window.__compressionProduct.runtimes.first.exportService._pngEncoder?.cancel));
                const retried = await page.evaluate(async () => {
                    const service = window.__compressionProduct.runtimes.first.exportService;
                    window.__lifecycle.controller.abort();
                    const cancelled = await window.__lifecycle.pending;
                    const workerTerminated = !service._pngEncoder.worker;
                    const prepared = await service.prepareImage({ format: 'png', ratio: 1, compression: 'lossless', verifyPreview: true });
                    const size = [prepared.result.width, prepared.result.height];
                    service.discardPrepared();
                    return { cancelled, workerTerminated, size };
                });
                assert.deepEqual(retried, { cancelled: 'export-cancelled', workerTerminated: true, size: [width, height] });
            }
            await expect.poll(() => page.evaluate(() => Boolean(window.__compressionProduct.runtimes.first.exportService._pngEncoder?.worker))).toBe(false);
            const baseline = processTreeRssMiB(server.process().pid), timeline = [];
            sampler = setInterval(() => timeline.push(processTreeRssMiB(server.process().pid)), 50);
            const batch = await page.evaluate(async () => {
                const root = window.__compressionProduct.runtimes.first;
                root.workspace.setExportSettings({ format: 'png', ratio: 1, compression: 'lossless' }, { replace: true });
                const blob = root.imageStore.resolve(root.imageStore.list[0]).blob;
                root.batch.selectFiles(Array.from({ length: 12 }, (_, index) => new File([blob], `noise-${index}.png`, { type: 'image/png' })));
                const success = await root.batch.start();
                return { success, summary: { successCount: root.batch.summary?.successCount, outputBytes: root.batch.summary?.outputBytes,
                    archiveBytes: root.batch.archive?.size } };
            });
            assert.ok(batch.success); assert.equal(batch.summary.successCount, 12);
            const downloading = page.waitForEvent('download');
            assert.ok(await page.evaluate(() => window.__compressionProduct.runtimes.first.batch.download()));
            const downloaded = await downloading;
            assert.equal(await downloaded.failure(), null);
            clearInterval(sampler); sampler = null;
            // Stream the actual download. Serializing a ZIP as a JS number array
            // adds artificial allocations to the browser being measured.
            const chunks = []; for await (const chunk of await downloaded.createReadStream()) chunks.push(chunk);
            const bytes = Buffer.concat(chunks);
            assert.equal(bytes.length, batch.summary.archiveBytes);
            const entries = Object.values(unzipSync(bytes));
            assert.equal(entries.length, 12); assert.equal(entries.reduce((sum, bytes) => sum + bytes.length, 0), batch.summary.outputBytes);
            for (const entry of entries) {
                const image = PNG.sync.read(Buffer.from(entry)); assert.equal(image.width, width); assert.equal(image.height, height);
            }
            await expect.poll(() => page.evaluate(() => window.__lifecycle.ownedUrls.size)).toBe(0);
            const cleanup = await page.evaluate(() => {
                const root = window.__compressionProduct.runtimes.first;
                root.batch.clear();
                return { urls: window.__lifecycle.ownedUrls.size, leases: root.exportService._canvasLeases.size,
                    contexts: root.exportService._contexts.size, prepared: Boolean(root.exportService._prepared), busy: root.batch.isBusy,
                    hiddenScenes: [...document.querySelectorAll('body > div[aria-hidden="true"]')].filter(element => element.style.left === '-100000px').length };
            });
            assert.deepEqual(cleanup, { urls: 0, leases: 0, contexts: 0, prepared: false, busy: false, hiddenScenes: 0 });
            assert.deepEqual(errors, []);
            const peak = Math.max(baseline, ...timeline);
            const report = { engine, version: browser.version(), width, height, cancelRetryCycles: 6, batchFiles: 12,
                summary: batch.summary, cleanup, approximateBatchRss: { baseline, peak, delta: Math.round((peak - baseline) * 10) / 10, timeline },
                note: '12 sequential outputs retained for ZIP; measured separately from the single-preview review line.' };
            reports.push(report); console.log(JSON.stringify({ engine, cancelRetryCycles: 6, batchFiles: 12, deltaRssMiB: report.approximateBatchRss.delta, cleanup }));
        } finally { clearInterval(sampler); await browser.close(); await server.close(); }
    }
} finally { await origin.close(); }
const evidenceDirectory = new URL('../../artifacts/compression-product-evidence/', import.meta.url);
await mkdir(evidenceDirectory, { recursive: true });
await writeFile(new URL('lifecycle.json', evidenceDirectory), JSON.stringify(reports, null, 2));
