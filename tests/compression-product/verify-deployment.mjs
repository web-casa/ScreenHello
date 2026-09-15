import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit, expect as playwrightExpect } from '@playwright/test';
import { createPngFixture } from '../fixtures/createPngFixture.js';
import { startProbeServer } from '../spikes/compression/server.mjs';
import { normalizeWebBase } from '../../config/pwaConfig.js';

const expect = playwrightExpect.configure({ timeout: 45_000 });
const base = normalizeWebBase(process.env.SCREENHELLO_BASE_PATH || '/screenhello/');
const build = process.env.SCREENHELLO_PWA_OUT_DIR || fileURLToPath(new URL('../../artifacts/compression-subpath/', import.meta.url));
const label = process.env.SCREENHELLO_COMPRESSION_LABEL || 'current';
assert.ok(/^[a-z0-9-]{1,40}$/.test(label), 'invalid report label');
const reports = [];
const selected = process.env.SCREENHELLO_COMPRESSION_ENGINE;
if (selected) assert.ok(['chromium', 'firefox', 'webkit'].includes(selected));
const evidenceDirectory = new URL('../../artifacts/compression-product-evidence/', import.meta.url);
await mkdir(evidenceDirectory, { recursive: true });
const report = new URL(`deployment-${label}${selected ? `-${selected}` : ''}.json`, evidenceDirectory);
await writeFile(report, '[]\n', { flag: 'wx' });
const origin = await startProbeServer(build, { base });
async function importImage(page) {
    const input = page.locator('.shoteasy-upload-card input[type=file]');
    const button = page.locator('[aria-label="导出图片"]:not([disabled])');
    await expect(input.or(button)).toBeAttached();
    if (await input.count()) {
        try {
            await input.setInputFiles({ name: 'deployment.png', mimeType: 'image/png', buffer: createPngFixture(64, 48) }, { timeout: 3_000 });
        } catch (error) {
            // Restoring the already-imported draft may replace the initial
            // picker during hydration. Only accept the actual ready editor.
            if (await input.count() || !await button.isVisible()) throw error;
        }
    }
    await expect(button).toBeVisible();
}
async function preview(page, format = 'PNG', mode = 'lossless') {
    await page.getByRole('button', { name: '导出图片', exact: true }).click();
    const drawer = page.locator('.shoteasy-export-drawer');
    await drawer.getByText(format, { exact: true }).first().click();
    await page.getByTestId(`compression-${mode}`).click();
    await page.getByTestId('export-preview').click();
    await expect(page.getByTestId('preview-viewport').locator('canvas')).toBeVisible();
    await expect(page.getByTestId('export-download')).toBeEnabled();
    const download = page.waitForEvent('download');
    await page.getByTestId('export-download').click();
    const saved = await download;
    assert.ok(saved.suggestedFilename().endsWith(format === 'PNG' ? '.png' : '.webp'));
    assert.equal(await saved.failure(), null);
}
try {
    for (const [engine, launcher] of Object.entries({ chromium, firefox, webkit })) {
        if (selected && selected !== engine) continue;
        origin.setOffline(false);
        const browser = await launcher.launch();
        const diagnostics = [];
        let failureDetails = null;
        try {
            const context = await browser.newContext({ locale: 'zh-CN', serviceWorkers: 'allow' });
            const page = await context.newPage();
            page.setDefaultTimeout(45_000);
            const errors = [], outside = [];
            page.on('console', message => { if (['warning', 'error'].includes(message.type())) diagnostics.push(message.text()); });
            page.on('requestfailed', request => diagnostics.push({ url: request.url(), failure: request.failure() }));
            page.on('pageerror', error => errors.push(error.message));
            page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(origin.url)) outside.push(request.url()); });
            await page.addInitScript(() => {
                window.showSaveFilePicker = undefined;
                window.__cspFailures = [];
                document.addEventListener('securitypolicyviolation', event => window.__cspFailures.push(event.violatedDirective));
                window.addEventListener('vite:preloadError', event => console.warn('compression-preload-failure', event.payload?.message || String(event.payload)));
            });
            await page.goto(origin.url);
            await expect(page.getByText('离线已就绪', { exact: true })).toBeVisible();
            await page.reload();
            await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
            await importImage(page);
            const initialCache = await page.evaluate(async () => (await (await caches.open('screenhello-runtime-assets-v1')).keys()).map(request => request.url));
            assert.ok(!initialCache.some(url => /pngEncoder|oxipng/.test(url)));
            // A genuinely unavailable origin, not only context.setOffline().
            const refusedBefore = origin.refused;
            origin.setOffline(true);
            await page.getByRole('button', { name: '导出图片', exact: true }).click();
            await page.getByTestId('compression-lossless').click();
            await page.getByTestId('export-preview').click();
            await expect(page.getByRole('alert')).toBeVisible();
            await expect(page.getByTestId('export-download')).toBeEnabled();
            await page.getByTestId('export-cancel').click();
            origin.setOffline(false);
            // Recovery after a missing lazy chunk needs a new module realm.
            await page.reload(); await importImage(page);
            for (const [format, mode] of [['PNG', 'lossless'], ['PNG', 'lossy'], ['WEBP', 'lossless']]) {
                try { await preview(page, format, mode); }
                catch (error) {
                    failureDetails = { engine, format, mode, stage: 'online-recovery',
                        serviceWorker: await page.evaluate(() => ({ controller: navigator.serviceWorker.controller?.state })),
                        alerts: await page.getByRole('alert').allTextContents(),
                    };
                    console.log(JSON.stringify({ ...failureDetails, diagnostics })); throw error;
                }
            }
            await expect.poll(() => page.evaluate(async () => (await (await caches.open('screenhello-runtime-assets-v1')).keys()).filter(request => /(?:webp_enc|squoosh_oxipng_bg)-.*\.wasm$/.test(request.url)).length)).toBe(2);
            origin.setOffline(true);
            await page.reload(); await importImage(page);
            for (const [format, mode] of [['PNG', 'lossless'], ['PNG', 'lossy'], ['WEBP', 'lossless']]) await preview(page, format, mode);
            const csp = await page.evaluate(() => window.__cspFailures);
            assert.deepEqual(csp, []); assert.deepEqual(errors, []); assert.deepEqual(outside, []);
            reports.push({ engine, version: browser.version(), base, build, strictCsp: true,
                uncachedFailureVisible: true, originRefusedRequests: origin.refused - refusedBefore,
                coldOfflineReloadModes: ['png-lossless', 'png-lossy', 'webp-lossless'], outsideRequests: 0, pageErrors: 0 });
            await writeFile(report, JSON.stringify(reports, null, 2));
            console.log(`${engine}: production ${base} + strict CSP + unavailable-origin cold/warm codec recovery passed`);
        } catch (error) {
            await writeFile(new URL(`${report.href}.failure.json`), JSON.stringify({ engine, base, build, error: error.stack, diagnostics, failureDetails }, null, 2), { flag: 'wx' });
            throw error;
        } finally { origin.setOffline(false); await browser.close(); }
    }
} finally { await origin.close(); }
