import assert from 'node:assert/strict';
import { validateCompressionResult } from './compression-contract.mjs';

export const CANCEL_SCOPE = 'foreground-cancel-recovery/v1';
export const recoverySpecification = { id: 'pc-png-recovery', fixture: 'pc', format: 'png', compression: 'standard', ratio: 1 };
export const cancellationCases = () => ['pc-avif-standard-cancel', 'pc-png-recovery'];

export function validateCancelEvidence(evidence) {
    assert.equal(evidence?.scope, CANCEL_SCOPE);
    assert.equal(evidence.status, 'passed');
    assert.deepEqual(evidence.registration?.cases, cancellationCases());
    assert.equal(evidence.registration?.attemptsPerCase, 1);
    assert.equal(evidence.registration?.memoryMeasurement, false);
    assert.ok(Number.isFinite(Date.parse(evidence.registration?.registeredAt)));
    assert.match(evidence.registration?.fixtureSha256 || '', /^[a-f0-9]{64}$/);
    const { job, cancelledDownloads, cancellationMs, recoveredSamePage, overflow, jobsAdded } = evidence;
    assert.equal(jobsAdded, 1);
    assert.equal(overflow, false);
    assert.equal(job?.compression, 'standard');
    assert.ok(Number.isInteger(job?.id) && job.id > 0);
    assert.ok([job.width, job.height].every(value => Number.isInteger(value) && value > 0 && value <= 8192));
    assert.ok(job.width * job.height > 1_048_576 && job.width * job.height <= 4_194_304);
    for (const time of [job.startedAt, job.cancelRequestedAt, job.terminatedAt]) assert.ok(Number.isFinite(time) && time >= 0);
    assert.ok(job.startedAt <= job.cancelRequestedAt && job.cancelRequestedAt <= job.terminatedAt);
    assert.equal(job.completedAt, null, 'an already completed encode is not cancellation');
    assert.equal(job.failed, false);
    assert.equal(cancelledDownloads, 0);
    assert.ok(Number.isFinite(cancellationMs) && cancellationMs >= 0 && cancellationMs <= 10_000);
    assert.equal(recoveredSamePage, true);
    assert.ok(Array.isArray(evidence.layersBefore) && evidence.layersBefore.length > 0);
    assert.deepEqual(evidence.layersAfter, evidence.layersBefore, 'project layers changed');
    validateCompressionResult(evidence.recovery, recoverySpecification);
    assert.equal(evidence.recovery.width, job.width);
    assert.equal(evidence.recovery.height, job.height);
    assert.equal(evidence.recoveryDownloads, 1);
}
