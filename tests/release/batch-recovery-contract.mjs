import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { decodeAvifFile } from './avif-file-decoder.mjs';

export const BATCH_RECOVERY_SCOPE = 'local-production-batch-recovery/v1';
export const BATCH_TARGET_SCOPE = 'target-browser-batch-recovery/v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const batchRecoveryNames = mode => mode === 'all'
    ? ['recover-a-screenhello.avif', 'recover-b-screenhello.avif'] : ['queued-small-screenhello.avif'];

// Test-only: exact registered tiny outputs, bounded before unzip/decode allocation.
export async function inspectBatchRecoveryZip(bytes, mode) {
    assert.ok(['all', 'current'].includes(mode));
    assert.ok(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 262_144, 'batch ZIP size invalid');
    const expected = batchRecoveryNames(mode);
    const seen = new Set();
    const entries = unzipSync(bytes, { filter: entry => {
        assert.ok(expected.includes(entry.name) && !seen.has(entry.name), 'unexpected or duplicate ZIP entry');
        assert.ok(entry.originalSize > 0 && entry.originalSize <= 131_072, 'batch entry size invalid');
        seen.add(entry.name);
        return true;
    } });
    assert.deepEqual(Object.keys(entries).sort(), [...expected].sort());
    const results = [];
    for (const name of expected) {
        const file = Buffer.from(entries[name]);
        assert.equal(file.subarray(4, 12).toString('ascii'), 'ftypavif');
        results.push({ name, size: file.length, sha256: hash(file),
            decoded: await decodeAvifFile(file.toString('base64')) });
    }
    return { size: bytes.length, sha256: hash(bytes), entries: results };
}

export function validateBatchRecoveryEvidence(evidence, { targetBrowser = null } = {}) {
    assert.equal(evidence?.scope, targetBrowser ? BATCH_TARGET_SCOPE : BATCH_RECOVERY_SCOPE);
    assert.equal(evidence.status, 'passed');
    const { registration, jobs, archive, mode } = evidence;
    assert.ok(['all', 'current'].includes(mode));
    assert.equal(registration?.mode, mode);
    assert.equal(registration.attemptsPerCase, 1);
    assert.equal(registration.memoryMeasurement, false);
    assert.ok(Number.isFinite(Date.parse(registration.registeredAt)));
    for (const value of [registration.webSha256, registration.runnerSha256, registration.pcSha256, registration.smallSha256]) {
        assert.match(value || '', /^[a-f0-9]{64}$/);
    }
    assert.ok((targetBrowser ? [targetBrowser] : ['chromium', 'firefox', 'webkit']).includes(evidence.environment?.engine));
    assert.ok(evidence.environment.version && evidence.environment.platform && evidence.environment.arch);
    assert.equal(evidence.foreground?.visibility, 'visible');
    assert.equal(evidence.foreground.focused, true);
    assert.equal(evidence.overflow, false);
    assert.equal(evidence.samePage, true);
    assert.equal(evidence.productionEditor, true);
    assert.ok(Array.isArray(evidence.layersBefore) && evidence.layersBefore.length > 0);
    assert.deepEqual(evidence.layersAfter, evidence.layersBefore);
    assert.deepEqual(evidence.pageErrors, []);
    assert.deepEqual(evidence.blockedRequests, []);
    assert.equal(evidence.setupDownloads, 1);
    assert.equal(evidence.downloadsBeforeZip, 0, 'batch must not automatically download');
    assert.equal(evidence.downloadsAfterZip, 1, 'late or extra download');
    assert.deepEqual(evidence.cancelledStatuses, mode === 'all' ? ['已取消', '已取消'] : ['已取消', '已完成']);
    assert.equal(evidence.jobsAtCancellationReady, mode === 'all' ? 1 : 2);
    assert.equal(evidence.zipEnabledAfterCancel, mode === 'current');
    assert.deepEqual(evidence.recoveredStatuses, mode === 'all' ? ['已完成', '已完成'] : ['已取消', '已完成']);
    assert.ok(Number.isFinite(evidence.cancellationMs) && evidence.cancellationMs >= 0 && evidence.cancellationMs <= 10_000);
    assert.equal(jobs?.length, mode === 'all' ? 3 : 2);
    const first = jobs[0];
    for (const job of jobs) {
        assert.ok(Number.isInteger(job.id) && job.id > 0 && Number.isInteger(job.workerId) && job.workerId > 0);
        assert.equal(job.compression, 'standard');
        assert.equal(job.failed, false);
        assert.ok([job.width, job.height].every(n => Number.isInteger(n) && n > 0 && n <= 8192));
        assert.ok(Number.isFinite(job.startedAt) && job.startedAt >= 0);
    }
    assert.ok(first.width * first.height > 1_048_576 && first.width * first.height <= 4_194_304);
    assert.ok(Number.isFinite(first.cancelRequestedAt) && Number.isFinite(first.terminatedAt));
    assert.ok(first.startedAt <= first.cancelRequestedAt && first.cancelRequestedAt <= first.terminatedAt);
    assert.equal(first.completedAt, null, 'already completed encode is not cancellation');
    for (let index = 1; index < jobs.length; index++) {
        const job = jobs[index];
        assert.notEqual(job.workerId, first.workerId, 'cancelled Worker reused');
        assert.ok(Number.isFinite(job.completedAt) && job.completedAt >= job.startedAt);
        assert.equal(job.cancelRequestedAt, null);
        assert.ok(job.startedAt >= (index === 1 ? first.terminatedAt : jobs[index - 1].completedAt), 'parallel encoding');
        assert.deepEqual([job.width, job.height], [73, 55]);
    }
    assert.match(archive?.name || '', /^ScreenHello-batch-[\w-]+\.zip$/);
    assert.ok(Number.isInteger(archive.size) && archive.size > 0 && archive.size <= 262_144);
    assert.match(archive.sha256 || '', /^[a-f0-9]{64}$/);
    assert.deepEqual(archive.entries?.map(entry => entry.name), batchRecoveryNames(mode));
    for (const entry of archive.entries) {
        assert.ok(Number.isInteger(entry.size) && entry.size > 0 && entry.size <= 131_072);
        assert.match(entry.sha256 || '', /^[a-f0-9]{64}$/);
        assert.deepEqual([entry.decoded?.width, entry.decoded?.height], [73, 55]);
        assert.equal(entry.decoded.decoder, 'jsquash-avif-2.1.1-node-wasm');
        assert.ok(Array.isArray(entry.decoded.corner) && entry.decoded.corner.length === 4
            && entry.decoded.corner.every(n => Number.isInteger(n) && n >= 0 && n <= 255));
        assert.equal(entry.decoded.corner[3], 0);
    }
}

export function validateTargetBatchEvidence(evidence, { target, observed, releaseCandidate }) {
    assert.equal(evidence?.scope, BATCH_TARGET_SCOPE);
    assert.equal(evidence.status, 'passed');
    assert.equal(evidence.target, target.id);
    assert.equal(evidence.candidate?.commit, releaseCandidate);
    assert.equal(evidence.candidate.optionalDevicePackIncluded, false);
    assert.equal(evidence.candidate.deploymentAuthorized, false);
    assert.equal(evidence.candidate.batchChecks, true);
    for (const key of ['webBuildSha256', 'runnerSha256']) assert.match(evidence.candidate[key] || '', /^[a-f0-9]{64}$/);
    assert.deepEqual(evidence.registration?.modes, ['all', 'current']);
    assert.equal(evidence.registration.attemptsPerCase, 1);
    assert.equal(evidence.registration.memoryMeasurement, false);
    assert.ok(Number.isFinite(Date.parse(evidence.registration.registeredAt)));
    assert.deepEqual(evidence.cases?.map(item => item.mode), ['all', 'current']);
    assert.equal(evidence.zipObserverOverflow, false);
    assert.equal(evidence.zipHandoffs, 2);
    assert.equal(evidence.deliveryEvidence, 'native-anchor-blob-bytes');
    for (const item of evidence.cases) {
        validateBatchRecoveryEvidence(item, { targetBrowser: target.browser });
        assert.equal(item.environment.version, observed.browserVersion);
        assert.equal(item.environment.platform, evidence.candidate.environment?.platform);
        assert.equal(item.environment.arch, evidence.candidate.environment?.arch);
        assert.equal(item.registration.webSha256, evidence.candidate.webBuildSha256);
        assert.equal(item.registration.runnerSha256, evidence.candidate.runnerSha256);
        assert.equal(item.registration.pcSha256, evidence.registration.pcSha256);
        assert.equal(item.registration.smallSha256, evidence.registration.smallSha256);
        assert.deepEqual(item.externalResourceRequests, []);
        assert.equal(item.archive.type, 'application/zip');
        assert.equal(item.archive.evidenceFile, `${target.id}-batch-${item.mode}.zip`);
    }
}
