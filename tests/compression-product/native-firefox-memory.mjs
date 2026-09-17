import assert from 'node:assert/strict';
import { MEMORY_POLICY, DIRECT_PATH, REQUIRED_GATES, REQUIRED_DEVICES, validateManifest, sha256 } from './memory-evidence.mjs';
import { evaluateMemory } from './memory-policy.mjs';
import { compareSystemPressure } from './system-pressure.mjs';

export const NATIVE_MEMORY_SCOPE = 'native-x64-firefox-noise-supplement/v1';
export const NATIVE_MEMORY_REPORT = 'benchmark-1024x1024-direct-firefox-avif-lossy-noise-mg3-native-firefox.json.v2';
export const nativeMemoryScene = () => ({ engine: 'firefox', kind: 'noise', mode: 'avif-lossy', width: 1024, height: 1024,
    repeat: 6, profile: 'web', path: DIRECT_PATH });

export function validateNativeMemoryHost(environment, github) {
    assert.equal(environment.platform, 'linux');
    assert.equal(environment.arch, 'x64', 'native x64 required');
    assert.match(environment.node, /^v24\./);
    assert.equal(github.repository, 'web-casa/ScreenHello');
    assert.equal(github.private, false);
    assert.equal(github.event, 'workflow_dispatch');
    assert.match(github.commit || '', /^[a-f0-9]{40}$/);
    assert.equal(github.runner, 'ubuntu-24.04');
    assert.match(github.runId || '', /^\d+$/);
    assert.equal(github.runAttempt, '1', 'do not overwrite a failed first attempt with a rerun');
}
export function createNativeMemoryManifest(candidate, environment) {
    const manifest = { schema: MEMORY_POLICY, scope: 'instrumentation', registeredAt: new Date().toISOString(), candidate, environment,
        scenarios: [nativeMemoryScene()], requiredGates: [...REQUIRED_GATES], requiredDevices: [...REQUIRED_DEVICES] };
    validateManifest(manifest);
    return manifest;
}

// Independent evaluation still invokes the unchanged V2 rules. Completing this
// supplement cannot supply device/review attestations or turn a release gate GO.
export function evaluateNativeMemorySupplement({ registration, manifestBytes, reportBytes, after, finalCandidate, workflowSha256 }) {
    assert.equal(registration.scope, NATIVE_MEMORY_SCOPE);
    assert.equal(registration.attempts, 1);
    validateNativeMemoryHost(registration.environment, registration.github);
    assert.match(workflowSha256 || '', /^[a-f0-9]{64}$/);
    assert.equal(registration.workflowSha256, workflowSha256, 'workflow changed during collection');
    const manifest = JSON.parse(manifestBytes);
    validateManifest(manifest);
    assert.equal(manifest.scope, 'instrumentation');
    assert.deepEqual(manifest.scenarios, [nativeMemoryScene()]);
    assert.deepEqual(manifest.candidate, registration.candidate);
    assert.deepEqual(manifest.environment, registration.environment);
    assert.deepEqual(finalCandidate, registration.candidate, 'candidate changed during collection');
    assert.equal(sha256(manifestBytes), registration.manifestSha256);
    const report = JSON.parse(reportBytes);
    const times = [manifest.registeredAt, registration.registeredAt, registration.before?.observedAt, report.startedAt, after?.observedAt].map(Date.parse);
    assert.ok(times.every(Number.isFinite) && times.every((time, index) => index === 0 || time >= times[index - 1]), 'invalid observation order');
    const verdict = evaluateMemory(manifest, registration.manifestSha256, [{ data: report, sha256: sha256(reportBytes) }]);
    const pressure = compareSystemPressure(registration.before, after);
    const collectionValid = verdict.invalid.length === 0 && verdict.failures.length === 0 && verdict.results.length === 1;
    return { scope: NATIVE_MEMORY_SCOPE, collectionValid, status: collectionValid ? 'MEASURED-REVIEW-HOLD' : 'EVIDENCE-OR-FUNCTIONAL-HOLD',
        deploymentAuthorized: false, verdict, pressure, reportSha256: sha256(reportBytes) };
}
