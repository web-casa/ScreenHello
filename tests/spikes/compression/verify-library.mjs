import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { chromium, firefox, webkit } from '@playwright/test';
import { startProbeServer } from './server.mjs';
import { createPngFixture } from '../../fixtures/createPngFixture.js';

const origin = await startProbeServer(fileURLToPath(new URL('../../../artifacts/compression-consumer/', import.meta.url)));
const output = [];
try {
    for (const [name, launcher] of Object.entries({ chromium, firefox, webkit })) {
        const browser = await launcher.launch();
        try {
            const page = await browser.newPage();
            const requests = [], errors = [];
            page.on('request', request => requests.push(request.url()));
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(origin.url, { waitUntil: 'networkidle' });
            assert.equal(requests.some(url => url.endsWith('.wasm')), false);
            const png = createPngFixture();
            const result = await page.evaluate(bytes => globalThis.__compressionLibrary(bytes), [...png]);
            assert.deepEqual(PNG.sync.read(Buffer.from(result.bytes)).data, PNG.sync.read(png).data);
            assert.deepEqual([...PNG.sync.read(Buffer.from(result.tinyPng)).data], [120, 30, 210, 255, 0, 0, 0, 0]);
            assert.equal(result.pair[0].type, 'image/png'); assert.equal(result.pair[1].type, 'image/webp');
            assert.ok(result.pair.every(item => item.bytes > 0));
            assert.deepEqual(errors, []);
            const wasm = requests.filter(url => url.endsWith('.wasm'));
            assert.equal(new Set(wasm).size, 2);
            assert.ok(wasm.every(url => url.startsWith(origin.url) && !url.includes('data:')));
            output.push({ name, pixelExact: true, isolatedPair: result.pair, wasm, twoStageProductionBuild: true });
            console.log(`${name}: library asset rewrite + consumer rebuild + two clients passed`);
        } finally { await browser.close(); }
    }
} finally { await origin.close(); }
const directory = new URL('../../../artifacts/compression-evidence/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('library.json', directory), JSON.stringify(output, null, 2));
