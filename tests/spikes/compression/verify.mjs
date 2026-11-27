import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { PNG } from 'pngjs';
import { chromium, firefox, webkit } from '@playwright/test';
import { createPngFixture } from '../../fixtures/createPngFixture.js';

const baseURL = process.env.SCREENHELLO_COMPRESSION_URL || 'http://127.0.0.1:4196/';
const directory = new URL('../../../artifacts/compression-evidence/', import.meta.url);
await mkdir(directory, { recursive: true });
const fromDataUrl = (data) => Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const engines = { chromium, firefox, webkit };
const report = { scope: 'C0 isolated production spike; not product or minimum-browser acceptance',
    time: new Date().toISOString(), platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model, engines: [] };
const selected = process.env.SCREENHELLO_COMPRESSION_ENGINE;
if (selected) assert.ok(Object.hasOwn(engines, selected), 'unknown engine');

for (const [name, launcher] of Object.entries(engines)) {
    if (selected && selected !== name) continue;
    const browser = await launcher.launch();
    try {
        const context = await browser.newContext({ viewport: { width: 1250, height: 850 } });
        const page = await context.newPage();
        page.setDefaultTimeout(45_000);
        const requests = [], errors = [], workers = [];
        page.on('request', (request) => requests.push(request.url()));
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('worker', (worker) => workers.push(worker.url()));
        await page.addInitScript(() => {
            const NativeWorker = globalThis.Worker;
            globalThis.__probeWorkers = { created: 0, terminated: 0 };
            globalThis.Worker = class extends NativeWorker {
                constructor(...args) { super(...args); this.stopped = false; globalThis.__probeWorkers.created++; }
                terminate() { if (!this.stopped) { this.stopped = true; globalThis.__probeWorkers.terminated++; } return super.terminate(); }
            };
        });
        const response = await page.goto(baseURL, { waitUntil: 'networkidle' });
        assert.ok(response.ok());
        assert.ok(response.headers()['content-security-policy']?.includes("worker-src 'self'"), 'CSP missing');
        assert.equal(requests.some(url => url.endsWith('.wasm')), false, 'eager WASM fetch');
        const result = { name, version: browser.version(), cases: [], cancellation: [] };
        const cases = [];
        for (const colors of [64, 128, 256]) cases.push({ kind: 'transparent', mode: 'png-lossy', width: 1, height: 1, colors });
        for (const kind of ['screenshot', 'few-colors', 'photo', 'noise']) {
            cases.push({ kind, mode: 'png-lossless' }, { kind, mode: 'webp-lossless' });
            for (const colors of [64, 128, 256]) cases.push({ kind, mode: 'png-lossy', colors });
        }
        for (const kind of ['screenshot', 'photo']) {
            for (const mode of ['jpg-lossy', 'webp-lossy', 'avif-lossy']) {
                for (const quality of mode === 'avif-lossy' ? [40, 60, 80] : [60, 80, 90]) cases.push({ kind, mode, quality });
            }
        }
        for (const options of cases) {
            const current = await page.evaluate(opts => globalThis.__compressionProbe.run(opts), options);
            assert.equal(current.decodedWidth, current.width); assert.equal(current.decodedHeight, current.height);
            const output = fromDataUrl(current.output);
            const baseline = PNG.sync.read(fromDataUrl(current.baseline));
            if (current.mode.startsWith('png-')) {
                const decoded = PNG.sync.read(output);
                assert.equal(decoded.width, current.width); assert.equal(decoded.height, current.height);
                if (current.mode === 'png-lossless') assert.deepEqual(decoded.data, baseline.data, `${name}: PNG lossless pixels`);
                else {
                    const colors = new Set();
                    for (let i = 0; i < decoded.data.length; i += 4) colors.add(decoded.data.readUInt32BE(i));
                    assert.ok(colors.size <= current.colors, 'palette upper bound');
                    current.usedColors = colors.size;
                    if (current.kind === 'screenshot') assert.ok(current.zeroAlpha > 0, 'transparent background disappeared');
                    if (current.kind === 'transparent') assert.equal(current.zeroAlpha, current.width * current.height, 'transparent 1px fixture');
                }
            } else if (current.mode === 'webp-lossless') assert.equal(current.differentPixels, 0, 'WebP lossless changed opaque input');
            const stem = `${name}-${current.kind}-${current.mode}-${current.colors}-${current.quality}`;
            if (current.kind === 'screenshot' || current.kind === 'photo') {
                await writeFile(new URL(`${stem}.${current.mode.split('-')[0]}`, directory), output);
                await writeFile(new URL(`${name}-${current.kind}-${current.mode.startsWith('webp-') || current.mode === 'jpg-lossy' ? 'opaque' : 'alpha'}-baseline.png`, directory), fromDataUrl(current.baseline));
            }
            const { baseline: _baseline, output: _output, ...metrics } = current;
            void _baseline; void _output;
            result.cases.push({ ...metrics, sha256: digest(output) });
            console.log(`${name} ${options.kind} ${options.mode} ${options.colors || options.quality || ''}: ${current.outputBytes} B`);
        }
        // Raw PNG fixture avoids Canvas premultiplication masking transparent RGB changes.
        const raw = PNG.sync.read(createPngFixture(64, 48));
        raw.data.set([67, 89, 123, 0, 250, 12, 85, 1, 13, 177, 201, 127]);
        const hidden = PNG.sync.write(raw);
        const optimised = await page.evaluate(({ bytes, width, height }) => globalThis.__compressionProbe.optimiseRawFixture(bytes, width, height),
            { bytes: [...hidden], width: raw.width, height: raw.height });
        assert.deepEqual(PNG.sync.read(fromDataUrl(optimised)).data, raw.data, 'hidden RGB/alpha changed');
        result.transparentRgbExact = true;
        for (const mode of ['png-lossless', 'png-lossy', 'webp-lossless']) {
            for (const timeout of [false, true]) {
                const cancelled = await page.evaluate(({ mode, timeout }) => globalThis.__compressionProbe.cancellation(mode, timeout), { mode, timeout });
                assert.equal(cancelled.error, timeout ? 'compression-timeout' : 'compression-cancelled');
                if (!timeout) assert.equal(cancelled.computationStarted, true, 'cancel must exercise an encoding worker, not only startup');
                assert.ok(cancelled.detached && cancelled.retryBytes > 0 && cancelled.durationMs < 5000);
                result.cancellation.push({ mode, timeout, ...cancelled });
            }
        }
        const pair = await page.evaluate(() => Promise.all([
            globalThis.__compressionProbe.run({ mode: 'png-lossy', colors: 64, includeBytes: false }),
            globalThis.__compressionProbe.run({ mode: 'png-lossy', colors: 256, includeBytes: false }),
        ]));
        assert.equal(pair[0].colors, 64); assert.equal(pair[1].colors, 256);
        result.twoInstances = pair;
        await page.evaluate(() => globalThis.__compressionProbe.run({ mode: 'png-lossy', show: true, includeBytes: false }));
        await page.locator('#comparison').screenshot({ path: new URL(`${name}-comparison.png`, directory).pathname });
        result.workers = await page.evaluate(() => globalThis.__probeWorkers);
        assert.equal(result.workers.created, result.workers.terminated, 'worker leak');
        assert.equal(await page.evaluate(() => crossOriginIsolated), false);
        assert.deepEqual(errors, []);
        assert.ok(requests.every(url => ['data:', 'blob:'].includes(new URL(url).protocol) || new URL(url).origin === new URL(baseURL).origin), 'external request');
        assert.ok(workers.every(url => url.includes('codec.worker-')), 'unexpected nested worker');
        assert.ok(requests.some(url => url.includes('squoosh_oxipng_bg-')));
        assert.ok(!requests.some(url => /pkg-parallel|_mt|workerHelpers/.test(url)));
        result.sameOriginOnly = true; result.scalarOnly = true; result.csp = true;
        report.engines.push(result);
        await writeFile(new URL(`${name}-correctness.json`, directory), JSON.stringify(result, null, 2));
        console.log(`${name}: correctness / cancellation / ownership / CSP passed`);
    } finally { await browser.close(); }
}
const assetRoot = new URL('../../../artifacts/compression-spike/assets/', import.meta.url);
report.codecAssets = [];
for (const file of await readdir(assetRoot)) {
    if (!/codec\.worker|\.wasm$/.test(file)) continue;
    const bytes = await readFile(new URL(file, assetRoot));
    report.codecAssets.push({ file, bytes: bytes.length, sha256: digest(bytes) });
}
await writeFile(new URL('correctness.json', directory), JSON.stringify(report, null, 2));
console.log('C0 production codec verification passed (not a product release gate).');
