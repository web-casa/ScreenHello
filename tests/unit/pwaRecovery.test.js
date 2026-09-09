import { expect, it } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PWA_RECOVERY_SCOPE, PWA_RECOVERY_ENGINES, PWA_RECOVERY_MODES, validatePwaRecovery, validatePwaFile } from '../compression-product/pwa-recovery-contract.mjs';
import { startProbeServer, PROBE_CSP } from '../spikes/compression/server.mjs';
import { createPngFixture } from '../fixtures/createPngFixture.js';
import { resolveCodecPreloads, codecPreloadHashPlugin } from '../../config/codecPreload.mjs';

const hash = 'a'.repeat(64);
it('binds the preload policy to stable chunk filenames without timestamps', () => {
    expect(codecPreloadHashPlugin().augmentChunkHash()).toBe(codecPreloadHashPlugin().augmentChunkHash());
    expect(codecPreloadHashPlugin().augmentChunkHash()).toContain(resolveCodecPreloads.toString());
});
it.each(['png', 'webp', 'avif'])('avoids poisoned codec modulepreload without removing CSS or eager-loading codecs: %s', format => {
    const deps = [`assets/${format}Encoder-abcdefgh.js`, 'assets/shared-abcdefgh.js', 'assets/shared-abcdefgh.css'];
    expect(resolveCodecPreloads(`assets/${format}Encoder-abcdefgh.js`, deps, { hostType: 'js' })).toEqual(['assets/shared-abcdefgh.css']);
    expect(deps).toHaveLength(3);
    expect(resolveCodecPreloads(`assets/${format}Encoder-abcdefgh.js`, deps, { hostType: 'html' })).toBe(deps);
    expect(resolveCodecPreloads('assets/other-abcdefgh.js', deps, { hostType: 'js' })).toBe(deps);
});
function fixture() {
    const candidate = { webBuildSha256: hash, runnerSha256: hash };
    const registration = { scope: PWA_RECOVERY_SCOPE, candidate, engines: PWA_RECOVERY_ENGINES, attempts: 1, transport: 'http-loopback-secure-context-not-public-https' };
    const reports = PWA_RECOVERY_ENGINES.map(engine => ({ engine, version: 'synthetic', attempts: 1, secureContext: true, controller: 'activated',
        cspViolations: [], pageErrors: [], outsideRequests: [], droppedDiagnostics: 0, droppedRequests: 0, initialCache: [],
        coldFailure: { alerts: ['预览失败'], downloads: 0, cspViolations: [], requests: [{ offline: true, status: 503, path: '/assets/pngEncoder-abcdefgh.js' }] },
        warmCache: ['/assets/squoosh_oxipng_bg-abcdefgh.wasm', '/assets/webp_enc-abcdefgh.wasm'],
        offlineRequests: [{ offline: true, status: 503, path: '/pwa-origin-check' }],
        ...Object.fromEntries(['online', 'offline'].map(stage => [stage, PWA_RECOVERY_MODES.map(mode => ({ mode,
            file: `${engine}-${stage}-${mode}.${mode.split('-')[0]}`, width: 64, height: 48, bytes: 100, sha256: hash,
            decoded: { width: 64, height: 48, colors: 4, center: [22, 102, 255, 255], pixelsSha256: hash } }))])),
    }));
    return { candidate, registration, reports };
}
it('full local recovery is not an HTTPS, device or deployment gate', () => {
    const { candidate, registration, reports } = fixture();
    expect(validatePwaRecovery(registration, reports, candidate)).toEqual({ scope: PWA_RECOVERY_SCOPE, status: 'LOCAL-RECOVERY-PASS', releaseGate: 'HOLD', deploymentAuthorized: false });
    expect(validatePwaRecovery({ ...registration, engines: ['webkit'] }, [reports[2]], candidate).status).toBe('DIAGNOSTIC-PASS');
});
it.each([
    row => { row.secureContext = false; }, row => { row.controller = undefined; }, row => { row.attempts = 2; },
    row => { row.pageErrors = ['error']; }, row => { row.cspViolations = ['worker-src']; },
    row => { row.outsideRequests = ['https://remote.example/']; }, row => { row.droppedRequests = 1; },
    row => { row.initialCache = ['/assets/pngEncoder-abcdefgh.js']; },
    row => { row.coldFailure.alerts = ['unrelated error']; }, row => { row.coldFailure.downloads = 1; },
    row => { row.coldFailure.requests = []; }, row => { row.coldFailure.requests[0].status = 200; },
    row => { row.coldFailure.cspViolations = ['script-src']; }, row => { row.warmCache = []; },
    row => { row.offlineRequests = []; }, row => { row.offlineRequests[0].offline = false; },
    row => { row.offline.pop(); }, row => { row.offline[0].file = '../escape.png'; },
    row => { row.offline[0].bytes = 1048577; }, row => { row.offline[0].sha256 = ''; },
    row => { row.offline[0].decoded.width++; }, row => { row.offline[0].decoded.colors = 1; },
    row => { row.offline[0].decoded.center[3] = 0; }, row => { row.offline[0].decoded.pixelsSha256 = 'b'.repeat(64); },
])('rejects missing or contradictory recovery evidence', mutate => {
    const { candidate, registration, reports } = fixture(); mutate(reports[0]);
    expect(() => validatePwaRecovery(registration, reports, candidate)).toThrow();
});
it('rejects missing engines and changed candidate or invented transport', () => {
    const { candidate, registration, reports } = fixture();
    expect(() => validatePwaRecovery(registration, reports.slice(1), candidate)).toThrow();
    expect(() => validatePwaRecovery(registration, reports, { ...candidate, runnerSha256: 'b'.repeat(64) })).toThrow();
    expect(() => validatePwaRecovery({ ...registration, transport: 'public-https' }, reports, candidate)).toThrow();
    expect(() => validatePwaRecovery({ ...registration, candidate: {} }, reports, {})).toThrow();
});
it('checks actual file signatures and bounded bytes', () => {
    expect(validatePwaFile(createPngFixture(), 'png')).toMatch(/^[a-f0-9]{64}$/);
    for (const bytes of [Buffer.alloc(0), Buffer.alloc(1048577), Buffer.from('bad')]) expect(() => validatePwaFile(bytes, 'png')).toThrow();
    expect(() => validatePwaFile(createPngFixture(), 'webp')).toThrow();
    const webp = Buffer.from('524946460400000057454250', 'hex');
    expect(validatePwaFile(webp, 'webp')).toMatch(/^[a-f0-9]{64}$/); // Header only; a real decoder remains mandatory.
    webp.writeUInt32LE(100, 4); expect(() => validatePwaFile(webp, 'webp')).toThrow();
});
it('records actual server refusal, correct manifest MIME and strict CSP without leaking mutable logs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'screenhello-pwa-server-unit-'));
    let server;
    try {
        await writeFile(path.join(root, 'index.html'), '<!doctype html>test');
        await writeFile(path.join(root, 'manifest.webmanifest'), '{}');
        server = await startProbeServer(root, { recordRequests: true });
        const online = await fetch(server.url);
        expect(online.headers.get('content-security-policy')).toBe(PROBE_CSP);
        expect((await fetch(`${server.url}manifest.webmanifest`)).headers.get('content-type')).toBe('application/manifest+json');
        server.setOffline(true);
        expect((await fetch(`${server.url}assets/pngEncoder-abcdefgh.js`)).status).toBe(503);
        expect(server.refused).toBe(1);
        expect(server.requests.at(-1)).toMatchObject({ offline: true, status: 503, path: '/assets/pngEncoder-abcdefgh.js' });
        server.requests[0].status = 999;
        expect(server.requests[0].status).toBe(200);
        server.setOffline(false); expect((await fetch(server.url)).status).toBe(200);
        expect(server.droppedRequests).toBe(0);
    } finally {
        await server?.close();
        await rm(root, { recursive: true }); // Only the unique fixture directory created by this test.
    }
});
it('does not allocate request logs for existing memory benchmarks by default', async () => {
    const server = await startProbeServer('/nonexistent-probe-fixture');
    try { await fetch(server.url); expect(server.requests).toEqual([]); expect(server.droppedRequests).toBe(0); }
    finally { await server.close(); }
});
it('refuses evidence paths pointing into frozen builds through a symlink', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'screenhello-pwa-path-unit-'));
    try {
        const build = path.join(root, 'web'); await mkdir(build);
        await symlink(build, path.join(root, 'alias'));
        const result = spawnSync(process.execPath, ['tests/compression-product/verify-pwa-recovery.mjs', build, path.join(root, 'alias', 'evidence'), hash], { encoding: 'utf8', timeout: 10000 });
        expect(result.status).not.toBe(0); expect(result.stderr).toContain('output must not mutate candidate');
    } finally { await rm(root, { recursive: true }); }
});
