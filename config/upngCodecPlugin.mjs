import { createHash } from 'node:crypto';

// Pinned compatibility fixes for upng-js 2.1.0. The source uses a runtime
// typeof require guard, but Rolldown rewrites the call and leaves that guard.
// Also size the STATIC PNG container from the compressed payload, not raw+100:
// upstream truncates e.g. a transparent 1px PNG's IEND CRC. Quantization is intact.
// Both changes are pinned and documented; no global window/require shim.
export const UPNG_SOURCE_SHA256 = 'b7c0bdb021dffeb82f1ac27c6762f939f967a9e4e0886518fef649331b612164';
const ENTRY = 'if (typeof require == "function") {pako = require("pako");}  else {pako = window.pako;}';
const ALLOCATION = 'var data = new Uint8Array(bufs[0].byteLength*bufs.length+100);';
const COMPRESS = 'var nimg = UPNG.encode.compressPNG(bufs, w, h, ps, forbidPlte);';
const STATIC_ALLOCATION = `if(bufs.length!==1) throw new Error("compression-static-png-only");
    ${COMPRESS}
    // C0 container allocation fix: signature + IHDR + sRGB + IEND, optional
    // PLTE/tRNS and each already compressed IDAT. No pixel/palette changes.
    var pngBytes = 8 + 25 + 13 + 12;
    if(nimg.ctype==3) {
        pngBytes += 12 + nimg.plte.length*3;
        if(nimg.gotAlpha) pngBytes += 12 + nimg.plte.length;
    }
    for(var c0i=0; c0i<nimg.frames.length; c0i++) pngBytes += 12 + nimg.frames[c0i].cimg.length;
    var data = new Uint8Array(pngBytes);`;
export function transformUpngEntry(code) {
    if (createHash('sha256').update(code).digest('hex') !== UPNG_SOURCE_SHA256
        || ![ENTRY, ALLOCATION, COMPRESS].every(text => code.split(text).length === 2)) {
        throw new Error('compression-upng-source-changed-review-required');
    }
    return code.replace(ENTRY, 'pako = require("pako"); // C0 pinned CJS packaging fix.')
        .replace(COMPRESS, '').replace(ALLOCATION, STATIC_ALLOCATION);
}
export const upngCjsPlugin = () => ({
    name: 'screenhello-pinned-upng-codec', enforce: 'pre',
    transform(code, id) {
        if (!id.replaceAll('\\', '/').endsWith('/upng-js/UPNG.js')) return null;
        return { code: transformUpngEntry(code), map: null };
    },
});
