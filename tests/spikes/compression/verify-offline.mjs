import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, firefox, webkit } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { startProbeServer } from './server.mjs';

const output = [];
for (const [name, launcher] of Object.entries({ chromium, firefox, webkit })) {
    const origin = await startProbeServer(fileURLToPath(new URL('../../../artifacts/compression-spike/', import.meta.url)));
    const browser = await launcher.launch();
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(origin.url, { waitUntil: 'networkidle' });
        await page.evaluate(async () => { await navigator.serviceWorker.register('./sw.js'); await navigator.serviceWorker.ready; });
        await page.reload({ waitUntil: 'networkidle' });
        assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true);
        origin.setOffline(true);
        const cold = await page.evaluate(async () => {
            try { await globalThis.__compressionProbe.run({ mode: 'png-lossless', includeBytes: false }); return 'unexpected-success'; }
            catch { return 'unavailable'; }
        });
        assert.equal(cold, 'unavailable', `${name}: cold offline must not claim codec availability`);
        origin.setOffline(false);
        for (const mode of ['png-lossless', 'png-lossy', 'webp-lossless']) {
            await page.evaluate(mode => globalThis.__compressionProbe.run({ mode, includeBytes: false }), mode);
        }
        await page.waitForFunction(async () => {
            const cache = await caches.open('screenhello-runtime-assets-v1');
            return (await cache.keys()).filter(request => request.url.endsWith('.wasm')).length >= 2;
        });
        const cached = await page.evaluate(async () => (await (await caches.open('screenhello-runtime-assets-v1')).keys()).map(x => x.url));
        if (name === 'chromium') {
            const session = await context.newCDPSession(page);
            await session.send('Network.clearBrowserCache'); await session.detach();
        }
        origin.setOffline(true);
        await page.reload({ waitUntil: 'networkidle' });
        const warm = [];
        for (const mode of ['png-lossless', 'png-lossy', 'webp-lossless']) {
            const result = await page.evaluate(mode => globalThis.__compressionProbe.run({ mode, includeBytes: false }), mode);
            assert.ok(result.outputBytes > 0); warm.push({ mode, bytes: result.outputBytes });
        }
        output.push({ name, cold, warm, cached, originUnavailable: true, refusedOriginRequests: origin.refused,
            httpCacheExplicitlyCleared: name === 'chromium', productRuntimeCacheRule: true });
        console.log(`${name}: uncached offline unavailable; cached codec offline reload passed`);
    } finally { await browser.close(); await origin.close(); }
}
const directory = new URL('../../../artifacts/compression-evidence/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('offline.json', directory), JSON.stringify(output, null, 2));
