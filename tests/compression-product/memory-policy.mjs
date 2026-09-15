import { isDeepStrictEqual } from 'node:util';
import { MEMORY_POLICY, digest, scenarioId, validateManifest } from './memory-evidence.mjs';

const positive = n => Number.isFinite(n) && n > 0;
const finite = n => Number.isFinite(n) && n >= 0;
const nonLeaderThreadExit = (sample, error) => {
    const match = error.path?.match(/^\/proc\/(\d+)\/task\/(\d+)\/children$/);
    return sample.rootReadable === true && error.code === 'ENOENT' && match &&
        Number(match[1]) === sample.rootPid && error.pid === sample.rootPid && Number(match[2]) > 0 && Number(match[2]) !== sample.rootPid;
};
const emptyResources = (resources, workers = false) => resources && Object.keys(resources).length === 2 && Object.values(resources).every(value =>
    value.leases === 0 && value.contexts === 0 && value.prepared === false && value.busy === false &&
    (!workers || (value.pngWorker === false && value.webpWorker === false && value.avifWorker === false)));
const validResources = resources => resources && ['first', 'second'].every(key => {
    const value = resources[key];
    return value && ['leases', 'contexts'].every(field => finite(value[field])) &&
        ['prepared', 'busy', 'pngWorker', 'webpWorker', 'avifWorker'].every(field => typeof value[field] === 'boolean');
});
const median = values => { const sorted = [...values].sort((a, b) => a - b); return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2; };
export function releaseTrend(runs) {
    const values = runs.map(run => run.releasedRssMiB);
    const blocks = [];
    for (let index = 0; index + 6 <= values.length; index += 6) {
        const group = values.slice(index, index + 6);
        blocks.push({ from: index + 1, to: index + 6, median: median(group), min: Math.min(...group), max: Math.max(...group) });
    }
    return { values, blocks,
        risingBlocks: blocks.length >= 4 && blocks.every((block, index) => !index || block.median > blocks[index - 1].median),
        risingTail: values.length >= 6 && values.slice(-6).every((value, index, tail) => !index || value > tail[index - 1]) };
}

export function evaluateScenario(entry, expected) {
    const invalid = [], failures = [], warnings = [];
    const v2 = entry?.v2;
    if (!v2 || !Array.isArray(v2.samples) || !v2.samples.length || !Array.isArray(entry.runs)) return { invalid: ['missing-v2-samples-or-runs'], failures, warnings };
    const samples = v2.samples, runs = entry.runs;
    const checkResources = (value, workers, label) => {
        if (!validResources(value)) invalid.push(`missing-${label}-resources`);
        else if (!emptyResources(value, workers)) failures.push(`${label}-resources-not-released`);
    };
    if (entry.profile !== expected.profile || entry.path !== expected.path || scenarioId({ ...entry, repeat: runs.length }) !== scenarioId(expected)) invalid.push('scenario-or-repeat-mismatch');
    if (entry.policy?.profile !== expected.profile || !isDeepStrictEqual(entry.policy.limits, [1_048_576, 1_048_576])) invalid.push('runtime-policy-mismatch');
    if (!/^[a-f0-9]{64}$/.test(v2.fixtureSha256 || '') || !entry.version || entry.rssSampler !== 'all-thread-child-tree-v2' || entry.timingClock !== 'monotonic-performance-now') invalid.push('missing-provenance');
    if (v2.settings?.format !== expected.mode.split('-')[0] || v2.settings.ratio !== 1 ||
        (v2.settings.compression || 'standard') !== expected.mode.split('-')[1]) invalid.push('output-settings-mismatch');
    if (entry.pageErrors > 0 || entry.externalRequests > 0) failures.push('page-error-or-external-request');
    if (entry.pageErrors !== 0 || entry.externalRequests !== 0) invalid.push('missing-page-checks');
    let maxGapMs = 0, maxReadMs = 0, reclassifiedThreadExits = 0;
    for (let index = 0; index < samples.length; index++) {
        const sample = samples[index], previous = samples[index - 1];
        // Correct MG1's root non-leader thread race using the recorded path,
        // never by rewriting status/errors in the original evidence.
        const threadRaceOnly = sample.status === 'invalid' && sample.errors?.some(error => !error.normalExit && nonLeaderThreadExit(sample, error)) && sample.errors.every(error => error.normalExit || nonLeaderThreadExit(sample, error));
        reclassifiedThreadExits += (sample.errors || []).filter(error => !error.normalExit && nonLeaderThreadExit(sample, error)).length;
        if (!finite(sample.atMs) || !finite(sample.wallElapsedMs) || !positive(sample.rssMiB) || !finite(sample.readMs) || !positive(sample.rootPid) || !sample.rootReadable || !(sample.status === 'ok' || threadRaceOnly)) invalid.push('unreadable-or-invalid-sample');
        if (!Array.isArray(sample.processes) || !sample.processes.some(item => item.pid === sample.rootPid && positive(item.rssKiB)) || !Array.isArray(sample.errors) || sample.errors.some(error => !error.normalExit && !nonLeaderThreadExit(sample, error))) invalid.push('missing-process-read-status');
        if (sample.wallClockPosition !== undefined && sample.wallClockPosition !== 'sample-start') invalid.push('unknown-wall-clock-position');
        maxReadMs = Math.max(maxReadMs, sample.readMs);
        if (sample.readMs > 1000) invalid.push('sample-read-over-1000ms');
        if (previous) {
            const gap = sample.atMs - previous.atMs;
            maxGapMs = Math.max(maxGapMs, gap);
            if (gap < 0) invalid.push('nonmonotonic-clock');
            // All session windows must be covered. This is stricter than only
            // checking encoding, so a lost boundary cannot hide a gap.
            if (gap > 1000) invalid.push('sample-gap-over-1000ms');
            // MG1 recorded wall time after /proc reads, monotonic time before.
            // Normalize that known clock boundary for comparison only. Long
            // reads and sampling gaps still invalidate evidence independently.
            const wallAtStart = point => point.wallElapsedMs - (point.wallClockPosition === 'sample-start' ? 0 : point.readMs);
            if (Math.abs((wallAtStart(sample) - wallAtStart(previous)) - gap) > 1000) invalid.push('wall-clock-discontinuity');
        }
    }
    const baseline = samples.find(sample => sample.atMs === v2.baselineAtMs && sample.phase === 'export-baseline');
    const end = samples.find(sample => sample.atMs === v2.legacyEndMs && sample.phase === 'idle-released');
    if (samples[0].phase !== 'before-navigation' || !baseline || !end || !(v2.legacyEndMs > v2.baselineAtMs)) invalid.push('missing-session-boundaries');
    let previousEnd = v2.baselineAtMs;
    for (const run of runs) {
        if (!finite(run.startedAtMs) || !finite(run.endedAtMs) || run.endedAtMs < run.startedAtMs || run.startedAtMs < v2.baselineAtMs || run.endedAtMs > v2.legacyEndMs || !positive(run.bytes) || !positive(run.releasedRssMiB)) invalid.push('incomplete-operation');
        if (run.outcome === 'failed') failures.push('download-failed');
        else if (run.outcome !== 'downloaded') invalid.push('missing-download-outcome');
        if (!finite(run.downloadedAtMs) || run.downloadedAtMs < run.startedAtMs || run.downloadedAtMs > run.endedAtMs || run.resourcesZeroAtMs !== run.endedAtMs || run.startedAtMs < previousEnd) invalid.push('invalid-operation-order');
        previousEnd = run.endedAtMs;
        checkResources(run.resources, false, 'operation');
        const covered = samples.filter(sample => sample.atMs >= run.startedAtMs && sample.atMs <= run.endedAtMs);
        if (!covered.some(sample => sample.phase === 'render-and-encode') || !covered.some(sample => sample.phase === 'verify-decode')) invalid.push('missing-encoding-interval');
    }
    checkResources(entry.resources, true, 'idle');
    if (!Array.isArray(v2.idle) || v2.idle.length !== 3 || !finite(v2.workerIdleAtMs)) invalid.push('missing-fixed-idle');
    else for (const [index, targetMs] of [5000, 15000, 30000].entries()) {
        const idle = v2.idle[index], sample = samples[idle?.sampleIndex];
        if (idle?.targetMs !== targetMs || !sample || sample.atMs - v2.workerIdleAtMs < targetMs || sample.atMs - v2.workerIdleAtMs > targetMs + 1000) invalid.push('invalid-idle-observation');
        checkResources(idle?.resources, true, 'idle-observation');
    }
    const sessionPeakRssMiB = samples.reduce((max, sample) => Math.max(max, sample.rssMiB), 0);
    const exportSamples = samples.filter(sample => sample.atMs >= v2.baselineAtMs && sample.atMs <= v2.legacyEndMs);
    const exportPeakRssMiB = exportSamples.reduce((max, sample) => Math.max(max, sample.rssMiB), 0);
    const delta = exportPeakRssMiB - (baseline?.rssMiB ?? NaN);
    const deltaRssMiB = Math.round(delta * 10) / 10;
    if (entry.baselineRssMiB !== baseline?.rssMiB || entry.peakRssMiB !== exportPeakRssMiB || entry.deltaRssMiB !== deltaRssMiB || entry.withinReviewLine !== (delta <= 384)) invalid.push('legacy-summary-mismatch');
    if (delta > 384) warnings.push('historical-384-review');
    const trend = releaseTrend(runs);
    if (trend.risingBlocks) warnings.push('released-blocks-rising');
    if (trend.risingTail) warnings.push('released-tail-rising');
    // Total RSS and allocator slack have no universal safe threshold. A
    // candidate-bound review of headroom is mandatory even with a low delta.
    warnings.push('session-headroom-review');
    return { invalid: [...new Set(invalid)], failures: [...new Set(failures)], warnings,
        metrics: { sessionPeakRssMiB, exportPeakRssMiB, deltaRssMiB, maxGapMs, maxReadMs, reclassifiedThreadExits, trend,
            operationPeaksRssMiB: runs.map(run => samples.reduce((max, sample) => sample.atMs >= run.startedAtMs && sample.atMs <= run.endedAtMs ? Math.max(max, sample.rssMiB) : max, 0)),
            idleRssMiB: v2.idle?.map(idle => samples[idle.sampleIndex]?.rssMiB) } };
}

// Supplements are local review records, not signatures or independently
// verified device claims. The CLI verifies attachment bytes and their hashes.
export function evaluateMemory(manifest, manifestSha256, reports, supplements = []) {
    const invalid = [], failures = [], pending = [], reviews = [], results = [];
    try { validateManifest(manifest); } catch (error) { return { schema: MEMORY_POLICY, status: 'EVIDENCE-HOLD', invalid: [error.message], deploymentAuthorized: false }; }
    const binding = digest(manifest.candidate), seen = new Set();
    const validSupplement = record => record && record.candidateSha256 === binding && record.manifestSha256 === manifestSha256 &&
        typeof record.reviewer === 'string' && record.reviewer.trim() && typeof record.reason === 'string' && record.reason.trim() &&
        record.attachmentVerified === true && /^[a-f0-9]{64}$/.test(record.evidenceSha256 || '');
    for (const { data: report, sha256: reportSha256 } of reports) {
        if (report?.failure?.kind === 'functional') failures.push(report.failure.message || 'functional-failure');
        if (report?.schema !== MEMORY_POLICY || !/^[a-f0-9]{64}$/.test(reportSha256 || '')) { invalid.push('legacy-or-unknown-report'); continue; }
        if (report.manifestSha256 !== manifestSha256 || !isDeepStrictEqual(report.candidate, manifest.candidate) || !isDeepStrictEqual(report.environment, manifest.environment)) invalid.push('report-binding-mismatch');
        if (!Number.isFinite(Date.parse(report.startedAt)) || Date.parse(report.startedAt) < Date.parse(manifest.registeredAt)) invalid.push('report-precedes-registration');
        if (report.status !== 'complete') invalid.push('incomplete-report');
        if (!Array.isArray(report.scenarios) || !report.scenarios.length) { invalid.push('empty-report'); continue; }
        for (const entry of report.scenarios) {
            const id = entry?.v2?.scenarioId;
            const expected = manifest.scenarios.find(scene => scenarioId(scene) === id);
            if (!expected || seen.has(id)) { invalid.push('unexpected-or-duplicate-scenario'); continue; }
            seen.add(id);
            let result;
            try { result = evaluateScenario(entry, expected); }
            catch { result = { invalid: ['malformed-scenario-data'], failures: [], warnings: [] }; }
            if (entry.buildSha256 !== manifest.candidate.buildSha256) result.invalid.push('entry-build-mismatch');
            results.push({ id, reportSha256, ...result });
            invalid.push(...result.invalid.map(issue => `${id}: ${issue}`)); failures.push(...result.failures.map(issue => `${id}: ${issue}`));
            const dispositions = supplements.filter(record => record.kind === 'review' && record.scenarioId === id && record.reportSha256 === reportSha256 && validSupplement(record));
            if (dispositions.some(record => record.status === 'fail')) failures.push(`${id}: review-rejected`);
            const accepted = dispositions.some(record => record.status === 'pass' &&
                ['resources', 'trend', 'comparableBaseline', 'deviceStability', 'headroom'].every(key => typeof record.assessment?.[key] === 'string' && record.assessment[key].trim()));
            if (result.warnings.length && !accepted) reviews.push({ id, warnings: result.warnings });
        }
    }
    for (const scene of manifest.scenarios) if (!seen.has(scenarioId(scene))) pending.push(`missing-scenario: ${scenarioId(scene)}`);
    for (const [kind, ids] of [['gate', manifest.requiredGates], ['device', manifest.requiredDevices]]) for (const id of ids) {
        const records = supplements.filter(record => record.kind === kind && record.id === id && validSupplement(record));
        if (records.some(record => record.status === 'fail')) failures.push(`${kind}: ${id}`);
        if (!records.some(record => record.status === 'pass')) pending.push(`${kind}: ${id}`);
    }
    if (manifest.scope !== 'release') pending.push('instrumentation-only-not-release');
    const status = failures.length ? 'FAIL-HOLD' : invalid.length || pending.length ? 'EVIDENCE-HOLD' : reviews.length ? 'REVIEW-HOLD' : 'GO';
    return { schema: MEMORY_POLICY, status, scope: manifest.scope, manifestSha256, candidate: manifest.candidate,
        invalid, failures, pending, reviews, results, deploymentAuthorized: false };
}
