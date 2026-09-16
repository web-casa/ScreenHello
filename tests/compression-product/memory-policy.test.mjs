import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, unlink, rmdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { MEMORY_POLICY, REQUIRED_GATES, REQUIRED_DEVICES, digest, sha256, scenarioId, requiredMemoryScenarios, validateManifest, reserveEvidence, writeImmutableJson } from './memory-evidence.mjs';
import { evaluateMemory, evaluateScenario, releaseTrend } from './memory-policy.mjs';
import { createMemorySampler } from './memory-sampler.mjs';
import { processTreeRssMiB, processTreeRssSnapshot } from '../spikes/compression/rss.mjs';

const hash = 'a'.repeat(64);
const owned = () => Object.fromEntries(['first', 'second'].map(key => [key, { leases: 0, contexts: 0, prepared: false, busy: false, pngWorker: false, webpWorker: false, avifWorker: false }]));
function manifest() {
    return { schema: MEMORY_POLICY, scope: 'release', registeredAt: '2026-09-08T00:00:00Z', candidate: { buildSha256: hash, webBuildSha256: hash, sourceSha256: hash, runnerSha256: hash },
        environment: { platform: 'linux', arch: 'arm64', ramBytes: 8 * 1024 ** 3 }, scenarios: requiredMemoryScenarios(), requiredGates: [...REQUIRED_GATES], requiredDevices: [...REQUIRED_DEVICES] };
}
function entry(scene = requiredMemoryScenarios()[0], delta = 383) {
    const runs = Array.from({ length: scene.repeat }, (_, index) => ({ startedAtMs: 100 + index * 200, endedAtMs: 250 + index * 200, downloadedAtMs: 225 + index * 200, resourcesZeroAtMs: 250 + index * 200, bytes: 100, ms: 150,
        outcome: 'downloaded', resources: owned(), releasedRssMiB: 900 + index % 2 }));
    const legacyEndMs = 100 + scene.repeat * 200;
    const samples = [];
    for (let atMs = 0; atMs <= legacyEndMs + 30000; atMs += 50) {
        let phase = atMs < 100 ? 'before-navigation' : 'idle';
        if (atMs === 100) phase = 'export-baseline';
        else if (atMs > 100 && atMs < legacyEndMs) phase = (atMs - 100) % 200 === 50 ? 'render-and-encode' : 'verify-decode';
        else if (atMs === legacyEndMs) phase = 'idle-released';
        samples.push({ atMs, wallElapsedMs: atMs, phase, rssMiB: atMs === 150 ? 800 + delta : 800,
            readMs: 1, rootPid: 10, rootReadable: true, status: 'ok', processes: [{ pid: 10, rssKiB: 800 * 1024 }], errors: [] });
    }
    return { ...scene, version: 'test', buildSha256: hash, timingClock: 'monotonic-performance-now', rssSampler: 'all-thread-child-tree-v2', policy: { profile: 'web', limits: [1_048_576, 1_048_576] },
        baselineRssMiB: 800, peakRssMiB: 800 + delta, deltaRssMiB: delta, withinReviewLine: delta <= 384, pageErrors: 0, externalRequests: 0, resources: owned(), runs,
        v2: { scenarioId: scenarioId(scene), fixtureSha256: hash, settings: { format: scene.mode.split('-')[0], ratio: 1, ...(scene.mode.endsWith('standard') ? {} : { compression: scene.mode.split('-')[1] }) },
            baselineAtMs: 100, legacyEndMs, workerIdleAtMs: legacyEndMs, samples,
            idle: [5000, 15000, 30000].map(targetMs => ({ targetMs, sampleIndex: (legacyEndMs + targetMs) / 50, resources: owned() })) } };
}
function dataset() {
    const expected = manifest(), manifestSha = digest(expected);
    const data = { schema: MEMORY_POLICY, manifestSha256: manifestSha, candidate: expected.candidate, environment: expected.environment,
        startedAt: '2026-09-08T01:00:00Z', status: 'complete', scenarios: expected.scenarios.map(scene => entry(scene)) };
    return { expected, manifestSha, data };
}
function evaluate(set, withReviews = true, change = records => records) {
    const reportSha = digest(set.data);
    const common = { candidateSha256: digest(set.expected.candidate), manifestSha256: set.manifestSha, reviewer: 'test reviewer', reason: 'synthetic fixture, not device evidence',
        evidenceSha256: hash, attachmentVerified: true, status: 'pass' };
    const supplements = [
        ...REQUIRED_GATES.map(id => ({ ...common, kind: 'gate', id })), ...REQUIRED_DEVICES.map(id => ({ ...common, kind: 'device', id })),
        ...(withReviews ? set.data.scenarios.map(row => ({ ...common, kind: 'review', scenarioId: row.v2.scenarioId, reportSha256: reportSha,
            assessment: { resources: 'zero', trend: 'stable', comparableBaseline: 'same machine and scene', deviceStability: 'checked', headroom: 'checked' } })) : []),
    ];
    return evaluateMemory(set.expected, set.manifestSha, [{ data: set.data, sha256: reportSha }], change(supplements));
}
for (const delta of [383, 384, 385]) test(`legacy ${delta} boundary is retained, not used as L1 failure`, () => {
    const row = entry(undefined, delta), before = JSON.stringify(row);
    const result = evaluateScenario(row, requiredMemoryScenarios()[0]);
    assert.deepEqual(result.invalid, []); assert.deepEqual(result.failures, []);
    assert.equal(result.warnings.includes('historical-384-review'), delta > 384);
    assert.equal(JSON.stringify(row), before); assert.equal(row.withinReviewLine, delta <= 384);
});
test('all required evidence plus bound reviews can pass, not authorize deployment', () => {
    const result = evaluate(dataset()); assert.equal(result.status, 'GO', JSON.stringify(result)); assert.equal(result.deploymentAuthorized, false);
});
test('even low delta requires review of session total and headroom', () => assert.equal(evaluate(dataset(), false).status, 'REVIEW-HOLD'));
test('385 remains REVIEW, not automatic GO', () => {
    const set = dataset(); set.data.scenarios[0] = entry(undefined, 385);
    assert.equal(evaluate(set, false).status, 'REVIEW-HOLD');
});
for (const [name, mutate] of [
    ['OOM', set => { set.data.failure = { kind: 'functional', message: 'OOM' }; }],
    ['failed download', set => { set.data.scenarios[0].runs[0].outcome = 'failed'; }],
    ['owned resources', set => { set.data.scenarios[0].runs[0].resources.first.leases = 1; }],
    ['idle worker return', set => { set.data.scenarios[0].v2.idle[2].resources.first.avifWorker = true; }],
]) test(`${name} fails even when memory is low`, () => { const set = dataset(); mutate(set); assert.equal(evaluate(set).status, 'FAIL-HOLD'); });
for (const id of ['output-decode-dimensions-mime-transparency', 'limits-serial-cancel-recovery-isolation']) test(`wrong output or failed cancellation in ${id} cannot be waived`, () => {
    assert.equal(evaluate(dataset(), true, records => records.map(record => record.id === id ? { ...record, status: 'fail' } : record)).status, 'FAIL-HOLD');
});
for (const [name, mutate] of [
    ['zero samples', set => { set.data.scenarios[0].v2.samples = []; }],
    ['zero RSS', set => { set.data.scenarios[0].v2.samples[4].rssMiB = 0; }],
    ['unreadable root', set => { set.data.scenarios[0].v2.samples[4].rootReadable = false; }],
    ['sample gap', set => { set.data.scenarios[0].v2.samples.splice(4, 21); }],
    ['missing encode boundary', set => { for (const sample of set.data.scenarios[0].v2.samples) if (sample.phase === 'render-and-encode') sample.phase = 'unknown'; }],
    ['missing resource observations', set => { delete set.data.scenarios[0].runs[0].resources; }],
    ['overlapping operations', set => { set.data.scenarios[0].runs[1].startedAtMs = 100; }],
    ['wrong profile', set => { set.data.scenarios[0].profile = 'library'; }],
    ['wrong build', set => { set.data.scenarios[0].buildSha256 = 'b'.repeat(64); }],
    ['wrong runtime budget', set => { set.data.scenarios[0].policy.limits[0] = 4_194_304; }],
    ['wrong settings', set => { set.data.scenarios[0].v2.settings.ratio = 2; }],
    ['missing scene', set => { set.data.scenarios.pop(); }],
    ['24 replaced by 6', set => { set.data.scenarios[0].runs.length = 6; }],
    ['missing fixed idle', set => { set.data.scenarios[0].v2.idle.pop(); }],
    ['malformed idle', set => { set.data.scenarios[0].v2.idle = {}; }],
    ['wall clock jump', set => { set.data.scenarios[0].v2.samples[4].wallElapsedMs += 99999; }],
    ['legacy report', set => { delete set.data.schema; }],
    ['changed runner binding', set => { set.data.candidate = { ...set.data.candidate, runnerSha256: 'b'.repeat(64) }; }],
    ['partial report', set => { set.data.status = 'partial'; }],
    ['altered registration', set => { set.data.manifestSha256 = 'b'.repeat(64); }],
    ['earlier report', set => { set.data.startedAt = '2025-01-01T00:00:00Z'; }],
    ['duplicate rows', set => { set.data.scenarios.push(set.data.scenarios[0]); }],
]) test(`${name} is evidence HOLD`, () => { const set = dataset(); mutate(set); assert.equal(evaluate(set).status, 'EVIDENCE-HOLD'); });
test('missing device evidence prevents GO', () => assert.equal(evaluate(dataset(), true, records => records.filter(record => record.kind !== 'device')).status, 'EVIDENCE-HOLD'));
test('review is bound to exact report, candidate and attachments', () => {
    for (const field of ['reportSha256', 'candidateSha256', 'manifestSha256', 'evidenceSha256']) assert.equal(evaluate(dataset(), true, records => records.map(record => record.kind === 'review' ? { ...record, [field]: '' } : record)).status, 'REVIEW-HOLD');
    assert.equal(evaluate(dataset(), true, records => records.map(record => ({ ...record, attachmentVerified: false }))).status, 'EVIDENCE-HOLD');
});
test('generic approved flag lacks required five-part assessment', () => assert.equal(evaluate(dataset(), true, records => records.map(record => record.kind === 'review' ? { ...record, approved: true, assessment: {} } : record)).status, 'REVIEW-HOLD'));
test('empty, filtered and altered-schema manifests cannot weaken requirements', () => {
    for (const mutate of [m => { m.scenarios = []; }, m => { m.scenarios.pop(); }, m => { m.schema = 'v3'; }, m => { m.requiredDevices = []; }]) {
        const value = manifest(); mutate(value); assert.throws(() => validateManifest(value));
        assert.equal(evaluateMemory(value, hash, []).status, 'EVIDENCE-HOLD');
    }
});
test('empty reports and instrumentation scope cannot pass release', () => {
    const set = dataset(); assert.equal(evaluateMemory(set.expected, set.manifestSha, []).status, 'EVIDENCE-HOLD');
    set.expected.scope = 'instrumentation'; set.manifestSha = digest(set.expected); set.data.manifestSha256 = set.manifestSha;
    assert.equal(evaluate(set).status, 'EVIDENCE-HOLD');
});
test('high import baseline is exposed separately, without inventing another RAM cutoff', () => {
    const row = entry(); row.v2.samples[0].rssMiB = 2400;
    const result = evaluateScenario(row, requiredMemoryScenarios()[0]);
    assert.equal(result.metrics.sessionPeakRssMiB, 2400); assert.equal(result.metrics.deltaRssMiB, 383);
    assert.deepEqual(result.failures, []); assert.ok(result.warnings.includes('session-headroom-review'));
});
test('four rising release blocks and tail prompt review, not a proven leak', () => {
    const row = entry(); row.runs.forEach((run, index) => { run.releasedRssMiB += index; });
    const result = evaluateScenario(row, requiredMemoryScenarios()[0]);
    assert.ok(result.warnings.includes('released-blocks-rising')); assert.deepEqual(result.failures, []);
    assert.equal(releaseTrend(Array.from({ length: 24 }, (_, index) => ({ releasedRssMiB: 100 + index }))).risingTail, true);
});
test('normal alternating noise and retained idle RSS are not called leaks', () => {
    const result = evaluateScenario(entry(), requiredMemoryScenarios()[0]);
    assert.deepEqual(result.failures, []); assert.equal(result.metrics.trend.risingBlocks, false);
    assert.deepEqual(result.metrics.idleRssMiB, [800, 800, 800]);
});

test('MG1 root non-leader thread exit is reclassified from raw path without mutating evidence', () => {
    const row = entry(), sample = row.v2.samples[4];
    sample.status = 'invalid'; sample.errors = [{ pid: 10, path: '/proc/10/task/11/children', code: 'ENOENT', normalExit: false }];
    const before = JSON.stringify(row), result = evaluateScenario(row, requiredMemoryScenarios()[0]);
    assert.deepEqual(result.invalid, []); assert.equal(result.metrics.reclassifiedThreadExits, 1); assert.equal(JSON.stringify(row), before);
    for (const failure of [
        { path: '/proc/10/task/10/children', code: 'ENOENT' },
        { path: '/proc/10/status', code: 'ENOENT' },
        { path: '/proc/10/task/11/children', code: 'EACCES' },
    ]) {
        sample.errors = [{ pid: 10, normalExit: false, ...failure }];
        assert.ok(evaluateScenario(row, requiredMemoryScenarios()[0]).invalid.includes('unreadable-or-invalid-sample'));
    }
});
test('slow historical reads remain invalid but do not fabricate a wall clock jump', () => {
    const row = entry(), sample = row.v2.samples[4];
    sample.readMs = 1500; sample.wallElapsedMs += 1499;
    const result = evaluateScenario(row, requiredMemoryScenarios()[0]);
    assert.ok(result.invalid.includes('sample-read-over-1000ms'));
    assert.equal(result.invalid.includes('wall-clock-discontinuity'), false);
    sample.wallElapsedMs += 5000;
    assert.ok(evaluateScenario(row, requiredMemoryScenarios()[0]).invalid.includes('wall-clock-discontinuity'));
});
test('new sampler captures both clocks before a slow read', () => {
    let time = 0;
    const sampler = createMemorySampler(10, { read: () => { time += 1500; return { rssMiB: 42 }; }, now: () => time, wall: () => time });
    const sample = sampler.sample();
    assert.equal(sample.atMs, 0); assert.equal(sample.wallElapsedMs, 0); assert.equal(sample.readMs, 1500); assert.equal(sample.wallClockPosition, 'sample-start');
});
test('snapshot tolerates root auxiliary-thread exit but never root-leader disappearance', () => {
    const readText = file => {
        if (file.endsWith('/status')) return 'VmRSS: 1024 kB\n';
        if (file === '/proc/10/task/10/children') return '';
        throw Object.assign(new Error('thread gone'), { code: 'ENOENT' });
    };
    const snapshot = processTreeRssSnapshot(10, { readText, listThreads: () => ['10', '11'] });
    assert.equal(snapshot.status, 'ok'); assert.equal(snapshot.errors[0].normalExit, true);
    assert.equal(processTreeRssSnapshot(10, { readText: file => {
        if (file.endsWith('/status')) return 'VmRSS: 1024 kB\n';
        throw Object.assign(new Error('leader gone'), { code: 'ENOENT' });
    }, listThreads: () => ['10'] }).status, 'invalid');
});

test('structured sampler preserves legacy tree totals, accepts child exit, rejects root loss', () => {
    const files = { '/proc/10/status': 'VmRSS: 1024 kB\n', '/proc/10/task/10/children': '20', '/proc/10/task/11/children': '20 30',
        '/proc/20/status': 'VmRSS: 2048 kB\n', '/proc/20/task/20/children': '' };
    const listThreads = file => file === '/proc/10/task' ? ['10', '11'] : ['20'];
    const legacy = processTreeRssMiB(10, { readText: file => files[file] || '', listThreads });
    const readText = file => { if (file in files) return files[file]; throw Object.assign(new Error('gone'), { code: 'ENOENT' }); };
    const snapshot = processTreeRssSnapshot(10, { readText, listThreads });
    assert.equal(snapshot.rssMiB, legacy); assert.equal(snapshot.status, 'ok'); assert.equal(snapshot.errors[0].normalExit, true);
    assert.equal(processTreeRssSnapshot(40, { readText, listThreads }).status, 'invalid');
    assert.equal(processTreeRssSnapshot(10, { readText: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); }, listThreads }).status, 'invalid');
});
test('one timer and one traversal per sample, monotonic and wall clocks independent', async () => {
    let reads = 0, time = 0;
    const sampler = createMemorySampler(10, { read: () => { reads++; time += 2; return { rssMiB: 42 }; }, now: () => time, wall: () => 1000 + time });
    sampler.start(); assert.throws(() => sampler.start(), /already-started/);
    sampler.sample('export-baseline'); sampler.stop();
    assert.equal(reads, 2); assert.equal(sampler.samples[1].phase, 'export-baseline'); assert.equal(sampler.samples[1].readMs, 2);
    await new Promise(resolve => setTimeout(resolve, 60)); assert.equal(reads, 2);
});
test('atomic checkpoints, duplicate labels and concurrent writers preserve original evidence', async () => {
    const directory = await mkdtemp('/var/tmp/screenhello-memory-contract-'), runDir = path.join(directory, 'run');
    try {
        const writer = await reserveEvidence(runDir, { expected: ['one', 'two'] });
        await assert.rejects(reserveEvidence(runDir, {}), { code: 'EEXIST' });
        await writer.checkpoint(1, { partial: true });
        await writer.failure({ failure: true });
        await assert.rejects(writer.failure({ failure: false }), { code: 'EEXIST' });
        assert.deepEqual(JSON.parse(await readFile(path.join(runDir, 'failure.json'))), { failure: true });
        const file = path.join(runDir, 'race.json');
        const results = await Promise.allSettled([writeImmutableJson(file, { value: 1 }), writeImmutableJson(file, { value: 2 })]);
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
        assert.ok([1, 2].includes(JSON.parse(await readFile(file)).value));
    } finally { for (const file of await readdir(runDir)) await unlink(path.join(runDir, file)); await rmdir(runDir); await rmdir(directory); }
});
test('CLI reads historical evidence without mutation and refuses replacing its verdict', async () => {
    const directory = await mkdtemp('/var/tmp/screenhello-memory-cli-');
    try {
        const historical = '[{"withinReviewLine":false}]\n';
        for (const [file, content] of [['manifest.json', JSON.stringify(manifest())], ['old.json', historical], ['input.json', JSON.stringify({ manifest: 'manifest.json', reports: ['old.json'] })]]) await writeFile(path.join(directory, file), content, { flag: 'wx' });
        const args = ['tests/compression-product/evaluate-memory.mjs', path.join(directory, 'input.json'), path.join(directory, 'result.json')];
        const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
        assert.equal(result.status, 4, result.stderr); assert.equal(sha256(await readFile(path.join(directory, 'old.json'))), sha256(historical));
        const original = await readFile(path.join(directory, 'result.json'));
        assert.notEqual(spawnSync(process.execPath, args).status, 0);
        assert.deepEqual(await readFile(path.join(directory, 'result.json')), original);
        await writeFile(path.join(directory, 'missing-input.json'), JSON.stringify({ manifest: 'manifest.json', reports: ['does-not-exist.json'] }), { flag: 'wx' });
        const missing = spawnSync(process.execPath, ['tests/compression-product/evaluate-memory.mjs', path.join(directory, 'missing-input.json'), path.join(directory, 'missing-result.json')], { encoding: 'utf8' });
        assert.equal(missing.status, 4, missing.stderr);
        assert.equal(JSON.parse(await readFile(path.join(directory, 'missing-result.json'))).readErrors.length, 1);
    } finally { for (const file of await readdir(directory)) await unlink(path.join(directory, file)); await rmdir(directory); }
});
