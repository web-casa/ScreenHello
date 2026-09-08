import createAvifEncoderModule from '@jsquash/avif/codec/enc/avif_enc.js';
import { defaultOptions } from '@jsquash/avif/meta.js';
import { initEmscriptenModule } from '@jsquash/avif/utils.js';
import { MAX_COMPRESSED_PIXELS, validateExportSettings } from '../utils/exportSettings';

const SCREENSHOT_OPTIONS = Object.freeze({
    ...defaultOptions,
    quality: 60,
    qualityAlpha: 60,
    speed: 8,
    subsample: 3,
    bitDepth: 8,
    lossless: false,
});

let encoderModule = null;

const trustedWasmUrl = (value) => {
    const url = new URL(value, self.location.href);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== self.location.origin) {
        throw new Error('untrusted AVIF WASM URL');
    }
    return url.href;
};

const getEncoderModule = (wasmUrl) => {
    if (!encoderModule) {
        // 固定 scalar glue，避免 @jsquash/avif 自动入口把 pthread Worker 与第二份 WASM 带入构建。
        const localWasmUrl = trustedWasmUrl(wasmUrl);
        encoderModule = initEmscriptenModule(createAvifEncoderModule, undefined, {
            locateFile: (path) => path === 'avif_enc.wasm' ? localWasmUrl : path,
        });
    }
    return encoderModule;
};

self.onmessage = async ({ data }) => {
    const { id, pixels, width, height, wasmUrl } = data || {};
    try {
        const settings = validateExportSettings({ ...data, format: 'avif' });
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
            || width > 8192 || height > 8192 || width * height > (settings.compression ? MAX_COMPRESSED_PIXELS : 4_194_304)
            || !(pixels instanceof ArrayBuffer) || pixels.byteLength !== width * height * 4) throw new Error('avif-input-invalid');
        const module = await getEncoderModule(wasmUrl);
        const output = module.encode(new Uint8Array(pixels), width, height,
            { ...SCREENSHOT_OPTIONS, ...(settings.quality === undefined ? {} : { quality: settings.quality }) });
        if (!(output instanceof Uint8Array) || output.byteLength === 0) {
            throw new Error('empty AVIF output');
        }
        // The pinned scalar codec returns an independent Uint8Array (its public
        // wrapper returns output.buffer too). Transfer that owned output once;
        // never detach the input, a Wasm heap, or unrelated bytes in a subview.
        const ownedOutput = module.HEAPU8 instanceof Uint8Array && output.buffer instanceof ArrayBuffer
            && output.byteOffset === 0 && output.byteLength === output.buffer.byteLength
            && output.buffer !== pixels && output.buffer !== module.HEAPU8.buffer;
        const buffer = ownedOutput ? output.buffer : output.slice().buffer;
        self.postMessage({ id, ok: true, buffer }, [buffer]);
    } catch (error) {
        self.postMessage({
            id,
            ok: false,
            message: error instanceof Error ? error.message : 'AVIF encoding failed',
        });
    } finally {
        // The caller transferred ownership of these pixels to this Worker.
        // Encoding is synchronous once the module is ready; no codec view needs
        // the input now. Detach the consumed buffer without making another copy.
        if (pixels instanceof ArrayBuffer && pixels.byteLength && typeof structuredClone === 'function') {
            structuredClone(null, { transfer: [pixels] });
        }
    }
};
