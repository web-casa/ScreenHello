import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { By, until } from 'selenium-webdriver';
import { activateEditorWindow } from './foreground.mjs';
import { compressionCases, COMPRESSION_SCOPE, validateCompressionEvidence, validateCompressionResult } from './compression-contract.mjs';
import { createPngFixture } from '../fixtures/createPngFixture.js';

export async function checkCompressionDownloads({ driver, editorWindow, selectFormat, waitForEnabled,
    clickMenuItem, waitForRemovedSelector, report, checkpoint, completeDownloadDecode }) {
    const evidence = report.compressionDownloads = {
        scope: COMPRESSION_SCOPE, status: 'running',
        registration: { registeredAt: new Date().toISOString(), cases: compressionCases(), attemptsPerCase: 1, memoryMeasurement: false,
            fixtureSha256: {
                small: createHash('sha256').update(createPngFixture(64, 48)).digest('hex'),
                pc: createHash('sha256').update(readFileSync(new URL('../../src/assets/demo-desktop.webp', import.meta.url))).digest('hex'),
            } },
        results: [],
    };
    await checkpoint(); // Persist the exact bounded workload before the first compression action.
    let fixture = 'small';
    for (const specification of evidence.registration.cases) {
        await activateEditorWindow(driver, editorWindow);
        if (specification.fixture !== fixture) {
            await clickMenuItem('文件', '新建项目');
            const discard = await driver.wait(until.elementLocated(By.xpath('//div[contains(@class,"shoteasy-workspace-guard")]//button[normalize-space(.)="不保存并继续"]')), 20_000);
            await discard.click();
            await (await waitForEnabled('.shoteasy-demo-button')).click();
            await waitForEnabled('[aria-label="导出图片"]');
            fixture = specification.fixture;
        }
        await selectFormat(specification.format);
        await (await waitForEnabled(`[data-testid="compression-${specification.compression}"]`)).click();
        const selected = await driver.executeScript(ratio => {
            const labels = document.querySelectorAll('.shoteasy-export-drawer .ant-segmented label');
            const label = [...labels].find(element => element.textContent.trim() === `${ratio}x`);
            label?.click(); return !!label;
        }, specification.ratio);
        assert.equal(selected, true);
        await driver.wait(async () => driver.executeScript(mode => document.querySelector(`[data-testid="compression-${mode}"]`)?.getAttribute('aria-pressed') === 'true', specification.compression), 10_000);
        await driver.wait(async () => driver.executeScript(ratio => [...document.querySelectorAll('.shoteasy-export-drawer .ant-segmented label')]
            .some(label => label.textContent.trim() === `${ratio}x` && label.querySelector('input')?.checked), specification.ratio), 10_000);
        const dimensions = await driver.executeScript(() => {
            const text = [...document.querySelectorAll('.shoteasy-export-summary strong')].map(el => el.textContent).find(value => /^\d+ × \d+ px$/.test(value));
            const match = text?.match(/(\d+) × (\d+)/);
            const quality = document.querySelector('.shoteasy-export-quality input')?.value;
            const palette = document.querySelector('[data-testid^="palette-"][aria-pressed="true"]')?.getAttribute('data-testid');
            return match ? { width: Number(match[1]), height: Number(match[2]),
                quality: quality ? Number(quality) : null, paletteColors: palette ? Number(palette.slice(8)) : null } : null;
        });
        assert.ok(dimensions, 'visible output dimensions missing');
        const pixels = dimensions.width * dimensions.height;
        assert.ok(pixels > 0 && pixels <= (specification.fixture === 'pc' ? 4_194_304 : 1_048_576), 'fixture exceeded registered scope');
        if (specification.fixture === 'pc') assert.ok(pixels > 1_048_576, 'PC fixture unexpectedly small');
        let previewBytes;
        let previewBlobIds = [];
        if (specification.preview) {
            await driver.executeScript(() => { window.__screenhelloPreviewBlobIds = []; });
            await (await waitForEnabled('[data-testid="export-preview"]')).click();
            await driver.wait(async () => driver.executeScript(() => document.querySelector('[data-testid="preview-viewport"]')?.getAttribute('aria-busy') === 'false'), 45_000, 'compression preview did not decode');
            const state = await driver.executeScript(() => ({
                bytes: Number.parseInt(document.querySelector('[data-testid="preview-bytes"]')?.title, 10),
                blobIds: window.__screenhelloPreviewBlobIds,
            }));
            previewBytes = state.bytes; previewBlobIds = state.blobIds;
        } else if (specification.fixture === 'pc') {
            assert.equal(await driver.findElement(By.css('[data-testid="export-preview"]')).isEnabled(), false);
        }
        const previousCount = await driver.executeScript(() => window.__screenhelloReleaseDownloads.length);
        const foreground = await activateEditorWindow(driver, editorWindow);
        const started = performance.now();
        await (await waitForEnabled('[data-testid="export-download"]')).click();
        let record;
        await driver.wait(async () => {
            record = await driver.executeScript(count => window.__screenhelloReleaseDownloads[count] || null, previousCount);
            return !!record;
        }, 120_000, `${specification.id}: download did not complete`);
        record = await completeDownloadDecode(record);
        await waitForRemovedSelector('.shoteasy-export-drawer', `${specification.id}: drawer did not close`);
        assert.equal(await driver.executeScript(() => window.__screenhelloReleaseDownloads.length), previousCount + 1, 'unexpected extra download');
        const editorSurvived = await driver.executeScript(() => !!document.querySelector('.shoteasy-editor-canvas') && typeof window.__shoteasyStores === 'undefined');
        const result = { ...specification, ...dimensions, ...record, ...foreground, durationMs: performance.now() - started,
            editorSurvived, ...(specification.preview ? { previewBytes, previewBlobReused: previewBlobIds.includes(record.blobId) } : {}) };
        evidence.results.push(result);
        await checkpoint(); // Preserve failed decoded output too, before asserting.
        validateCompressionResult(result, specification);
    }
    await activateEditorWindow(driver, editorWindow);
    await selectFormat('avif');
    const count = await driver.executeScript(() => window.__screenhelloReleaseDownloads.length);
    await (await waitForEnabled('[data-testid="compression-lossy"]')).click();
    const lossyDisabled = !await driver.findElement(By.css('[data-testid="export-download"]')).isEnabled();
    const previewDisabled = !await driver.findElement(By.css('[data-testid="export-preview"]')).isEnabled();
    await (await waitForEnabled('[data-testid="compression-standard"]')).click();
    const standardEnabled = await driver.findElement(By.css('[data-testid="export-download"]')).isEnabled();
    const noDownload = count === await driver.executeScript(() => window.__screenhelloReleaseDownloads.length);
    evidence.largeAvifRejection = { lossyDisabled, standardEnabled, previewDisabled, noDownload };
    await (await waitForEnabled('[data-testid="export-cancel"]')).click();
    await waitForRemovedSelector('.shoteasy-export-drawer', 'rejection panel did not close');
    evidence.status = 'passed';
    validateCompressionEvidence(evidence);
    await checkpoint();
}
