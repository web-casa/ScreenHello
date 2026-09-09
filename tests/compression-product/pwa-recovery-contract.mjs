import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { hashPaths, sha256 } from './memory-evidence.mjs';

export const PWA_RECOVERY_SCOPE = 'local-production-pwa-recovery/v1';
export const PWA_RECOVERY_MODES = ['png-lossless', 'png-lossy', 'webp-lossless'];
export const PWA_RECOVERY_ENGINES = ['chromium', 'firefox', 'webkit'];
export const PWA_MAX_FILE_BYTES = 1024 * 1024;
export const pwaRecoveryFingerprint = build => ({ webBuildSha256: hashPaths(build, ['./']),
    runnerSha256: hashPaths(fileURLToPath(new URL('../../', import.meta.url)), [
        'tests/compression-product/verify-pwa-recovery.mjs', 'tests/compression-product/pwa-recovery-contract.mjs',
        'tests/compression-product/memory-evidence.mjs', 'tests/spikes/compression/server.mjs', 'tests/fixtures/createPngFixture.js',
        'tests/compression-product/system-pressure.mjs',
    ]) });

export function validatePwaFile(bytes, format) {
    assert.ok(bytes.length > 0 && bytes.length <= PWA_MAX_FILE_BYTES, 'invalid file size');
    assert.ok(['png', 'webp'].includes(format));
    if (format === 'png') assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    else {
        assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
        assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
        assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, 'truncated RIFF');
    }
    return sha256(bytes);
}

// Runs in an isolated decoder page, not the editor. Actual file bytes are input.
export async function decodePwaFile({ base64, format }) {
    const bytes = Uint8Array.from(atob(base64), value => value.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: `image/${format}` }));
    let canvas;
    try {
        if (bitmap.width * bitmap.height > 1048576) throw new Error('pwa-decode-budget');
        canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        const colors = new Set();
        for (let offset = 0; offset < pixels.length && colors.size < 8; offset += 4) colors.add(pixels.slice(offset, offset + 4).join(','));
        const digest = await crypto.subtle.digest('SHA-256', pixels);
        return { width: bitmap.width, height: bitmap.height, colors: colors.size,
            center: Array.from(pixels.slice((Math.floor(bitmap.height / 2) * bitmap.width + Math.floor(bitmap.width / 2)) * 4,
                (Math.floor(bitmap.height / 2) * bitmap.width + Math.floor(bitmap.width / 2)) * 4 + 4)),
            pixelsSha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') };
    } finally { bitmap.close(); if (canvas) { canvas.width = 0; canvas.height = 0; } }
}

export function validatePwaRecovery(registration, reports, finalCandidate) {
    assert.equal(registration.scope, PWA_RECOVERY_SCOPE);
    assert.deepEqual(finalCandidate, registration.candidate);
    for (const key of ['webBuildSha256', 'runnerSha256']) assert.match(registration.candidate[key] || '', /^[a-f0-9]{64}$/);
    assert.equal(registration.attempts, 1);
    assert.equal(registration.transport, 'http-loopback-secure-context-not-public-https');
    assert.deepEqual(reports.map(report => report.engine), registration.engines);
    assert.ok(registration.engines.length > 0 && new Set(registration.engines).size === registration.engines.length);
    assert.ok(registration.engines.every(engine => PWA_RECOVERY_ENGINES.includes(engine)));
    for (const report of reports) {
        assert.equal(report.attempts, 1); assert.ok(report.version);
        assert.equal(report.secureContext, true); assert.equal(report.controller, 'activated');
        assert.deepEqual(report.cspViolations, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.outsideRequests, []);
        assert.equal(report.droppedDiagnostics, 0); assert.equal(report.droppedRequests, 0);
        assert.ok(!report.initialCache.some(url => /pngEncoder|oxipng/.test(url)));
        assert.ok(report.coldFailure.alerts.some(text => /预览失败/.test(text)), 'wrong cold failure');
        assert.equal(report.coldFailure.downloads, 0);
        assert.deepEqual(report.coldFailure.cspViolations, []);
        assert.ok(report.coldFailure.requests.some(entry => entry.offline && entry.status === 503 && /pngEncoder.*\.js/.test(entry.path)), 'missing real codec refusal');
        assert.ok(report.warmCache.some(url => /squoosh_oxipng_bg-.*\.wasm/.test(url)));
        assert.ok(report.warmCache.some(url => /webp_enc-.*\.wasm/.test(url)));
        for (const stage of ['online', 'offline']) {
            assert.deepEqual(report[stage].map(output => output.mode), PWA_RECOVERY_MODES);
            for (const output of report[stage]) {
                assert.equal(output.file, `${report.engine}-${stage}-${output.mode}.${output.mode.split('-')[0]}`);
                assert.ok(output.bytes > 0 && output.bytes <= PWA_MAX_FILE_BYTES);
                assert.match(output.sha256, /^[a-f0-9]{64}$/);
                assert.ok(output.width > 0 && output.height > 0 && output.width * output.height <= 1048576);
                assert.equal(output.decoded.width, output.width); assert.equal(output.decoded.height, output.height);
                assert.ok(output.decoded.colors > 1 && output.decoded.center[3] > 0, 'empty or uniform output');
                assert.match(output.decoded.pixelsSha256, /^[a-f0-9]{64}$/);
            }
        }
        assert.ok(report.offlineRequests.every(request => request.offline && request.status === 503));
        assert.ok(report.offlineRequests.some(request => request.path === '/pwa-origin-check'), 'missing offline origin check');
        for (let index = 0; index < PWA_RECOVERY_MODES.length; index++) assert.deepEqual(report.online[index].decoded, report.offline[index].decoded, 'offline output changed');
    }
    return { scope: PWA_RECOVERY_SCOPE, status: registration.engines.length === 3 ? 'LOCAL-RECOVERY-PASS' : 'DIAGNOSTIC-PASS',
        releaseGate: 'HOLD', deploymentAuthorized: false };
}
