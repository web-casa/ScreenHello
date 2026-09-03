import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from '@playwright/test';

const baseURL = process.env.SCREENHELLO_AVIF_SPIKE_URL || 'http://127.0.0.1:4195';
const engines = { chromium, firefox, webkit };
const results = [];

for (const [name, launcher] of Object.entries(engines)) {
    const browser = await launcher.launch();
    try {
        const page = await browser.newPage();
        const requests = [];
        const workers = [];
        const errors = [];
        await page.addInitScript(() => {
            const NativeWorker = globalThis.Worker;
            globalThis.__screenhelloWorkerLifecycle = { created: 0, terminated: 0 };
            globalThis.Worker = class ScreenHelloTrackedWorker extends NativeWorker {
                constructor(...args) {
                    super(...args);
                    globalThis.__screenhelloWorkerLifecycle.created += 1;
                }

                terminate() {
                    globalThis.__screenhelloWorkerLifecycle.terminated += 1;
                    return super.terminate();
                }
            };
        });
        page.on('request', (request) => requests.push(request.url()));
        page.on('worker', (worker) => workers.push(worker.url()));
        page.on('pageerror', (error) => errors.push(error.message));
        const response = await page.goto(baseURL, { waitUntil: 'networkidle' });
        assert.equal(response?.ok(), true, `${name}: fixture did not load`);
        await page.waitForFunction(() => document.querySelector('#result')?.textContent !== 'pending');
        const result = JSON.parse(await page.locator('#result').textContent());

        assert.equal(result.error, undefined, `${name}: ${result.error}`);
        assert.equal(result.mimeType, 'image/avif');
        assert.equal(result.validBrand, true);
        assert.equal(result.width, 48);
        assert.equal(result.height, 32);
        assert.ok(result.alphaSample >= 120 && result.alphaSample <= 136, `${name}: alpha channel was not preserved`);
        assert.equal(result.crossOriginIsolated, false);
        assert.deepEqual(errors, [], `${name}: uncaught page error`);
        assert.equal(workers.length, 1, `${name}: expected exactly one outer worker`);
        assert.ok(requests.every((url) => new URL(url).origin === new URL(baseURL).origin), `${name}: cross-origin request`);

        const wasmRequests = requests.filter((url) => url.endsWith('.wasm'));
        assert.equal(wasmRequests.length, 1, `${name}: expected exactly one WASM request`);
        assert.match(wasmRequests[0], /avif_enc-/);
        assert.doesNotMatch(wasmRequests[0], /avif_enc_mt/);
        assert.equal(requests.some((url) => url.includes('avif_enc_mt')), false);
        const cancelled = await page.evaluate(() => globalThis.__screenhelloCancelAvifProductionSpike());
        assert.equal(cancelled.code, 'export-cancelled');
        assert.equal(cancelled.transferredBytesRemaining, 0);
        assert.ok(cancelled.durationMs < 5_000, `${name}: cancellation took too long`);
        const workerLifecycle = await page.evaluate(() => globalThis.__screenhelloWorkerLifecycle);
        assert.deepEqual(workerLifecycle, { created: 2, terminated: 2 });
        results.push({
            name,
            ...result,
            observedWorkers: workers.length,
            workerLifecycle,
            cancellationMs: cancelled.durationMs,
            wasm: new URL(wasmRequests[0]).pathname,
        });
    } finally {
        await browser.close();
    }
}

console.log(JSON.stringify(results, null, 2));
