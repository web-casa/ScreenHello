import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import decode, { init } from '@jsquash/avif/decode.js';

// Test-only independent file validation. No decoder is added to the Web build.
try {
    const wasm = readFileSync(new URL(import.meta.resolve('@jsquash/avif/codec/dec/avif_dec.wasm')));
    await init(new WebAssembly.Module(wasm));
    const image = await decode(Uint8Array.from(workerData.inspectPc ? workerData.bytes : workerData).buffer);
    const result = { width: image.width, height: image.height,
        corner: [...image.data.subarray(0, 4)], decoder: 'jsquash-avif-2.1.1-node-wasm' };
    if (workerData.inspectPc) {
        if (image.width !== 2223 || image.height !== 1667) throw new Error('avif-pc-decoded-dimensions-invalid');
        const center = (Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) * 4;
        result.center = [...image.data.subarray(center, center + 4)];
        result.pixelSha256 = createHash('sha256').update(image.data).digest('hex');
        let firstOpaqueColor;
        result.opaqueVariation = false;
        for (let offset = 0; offset < image.data.length; offset += 4) {
            if (image.data[offset + 3] !== 255) continue;
            const color = (image.data[offset] << 16) | (image.data[offset + 1] << 8) | image.data[offset + 2];
            if (firstOpaqueColor === undefined) firstOpaqueColor = color;
            else if (color !== firstOpaqueColor) { result.opaqueVariation = true; break; }
        }
    }
    parentPort.postMessage(result);
} catch (error) { parentPort.postMessage({ error: String(error?.message || error) }); }
