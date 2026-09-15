import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { PNG } from 'pngjs';
import { chromium, firefox, webkit, expect as playwrightExpect } from '@playwright/test';
import { createPngFixture } from '../fixtures/createPngFixture.js';
import { processTreeRssMiB } from '../spikes/compression/rss.mjs';
import { startProbeServer } from '../spikes/compression/server.mjs';
import { MAX_PREVIEW_PIXELS, compressionTimeoutMs } from '../../src/utils/exportSettings.js';
import { createMemorySampler } from './memory-sampler.mjs';
import { MEMORY_POLICY, candidateFingerprint, environmentFingerprint, reserveEvidence, scenarioId, sha256, validateManifest } from './memory-evidence.mjs';

const engines = { chromium, firefox, webkit };
const expect = playwrightExpect.configure({ timeout: 45_000 });
const selected = process.env.SCREENHELLO_COMPRESSION_ENGINE;
const profile = process.env.SCREENHELLO_COMPRESSION_PROFILE || 'library';
assert.ok(['web', 'library'].includes(profile), 'unknown harness profile');
const memoryPolicy = process.env.SCREENHELLO_COMPRESSION_MEMORY_POLICY || 'legacy';
assert.ok(['legacy', MEMORY_POLICY].includes(memoryPolicy), 'unknown memory policy');
const v2 = memoryPolicy === MEMORY_POLICY;
const manifestFile = process.env.SCREENHELLO_COMPRESSION_MANIFEST;
assert.ok(v2 ? manifestFile : !manifestFile, 'V2 requires explicit policy and manifest together');
const direct = process.env.SCREENHELLO_COMPRESSION_DIRECT === '1';
const pair = process.env.SCREENHELLO_COMPRESSION_PAIR === '1';
const repeat = Number(process.env.SCREENHELLO_COMPRESSION_REPEAT || 6);
assert.ok(Number.isInteger(repeat) && repeat >= 6 && repeat <= 24, 'invalid repeat count');
const selectedMode = process.env.SCREENHELLO_COMPRESSION_MODE;
const selectedKind = process.env.SCREENHELLO_COMPRESSION_KIND;
const label = process.env.SCREENHELLO_COMPRESSION_LABEL || 'current';
assert.ok(/^[a-z0-9-]{1,40}$/.test(label), 'invalid report label');
const width = Number(process.env.SCREENHELLO_COMPRESSION_WIDTH || (direct ? 2048 : MAX_PREVIEW_PIXELS / 1024)), height = Number(process.env.SCREENHELLO_COMPRESSION_HEIGHT || (direct ? 2048 : 1024));
assert.ok([width, height].every(n => Number.isInteger(n) && n > 0 && n <= 8192) && width * height <= (direct ? 4_194_304 : 2_097_152), 'invalid probe dimensions');
assert.ok(!direct || !pair, 'direct probe requires one active editor');
const modes = direct ? ['png-lossless', 'png-lossy', 'webp-lossless', 'webp-lossy', 'jpg-lossy', 'avif-lossy'] : ['png-lossless', 'png-lossy', 'webp-lossless'];
// Standard AVIF is an explicit supplemental scene, never silently added to or
// substituted for the historical six-mode matrix.
if (direct && selectedMode === 'avif-standard') modes.push('avif-standard');
if (selectedMode) assert.ok(modes.includes(selectedMode), 'unknown mode');
if (selectedKind) assert.ok(['screenshot', 'noise'].includes(selectedKind), 'unknown fixture');
if (selected) assert.ok(Object.hasOwn(engines, selected), 'unknown engine');
const directory = new URL('../../artifacts/compression-product-evidence/', import.meta.url);
await mkdir(directory, { recursive: true });
const build = fileURLToPath(new URL('../../artifacts/compression-product/', import.meta.url));
const hash = createHash('sha256');
function hashDirectory(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const relative = `${prefix}${entry.name}`;
        if (entry.isDirectory()) hashDirectory(path.join(directory, entry.name), `${relative}/`);
        else hash.update(relative).update('\0').update(readFileSync(path.join(directory, entry.name)));
    }
}
hashDirectory(build);
const buildSha256 = hash.digest('hex');
let manifest, manifestSha256, candidate, environment;
if (v2) {
    const bytes = readFileSync(manifestFile);
    manifest = JSON.parse(bytes); manifestSha256 = sha256(bytes); validateManifest(manifest);
    candidate = candidateFingerprint(); environment = environmentFingerprint();
    assert.deepEqual(candidate, manifest.candidate, 'candidate changed after registration');
    assert.deepEqual(environment, manifest.environment, 'environment changed after registration');
    assert.ok(direct && !pair && selected && selectedMode && selectedKind, 'V2 requires one explicit direct scenario per session');
    assert.ok(manifest.scenarios.some(scene => scenarioId(scene) === scenarioId({ engine: selected, mode: selectedMode, kind: selectedKind, width, height, repeat, profile, path: 'App-ExportPanel-direct-download' })), 'scenario not registered');
}
const report = new URL(`benchmark-${width}x${height}${direct ? '-direct' : ''}${pair ? '-pair' : ''}${selected ? `-${selected}` : ''}${selectedMode ? `-${selectedMode}` : ''}${selectedKind ? `-${selectedKind}` : ''}${repeat !== 6 ? `-repeat${repeat}` : ''}-${label}.json`, directory);
// Reserve the evidence path before launching any browser; failed runs remain
// visible and cannot be replaced by a later successful repeat of the label.
const output = [];
const startedAt = new Date().toISOString();
const envelope = (status, failure) => ({ schema: MEMORY_POLICY, manifestSha256, candidate, environment, startedAt, status, scenarios: output,
    missingScenarios: manifest.scenarios.filter(scene => !output.some(entry => entry.v2.scenarioId === scenarioId(scene))).map(scenarioId), ...(failure ? { failure } : {}) });
const evidence = v2 ? await reserveEvidence(fileURLToPath(report) + '.v2', { manifest, manifestSha256, startedAt }) : null;
if (!v2) await writeFile(report, '[]\n', { flag: 'wx' });
let origin;
let failureRecorded = false;
const fixture = kind => {
    if (kind === 'screenshot') return createPngFixture(width, height);
    const png = new PNG({ width, height });
    let seed = 123456;
    for (let i = 0; i < png.data.length; i += 4) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        png.data.set([seed & 255, seed >>> 8 & 255, seed >>> 16 & 255, 255], i);
    }
    return PNG.sync.write(png);
};
// Fixture creation/hashing is outside the measurement window. Do not allocate
// another full noise PNG merely to add provenance after the export baseline.
const v2Fixture = v2 ? fixture(selectedKind) : null;
const v2FixtureSha256 = v2 ? sha256(v2Fixture) : null;
async function configure(page, name, kind) {
    await page.getByTestId(`locale-${name}`).locator('.shoteasy-upload-card input[type=file]').setInputFiles({
        name: `${kind}.png`, mimeType: 'image/png', buffer: v2Fixture || fixture(kind),
    });
    await page.waitForFunction(name => window.__compressionProduct.runtimes[name]?.editor.app?.tree, name);
    await page.evaluate(({ name, kind, width, height }) => {
        const root = window.__compressionProduct.runtimes[name];
        root.option.setSize({ type: 'fixed', width, height });
        root.option.setPadding(0); root.option.setBackground('none'); root.option.setShadowConf({ visible: false });
        if (kind === 'screenshot') {
            root.editor.addShape({ id: 'c4-text', type: 'text', x: 50, y: 100, text: 'ScreenHello ABC abc 0123456789', fontSize: 22, fill: '#172b4d' });
            root.editor.addShape({ id: 'c4-line', type: 'SquareFill', x: 50, y: 160, width: 900, height: 1, fill: '#2467ac' });
        }
    }, { name, kind, width, height });
    await page.evaluate(async name => {
        const root = window.__compressionProduct.runtimes[name];
        await new Promise(resolve => requestAnimationFrame(resolve));
        await root.renderTaskTracker.waitForIdle();
        await new Promise(resolve => requestAnimationFrame(resolve));
    }, name);
}
async function open(page, name, mode) {
    await page.evaluate(async ({ name, mode }) => {
        const root = window.__compressionProduct.runtimes[name];
        root.workspace.setExportSettings({ format: mode.split('-')[0], ratio: 1,
            ...(mode.endsWith('standard') ? {} : { compression: mode.endsWith('lossless') ? 'lossless' : 'lossy' }),
            ...(mode === 'png-lossy' ? { paletteColors: 256 } : {}) }, { replace: true });
        if (mode.endsWith('standard') && root.workspace.exportSettings.compression) throw new Error('standard mode retained compression');
        await root.commands.execute('file.openExport');
    }, { name, mode });
    await expect(page.getByTestId('export-preview')).toBeVisible();
}
const resources = async page => page.evaluate(() => Object.fromEntries(Object.entries(window.__compressionProduct.runtimes).map(([name, root]) => [name, {
    leases: root.exportService._canvasLeases.size, contexts: root.exportService._contexts.size,
    prepared: Boolean(root.exportService._prepared), busy: root.exportService.isBusy,
    pngWorker: Boolean(root.exportService._pngEncoder?.worker), webpWorker: Boolean(root.exportService._webpEncoder?._worker),
    avifWorker: Boolean(root.exportService._avifEncoder?._worker),
}])));
try {
    origin = await startProbeServer(build);
    for (const [engine, launcher] of Object.entries(engines)) {
        if (selected && selected !== engine) continue;
        for (const kind of pair ? ['noise'] : ['screenshot', 'noise']) {
            if (selectedKind && kind !== selectedKind) continue;
            for (const mode of pair ? ['pair'] : modes) {
                if (!pair && selectedMode && mode !== selectedMode) continue;
                let server, browser, sampler, memory, currentV2, functionalFailure = false;
                const runs = [];
                try {
                    server = await launcher.launchServer({ host: '127.0.0.1' });
                    browser = await launcher.connect(server.wsEndpoint());
                    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
                    page.setDefaultTimeout(45_000);
                    const errors = [], external = [];
                    page.on('pageerror', error => errors.push(error.message));
                    page.on('request', request => { if (!request.url().startsWith(origin.url) && /^https?:/.test(request.url())) external.push(request.url()); });
                    if (v2) { memory = createMemorySampler(server.process().pid); memory.start(); }
                    page.on('crash', () => { functionalFailure = true; });
                    await page.goto(`${origin.url}?profile=${profile}`, { waitUntil: 'networkidle' });
                    const policy = await page.evaluate(() => ({
                        profile: window.__compressionProduct.profile,
                        limits: Object.values(window.__compressionProduct.runtimes).map(root => root.exportService.compressedPixelLimit('avif')),
                    }));
                    assert.equal(policy.profile, profile);
                    assert.deepEqual(policy.limits, [profile === 'web' ? 1_048_576 : 4_194_304, profile === 'web' ? 1_048_576 : 4_194_304]);
                    await configure(page, 'first', kind);
                    if (pair) await configure(page, 'second', kind);
                    if (!pair) await open(page, 'first', mode);
                    const baselineSample = memory?.sample('export-baseline');
                    const baseline = baselineSample?.rssMiB ?? processTreeRssMiB(server.process().pid);
                    assert.ok(baseline > 0, 'RSS unavailable');
                    let peak = baseline, phase = 'setup';
                    const phasePeaks = {}, timeline = [];
                    const sample = () => {
                        if (memory) return memory.sample(phase);
                        const rss = processTreeRssMiB(server.process().pid); peak = Math.max(peak, rss); phasePeaks[phase] = Math.max(phasePeaks[phase] || 0, rss); timeline.push({ phase, rss });
                    };
                    if (v2) currentV2 = { scenarioId: scenarioId({ engine, mode, kind, width, height, repeat, profile, path: 'App-ExportPanel-direct-download' }),
                        fixtureSha256: v2FixtureSha256, baselineAtMs: baselineSample.atMs, samples: memory.samples, idle: [],
                        settings: await page.evaluate(() => ({ ...window.__compressionProduct.runtimes.first.workspace.exportSettings })) };
                    await page.exposeFunction('__c4Phase', value => { phase = value; sample(); });
                    await page.evaluate(() => {
                        for (const root of Object.values(window.__compressionProduct.runtimes)) {
                            const render = root.exportService._renderImage.bind(root.exportService);
                            root.exportService._renderImage = async (...args) => {
                                await window.__c4Phase('render-and-encode');
                                const result = await render(...args);
                                await window.__c4Phase('verify-decode'); return result;
                            };
                        }
                    });
                    if (!v2) sampler = setInterval(sample, 50);
                    for (let index = 0; index < repeat; index++) {
                        functionalFailure = true;
                        const started = performance.now();
                        const startedAtMs = memory?.now();
                        if (pair) {
                            const sizes = await page.evaluate(async () => Promise.all(Object.values(window.__compressionProduct.runtimes).map(async (root, i) => {
                                const prepared = await root.exportService.prepareImage({ format: i ? 'webp' : 'png', ratio: 1, compression: 'lossless', verifyPreview: true });
                                return { width: prepared.result.width, height: prepared.result.height, bytes: prepared.result.blob.size };
                            })));
                            assert.ok(sizes.every(size => size.width === width && size.height === height && size.bytes > 0));
                            runs.push({ ms: Math.round(performance.now() - started), sizes });
                            await page.evaluate(() => Object.values(window.__compressionProduct.runtimes).forEach(root => root.exportService.discardPrepared()));
                        } else if (direct) {
                            if (width * height > MAX_PREVIEW_PIXELS) await expect(page.getByTestId('export-preview')).toBeDisabled();
                            else await expect(page.getByTestId('export-preview')).toBeEnabled();
                            await expect(page.getByTestId('export-download')).toBeEnabled();
                            const downloaded = page.waitForEvent('download', { timeout: compressionTimeoutMs(width, height) + 15_000 });
                            await page.getByTestId('export-download').click();
                            const download = await downloaded;
                            assert.equal(await download.failure(), null);
                            let bytes = 0;
                            for await (const chunk of await download.createReadStream()) bytes += chunk.length;
                            assert.ok(bytes > 0);
                            assert.ok(download.suggestedFilename().endsWith(`.${mode.split('-')[0]}`));
                            runs.push({ ms: Math.round(performance.now() - started), bytes, ...(v2 ? { downloadedAtMs: memory.now() } : {}) });
                            await download.delete();
                            await expect(page.locator('.shoteasy-export-drawer')).toHaveCount(0);
                            if (index < repeat - 1) await open(page, 'first', mode);
                        } else {
                            await page.getByTestId('export-preview').click();
                            await expect(page.getByTestId('preview-viewport')).toHaveAttribute('aria-busy', 'false');
                            await expect(page.getByTestId('preview-viewport').locator('img, canvas')).toBeVisible();
                            phase = 'visible-preview'; sample();
                            await page.getByTestId('preview-zoom').click();
                            for (const side of ['reference', 'output']) {
                                await page.getByTestId(`preview-${side}`).click();
                                await expect(page.getByTestId('preview-viewport')).toHaveAttribute('aria-busy', 'false'); sample();
                            }
                            const result = await page.evaluate(() => {
                                const result = window.__compressionProduct.runtimes.first.exportService._prepared.result;
                                return { width: result.width, height: result.height, bytes: result.blob.size, referenceBytes: result.referenceBlob.size };
                            });
                            assert.equal(result.width, width); assert.equal(result.height, height);
                            runs.push({ ms: Math.round(performance.now() - started), ...result });
                            await page.locator('.shoteasy-export-drawer .ant-drawer-close').click();
                            await expect(page.getByTestId('preview-viewport')).toHaveCount(0);
                            if (index < repeat - 1) await open(page, 'first', mode);
                        }
                        phase = 'released'; sample();
                        const owned = await resources(page);
                        assert.ok(Object.values(owned).every(value => !value.prepared && !value.busy && !value.contexts && !value.leases));
                        if (!v2) runs[index].releasedRssMiB = processTreeRssMiB(server.process().pid);
                        if (v2) {
                            const released = memory.sample('released');
                            Object.assign(runs[index], { startedAtMs, endedAtMs: released.atMs, resourcesZeroAtMs: released.atMs, outcome: 'downloaded', resources: owned, releasedRssMiB: released.rssMiB });
                        }
                    }
                    // Idle release is part of the production encoder contract, not a forced GC.
                    await expect.poll(async () => Object.values(await resources(page)).some(value => value.pngWorker || value.webpWorker || value.avifWorker)).toBe(false);
                    phase = 'idle-released'; const legacyEnd = sample(); clearInterval(sampler); sampler = null;
                    if (v2) {
                        currentV2.legacyEndMs = legacyEnd.atMs; currentV2.workerIdleAtMs = legacyEnd.atMs;
                        // Derive the unchanged export window from the same stream.
                        for (const point of memory.samples.filter(point => point.atMs >= baselineSample.atMs)) {
                            peak = Math.max(peak, point.rssMiB);
                            phasePeaks[point.phase] = Math.max(phasePeaks[point.phase] || 0, point.rssMiB);
                            timeline.push({ phase: point.phase, rss: point.rssMiB });
                        }
                        for (const targetMs of [5000, 15000, 30000]) {
                            while (memory.now() - legacyEnd.atMs < targetMs) await new Promise(resolve => setTimeout(resolve, Math.min(100, targetMs - (memory.now() - legacyEnd.atMs))));
                            memory.sample(`idle-${targetMs}`);
                            const sampleIndex = memory.samples.length - 1;
                            currentV2.idle.push({ targetMs, sampleIndex, resources: await resources(page) });
                        }
                        memory.stop();
                        currentV2.workerParameters = await page.evaluate(() => Object.fromEntries(Object.entries(window.__compressionProduct.runtimes).map(([name, root]) => [name,
                            Object.fromEntries(['_pngEncoder', '_webpEncoder', '_avifEncoder'].map(key => [key, root.exportService[key] ? {
                                idleMs: root.exportService[key].idleMs, timeoutMs: root.exportService[key].timeoutMs,
                            } : null]))])));
                    }
                    assert.deepEqual(errors, []); assert.deepEqual(external, []);
                    const entry = { engine, version: browser.version(), mode, kind, width, height, profile, policy, buildSha256, timingClock: 'monotonic-performance-now', path: direct ? 'App-ExportPanel-direct-download' : pair ? 'two-runtime-prepareImage-verifyPreview' : 'App-ExportPanel-100%-switch',
                        baselineRssMiB: baseline, peakRssMiB: peak, deltaRssMiB: Math.round((peak - baseline) * 10) / 10,
                        withinReviewLine: pair ? null : peak - baseline <= 384, phasePeaks, timeline, runs,
                        resources: await resources(page), externalRequests: external.length, pageErrors: errors.length,
                        memoryIsApproximate: true, rssSampler: 'all-thread-child-tree-v2', hardware: { platform: process.platform, arch: process.arch, cpus: os.cpus().length, model: os.cpus()[0]?.model }, ...(v2 ? { v2: currentV2 } : {}) };
                    output.push(entry);
                    if (v2) await evidence.checkpoint(output.length, envelope('partial'));
                    else await writeFile(report, JSON.stringify(output, null, 2));
                    console.log(JSON.stringify({ engine, mode, kind, deltaRssMiB: entry.deltaRssMiB, withinReviewLine: entry.withinReviewLine, milliseconds: runs.map(run => run.ms) }));
                } catch (error) {
                    if (v2) {
                        memory?.stop();
                        await evidence.failure(envelope('failed', { kind: functionalFailure || (error.code === 'ERR_ASSERTION' && !String(error.message).includes('RSS unavailable')) ? 'functional' : 'evidence',
                            message: error.stack, scenario: { engine, mode, kind, profile },
                            partial: { ...(currentV2 || { samples: memory?.samples || [] }), runs,
                                completedOperations: runs.filter(run => run.outcome === 'downloaded').length,
                                remainingOperations: repeat - runs.filter(run => run.outcome === 'downloaded').length } }));
                        failureRecorded = true;
                    } else await writeFile(new URL(`${report.href}.failure.json`), JSON.stringify({ engine, mode, kind, profile, buildSha256, error: error.stack }, null, 2), { flag: 'wx' });
                    throw error;
                } finally { clearInterval(sampler); memory?.stop(); try { await browser?.close(); } finally { await server?.close(); } }
            }
        }
    }
    if (v2) await evidence.complete(envelope('complete'));
} catch (error) {
    if (v2 && !failureRecorded) await evidence.failure(envelope('failed', { kind: 'evidence', message: error.stack }));
    throw error;
} finally { await origin?.close(); }
// Explicit V2 collection success is not a gate result. Run the independent
// evaluator; the default legacy command retains its original exit code.
if (!v2 && output.some(entry => entry.withinReviewLine === false)) process.exitCode = 1;
