import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createPngFixture } from '../fixtures/createPngFixture.js';
import { hashPaths, sha256 } from '../compression-product/memory-evidence.mjs';
import { installCancelObserver } from './cancel-observer.mjs';
import { BATCH_RECOVERY_SCOPE, inspectBatchRecoveryZip, validateBatchRecoveryEvidence } from './batch-recovery-contract.mjs';

test.describe.configure({ retries: 0 });

async function downloadBytes(download, maxBytes) {
    expect(await download.failure()).toBeNull();
    const chunks = [];
    let size = 0;
    for await (const chunk of await download.createReadStream()) {
        size += chunk.length;
        expect(size).toBeLessThanOrEqual(maxBytes);
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

for (const mode of ['all', 'current']) test(`production batch AVIF cancel ${mode} and recover without reloading`, async ({ page, browser }, testInfo) => {
    const small = createPngFixture(64, 48);
    const pc = await readFile(new URL('../../src/assets/demo-desktop.webp', import.meta.url));
    const evidence = { scope: BATCH_RECOVERY_SCOPE, mode, status: 'running',
        registration: { mode, attemptsPerCase: 1, memoryMeasurement: false, registeredAt: new Date().toISOString(),
            webSha256: hashPaths('dist', ['./']), runnerSha256: hashPaths('.', ['tests/release/', 'tests/fixtures/']),
            pcSha256: sha256(pc), smallSha256: sha256(small) },
        environment: { engine: testInfo.project.name, version: browser.version(), platform: process.platform, arch: process.arch },
        pageErrors: [], blockedRequests: [] };
    const downloads = [];
    page.on('download', download => downloads.push(download));
    page.on('pageerror', error => evidence.pageErrors.push(error.message));
    const smallFile = name => ({ name, mimeType: 'image/png', buffer: small });
    const trace = () => page.evaluate(() => window.__screenhelloCancelObserver);
    const layers = () => page.locator('.shoteasy-layer-copy').allTextContents();
    const drawer = page.locator('.shoteasy-batch-drawer');
    const statuses = () => drawer.locator('.shoteasy-batch-jobs .ant-tag').allTextContents();
    try {
        expect(testInfo.retry).toBe(0);
        expect(testInfo.repeatEachIndex).toBe(0);
        // Persist scope before driving the page; a failed run must retain its registration.
        await testInfo.attach('batch-registration', { body: Buffer.from(JSON.stringify(evidence.registration)), contentType: 'application/json' });
        await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin === new URL(testInfo.project.use.baseURL).origin || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
            evidence.blockedRequests.push(url.href);
            await route.abort('blockedbyclient');
        });
        await page.addInitScript(installCancelObserver, {
            cancelSelector: '.shoteasy-batch-drawer button', cancelText: mode === 'all' ? '取消全部' : '取消当前',
        });
        await page.goto('/');
        await page.bringToFront();
        await page.locator('.shoteasy-upload-card input[type=file]').setInputFiles(smallFile('original-project.png'));
        await expect(page.getByRole('button', { name: '导出图片', exact: true })).toBeEnabled();
        await page.locator('.shoteasy-inspector [title="无背景"]').click();
        // A successful real UI download commits the current batch style; no Store mutation.
        await page.getByRole('button', { name: '导出图片', exact: true }).click();
        await page.locator('.shoteasy-export-drawer .ant-segmented').first().getByText('AVIF', { exact: true }).click();
        await page.getByTestId('compression-standard').click();
        const setupDownload = page.waitForEvent('download');
        await page.getByTestId('export-download').click();
        const setupBytes = await downloadBytes(await setupDownload, 131_072);
        expect(setupBytes.subarray(4, 12).toString('ascii')).toBe('ftypavif');
        await expect(page.locator('.shoteasy-export-drawer')).toHaveCount(0);
        await expect(page.getByRole('button', { name: '导出图片', exact: true })).toBeEnabled();
        evidence.setupDownloads = downloads.length;
        evidence.layersBefore = await layers();
        await page.evaluate(() => { window.__screenhelloBatchPage = {}; });
        await page.getByRole('menubar', { name: '应用菜单' }).getByRole('menuitem', { name: '文件', exact: true }).click();
        await page.getByRole('menuitem', { name: '批量处理…' }).last().click();
        await page.getByTestId('batch-file-input').setInputFiles([
            { name: 'cancel-pc.webp', mimeType: 'image/webp', buffer: pc }, smallFile('queued-small.png'),
        ]);
        const offset = (await trace()).jobs.length;
        evidence.foreground = await page.evaluate(() => ({ visibility: document.visibilityState, focused: document.hasFocus() }));
        await drawer.getByRole('button', { name: '开始批量处理', exact: true }).click();
        await page.waitForFunction(count => window.__screenhelloCancelObserver.jobs.length > count, offset, { polling: 25, timeout: 20_000 });
        const cancelStarted = performance.now();
        await drawer.getByRole('button', { name: mode === 'all' ? '取消全部' : '取消当前', exact: true }).click();
        // Waiting for the entire queue includes rendering/encoding the second tiny item for cancel-current.
        await expect(drawer.getByRole('button', { name: '开始批量处理', exact: true })).toBeEnabled({ timeout: 10_000 });
        evidence.cancellationMs = performance.now() - cancelStarted;
        evidence.cancelledStatuses = await statuses();
        evidence.zipEnabledAfterCancel = await drawer.getByRole('button', { name: '下载 ZIP', exact: true }).isEnabled();
        evidence.jobsAtCancellationReady = (await trace()).jobs.length - offset;
        if (mode === 'all') {
            expect(evidence.cancelledStatuses).toEqual(['已取消', '已取消']);
            expect(evidence.zipEnabledAfterCancel).toBe(false);
            expect(evidence.jobsAtCancellationReady).toBe(1);
            expect(downloads).toHaveLength(1);
            await page.getByTestId('batch-file-input').setInputFiles([smallFile('recover-a.png'), smallFile('recover-b.png')]);
            await drawer.getByRole('button', { name: '开始批量处理', exact: true }).click();
        }
        await expect(drawer.getByRole('button', { name: '下载 ZIP', exact: true })).toBeEnabled();
        evidence.recoveredStatuses = await statuses();
        evidence.downloadsBeforeZip = downloads.length - evidence.setupDownloads;
        const archiveDownload = page.waitForEvent('download');
        await drawer.getByRole('button', { name: '下载 ZIP', exact: true }).click();
        const download = await archiveDownload;
        const bytes = await downloadBytes(download, 262_144);
        await testInfo.attach('actual-batch.zip', { body: bytes, contentType: 'application/zip' });
        evidence.archive = { name: download.suggestedFilename(), ...await inspectBatchRecoveryZip(bytes, mode) };
        const observed = await trace();
        evidence.jobs = observed.jobs.slice(offset);
        evidence.overflow = observed.overflow;
        evidence.layersAfter = await layers();
        const after = await page.evaluate(() => ({ samePage: !!window.__screenhelloBatchPage,
            productionEditor: !!document.querySelector('.shoteasy-editor-canvas') && typeof window.__shoteasyStores === 'undefined' }));
        Object.assign(evidence, after, { downloadsAfterZip: downloads.length - evidence.setupDownloads });
        evidence.status = 'passed';
        validateBatchRecoveryEvidence(evidence);
    } catch (error) {
        evidence.status = 'failed'; evidence.error = String(error.stack || error);
        throw error;
    } finally {
        try { evidence.finalTrace = await trace(); } catch (error) { evidence.traceError = String(error); }
        await testInfo.attach('batch-recovery-evidence', { body: Buffer.from(JSON.stringify(evidence, null, 2)), contentType: 'application/json' });
    }
});
