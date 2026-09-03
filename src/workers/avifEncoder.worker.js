import createAvifEncoderModule from '@jsquash/avif/codec/enc/avif_enc.js';
import { defaultOptions } from '@jsquash/avif/meta.js';
import { initEmscriptenModule } from '@jsquash/avif/utils.js';

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
        const module = await getEncoderModule(wasmUrl);
        const output = module.encode(new Uint8Array(pixels), width, height, SCREENSHOT_OPTIONS);
        if (!(output instanceof Uint8Array) || output.byteLength === 0) {
            throw new Error('empty AVIF output');
        }
        const buffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
        self.postMessage({ id, ok: true, buffer }, [buffer]);
    } catch (error) {
        self.postMessage({
            id,
            ok: false,
            message: error instanceof Error ? error.message : 'AVIF encoding failed',
        });
    }
};
