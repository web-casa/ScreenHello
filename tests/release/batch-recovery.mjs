import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPngFixture } from '../fixtures/createPngFixture.js';
import { sha256 } from '../compression-product/memory-evidence.mjs';
import { activateEditorWindow } from './foreground.mjs';
import { BATCH_TARGET_SCOPE, inspectBatchRecoveryZip, validateTargetBatchEvidence } from './batch-recovery-contract.mjs';

export async function checkTargetBatchRecovery({ driver, editorWindow, clickMenuItem, waitForEnabled,
    waitForRemovedSelector, report, checkpoint, target, evidenceDirectory }) {
    const candidate = JSON.parse(await readFile(join(evidenceDirectory, 'candidate.json'), 'utf8'));
    assert.equal(candidate.commit, report.releaseCandidate);
    const pc = await readFile(new URL('../../src/assets/demo-desktop.webp', import.meta.url));
    const small = createPngFixture(64, 48);
    const registration = { registeredAt: new Date().toISOString(), modes: ['all', 'current'],
        attemptsPerCase: 1, memoryMeasurement: false, pcSha256: sha256(pc), smallSha256: sha256(small) };
    const evidence = report.batchRecovery = { scope: BATCH_TARGET_SCOPE, status: 'running', target: target.id,
        registration, candidate, cases: [], deliveryEvidence: 'native-anchor-blob-bytes' };
    await checkpoint();
    const button = async (label, timeout = 20_000) => driver.wait(async () => {
        const element = await driver.executeScript(text => [...document.querySelectorAll('.shoteasy-batch-drawer button')]
            .find(node => node.textContent.replace(/\s/g, '') === text) || null, label.replace(/\s/g, ''));
        return element && await element.isDisplayed() && await element.isEnabled() ? element : false;
    }, timeout, `batch button not ready: ${label}`, 50);
    const getState = () => driver.executeScript(() => ({
        layers: [...document.querySelectorAll('.shoteasy-layer-copy')].map(node => node.textContent),
        statuses: [...document.querySelectorAll('.shoteasy-batch-jobs .ant-tag')].map(node => node.textContent),
        jobs: window.__screenhelloCancelObserver.jobs, overflow: window.__screenhelloCancelObserver.overflow,
        downloads: window.__screenhelloReleaseDownloads.length,
        zipEnabled: [...document.querySelectorAll('.shoteasy-batch-drawer button')]
            .some(node => node.textContent.replace(/\s/g, '') === '下载ZIP' && !node.disabled),
        samePage: !!window.__screenhelloBatchPage,
        productionEditor: !!document.querySelector('.shoteasy-editor-canvas') && typeof window.__shoteasyStores === 'undefined',
        pageErrors: [...window.__screenhelloReleaseErrors],
        externalResourceRequests: performance.getEntriesByType('resource').map(entry => entry.name).filter(url => {
            const parsed = new URL(url, location.href);
            return !['blob:', 'data:'].includes(parsed.protocol) && parsed.origin !== location.origin;
        }),
    }));
    const file = (name, type, bytes) => ({ name, type, base64: bytes.toString('base64') });
    const smallFile = name => file(name, 'image/png', small);
    const setFiles = async files => {
        const count = await driver.executeScript(records => {
            const transfer = new DataTransfer();
            for (const record of records) {
                const bytes = Uint8Array.from(atob(record.base64), char => char.charCodeAt(0));
                transfer.items.add(new File([bytes], record.name, { type: record.type }));
            }
            const input = document.querySelector('[data-testid="batch-file-input"]');
            if (!input) return 0;
            input.files = transfer.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return transfer.files.length;
        }, files);
        assert.equal(count, 2);
    };
    // The existing four-format smoke ends with one successful small AVIF export.
    const setup = await driver.executeScript(() => window.__screenhelloReleaseDownloads.map(({ type }) => type));
    assert.deepEqual(setup, ['image/png', 'image/jpeg', 'image/webp', 'image/avif']);
    for (const mode of registration.modes) {
        const item = { scope: BATCH_TARGET_SCOPE, mode, status: 'running', setupDownloads: setup.filter(type => type === 'image/avif').length,
            registration: { mode, attemptsPerCase: 1, memoryMeasurement: false, registeredAt: new Date().toISOString(),
                webSha256: candidate.webBuildSha256, runnerSha256: candidate.runnerSha256,
                pcSha256: registration.pcSha256, smallSha256: registration.smallSha256 },
            environment: { engine: target.browser, version: report.observed.browserVersion, platform: process.platform, arch: process.arch },
            blockedRequests: [] };
        evidence.cases.push(item);
        await checkpoint();
        item.foreground = await activateEditorWindow(driver, editorWindow);
        await driver.executeScript(() => { window.__screenhelloBatchPage = {}; });
        await clickMenuItem('文件', '批量处理');
        await setFiles([file('cancel-pc.webp', 'image/webp', pc), smallFile('queued-small.png')]);
        const before = await getState();
        item.layersBefore = before.layers;
        assert.ok(before.layers.length > 0);
        await (await button('开始批量处理')).click();
        await driver.wait(async () => driver.executeScript(offset => window.__screenhelloCancelObserver.jobs.length > offset, before.jobs.length),
            20_000, 'batch AVIF was not submitted', 25);
        const started = performance.now();
        await (await button(mode === 'all' ? '取消全部' : '取消当前')).click();
        await button('开始批量处理', 10_000);
        item.cancellationMs = performance.now() - started;
        const cancelled = await getState();
        item.cancelledStatuses = cancelled.statuses;
        item.zipEnabledAfterCancel = cancelled.zipEnabled;
        item.jobsAtCancellationReady = cancelled.jobs.length - before.jobs.length;
        await checkpoint();
        const first = cancelled.jobs[before.jobs.length];
        assert.equal(first.completedAt, null);
        assert.ok(Number.isFinite(first.cancelRequestedAt) && Number.isFinite(first.terminatedAt));
        assert.equal(cancelled.downloads, before.downloads);
        if (mode === 'all') {
            assert.deepEqual(cancelled.statuses, ['已取消', '已取消']);
            assert.equal(cancelled.zipEnabled, false);
            assert.equal(item.jobsAtCancellationReady, 1);
            await setFiles([smallFile('recover-a.png'), smallFile('recover-b.png')]);
            await (await button('开始批量处理')).click();
        }
        await button('下载 ZIP');
        const recovered = await getState();
        item.recoveredStatuses = recovered.statuses;
        item.downloadsBeforeZip = recovered.downloads - before.downloads;
        const zipIndex = await driver.executeScript(() => window.__screenhelloBatchDownloads.records.length);
        await (await button('下载 ZIP')).click();
        let record;
        await driver.wait(async () => {
            record = await driver.executeScript(index => window.__screenhelloBatchDownloads.records[index] || null, zipIndex);
            return record?.base64 || record?.error;
        }, 20_000, 'batch ZIP bytes were not observed');
        assert.equal(record.error, null);
        assert.ok(typeof record.base64 === 'string' && record.base64.length <= 349_528);
        const bytes = Buffer.from(record.base64, 'base64');
        const evidenceFile = `${target.id}-batch-${mode}.zip`;
        try {
            assert.equal(bytes.length, record.size);
            await writeFile(join(evidenceDirectory, evidenceFile), bytes, { flag: 'wx' });
        } finally {
            delete record.base64;
            await driver.executeScript(index => { delete window.__screenhelloBatchDownloads.records[index].base64; }, zipIndex);
        }
        item.archive = { name: record.name, type: record.type, evidenceFile,
            ...await inspectBatchRecoveryZip(bytes, mode) };
        await driver.wait(async () => (await getState()).downloads > before.downloads, 10_000, 'batch handoff metadata missing');
        await button('清空');
        const after = await getState();
        Object.assign(item, { downloadsAfterZip: after.downloads - before.downloads, jobs: after.jobs.slice(before.jobs.length),
            overflow: after.overflow, layersAfter: after.layers, samePage: after.samePage,
            productionEditor: after.productionEditor, pageErrors: after.pageErrors, externalResourceRequests: after.externalResourceRequests });
        item.status = 'passed';
        await checkpoint();
        await (await button('清空')).click();
        await (await waitForEnabled('.shoteasy-batch-drawer .ant-drawer-close')).click();
        await waitForRemovedSelector('.shoteasy-batch-drawer', 'batch panel did not close');
    }
    const state = await driver.executeScript(() => ({ overflow: window.__screenhelloBatchDownloads.overflow,
        count: window.__screenhelloBatchDownloads.records.length }));
    evidence.zipObserverOverflow = state.overflow;
    evidence.zipHandoffs = state.count;
    evidence.status = 'passed';
    try { validateTargetBatchEvidence(evidence, { target, observed: report.observed, releaseCandidate: report.releaseCandidate }); }
    catch (error) { evidence.status = 'failed'; throw error; }
    await checkpoint();
}
