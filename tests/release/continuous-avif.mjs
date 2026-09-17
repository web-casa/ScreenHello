import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { activateEditorWindow } from './foreground.mjs';
import { hashPaths, sha256 } from '../compression-product/memory-evidence.mjs';
import { CONTINUOUS_AVIF_TARGET_SCOPE, CONTINUOUS_AVIF_SIZE, CONTINUOUS_AVIF_COUNT,
    continuousAvifName, inspectContinuousAvif, validateTargetContinuousEvidence } from './continuous-avif-contract.mjs';

export async function checkTargetContinuousAvif({ driver, editorWindow, selectFormat, waitForEnabled,
    waitForRemovedSelector, report, checkpoint, target, evidenceDirectory }) {
    const candidate = JSON.parse(await readFile(join(evidenceDirectory, 'candidate.json'), 'utf8'));
    assert.equal(candidate.commit, report.releaseCandidate);
    const pc = await readFile(new URL('../../src/assets/demo-desktop.webp', import.meta.url));
    const evidence = report.continuousAvif = { scope: CONTINUOUS_AVIF_TARGET_SCOPE, status: 'running', target: target.id, candidate,
        registration: { registeredAt: new Date().toISOString(), count: CONTINUOUS_AVIF_COUNT, attemptsPerCase: 1, memoryMeasurement: false,
            mode: 'standard', ratio: 1, dimensions: CONTINUOUS_AVIF_SIZE, pcSha256: sha256(pc),
            webSha256: candidate.webBuildSha256, sourceSha256: candidate.sourceSha256, runnerSha256: candidate.runnerSha256 },
        environment: { engine: target.browser, version: report.observed.browserVersion, platform: process.platform, arch: process.arch },
        deliveryEvidence: 'native-anchor-blob-bytes', blockedRequests: [], results: [] };
    await checkpoint();
    const state = () => driver.executeScript(() => ({
        layers: [...document.querySelectorAll('.shoteasy-layer-copy')].map(node => node.textContent),
        downloads: window.__screenhelloReleaseDownloads.length,
        jobs: window.__screenhelloCancelObserver.jobs, overflow: window.__screenhelloCancelObserver.overflow,
        samePage: window.__screenhelloContinuousPage === true,
        productionEditor: !!document.querySelector('.shoteasy-editor-canvas') && typeof window.__shoteasyStores === 'undefined',
        observerOverflow: window.__screenhelloContinuousDownloads.overflow,
        pageErrors: [...window.__screenhelloReleaseErrors],
        externalResourceRequests: performance.getEntriesByType('resource').map(entry => entry.name).filter(url => {
            const parsed = new URL(url, location.href);
            return !['blob:', 'data:'].includes(parsed.protocol) && parsed.origin !== location.origin;
        }),
    }));
    try {
        // Compression checks have already created the registered PC example.
        await activateEditorWindow(driver, editorWindow);
        await (await waitForEnabled('[title="无背景"]')).click();
        await driver.executeScript(() => {
            window.__screenhelloContinuousPage = true;
            window.__screenhelloContinuousDownloads.active = true;
        });
        const before = await state();
        evidence.layersBefore = before.layers;
        assert.ok(before.layers.length > 0);
        for (let index = 0; index < CONTINUOUS_AVIF_COUNT; index++) {
            await activateEditorWindow(driver, editorWindow);
            await selectFormat('avif');
            await (await waitForEnabled('[data-testid="compression-standard"]')).click();
            assert.equal(await driver.executeScript(() => {
                const label = [...document.querySelectorAll('.shoteasy-export-drawer .ant-segmented label')]
                    .find(el => el.textContent.trim() === '1x');
                label?.click(); return !!label;
            }), true);
            await driver.wait(() => driver.executeScript(() =>
                document.querySelector('[data-testid="compression-standard"]')?.getAttribute('aria-pressed') === 'true'
                && [...document.querySelectorAll('.shoteasy-export-drawer .ant-segmented label')]
                    .some(el => el.textContent.trim() === '1x' && el.querySelector('input')?.checked)
                && document.querySelector('.shoteasy-export-summary')?.textContent.includes('2223 × 1667 px')), 20_000);
            const foreground = await activateEditorWindow(driver, editorWindow);
            const started = performance.now();
            await (await waitForEnabled('[data-testid="export-download"]')).click();
            let record;
            await driver.wait(async () => {
                record = await driver.executeScript(i => window.__screenhelloContinuousDownloads.records[i] || null, index);
                return record?.base64 || record?.error;
            }, 120_000, 'continuous AVIF handoff missing');
            assert.equal(record.error, null);
            assert.ok(typeof record.base64 === 'string' && record.base64.length <= 11_184_812);
            const bytes = Buffer.from(record.base64, 'base64');
            const file = continuousAvifName(index);
            const evidenceFile = `${target.id}-${file}`;
            try {
                assert.equal(bytes.length, record.size);
                await writeFile(join(evidenceDirectory, evidenceFile), bytes, { flag: 'wx' });
            } finally {
                delete record.base64;
                await driver.executeScript(i => { delete window.__screenhelloContinuousDownloads.records[i].base64; }, index);
            }
            await waitForRemovedSelector('.shoteasy-export-drawer', 'continuous export drawer did not close');
            await waitForEnabled('[aria-label="导出图片"]');
            await driver.wait(async () => (await state()).downloads === before.downloads + index + 1, 10_000);
            const after = await state();
            const result = { index, file, evidenceFile, downloadName: record.name, type: record.type,
                size: bytes.length, sha256: sha256(bytes), elapsedMs: performance.now() - started, foreground,
                samePage: after.samePage, layers: after.layers, downloads: after.downloads - before.downloads };
            evidence.results.push(result);
            evidence.jobs = after.jobs.slice(before.jobs.length);
            await checkpoint();
            assert.equal(result.samePage, true);
            assert.deepEqual(result.layers, before.layers);
            assert.equal(evidence.jobs.length, index + 1);
            assert.ok(Number.isFinite(evidence.jobs[index].completedAt));
            assert.equal(evidence.jobs[index].failed, false);
        }
        // No browser-native AVIF decode is required, including on Edge 111.
        for (const result of evidence.results) Object.assign(result,
            await inspectContinuousAvif(await readFile(join(evidenceDirectory, result.evidenceFile))));
        const after = await state();
        Object.assign(evidence, { jobs: after.jobs.slice(before.jobs.length), overflow: after.overflow,
            downloads: after.downloads - before.downloads, layersAfter: after.layers,
            samePage: after.samePage, productionEditor: after.productionEditor, observerOverflow: after.observerOverflow,
            pageErrors: after.pageErrors, externalResourceRequests: after.externalResourceRequests,
            finalFingerprints: {
                webSha256: hashPaths('dist', ['./']),
                sourceSha256: hashPaths('.', ['src/', 'public/', 'config/', 'scripts/', 'index.html', 'package.json', 'pnpm-lock.yaml', 'vite.config.js']),
                runnerSha256: hashPaths('.', ['tests/release/', '.github/workflows/web-release-browser-matrix.yml']),
            }, status: 'passed' });
        validateTargetContinuousEvidence(evidence, { target, observed: report.observed, releaseCandidate: report.releaseCandidate });
    } catch (error) { evidence.status = 'failed'; evidence.error = String(error.stack || error); throw error; }
    finally {
        await checkpoint();
        await driver.executeScript(() => { window.__screenhelloContinuousDownloads.active = false; });
    }
}
