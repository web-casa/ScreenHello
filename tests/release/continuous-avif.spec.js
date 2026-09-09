import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { hashPaths, sha256, writeImmutableJson } from '../compression-product/memory-evidence.mjs';
import { installCancelObserver } from './cancel-observer.mjs';
import { CONTINUOUS_AVIF_SCOPE, CONTINUOUS_AVIF_COUNT, CONTINUOUS_AVIF_SIZE,
    CONTINUOUS_AVIF_MAX_BYTES, continuousAvifName, inspectContinuousAvif, validateContinuousAvifEvidence } from './continuous-avif-contract.mjs';

const fingerprints = () => ({ webSha256: hashPaths('dist', ['./']),
    sourceSha256: hashPaths('.', ['src/', 'public/', 'config/', 'index.html', 'package.json', 'pnpm-lock.yaml', 'vite.config.js']),
    runnerSha256: hashPaths('.', ['tests/release/', 'tests/fixtures/', 'tests/compression-product/']) });

test.describe.configure({ retries: 0 });
test('production PC standard AVIF six consecutive downloads preserve the editor', async ({ page, browser }, testInfo) => {
    const pc = await readFile(new URL('../../src/assets/demo-desktop.webp', import.meta.url));
    const evidence = { scope: CONTINUOUS_AVIF_SCOPE, status: 'running',
        registration: { ...fingerprints(), pcSha256: sha256(pc), registeredAt: new Date().toISOString(),
            count: CONTINUOUS_AVIF_COUNT, attemptsPerCase: 1, memoryMeasurement: false,
            mode: 'standard', ratio: 1, dimensions: CONTINUOUS_AVIF_SIZE },
        environment: { engine: testInfo.project.name, version: browser.version(), platform: process.platform, arch: process.arch },
        deliveryEvidence: 'playwright-download-stream', results: [], pageErrors: [], blockedRequests: [] };
    const trace = () => page.evaluate(() => window.__screenhelloCancelObserver);
    const layers = () => page.locator('.shoteasy-layer-copy').allTextContents();
    let downloads = 0;
    page.on('download', () => { downloads++; });
    page.on('pageerror', error => evidence.pageErrors.push(error.message));
    try {
        expect(testInfo.retry).toBe(0);
        expect(testInfo.repeatEachIndex).toBe(0);
        await testInfo.attach('continuous-registration', { body: Buffer.from(JSON.stringify(evidence.registration)), contentType: 'application/json' });
        await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin === new URL(testInfo.project.use.baseURL).origin || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
            evidence.blockedRequests.push(url.href);
            await route.abort('blockedbyclient');
        });
        await page.addInitScript(installCancelObserver);
        await page.goto('/');
        await page.bringToFront();
        await page.locator('.shoteasy-upload-card input[type=file]').setInputFiles({ name: 'pc-example.webp', mimeType: 'image/webp', buffer: pc });
        await expect(page.getByRole('button', { name: '导出图片', exact: true })).toBeEnabled();
        await page.locator('.shoteasy-inspector [title="无背景"]').click();
        evidence.layersBefore = await layers();
        await page.evaluate(() => { window.__screenhelloContinuousPage = true; });
        for (let index = 0; index < CONTINUOUS_AVIF_COUNT; index++) {
            await page.bringToFront();
            await page.getByRole('button', { name: '导出图片', exact: true }).click();
            await page.locator('.shoteasy-export-drawer .ant-segmented').first().getByText('AVIF', { exact: true }).click();
            await page.getByTestId('compression-standard').click();
            await page.locator('.shoteasy-export-drawer .ant-segmented').getByText('1x', { exact: true }).click();
            await expect(page.locator('.shoteasy-export-summary')).toContainText('2223 × 1667 px');
            await expect(page.getByTestId('compression-standard')).toHaveAttribute('aria-pressed', 'true');
            const foreground = await page.evaluate(() => ({ visibility: document.visibilityState, focused: document.hasFocus() }));
            expect(foreground).toEqual({ visibility: 'visible', focused: true });
            const started = performance.now();
            // Promise.all handles either rejection, avoiding an orphaned event waiter on click failure.
            const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.getByTestId('export-download').click()]);
            expect(await download.failure()).toBeNull();
            const chunks = [];
            let size = 0;
            for await (const chunk of await download.createReadStream()) {
                size += chunk.length;
                expect(size).toBeLessThanOrEqual(CONTINUOUS_AVIF_MAX_BYTES);
                chunks.push(chunk);
            }
            const bytes = Buffer.concat(chunks);
            const file = continuousAvifName(index);
            await writeFile(testInfo.outputPath(file), bytes, { flag: 'wx' });
            await testInfo.attach(file, { path: testInfo.outputPath(file), contentType: 'image/avif' });
            await expect(page.locator('.shoteasy-export-drawer')).toHaveCount(0);
            await expect(page.getByRole('button', { name: '导出图片', exact: true })).toBeEnabled();
            const result = { index, file, downloadName: download.suggestedFilename(), size,
                sha256: sha256(bytes), elapsedMs: performance.now() - started, foreground,
                samePage: await page.evaluate(() => window.__screenhelloContinuousPage === true), layers: await layers(), downloads };
            evidence.results.push(result);
            await testInfo.attach(`continuous-checkpoint-${index + 1}`, { body: Buffer.from(JSON.stringify({ result, trace: await trace() })), contentType: 'application/json' });
            expect(result.samePage).toBe(true);
            expect(result.layers).toEqual(evidence.layersBefore);
            expect(downloads).toBe(index + 1);
            const observed = await trace();
            expect(observed.jobs).toHaveLength(index + 1);
            expect(observed.jobs[index].completedAt).not.toBeNull();
            expect(observed.jobs[index].failed).toBe(false);
        }
        // Independent decoder runs after the consecutive workload, never between encodes.
        for (const result of evidence.results) Object.assign(result, await inspectContinuousAvif(await readFile(testInfo.outputPath(result.file))));
        const observed = await trace();
        Object.assign(evidence, { jobs: observed.jobs, overflow: observed.overflow, downloads,
            layersAfter: await layers(), finalFingerprints: fingerprints(),
            ...await page.evaluate(() => ({ samePage: window.__screenhelloContinuousPage === true,
                productionEditor: !!document.querySelector('.shoteasy-editor-canvas') && typeof window.__shoteasyStores === 'undefined' })) });
        evidence.status = 'passed';
        validateContinuousAvifEvidence(evidence);
    } catch (error) {
        evidence.status = 'failed'; evidence.error = String(error.stack || error);
        throw error;
    } finally {
        try { evidence.finalTrace = await trace(); } catch (error) { evidence.traceError = String(error); }
        await writeImmutableJson(testInfo.outputPath('continuous-evidence.json'), evidence);
        await testInfo.attach('continuous-avif-evidence', { body: Buffer.from(JSON.stringify(evidence, null, 2)), contentType: 'application/json' });
    }
});
