// Diagnostic only: same production harness and direct-download path as benchmark.mjs.
// Sparse PSS/idle/unmount observations do not replace its unchanged 384 MiB RSS gate.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, webkit, expect as playwrightExpect } from '@playwright/test';
import { PNG } from 'pngjs';
import { createPngFixture } from '../fixtures/createPngFixture.js';
import { processTreeRssMiB } from '../spikes/compression/rss.mjs';
import { startProbeServer } from '../spikes/compression/server.mjs';
import { compressionTimeoutMs } from '../../src/utils/exportSettings.js';
import { processRole, readNativeMemory } from './native-memory.mjs';
import { readCdpAllocations, readCdpMemory } from './cdp-memory.mjs';

const expect = playwrightExpect.configure({ timeout: 45_000 });
const engine = process.env.SCREENHELLO_COMPRESSION_ENGINE || 'webkit';
const engines = { chromium, webkit };
assert.ok(Object.hasOwn(engines, engine), 'Diagnostic supports chromium or webkit');
const chromiumChannel = process.env.SCREENHELLO_MEMORY_CHROMIUM_CHANNEL || null;
assert.ok(chromiumChannel === null || (engine === 'chromium' && chromiumChannel === 'chromium'), 'Only bundled Chromium is allowed as a diagnostic channel');
const traceAllocations = process.env.SCREENHELLO_MEMORY_CDP_ALLOCATIONS === '1';
const traceCdp = process.env.SCREENHELLO_MEMORY_CDP_TRACE === '1' || traceAllocations;
assert.ok(!traceCdp || engine === 'chromium', 'CDP diagnostics require Chromium');
const mode = process.env.SCREENHELLO_COMPRESSION_MODE || 'avif-lossy';
const kind = process.env.SCREENHELLO_COMPRESSION_KIND || 'screenshot';
const repeat = Number(process.env.SCREENHELLO_COMPRESSION_REPEAT || 6);
const label = process.env.SCREENHELLO_COMPRESSION_LABEL || 'current';
const traceCanvases = process.env.SCREENHELLO_MEMORY_CANVAS_TRACE === '1';
const traceNative = process.env.SCREENHELLO_MEMORY_NATIVE_TRACE === '1';
const stage = process.env.SCREENHELLO_MEMORY_STAGE || 'full';
const reducedMotion = process.env.SCREENHELLO_MEMORY_REDUCED_MOTION === '1';
const exportMotionOnly = process.env.SCREENHELLO_MEMORY_EXPORT_MOTION_ONLY === '1';
const legacyExportMotion = process.env.SCREENHELLO_MEMORY_LEGACY_EXPORT_MOTION === '1';
assert.ok(!legacyExportMotion || (!exportMotionOnly && !reducedMotion), 'Motion overrides are mutually exclusive');
assert.ok(['full', 'render', 'encode', 'pipeline', 'ui'].includes(stage));
assert.ok(stage === 'full' || mode === 'avif-lossy', 'Stage isolation currently covers AVIF only');
assert.ok(['png-lossless', 'png-lossy', 'webp-lossless', 'webp-lossy', 'jpg-lossy', 'avif-lossy'].includes(mode));
assert.ok(['screenshot', 'noise'].includes(kind));
assert.ok(Number.isInteger(repeat) && repeat >= 6 && repeat <= 24);
assert.match(label, /^[a-z0-9-]{1,40}$/);
const directory = new URL('../../artifacts/compression-product-evidence/', import.meta.url);
const reportPath = new URL(`memory-diagnostic-${engine}-${mode}-${kind}-repeat${repeat}${stage === 'full' ? '' : `-stage-${stage}`}-${label}.json`, directory);
assert.ok(!existsSync(reportPath), 'Diagnostic evidence already exists; use a new label');
const width = 2048, height = 2048;
const build = process.env.SCREENHELLO_MEMORY_BUILD || fileURLToPath(new URL('../../artifacts/compression-product/', import.meta.url));
const digest = createHash('sha256');
function hashDirectory(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const relative = `${prefix}${entry.name}`;
        if (entry.isDirectory()) hashDirectory(`${directory}/${entry.name}`, `${relative}/`);
        else { digest.update(`${relative}\0`); digest.update(readFileSync(`${directory}/${entry.name}`)); }
    }
}
hashDirectory(build);
const report = { diagnosticOnly: true, engine, chromiumChannel, mode, kind, repeat, width, height, startedAt: new Date().toISOString(),
    traceCanvases, traceNative, traceCdp, traceAllocations, stage, reducedMotion, exportMotionOnly, legacyExportMotion,
    buildSha256: digest.digest('hex'), node: process.version, platform: process.platform, arch: process.arch, checkpoints: [], runs: [] };
const safeRead = path => { try { return readFileSync(path, 'utf8'); } catch { return ''; } };
function memory(pid) {
    const pending = [pid], seen = new Set(), processes = [];
    while (pending.length) {
        const current = pending.pop();
        if (!current || seen.has(current)) continue;
        seen.add(current);
        const status = safeRead(`/proc/${current}/status`), rollup = safeRead(`/proc/${current}/smaps_rollup`);
        const rss = status.match(/^VmRSS:\s+(\d+)\s+kB$/m), pss = rollup.match(/^Pss:\s+(\d+)\s+kB$/m);
        if (rss) processes.push({ pid: current, name: safeRead(`/proc/${current}/comm`).trim(),
            role: processRole(safeRead(`/proc/${current}/cmdline`)),
            rssMiB: Number(rss[1]) / 1024, pssMiB: pss ? Number(pss[1]) / 1024 : null,
            ...(traceNative ? { native: readNativeMemory(current) } : {}) });
        let threads;
        try { threads = readdirSync(`/proc/${current}/task`); } catch { threads = [String(current)]; }
        for (const tid of threads) pending.push(...safeRead(`/proc/${current}/task/${tid}/children`).trim().split(/\s+/).map(Number));
    }
    return { rssMiB: processes.reduce((sum, item) => sum + item.rssMiB, 0),
        pssMiB: processes.length && processes.every(item => item.pssMiB !== null) ? processes.reduce((sum, item) => sum + item.pssMiB, 0) : null, processes };
}
const origin = await startProbeServer(build);
let server, browser, sampler, cdp, allocationSampling = false;
try {
    server = await engines[engine].launchServer({ host: '127.0.0.1', ...(chromiumChannel ? { channel: chromiumChannel } : {}) });
    browser = await engines[engine].connect(server.wsEndpoint());
    report.version = browser.version();
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    if (traceCdp) cdp = await page.context().newCDPSession(page);
    if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
    page.setDefaultTimeout(45_000);
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(origin.url)) external.push(request.url()); });
    await page.addInitScript(traceCanvases => {
        // Store only primitive metadata, never Blobs or Worker instances.
        const urls = new Map(), create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = value => { const url = create(value); urls.set(url, { bytes: value.size || 0, type: value.type || '' }); return url; };
        URL.revokeObjectURL = url => { revoke(url); urls.delete(url); };
        window.__memoryUrls = () => ({ count: urls.size, bytes: [...urls.values()].reduce((sum, value) => sum + value.bytes, 0) });
        if (traceCanvases) {
            const canvases = [], createElement = document.createElement.bind(document);
            document.createElement = (...args) => {
                const element = createElement(...args);
                if (element instanceof HTMLCanvasElement) canvases.push(new WeakRef(element));
                return element;
            };
            window.__memoryCanvases = () => {
                let alive = 0, detached = 0, pixels = 0, detachedPixels = 0;
                for (const weak of canvases) {
                    const canvas = weak.deref();
                    if (!canvas) continue;
                    alive++; pixels += canvas.width * canvas.height;
                    if (!canvas.isConnected) { detached++; detachedPixels += canvas.width * canvas.height; }
                }
                return { created: canvases.length, alive, detached, pixels, detachedPixels };
            };
        }
    }, traceCanvases);
    await page.goto(origin.url, { waitUntil: 'networkidle' });
    if (exportMotionOnly) {
        // Diagnostic single-variable override, never part of the formal gate.
        // This fixture opens only the export overlay during the measured loop.
        await page.addStyleTag({ content: '.shoteasy-overlay-drawer .ant-drawer-content-wrapper, .shoteasy-overlay-drawer .ant-drawer-mask { animation-duration: 0.01ms !important; animation-delay: 0s !important; transition-duration: 0.01ms !important; transition-delay: 0s !important; }' });
    }
    if (legacyExportMotion) {
        // Counterfactual on this exact build, NOT the original MO binary.
        // Same cascade layer and higher specificity beat the product's important rule.
        await page.addStyleTag({ content: '@layer components { .shoteasy-components.shoteasy-export-overlay .ant-drawer-content-wrapper, .shoteasy-components.shoteasy-export-overlay .ant-drawer-mask { animation-duration: 0.3s !important; animation-delay: 0s !important; transition-duration: 0.3s !important; transition-delay: 0s !important; } }' });
    }
    let buffer = createPngFixture(width, height);
    if (kind === 'noise') {
        const png = new PNG({ width, height });
        let seed = 123456;
        for (let i = 0; i < png.data.length; i += 4) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            png.data.set([seed & 255, seed >>> 8 & 255, seed >>> 16 & 255, 255], i);
        }
        buffer = PNG.sync.write(png);
    }
    await page.getByTestId('locale-first').locator('.shoteasy-upload-card input[type=file]').setInputFiles({ name: `${kind}.png`, mimeType: 'image/png', buffer });
    await page.waitForFunction(() => window.__compressionProduct.runtimes.first?.editor.app?.tree);
    await page.evaluate(async ({ width, height, kind }) => {
        const root = window.__compressionProduct.runtimes.first;
        root.option.setSize({ type: 'fixed', width, height }); root.option.setPadding(0);
        root.option.setBackground('none'); root.option.setShadowConf({ visible: false });
        if (kind === 'screenshot') {
            root.editor.addShape({ id: 'c4-text', type: 'text', x: 50, y: 100, text: 'ScreenHello ABC abc 0123456789', fontSize: 22, fill: '#172b4d' });
            root.editor.addShape({ id: 'c4-line', type: 'SquareFill', x: 50, y: 160, width: 900, height: 1, fill: '#2467ac' });
        }
        await new Promise(resolve => requestAnimationFrame(resolve));
        await root.renderTaskTracker.waitForIdle();
        await new Promise(resolve => requestAnimationFrame(resolve));
    }, { width, height, kind });
    const open = async () => {
        await page.evaluate(async mode => {
            const root = window.__compressionProduct.runtimes.first;
            root.workspace.setExportSettings({ format: mode.split('-')[0], ratio: 1,
                compression: mode.endsWith('lossless') ? 'lossless' : 'lossy', ...(mode === 'png-lossy' ? { paletteColors: 256 } : {}) }, { replace: true });
            await root.commands.execute('file.openExport');
        }, mode);
        await expect(page.getByTestId('export-preview')).toBeDisabled();
    };
    const resources = () => page.evaluate(() => ({ urls: window.__memoryUrls(),
        stageWorker: Boolean(window.__compressionProduct?.stageEncoder?._worker),
        canvasTrace: window.__memoryCanvases?.() ?? null,
        canvasCount: document.querySelectorAll('canvas').length,
        canvasPixels: [...document.querySelectorAll('canvas')].reduce((sum, canvas) => sum + canvas.width * canvas.height, 0),
        runtimes: Object.fromEntries(Object.entries(window.__compressionProduct?.runtimes || {}).map(([name, root]) => [name, {
            disposed: root.isDisposed,
            leases: root.exportService._canvasLeases.size, contexts: root.exportService._contexts.size,
            prepared: Boolean(root.exportService._prepared), busy: root.exportService.isBusy,
            pngWorker: Boolean(root.exportService._pngEncoder?.worker), webpWorker: Boolean(root.exportService._webpEncoder?._worker),
            avifWorker: Boolean(root.exportService._avifEncoder?._worker),
        }])) }));
    const checkpoint = async phase => {
        const point = { phase, elapsedMs: Date.now() - started, ...memory(server.process().pid), resources: await resources() };
        if (cdp) point.cdp = await readCdpMemory(cdp);
        if (allocationSampling && (phase === 'baseline' || phase.endsWith(`-${repeat}`)
            || phase === 'workers-idle' || phase === 'idle-35s' || phase === 'unmounted-35s')) {
            point.allocations = await readCdpAllocations(cdp);
        }
        report.checkpoints.push(point);
        console.log(JSON.stringify({ phase, rssMiB: point.rssMiB, pssMiB: point.pssMiB, resources: point.resources }));
        return point;
    };
    await open();
    // The pre-MP harness also supports diagnostics; it lacks the new export class.
    report.exportMotion = await page.locator('.shoteasy-overlay-drawer .ant-drawer-content-wrapper').evaluate(element => {
        const style = getComputedStyle(element);
        return { animationDuration: style.animationDuration, transitionDuration: style.transitionDuration };
    });
    if (legacyExportMotion) assert.equal(report.exportMotion.transitionDuration, '0.3s', 'Legacy motion override not applied');
    if (stage === 'encode') {
        // Diagnostic isolation only: a fixed source is retained in this baseline.
        // Each encode still uses the real product adapter/Worker and a fresh transfer.
        await page.evaluate(async () => {
            const harness = window.__compressionProduct;
            const service = harness.runtimes.first.exportService;
            harness.stageEncoder = await service.avifEncoderFactory();
            const lease = await service.exportCanvas({ ratio: 1 });
            try { harness.stagePixels = lease.canvas.getContext('2d').getImageData(0, 0, lease.width, lease.height).data; }
            finally { lease.release(); }
        });
    }
    if (traceAllocations) {
        try {
            await cdp.send('Memory.startSampling', { samplingInterval: 65_536 });
            allocationSampling = true;
        } catch (error) {
            report.allocationSamplingError = error instanceof Error ? error.message : String(error);
        }
    }
    const started = Date.now(), baseline = processTreeRssMiB(server.process().pid);
    assert.ok(baseline > 0, 'RSS unavailable');
    let peak = baseline;
    sampler = setInterval(() => { peak = Math.max(peak, processTreeRssMiB(server.process().pid)); }, 50);
    await checkpoint('baseline');
    for (let i = 0; i < repeat; i++) {
        const start = Date.now();
        if (stage === 'ui') {
            await page.locator('.shoteasy-export-drawer .ant-drawer-close').click();
            await expect(page.locator('.shoteasy-export-drawer')).toHaveCount(0);
            if (i < repeat - 1) await open();
            const point = await checkpoint(`ui-${i + 1}`);
            assert.ok(Object.values(point.resources.runtimes).every(item => !item.leases && !item.contexts && !item.prepared && !item.busy
                && !item.pngWorker && !item.webpWorker && !item.avifWorker));
            report.runs.push({ stage, ms: Date.now() - start });
            continue;
        }
        if (stage !== 'full') {
            const result = await page.evaluate(async ({ stage, width, height }) => {
                const harness = window.__compressionProduct;
                if (stage === 'pipeline') {
                    const result = await harness.runtimes.first.exportService.exportImage({ format: 'avif', ratio: 1, compression: 'lossy', quality: 60 });
                    return { bytes: result.blob.size, mime: result.blob.type, width: result.width, height: result.height };
                }
                if (stage === 'encode') {
                    const blob = await harness.stageEncoder.encode({ pixels: harness.stagePixels.slice(), width, height, compression: 'lossy', quality: 60 });
                    return { bytes: blob.size, mime: blob.type };
                }
                const lease = await harness.runtimes.first.exportService.exportCanvas({ ratio: 1 });
                try {
                    const pixels = lease.canvas.getContext('2d').getImageData(0, 0, width, height).data;
                    const bytes = pixels.byteLength;
                    // Match the existing consumed-input release, without invoking a codec.
                    structuredClone(null, { transfer: [pixels.buffer] });
                    return { pixelBytes: bytes, width: lease.width, height: lease.height };
                } finally { lease.release(); }
            }, { stage, width, height });
            if (stage === 'encode' || stage === 'pipeline') { assert.ok(result.bytes > 0); assert.equal(result.mime, 'image/avif'); }
            else { assert.equal(result.pixelBytes, width * height * 4); assert.equal(result.width, width); assert.equal(result.height, height); }
            if (stage === 'pipeline') { assert.equal(result.width, width); assert.equal(result.height, height); }
            const point = await checkpoint(`${stage}-${i + 1}`);
            assert.ok(Object.values(point.resources.runtimes).every(item => !item.leases && !item.contexts && !item.prepared && !item.busy));
            report.runs.push({ stage, ...result, ms: Date.now() - start });
            continue;
        }
        const pending = page.waitForEvent('download', { timeout: compressionTimeoutMs(width, height) + 15_000 });
        await page.getByTestId('export-download').click();
        const download = await pending;
        assert.equal(await download.failure(), null);
        let bytes = 0;
        for await (const chunk of await download.createReadStream()) bytes += chunk.length;
        assert.ok(bytes > 0); assert.ok(download.suggestedFilename().endsWith(`.${mode.split('-')[0]}`));
        await download.delete();
        await expect(page.locator('.shoteasy-export-drawer')).toHaveCount(0);
        if (i < repeat - 1) await open();
        const point = await checkpoint(`download-${i + 1}`);
        assert.ok(Object.values(point.resources.runtimes).every(item => !item.leases && !item.contexts && !item.prepared && !item.busy));
        report.runs.push({ bytes, ms: Date.now() - start });
    }
    await expect.poll(async () => {
        const current = await resources();
        return current.stageWorker || Object.values(current.runtimes).some(item => item.pngWorker || item.webpWorker || item.avifWorker);
    }).toBe(false);
    report.baselineRssMiB = baseline; report.activePeakRssMiB = peak; report.activeDeltaRssMiB = Math.round((peak - baseline) * 10) / 10;
    clearInterval(sampler); sampler = null;
    await checkpoint('workers-idle');
    await delay(5_000); await checkpoint('idle-5s');
    await delay(30_000); await checkpoint('idle-35s');
    await page.evaluate(() => {
        window.__compressionProduct.stageEncoder?.dispose();
        window.__compressionProduct.stageEncoder = null;
        window.__compressionProduct.stagePixels = null;
        window.__compressionProduct.unmount();
    });
    await page.waitForFunction(() => Object.values(window.__compressionProduct.runtimes).every(root => root.isDisposed));
    await checkpoint('unmounted-retained-harness');
    await page.evaluate(() => { window.__compressionProduct = null; });
    await delay(5_000); await checkpoint('unmounted-5s');
    await delay(30_000); await checkpoint('unmounted-35s');
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    report.pageErrors = errors; report.externalRequests = external;
    const final = report.checkpoints.at(-1).resources;
    assert.equal(final.urls.count, 0); assert.equal(final.canvasCount, 0);
} catch (error) { report.error = String(error.stack || error); process.exitCode = 1; }
finally {
    clearInterval(sampler);
    if (allocationSampling) {
        try { await cdp.send('Memory.stopSampling'); }
        catch (error) { report.allocationStopError = error instanceof Error ? error.message : String(error); }
    }
    try {
        await mkdir(directory, { recursive: true });
        await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' });
    } finally {
        try { await cdp?.detach(); }
        finally {
            try { await browser?.close(); }
            finally { try { await server?.close(); } finally { await origin.close(); } }
        }
    }
}
