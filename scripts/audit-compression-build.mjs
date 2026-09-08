import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { transformUpngEntry, UPNG_SOURCE_SHA256 } from '../config/upngCodecPlugin.mjs';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('node_modules/upng-js/UPNG.js', root), 'utf8');
assert.equal(createHash('sha256').update(source).digest('hex'), UPNG_SOURCE_SHA256);
transformUpngEntry(source); // Reject source drift before asserting the built assets.
const reports = [];
for (const directory of ['dist/assets/', 'lib/assets/']) {
    const files = await readdir(new URL(directory, root));
    const wasm = files.filter(file => /^squoosh_oxipng_bg-.*\.wasm$/.test(file));
    const worker = files.filter(file => /^pngEncoder\.worker-.*\.js$/.test(file));
    assert.equal(wasm.length, 1); assert.equal(worker.length, 1);
    assert.ok(!files.some(file => /codec\.worker-|workerHelpers|pkg-parallel|_mt[.-]/.test(file)));
    const workerCode = await readFile(new URL(`${directory}${worker[0]}`, root), 'utf8');
    assert.ok(!workerCode.includes('window.pako'));
    const wasmBytes = (await readFile(new URL(`${directory}${wasm[0]}`, root))).length;
    assert.ok(wasmBytes <= 180_000);
    reports.push({ directory, worker: worker[0], workerBytes: Buffer.byteLength(workerCode), wasm: wasm[0], wasmBytes });
}
const sw = await readFile(new URL('dist/sw.js', root), 'utf8');
assert.ok(!/url:"[^"]*(?:oxipng|pngEncoder)[^"]*"/.test(sw), 'PNG codecs must not be precached');
assert.ok(sw.includes('exportSettings-') && sw.includes('exportAsync-'), 'offline shell must include shared static imports');
console.log(JSON.stringify({ stage: 'compression-build', pinnedSource: UPNG_SOURCE_SHA256, scalarOnly: true, lazyCodecs: true, reports }, null, 2));
