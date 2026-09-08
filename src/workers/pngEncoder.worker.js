import UPNG from 'upng-js';
import init, { optimise } from '@jsquash/oxipng/codec/pkg/squoosh_oxipng.js';
import { MAX_COMPRESSED_PIXELS, validateExportSettings } from '../utils/exportSettings';

let modulePromise;
let busy = false;
self.onmessage = async ({ data }) => {
    const { id, width, height, buffer, wasmUrl } = data || {};
    if (busy) { self.postMessage({ id, ok: false, message: 'png-encoder-busy' }); return; }
    busy = true;
    try {
        const settings = validateExportSettings(data);
        if (settings.format !== 'png' || !['lossless', 'lossy'].includes(settings.compression)
            || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
            || width > 8192 || height > 8192 || width * height > MAX_COMPRESSED_PIXELS
            || !(buffer instanceof ArrayBuffer) || buffer.byteLength > MAX_COMPRESSED_PIXELS * 5) throw new Error('png-input-invalid');
        let output;
        if (settings.compression === 'lossless') {
            const header = new DataView(buffer);
            if (buffer.byteLength < 33 || header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a
                || header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452
                || header.getUint32(16) !== width || header.getUint32(20) !== height) throw new Error('png-input-invalid');
            const url = new URL(wasmUrl, self.location.href);
            if (!['http:', 'https:'].includes(url.protocol) || url.origin !== self.location.origin) throw new Error('png-wasm-untrusted');
            modulePromise ??= init(url.href);
            await modulePromise;
            output = optimise(new Uint8Array(buffer), 2, false, false);
        } else {
            if (buffer.byteLength !== width * height * 4) throw new Error('png-input-invalid');
            output = new Uint8Array(UPNG.encode([buffer], width, height, settings.paletteColors));
        }
        const result = output.slice().buffer;
        self.postMessage({ id, ok: true, buffer: result }, [result]);
    } catch (error) { self.postMessage({ id, ok: false, message: error instanceof Error ? error.message : 'png-encode-failed' }); }
    finally { busy = false; }
};
