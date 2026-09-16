import UPNG from 'upng-js';
import initOxi, { optimise } from '@jsquash/oxipng/codec/pkg/squoosh_oxipng.js';
import createWebp from '@jsquash/webp/codec/enc/webp_enc.js';
import { defaultOptions as webpDefaults } from '@jsquash/webp/meta.js';
import { initEmscriptenModule } from '@jsquash/webp/utils.js';
import createAvif from '@jsquash/avif/codec/enc/avif_enc.js';
import { defaultOptions as avifDefaults } from '@jsquash/avif/meta.js';
import { validateRequest } from './contract.js';

// Each worker owns its module graph. No threaded wrapper or shared global codec.
const modules = new Map();
let busy = false;
function localUrl(value) {
    const url = new URL(value, self.location.href);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== self.location.origin) {
        throw new Error('compression-untrusted-wasm');
    }
    return url.href;
}
function loadModule(name, url) {
    const trusted = localUrl(url);
    if (!modules.has(name)) {
        modules.set(name, name === 'oxi' ? initOxi(trusted) : initEmscriptenModule(
            name === 'webp' ? createWebp : createAvif, undefined,
            { locateFile: (file) => file === `${name}_enc.wasm` ? trusted : file },
        ));
    }
    return modules.get(name);
}
self.onmessage = async ({ data }) => {
    const { id } = data || {};
    if (busy) { self.postMessage({ id, error: 'compression-busy' }); return; }
    busy = true;
    try {
        const { mode, width, height, colors, quality } = validateRequest(data);
        const started = performance.now();
        let output;
        if (mode === 'png-lossless') {
            await loadModule('oxi', data.wasm.oxi);
            self.postMessage({ id, started: true });
            output = optimise(new Uint8Array(data.png), 2, false, false);
        } else if (mode === 'png-lossy') {
            self.postMessage({ id, started: true });
            // npm 2.1.0 quantize already premultiplies internally. Exactly one call.
            output = new Uint8Array(UPNG.encode([data.pixels], width, height, colors));
        } else {
            const isWebp = mode.startsWith('webp-');
            const module = await loadModule(isWebp ? 'webp' : 'avif', data.wasm[isWebp ? 'webp' : 'avif']);
            self.postMessage({ id, started: true });
            const options = isWebp ? {
                ...webpDefaults, quality, thread_level: 0,
                lossless: mode === 'webp-lossless' ? 1 : 0, exact: 1, near_lossless: 100,
            } : {
                ...avifDefaults, quality, qualityAlpha: 60, speed: 8, subsample: 3, bitDepth: 8, lossless: false,
            };
            output = module.encode(new Uint8Array(data.pixels), width, height, options);
        }
        if (!(output instanceof Uint8Array) || !output.byteLength) throw new Error('compression-empty-output');
        const buffer = output.slice().buffer;
        self.postMessage({ id, buffer, encodeMs: performance.now() - started }, [buffer]);
    } catch (error) {
        self.postMessage({ id, error: error instanceof Error ? error.message : 'compression-worker-failed' });
    } finally { busy = false; }
};
