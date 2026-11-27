import assert from 'node:assert/strict';
import { sha256 } from '../compression-product/memory-evidence.mjs';
import { decodePcAvifFile } from './avif-file-decoder.mjs';

export const CONTINUOUS_AVIF_SCOPE = 'local-production-continuous-avif/v1';
export const CONTINUOUS_AVIF_TARGET_SCOPE = 'target-browser-continuous-avif/v1';
export const CONTINUOUS_AVIF_COUNT = 6;
export const CONTINUOUS_AVIF_SIZE = [2223, 1667];
export const CONTINUOUS_AVIF_MAX_BYTES = 8_388_608;
export const continuousAvifName = index => `continuous-${index + 1}.avif`;

export async function inspectContinuousAvif(bytes) {
    const decoded = await decodePcAvifFile(bytes);
    assert.deepEqual([decoded.width, decoded.height], CONTINUOUS_AVIF_SIZE);
    assert.equal(decoded.corner?.[3], 0);
    assert.equal(decoded.center?.[3], 255);
    assert.equal(decoded.opaqueVariation, true);
    return { size: bytes.length, sha256: sha256(bytes), decoded };
}

export function validateContinuousAvifEvidence(evidence, { targetBrowser = null } = {}) {
    assert.equal(evidence?.scope, targetBrowser ? CONTINUOUS_AVIF_TARGET_SCOPE : CONTINUOUS_AVIF_SCOPE);
    assert.equal(evidence.status, 'passed');
    const { registration, results, jobs } = evidence;
    assert.equal(registration?.count, CONTINUOUS_AVIF_COUNT);
    assert.equal(registration.attemptsPerCase, 1);
    assert.equal(registration.memoryMeasurement, false);
    assert.equal(registration.mode, 'standard');
    assert.equal(registration.ratio, 1);
    assert.deepEqual(registration.dimensions, CONTINUOUS_AVIF_SIZE);
    assert.ok(Number.isFinite(Date.parse(registration.registeredAt)));
    for (const key of ['webSha256', 'sourceSha256', 'runnerSha256', 'pcSha256']) assert.match(registration[key] || '', /^[a-f0-9]{64}$/);
    assert.deepEqual(evidence.finalFingerprints, Object.fromEntries(['webSha256', 'sourceSha256', 'runnerSha256']
        .map(key => [key, registration[key]])), 'candidate changed during run');
    assert.ok((targetBrowser ? [targetBrowser] : ['chromium', 'firefox', 'webkit']).includes(evidence.environment?.engine));
    assert.ok(evidence.environment.version && evidence.environment.platform && evidence.environment.arch);
    assert.equal(evidence.deliveryEvidence, targetBrowser ? 'native-anchor-blob-bytes' : 'playwright-download-stream');
    assert.equal(evidence.samePage, true);
    assert.equal(evidence.productionEditor, true);
    assert.equal(evidence.overflow, false);
    assert.deepEqual(evidence.pageErrors, []);
    assert.deepEqual(evidence.blockedRequests, []);
    assert.ok(Array.isArray(evidence.layersBefore) && evidence.layersBefore.length > 0);
    assert.deepEqual(evidence.layersAfter, evidence.layersBefore);
    assert.equal(evidence.downloads, CONTINUOUS_AVIF_COUNT);
    assert.equal(results?.length, CONTINUOUS_AVIF_COUNT);
    assert.equal(jobs?.length, CONTINUOUS_AVIF_COUNT);
    const identities = new Set();
    for (let index = 0; index < CONTINUOUS_AVIF_COUNT; index++) {
        const result = results[index];
        const job = jobs[index];
        assert.equal(result.index, index);
        assert.equal(result.file, continuousAvifName(index));
        assert.match(result.downloadName || '', /\.avif$/);
        assert.equal(result.foreground?.visibility, 'visible');
        assert.equal(result.foreground.focused, true);
        assert.ok(Number.isFinite(result.elapsedMs) && result.elapsedMs > 0 && result.elapsedMs <= 120_000);
        assert.equal(result.samePage, true);
        assert.deepEqual(result.layers, evidence.layersBefore);
        assert.equal(result.downloads, index + 1);
        assert.ok(Number.isInteger(result.size) && result.size > 0 && result.size <= CONTINUOUS_AVIF_MAX_BYTES);
        assert.match(result.sha256 || '', /^[a-f0-9]{64}$/);
        assert.deepEqual([result.decoded?.width, result.decoded?.height], CONTINUOUS_AVIF_SIZE);
        assert.equal(result.decoded.decoder, 'jsquash-avif-2.1.1-node-wasm');
        assert.ok(Array.isArray(result.decoded.corner) && result.decoded.corner.length === 4
            && result.decoded.corner.every(n => Number.isInteger(n) && n >= 0 && n <= 255));
        assert.equal(result.decoded.corner[3], 0);
        assert.ok(Array.isArray(result.decoded.center) && result.decoded.center.length === 4
            && result.decoded.center.every(n => Number.isInteger(n) && n >= 0 && n <= 255));
        assert.equal(result.decoded.center[3], 255, 'empty center');
        assert.equal(result.decoded.opaqueVariation, true, 'blank image');
        assert.match(result.decoded.pixelSha256 || '', /^[a-f0-9]{64}$/);
        assert.equal(result.decoded.pixelSha256, results[0].decoded.pixelSha256, 'image changed between exports');
        assert.ok(Number.isInteger(job.id) && job.id > 0 && Number.isInteger(job.workerId) && job.workerId > 0);
        assert.ok(!identities.has(`${job.workerId}:${job.id}`), 'duplicate Worker request');
        identities.add(`${job.workerId}:${job.id}`);
        assert.deepEqual([job.width, job.height], CONTINUOUS_AVIF_SIZE);
        assert.equal(job.compression, 'standard');
        assert.equal(job.failed, false);
        assert.equal(job.cancelRequestedAt, null);
        assert.ok(Number.isFinite(job.startedAt) && job.startedAt >= 0);
        assert.ok(Number.isFinite(job.completedAt) && job.completedAt >= job.startedAt);
        // Idle Worker retirement is valid; retaining the same Worker is not required.
        assert.ok(job.terminatedAt === null || (Number.isFinite(job.terminatedAt) && job.terminatedAt >= job.completedAt));
        if (index) assert.ok(job.startedAt >= jobs[index - 1].completedAt, 'parallel encoding');
    }
}

export function validateTargetContinuousEvidence(evidence, { target, observed, releaseCandidate }) {
    validateContinuousAvifEvidence(evidence, { targetBrowser: target.browser });
    assert.equal(evidence.target, target.id);
    assert.equal(evidence.candidate?.commit, releaseCandidate);
    assert.match(releaseCandidate || '', /^[a-f0-9]{40}$/);
    assert.equal(evidence.candidate.continuousChecks, true);
    assert.equal(evidence.candidate.optionalDevicePackIncluded, false);
    assert.equal(evidence.candidate.deploymentAuthorized, false);
    assert.equal(evidence.environment.version, observed.browserVersion);
    assert.equal(evidence.environment.platform, evidence.candidate.environment?.platform);
    assert.equal(evidence.environment.arch, evidence.candidate.environment?.arch);
    assert.equal(evidence.registration.webSha256, evidence.candidate.webBuildSha256);
    assert.equal(evidence.registration.sourceSha256, evidence.candidate.sourceSha256);
    assert.equal(evidence.registration.runnerSha256, evidence.candidate.runnerSha256);
    assert.deepEqual(evidence.externalResourceRequests, []);
    assert.equal(evidence.observerOverflow, false);
    for (const result of evidence.results) {
        assert.equal(result.type, 'image/avif');
        assert.equal(result.evidenceFile, `${target.id}-${continuousAvifName(result.index)}`);
    }
}
