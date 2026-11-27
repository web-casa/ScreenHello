import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditContinuousAvifReports } from '../release/audit-continuous-avif.mjs';
import { CONTINUOUS_AVIF_SCOPE, CONTINUOUS_AVIF_TARGET_SCOPE, validateTargetContinuousEvidence,
    validateContinuousAvifEvidence, inspectContinuousAvif } from '../release/continuous-avif-contract.mjs';
import { installContinuousDownloadObserver } from '../release/continuous-download-observer.mjs';
import { decodeAvifFile, decodePcAvifFile } from '../release/avif-file-decoder.mjs';
import config from '../release/continuous-avif.config.js';
import release from '../release/playwright.config.js';

const hash = 'a'.repeat(64);
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function validEvidence() {
    const fingerprints = { webSha256: hash, sourceSha256: hash, runnerSha256: hash };
    const layers = ['pc-example.webp'];
    return { scope: CONTINUOUS_AVIF_SCOPE, status: 'passed',
        registration: { ...fingerprints, pcSha256: hash, registeredAt: '2026-09-09T00:00:00Z',
            count: 6, attemptsPerCase: 1, memoryMeasurement: false, mode: 'standard', ratio: 1, dimensions: [2223, 1667] },
        finalFingerprints: { ...fingerprints }, environment: { engine: 'chromium', version: 'test', platform: 'linux', arch: 'arm64' },
        deliveryEvidence: 'playwright-download-stream', samePage: true, productionEditor: true,
        overflow: false, pageErrors: [], blockedRequests: [], layersBefore: layers, layersAfter: [...layers], downloads: 6,
        jobs: Array.from({ length: 6 }, (_, index) => ({ id: index + 1, workerId: 1, width: 2223, height: 1667,
            compression: 'standard', failed: false, cancelRequestedAt: null, startedAt: 100 + index * 100,
            completedAt: 150 + index * 100, terminatedAt: null })),
        results: Array.from({ length: 6 }, (_, index) => ({ index, file: `continuous-${index + 1}.avif`, downloadName: 'ScreenHello.avif',
            foreground: { visibility: 'visible', focused: true }, elapsedMs: 1000, samePage: true, layers: [...layers], downloads: index + 1,
            size: 2000, sha256: hash, decoded: { width: 2223, height: 1667, corner: [0, 0, 0, 0], center: [255, 255, 255, 255],
                pixelSha256: hash, opaqueVariation: true, decoder: 'jsquash-avif-2.1.1-node-wasm' } })) };
}

describe('continuous AVIF evidence is bounded and fail-closed', () => {
    it('accepts six serial exports including legitimate idle Worker retirement', () => {
        const evidence = validEvidence();
        validateContinuousAvifEvidence(evidence);
        for (const [index, job] of evidence.jobs.entries()) {
            job.workerId = index + 1;
            job.terminatedAt = job.completedAt + 10;
        }
        expect(() => validateContinuousAvifEvidence(evidence)).not.toThrow();
    });
    const mutations = {
        'target browser scope': e => { e.scope = 'target-browser'; },
        'running report': e => { e.status = 'running'; },
        'fewer registered exports': e => { e.registration.count = 5; },
        'retries allowed': e => { e.registration.attemptsPerCase = 2; },
        'claims memory': e => { e.registration.memoryMeasurement = true; },
        'lossy substitution': e => { e.registration.mode = 'lossy'; },
        'changed ratio': e => { e.registration.ratio = 2; },
        'smaller fixture': e => { e.registration.dimensions = [73, 55]; },
        'missing registration time': e => { delete e.registration.registeredAt; },
        'missing source binding': e => { delete e.registration.sourceSha256; },
        'build changed': e => { e.finalFingerprints.webSha256 = 'b'.repeat(64); },
        'engine unspecified': e => { delete e.environment.engine; },
        'OS save overclaim': e => { e.deliveryEvidence = 'os-saved'; },
        'page reloaded': e => { e.samePage = false; },
        'harness instead of production': e => { e.productionEditor = false; },
        'trace overflow': e => { e.overflow = true; },
        'page error': e => { e.pageErrors.push('crash'); },
        'external request': e => { e.blockedRequests.push('https://example.org'); },
        'empty project': e => { e.layersBefore = []; },
        'lost layer': e => { e.layersAfter = []; },
        'late download': e => { e.downloads = 7; },
        'missing output': e => { e.results.pop(); },
        'missing Worker': e => { e.jobs.pop(); },
        'reordered results': e => { e.results.reverse(); },
        'unsafe filename': e => { e.results[0].file = '../continuous-1.avif'; },
        'format fallback': e => { e.results[0].downloadName = 'ScreenHello.png'; },
        'background page': e => { e.results[0].foreground.focused = false; },
        'nonfinite time': e => { e.results[0].elapsedMs = NaN; },
        'over time budget': e => { e.results[0].elapsedMs = 120001; },
        'intermediate reload': e => { e.results[0].samePage = false; },
        'intermediate layer loss': e => { e.results[0].layers = []; },
        'duplicate downloads': e => { e.results[0].downloads = 2; },
        'empty file': e => { e.results[0].size = 0; },
        'oversized file': e => { e.results[0].size = 8388609; },
        'missing output hash': e => { delete e.results[0].sha256; },
        'wrong decoded size': e => { e.results[0].decoded.width = 73; },
        'no independent decoder': e => { e.results[0].decoded.decoder = 'browser'; },
        'opaque corner': e => { e.results[0].decoded.corner[3] = 255; },
        'transparent empty center': e => { e.results[0].decoded.center[3] = 0; },
        'uniform blank image': e => { e.results[0].decoded.opaqueVariation = false; },
        'missing pixel fingerprint': e => { delete e.results[0].decoded.pixelSha256; },
        'content changed mid session': e => { e.results[2].decoded.pixelSha256 = 'b'.repeat(64); },
        'invalid color': e => { e.results[0].decoded.corner[0] = -1; },
        'duplicate request': e => { e.jobs[1].id = 1; },
        'Worker size changed': e => { e.jobs[0].width = 73; },
        'Worker mode changed': e => { e.jobs[0].compression = 'lossy'; },
        'codec error': e => { e.jobs[0].failed = true; },
        'canceled encode': e => { e.jobs[0].cancelRequestedAt = 120; },
        'encode never returned': e => { e.jobs[0].completedAt = null; },
        'Worker killed mid encode': e => { e.jobs[0].terminatedAt = 120; },
        'parallel encodes': e => { e.jobs[1].startedAt = 120; },
    };
    for (const [name, mutate] of Object.entries(mutations)) it(`rejects ${name}`, () => {
        const evidence = validEvidence(); mutate(evidence);
        expect(() => validateContinuousAvifEvidence(evidence)).toThrow();
    });
    it('keeps the tiny decoder limit and separately bounds PC input before spawning', async () => {
        expect(() => decodeAvifFile(Buffer.alloc(131073).toString('base64'))).toThrow('avif-fixture-file-size-invalid');
        expect(() => decodePcAvifFile(Buffer.alloc(8388609))).toThrow('avif-pc-file-size-invalid');
        expect(() => decodePcAvifFile(Buffer.alloc(0))).toThrow('avif-pc-file-size-invalid');
        expect(() => decodePcAvifFile('not bytes')).toThrow('avif-pc-file-size-invalid');
        await expect(inspectContinuousAvif(Buffer.from('not an AVIF file'))).rejects.toThrow('avif-pc-file-signature-invalid');
    });
    it('does not automatically add workload or retries to the existing smoke', () => {
        expect(release.testMatch).not.toContain('continuous-avif.spec.js');
        expect(config.testMatch).toBe('continuous-avif.spec.js');
        expect(config.retries).toBe(0);
        expect(config.repeatEach).toBe(1);
        expect(config.workers).toBe(1);
        expect(config.maxFailures).toBe(1);
    });
    it('rejects incomplete matrices and claimed passes without original files', async () => {
        await expect(auditContinuousAvifReports([])).rejects.toThrow('all three current engines required');
        const directory = await mkdtemp(join(tmpdir(), 'screenhello-continuous-audit-unit-'));
        try {
            const file = join(directory, 'continuous-evidence.json');
            await writeFile(file, JSON.stringify(validEvidence()), { flag: 'wx' });
            await expect(auditContinuousAvifReports([file, file, file])).rejects.toThrow('ENOENT');
            await writeFile(join(directory, 'continuous-1.avif'), 'invalid output', { flag: 'wx' });
            await expect(auditContinuousAvifReports([file, file, file])).rejects.toThrow('avif-pc-file-signature-invalid');
        } finally { await rm(directory, { recursive: true }); }
    });
});

describe('target continuous AVIF candidate contract', () => {
    const expected = { target: { id: 'edge-111', browser: 'edge' }, observed: { browserVersion: '111.0' }, releaseCandidate: 'a'.repeat(40) };
    const targetEvidence = () => {
        const evidence = validEvidence();
        Object.assign(evidence, { scope: CONTINUOUS_AVIF_TARGET_SCOPE, target: 'edge-111',
            deliveryEvidence: 'native-anchor-blob-bytes', externalResourceRequests: [], observerOverflow: false,
            environment: { engine: 'edge', version: '111.0', platform: 'linux', arch: 'x64' },
            candidate: { commit: expected.releaseCandidate, continuousChecks: true, optionalDevicePackIncluded: false, deploymentAuthorized: false,
                webBuildSha256: hash, sourceSha256: hash, runnerSha256: hash, environment: { platform: 'linux', arch: 'x64' } } });
        for (const result of evidence.results) Object.assign(result, { type: 'image/avif', evidenceFile: `edge-111-${result.file}` });
        return evidence;
    };
    it('accepts real file validation without claiming Edge native decode', () => {
        expect(() => validateTargetContinuousEvidence(targetEvidence(), expected)).not.toThrow();
    });
    const mutations = {
        'local scope': e => { e.scope = CONTINUOUS_AVIF_SCOPE; },
        'wrong target': e => { e.target = 'chrome-111'; },
        'wrong commit': e => { e.candidate.commit = 'b'.repeat(40); },
        'disabled workload': e => { e.candidate.continuousChecks = false; },
        'device pack included': e => { e.candidate.optionalDevicePackIncluded = true; },
        'deployment claim': e => { e.candidate.deploymentAuthorized = true; },
        'wrong version': e => { e.environment.version = '153.0'; },
        'wrong host': e => { e.environment.arch = 'arm64'; },
        'wrong Web': e => { e.candidate.webBuildSha256 = 'b'.repeat(64); },
        'wrong source': e => { e.candidate.sourceSha256 = 'b'.repeat(64); },
        'wrong runner': e => { e.candidate.runnerSha256 = 'b'.repeat(64); },
        'external resources': e => { e.externalResourceRequests.push('https://example.org'); },
        'extra handoff': e => { e.observerOverflow = true; },
        'wrong type': e => { e.results[0].type = 'image/png'; },
        'unsafe artifact path': e => { e.results[0].evidenceFile = '../file.avif'; },
    };
    for (const [name, mutate] of Object.entries(mutations)) it(`rejects ${name}`, () => {
        const evidence = targetEvidence(); mutate(evidence);
        expect(() => validateTargetContinuousEvidence(evidence, expected)).toThrow();
    });
});

describe('bounded native AVIF handoff observer', () => {
    function setup() {
        const nativeClick = vi.fn(() => 'clicked');
        class Anchor { click(...args) { return nativeClick(...args); } }
        vi.stubGlobal('window', {});
        vi.stubGlobal('HTMLAnchorElement', Anchor);
        let sequence = 0;
        vi.stubGlobal('URL', { createObjectURL: vi.fn(() => `blob:${++sequence}`), revokeObjectURL: vi.fn(() => 'revoked') });
        installContinuousDownloadObserver();
        const click = blob => {
            const anchor = new Anchor(); anchor.href = URL.createObjectURL(blob); anchor.download = 'ScreenHello.avif';
            expect(anchor.click('native-argument')).toBe('clicked');
            expect(URL.revokeObjectURL(anchor.href)).toBe('revoked');
        };
        return { state: window.__screenhelloContinuousDownloads, click, nativeClick };
    }
    it('only observes armed AVIF, preserves native arguments, and survives immediate revoke', async () => {
        const { state, click, nativeClick } = setup();
        click(new Blob(['before'], { type: 'image/avif' }));
        state.active = true;
        click(new Blob(['png'], { type: 'image/png' }));
        click(new Blob(['actual-avif-bytes'], { type: 'image/avif' }));
        await vi.waitFor(() => expect(state.records[0]?.base64).toBe(btoa('actual-avif-bytes')));
        expect(state.records).toHaveLength(1);
        expect(nativeClick).toHaveBeenCalledTimes(3);
        expect(nativeClick).toHaveBeenLastCalledWith('native-argument');
    });
    it('rejects oversized input before allocation and records extra handoffs as overflow', () => {
        const { state, click } = setup();
        state.active = true;
        const read = vi.fn();
        for (let index = 0; index < 7; index++) click({ type: 'image/avif', size: 8_388_609, arrayBuffer: read });
        expect(read).not.toHaveBeenCalled();
        expect(state.records).toHaveLength(6);
        expect(state.records[0].error).toBe('continuous-avif-size-invalid');
        expect(state.overflow).toBe(true);
    });
});
