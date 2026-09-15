import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { activateEditorWindow } from './foreground.mjs';
import { CANCEL_SCOPE, cancellationCases, recoverySpecification, validateCancelEvidence } from './cancel-contract.mjs';

export async function checkCancelRecovery({ driver, editorWindow, selectFormat, waitForEnabled,
    waitForRemovedSelector, completeDownloadDecode, report, checkpoint }) {
    const evidence = report.cancelRecovery = { scope: CANCEL_SCOPE, status: 'running',
        registration: { cases: cancellationCases(), attemptsPerCase: 1, memoryMeasurement: false,
            registeredAt: new Date().toISOString(), fixtureSha256: createHash('sha256')
                .update(readFileSync(new URL('../../src/assets/demo-desktop.webp', import.meta.url))).digest('hex') } };
    await checkpoint();
    await activateEditorWindow(driver, editorWindow);
    await selectFormat('avif');
    await (await waitForEnabled('[data-testid="compression-standard"]')).click();
    const before = await driver.executeScript(() => {
        const text = [...document.querySelectorAll('.shoteasy-export-summary strong')].map(el => el.textContent)
            .find(value => /^\d+ × \d+ px$/.test(value));
        const [width, height] = text.match(/\d+/g).map(Number);
        window.__screenhelloRecoveryPage = {};
        return { width, height, jobs: window.__screenhelloCancelObserver.jobs.length,
            layers: [...document.querySelectorAll('.shoteasy-layer-copy')].map(node => node.textContent),
            downloads: window.__screenhelloReleaseDownloads.length };
    });
    assert.ok(before.width * before.height > 1_048_576 && before.width * before.height <= 4_194_304);
    assert.ok(before.layers.length > 0, 'original project layers missing');
    evidence.dimensions = { width: before.width, height: before.height };
    await checkpoint();
    await (await waitForEnabled('[data-testid="export-download"]')).click();
    await driver.wait(async () => driver.executeScript(count => window.__screenhelloCancelObserver.jobs.length > count, before.jobs),
        20_000, 'AVIF job was not submitted to a Worker', 25);
    evidence.job = await driver.executeScript(index => window.__screenhelloCancelObserver.jobs[index], before.jobs);
    await checkpoint();
    assert.equal(evidence.job.completedAt, null, 'AVIF completed before cancellation could be attempted');
    const started = performance.now();
    await (await waitForEnabled('[data-testid="export-cancel"]')).click();
    await waitForRemovedSelector('.shoteasy-export-drawer', 'cancelled export drawer did not close');
    await waitForEnabled('[aria-label="导出图片"]');
    evidence.cancellationMs = performance.now() - started;
    evidence.job = await driver.executeScript(index => window.__screenhelloCancelObserver.jobs[index], before.jobs);
    evidence.cancelledDownloads = await driver.executeScript(() => window.__screenhelloReleaseDownloads.length) - before.downloads;
    await checkpoint();
    assert.equal(evidence.job.completedAt, null);
    assert.ok(Number.isFinite(evidence.job.cancelRequestedAt) && Number.isFinite(evidence.job.terminatedAt));
    assert.equal(evidence.cancelledDownloads, 0);
    const foreground = await activateEditorWindow(driver, editorWindow);
    await selectFormat('png');
    await (await waitForEnabled('[data-testid="compression-standard"]')).click();
    const recoveryStarted = performance.now();
    await (await waitForEnabled('[data-testid="export-download"]')).click();
    let record;
    await driver.wait(async () => {
        record = await driver.executeScript(index => window.__screenhelloReleaseDownloads[index] || null, before.downloads);
        return !!record;
    }, 30_000, 'PNG recovery download did not arrive');
    record = await completeDownloadDecode(record);
    await waitForRemovedSelector('.shoteasy-export-drawer', 'recovery drawer did not close');
    const after = await driver.executeScript(() => ({ samePage: !!window.__screenhelloRecoveryPage,
        layers: [...document.querySelectorAll('.shoteasy-layer-copy')].map(node => node.textContent),
        editor: !!document.querySelector('.shoteasy-editor-canvas') && typeof window.__shoteasyStores === 'undefined',
        downloads: window.__screenhelloReleaseDownloads.length, jobs: window.__screenhelloCancelObserver.jobs.length,
        overflow: window.__screenhelloCancelObserver.overflow }));
    evidence.recovery = { ...recoverySpecification, ...evidence.dimensions, ...record, ...foreground,
        durationMs: performance.now() - recoveryStarted, editorSurvived: after.editor };
    evidence.recoveredSamePage = after.samePage;
    evidence.layersBefore = before.layers;
    evidence.layersAfter = after.layers;
    evidence.recoveryDownloads = after.downloads - before.downloads;
    evidence.jobsAdded = after.jobs - before.jobs;
    evidence.overflow = after.overflow;
    evidence.job = await driver.executeScript(index => window.__screenhelloCancelObserver.jobs[index], before.jobs);
    evidence.status = 'passed';
    await checkpoint();
    validateCancelEvidence(evidence);
}
