import createWebpEncoderModule from '@jsquash/webp/codec/enc/webp_enc.js';
import { defaultOptions } from '@jsquash/webp/meta.js';
import { initEmscriptenModule } from '@jsquash/webp/utils.js';
import { MAX_COMPRESSED_PIXELS, validateExportSettings } from '../utils/exportSettings';

const SCREENSHOT_OPTIONS = Object.freeze({
    ...defaultOptions,
    quality: 90,
});

let encoderModule = null;

const trustedWasmUrl = (value) => {
    const url = new URL(value, self.location.href);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== self.location.origin) {
        throw new Error('untrusted WebP WASM URL');
    }
    return url.href;
};

const getEncoderModule = (wasmUrl) => {
    if (!encoderModule) {
        const localWasmUrl = trustedWasmUrl(wasmUrl);
        encoderModule = initEmscriptenModule(createWebpEncoderModule, undefined, {
            locateFile: (path) => path === 'webp_enc.wasm' ? localWasmUrl : path,
        });
    }
    return encoderModule;
};

self.onmessage = async ({ data }) => {
    const { id, pixels, width, height, wasmUrl } = data || {};
    try {
        const settings = validateExportSettings({ ...data, format: 'webp' });
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
            || width > 8192 || height > 8192 || width * height > (settings.compression ? MAX_COMPRESSED_PIXELS : 16_777_216)
            || !(pixels instanceof ArrayBuffer) || pixels.byteLength !== width * height * 4) throw new Error('webp-input-invalid');
        const module = await getEncoderModule(wasmUrl);
        const options = settings.compression === 'lossless'
            ? { ...SCREENSHOT_OPTIONS, quality: 80, lossless: 1, near_lossless: 100, exact: 1, thread_level: 0 }
            : { ...SCREENSHOT_OPTIONS, ...(settings.quality === undefined ? {} : { quality: settings.quality }) };
        const output = module.encode(new Uint8Array(pixels), width, height, options);
        if (!(output instanceof Uint8Array) || output.byteLength === 0) {
            throw new Error('empty WebP output');
        }
        const buffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
        self.postMessage({ id, ok: true, buffer }, [buffer]);
    } catch (error) {
        self.postMessage({
            id,
            ok: false,
            message: error instanceof Error ? error.message : 'WebP encoding failed',
        });
    }
};
