import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseMeminfo, parseMemoryPressure, parseOomKills, readSystemPressure, compareSystemPressure } from '../compression-product/system-pressure.mjs';
import { NATIVE_MEMORY_SCOPE, nativeMemoryScene, validateNativeMemoryHost, createNativeMemoryManifest, evaluateNativeMemorySupplement } from '../compression-product/native-firefox-memory.mjs';
import { MEMORY_POLICY, sha256, scenarioId } from '../compression-product/memory-evidence.mjs';

const hash = 'a'.repeat(64);
const environment = { platform: 'linux', arch: 'x64', node: 'v24.18.0', ramBytes: 16 * 1024 ** 3 };
const github = { repository: 'web-casa/ScreenHello', private: false, event: 'workflow_dispatch', commit: 'a'.repeat(40), runner: 'ubuntu-24.04', runId: '1234', runAttempt: '1' };
const meminfo = 'MemTotal: 10000 kB\nMemAvailable: 9000 kB\nSwapTotal: 2000 kB\nSwapFree: 1000 kB\n';
const psi = 'some avg10=0.00 avg60=0.01 avg300=0.02 total=100\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=10\n';
const snapshot = () => readSystemPressure({ platform: 'linux', read: file => ({ '/proc/meminfo': meminfo, '/proc/pressure/memory': psi, '/proc/vmstat': 'oom_kill 2\n' })[file] });
const resources = () => Object.fromEntries(['first', 'second'].map(key => [key, { leases: 0, contexts: 0, prepared: false, busy: false, pngWorker: false, webpWorker: false, avifWorker: false }]));

// Synthetic sampler fixture, never used as runtime/device evidence.
function dataset() {
    const candidate = { buildSha256: hash, webBuildSha256: hash, sourceSha256: hash, runnerSha256: hash };
    const manifest = createNativeMemoryManifest(candidate, environment);
    manifest.registeredAt = '2026-09-09T00:00:00Z';
    const scene = nativeMemoryScene(), legacyEndMs = 1300;
    const samples = Array.from({ length: 627 }, (_, index) => {
        const atMs = index * 50;
        const phase = atMs < 100 ? 'before-navigation' : atMs === 100 ? 'export-baseline'
            : atMs < legacyEndMs ? ((atMs - 100) % 200 === 50 ? 'render-and-encode' : 'verify-decode') : atMs === legacyEndMs ? 'idle-released' : 'idle';
        return { atMs, wallElapsedMs: atMs, phase, rssMiB: 800, readMs: 1, rootPid: 10, rootReadable: true, status: 'ok', processes: [{ pid: 10, rssKiB: 819200 }], errors: [] };
    });
    const row = { ...scene, version: 'synthetic', buildSha256: hash, timingClock: 'monotonic-performance-now', rssSampler: 'all-thread-child-tree-v2',
        policy: { profile: 'web', limits: [1048576, 1048576] }, resources: resources(), pageErrors: 0, externalRequests: 0,
        baselineRssMiB: 800, peakRssMiB: 800, deltaRssMiB: 0, withinReviewLine: true,
        runs: Array.from({ length: 6 }, (_, index) => ({ startedAtMs: 100 + index * 200, endedAtMs: 250 + index * 200,
            downloadedAtMs: 225 + index * 200, resourcesZeroAtMs: 250 + index * 200, bytes: 100, ms: 150, outcome: 'downloaded', resources: resources(), releasedRssMiB: 800 })),
        v2: { scenarioId: scenarioId(scene), fixtureSha256: hash, settings: { format: 'avif', ratio: 1, compression: 'lossy' },
            baselineAtMs: 100, legacyEndMs, workerIdleAtMs: legacyEndMs, samples,
            idle: [5000, 15000, 30000].map(targetMs => ({ targetMs, sampleIndex: (legacyEndMs + targetMs) / 50, resources: resources() })) } };
    const before = snapshot(), after = snapshot();
    before.observedAt = '2026-09-09T00:00:02Z'; after.observedAt = '2026-09-09T00:02:00Z';
    const manifestBytes = JSON.stringify(manifest);
    const registration = { scope: NATIVE_MEMORY_SCOPE, attempts: 1, registeredAt: '2026-09-09T00:00:01Z', github: { ...github }, environment,
        candidate, workflowSha256: hash, manifestSha256: sha256(manifestBytes), before };
    const report = { schema: MEMORY_POLICY, manifestSha256: registration.manifestSha256, candidate, environment,
        startedAt: '2026-09-09T00:00:03Z', status: 'complete', scenarios: [row] };
    return { registration, manifestBytes, reportBytes: JSON.stringify(report), after, finalCandidate: candidate, workflowSha256: hash };
}

describe('Linux host snapshots are scoped observations, not browser attribution', () => {
    it('parses KiB, microsecond PSI counters and integer OOM counts', () => {
        expect(parseMeminfo(meminfo)).toMatchObject({ units: 'KiB', MemAvailable: 9000, SwapFree: 1000 });
        expect(parseMemoryPressure(psi).some).toEqual({ avg10: 0, avg60: 0.01, avg300: 0.02, totalUs: 100 });
        expect(parseOomKills('pgfault 999\noom_kill 2\n')).toBe(2);
    });
    it.each([meminfo.replace('MemTotal: 10000', 'MemTotal: 0'), meminfo + meminfo, meminfo.replace(' kB', ' MB'), meminfo.replace('9000', '10001')])('rejects invalid memory readings', text => expect(() => parseMeminfo(text)).toThrow());
    it.each([psi + psi, psi.replace('0.01', '101.01'), psi.replace('total=100', 'total=9007199254740992'), ''])('rejects invalid PSI', text => expect(() => parseMemoryPressure(text)).toThrow());
    it.each(['', 'oom_kill -1', 'oom_kill 2\noom_kill 3', 'oom_kill 9007199254740992'])('rejects invalid OOM counters', text => expect(() => parseOomKills(text)).toThrow());
    it('preserves read failure instead of guessing zero', () => {
        const missing = readSystemPressure({ read: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); }, platform: 'linux' });
        expect(missing.oomKills).toEqual({ available: false, value: null, reason: 'EACCES' });
        expect(compareSystemPressure(missing, missing)).toMatchObject({ oomKillDelta: null, someStallUs: null, warnings: ['memory-unavailable', 'pressure-unavailable', 'oomKills-unavailable'] });
        expect(readSystemPressure({ platform: 'darwin' }).memory.available).toBe(false);
    });
    it('exposes host deltas without attributing them, and detects counter resets', () => {
        const before = snapshot(), after = snapshot();
        after.oomKills.value++; after.pressure.value.some.totalUs++;
        expect(compareSystemPressure(before, after)).toMatchObject({ oomKillDelta: 1, someStallUs: 1,
            warnings: ['host-oom-kills-observed-not-attributed', 'host-memory-stalls-observed'] });
        after.oomKills.value = 0;
        expect(compareSystemPressure(before, after).oomKillDelta).toBeNull();
        after.observedAt = '2000-01-01';
        expect(() => compareSystemPressure(before, after)).toThrow('reversed');
    });
});

describe('fixed native Firefox supplement', () => {
    it.each([
        [{ arch: 'arm64' }, {}], [{ platform: 'darwin' }, {}], [{ node: 'v22.1.0' }, {}],
        [{}, { private: true }], [{}, { repository: 'web-casa/private' }], [{}, { event: 'push' }],
        [{}, { runner: 'ubuntu-latest' }], [{}, { commit: '' }], [{}, { runId: '' }], [{}, { runAttempt: '2' }],
    ])('rejects unregistered execution hosts', (env, ci) => expect(() => validateNativeMemoryHost({ ...environment, ...env }, { ...github, ...ci })).toThrow());
    it('valid collection remains EVIDENCE-HOLD and never authorizes deployment', () => {
        const result = evaluateNativeMemorySupplement(dataset());
        expect(result.collectionValid, JSON.stringify(result.verdict)).toBe(true);
        expect(result.status).toBe('MEASURED-REVIEW-HOLD');
        expect(result.verdict.status).toBe('EVIDENCE-HOLD');
        expect(result.deploymentAuthorized).toBe(false);
    });
    it.each([
        report => { report.scenarios[0].v2.samples.splice(4, 21); },
        report => { report.scenarios[0].v2.samples[4].rssMiB = 0; },
        report => { delete report.scenarios[0].runs[0].resources; },
        report => { report.scenarios[0].runs[0].outcome = 'failed'; },
        report => { report.scenarios[0].v2.idle[2].resources.first.avifWorker = true; },
    ])('rejects invalid sampling or failed operations without weakening V2', mutate => {
        const input = dataset(), report = JSON.parse(input.reportBytes); mutate(report); input.reportBytes = JSON.stringify(report);
        expect(evaluateNativeMemorySupplement(input).collectionValid).toBe(false);
    });
    it.each([
        input => { input.finalCandidate = { ...input.finalCandidate, runnerSha256: 'b'.repeat(64) }; },
        input => { input.workflowSha256 = 'b'.repeat(64); },
        input => { input.registration.attempts = 2; },
        input => { input.registration.manifestSha256 = 'b'.repeat(64); },
        input => { input.after.observedAt = '2000-01-01'; },
    ])('rejects changed candidate, workflow, attempts, registration or observation order', mutate => {
        const input = dataset(); mutate(input); expect(() => evaluateNativeMemorySupplement(input)).toThrow();
    });
    it.each([
        manifest => { manifest.scenarios[0].repeat = 24; },
        manifest => { manifest.scenarios[0].width = 64; },
        manifest => { manifest.scenarios[0].mode = 'avif-standard'; },
        manifest => { manifest.requiredGates = []; },
        manifest => { manifest.requiredDevices = []; },
    ])('cannot silently change the registered workload or drop release requirements', mutate => {
        const input = dataset(), manifest = JSON.parse(input.manifestBytes); mutate(manifest);
        input.manifestBytes = JSON.stringify(manifest); input.registration.manifestSha256 = sha256(input.manifestBytes);
        expect(() => evaluateNativeMemorySupplement(input)).toThrow();
    });
    it('keeps the native job opt-in, public-only and isolated from both functional matrix jobs', () => {
        const workflow = readFileSync('.github/workflows/web-release-browser-matrix.yml', 'utf8');
        expect(workflow).toContain('if: ${{ !inputs.memory_firefox_probe }}');
        expect(workflow).toContain('!inputs.firefox_only && !inputs.memory_firefox_probe');
        expect(workflow).toContain("inputs.memory_firefox_probe && github.repository == 'web-casa/ScreenHello' && !github.event.repository.private");
        expect(workflow).toContain('runs-on: ubuntu-24.04');
        const runner = readFileSync('tests/compression-product/run-native-firefox-memory.mjs', 'utf8');
        expect(runner).toContain("!key.startsWith('SCREENHELLO_COMPRESSION_')");
        expect(runner).toContain("SCREENHELLO_COMPRESSION_REPEAT: '6'");
    });
});
