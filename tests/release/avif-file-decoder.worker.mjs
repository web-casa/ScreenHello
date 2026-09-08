import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import decode, { init } from '@jsquash/avif/decode.js';

// Test-only independent file validation. No decoder is added to the Web build.
try {
    const wasm = readFileSync(new URL(import.meta.resolve('@jsquash/avif/codec/dec/avif_dec.wasm')));
    await init(new WebAssembly.Module(wasm));
    const image = await decode(Uint8Array.from(workerData).buffer);
    parentPort.postMessage({ width: image.width, height: image.height,
        corner: [...image.data.subarray(0, 4)], decoder: 'jsquash-avif-2.1.1-node-wasm' });
} catch (error) { parentPort.postMessage({ error: String(error?.message || error) }); }
