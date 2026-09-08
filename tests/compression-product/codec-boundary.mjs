// Diagnostic only. Export wrappers see JS↔Wasm binding allocations, not malloc
// calls inside Wasm, and linear-memory capacity is NOT browser resident memory.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import createAvif from '@jsquash/avif/codec/enc/avif_enc.js';
import { defaultOptions } from '@jsquash/avif/meta.js';
import { PNG } from 'pngjs';
import { createPngFixture } from '../fixtures/createPngFixture.js';

const label = process.env.SCREENHELLO_CODEC_LABEL || 'current';
assert.match(label, /^[a-z0-9-]{1,40}$/, 'Invalid codec label');
const destination = new URL(`../../artifacts/compression-product-evidence/codec-boundary-${label}.json`, import.meta.url);
assert.ok(!existsSync(destination), 'Codec evidence already exists; use a new label');
const wasm = await readFile(new URL(import.meta.resolve('@jsquash/avif/codec/enc/avif_enc.wasm')));
const glue = await readFile(new URL(import.meta.resolve('@jsquash/avif/codec/enc/avif_enc.js')), 'utf8');
const mallocName = glue.match(/var _malloc=a0=>\(_malloc=wasmExports\["([^"]+)"\]\)\(a0\)/)?.[1];
const freeName = glue.match(/var _free=a0=>\(_free=wasmExports\["([^"]+)"\]\)\(a0\)/)?.[1];
assert.ok(mallocName && freeName, 'Unrecognized fixed glue binding; do not guess exports');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const compiled = await WebAssembly.compile(wasm);
const options = { ...defaultOptions, quality: 60, qualityAlpha: 60, speed: 8, subsample: 3, bitDepth: 8, lossless: false };
const report = { diagnosticOnly: true, node: process.version, wasmSha256: sha256(wasm), glueSha256: sha256(glue),
    allocationScope: 'JS-to-Wasm-export-calls-only', options, cases: [] };
try {
    for (const kind of ['screenshot', 'noise']) {
        let allocations = [], frees = [];
        const module = await createAvif({ noInitialRun: true, instantiateWasm(imports, receive) {
            const instance = new WebAssembly.Instance(compiled, imports);
            const exports = { ...instance.exports };
            const malloc = exports[mallocName], free = exports[freeName];
            assert.equal(typeof malloc, 'function'); assert.equal(typeof free, 'function');
            exports[mallocName] = size => { const pointer = malloc(size); allocations.push({ size, pointer }); return pointer; };
            exports[freeName] = pointer => { frees.push(pointer); return free(pointer); };
            receive({ exports });
            return exports;
        } });
        const width = 2048, height = 2048;
        const pixels = kind === 'screenshot' ? new Uint8Array(PNG.sync.read(createPngFixture(width, height)).data)
            : new Uint8Array(width * height * 4);
        if (kind === 'noise') {
            let state = 123456;
            for (let i = 0; i < pixels.length; i += 4) {
                state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
                pixels.set([state & 255, state >>> 8 & 255, state >>> 16 & 255, 255], i);
            }
        }
        const inputSha256 = sha256(pixels);
        const entry = { kind, width, height, inputBytes: pixels.byteLength, initialHeapBytes: module.HEAPU8.byteLength, runs: [] };
        report.cases.push(entry);
        for (let index = 0; index < 6; index++) {
            allocations = []; frees = [];
            const beforeHeapBytes = module.HEAPU8.byteLength;
            const output = module.encode(pixels, width, height, options);
            assert.ok(output instanceof Uint8Array && output.byteLength > 0);
            const independent = output.buffer instanceof ArrayBuffer && output.byteOffset === 0
                && output.byteLength === output.buffer.byteLength && output.buffer !== pixels.buffer && output.buffer !== module.HEAPU8.buffer;
            assert.ok(independent, 'Output is not independently transferable');
            const expectedSha256 = sha256(output), outputBytes = output.byteLength;
            const delivered = structuredClone(output.buffer, { transfer: [output.buffer] });
            assert.equal(output.byteLength, 0);
            assert.equal(sha256(new Uint8Array(delivered)), expectedSha256);
            assert.equal(sha256(pixels), inputSha256);
            const bindingInputs = allocations.filter(item => item.size === pixels.byteLength + 5);
            assert.equal(bindingInputs.length, 1, 'Expected one std::string wire allocation');
            assert.ok(bindingInputs.every(item => frees.includes(item.pointer)), 'Input wire allocation not freed');
            if (entry.runs.length) assert.equal(expectedSha256, entry.runs[0].outputSha256);
            entry.runs.push({ beforeHeapBytes, afterHeapBytes: module.HEAPU8.byteLength,
                allocations: allocations.map(item => ({ bytes: item.size, freedViaBinding: frees.includes(item.pointer) })),
                outputBytes, outputSha256: expectedSha256, outputIndependent: independent });
        }
        console.log(JSON.stringify(entry));
    }
} catch (error) { report.error = String(error.stack || error); process.exitCode = 1; }
finally {
    await mkdir(new URL('.', destination), { recursive: true });
    await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' });
}
