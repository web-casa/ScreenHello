import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { browserVersionIsAccepted } from './browser-version-policy.mjs';

const matrix = JSON.parse(await readFile(new URL('../config/browser-release-matrix.json', import.meta.url), 'utf8'));
const evidenceDirectory = resolve(process.env.SCREENHELLO_BROWSER_EVIDENCE_DIR || 'artifacts/release/browser-matrix');
const failures = [];
const results = [];
const releaseCandidates = new Set();

const normalize = (value) => String(value || '').toLowerCase();

for (const target of matrix.targets) {
    const path = resolve(evidenceDirectory, `${target.id}.json`);
    let evidence;
    try {
        evidence = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
        failures.push(`${target.id}: missing or invalid evidence (${error.code || error.message})`);
        continue;
    }

    const targetFailures = [];
    if (evidence.schemaVersion !== 1) targetFailures.push('unsupported schemaVersion');
    if (evidence.target !== target.id) targetFailures.push('target mismatch');
    if (evidence.status !== 'passed') targetFailures.push(`status is ${evidence.status || 'missing'}`);
    if (!target.acceptedBrowserNames.map(normalize).includes(normalize(evidence.observed?.browserName))) {
        targetFailures.push('browserName mismatch');
    }
    if (!browserVersionIsAccepted(evidence.observed?.browserVersion, target)) {
        targetFailures.push(`browser version does not satisfy ${target.versionPolicy || 'exact'} policy`);
    }
    if (!evidence.testedAt || Number.isNaN(Date.parse(evidence.testedAt))) targetFailures.push('invalid testedAt');
    if (!/^[0-9a-f]{40}$/.test(evidence.releaseCandidate || '')) targetFailures.push('releaseCandidate is not a commit SHA');
    else releaseCandidates.add(evidence.releaseCandidate);
    const acceptedExecutionEnvironments = target.requiresTrustedSafari
        ? ['trusted-cloud', 'apple-device', 'github-hosted-macos']
        : ['native-amd64', 'native-arm64', 'trusted-cloud'];
    if (!acceptedExecutionEnvironments.includes(evidence.executionEnvironment)) {
        targetFailures.push('execution environment is not release-trusted');
    }
    if (evidence.executionEnvironment?.startsWith('native-') && target.dockerImage && evidence.source !== target.dockerImage) {
        targetFailures.push('native evidence did not use the pinned browser image');
    }
    if (evidence.executionEnvironment === 'trusted-cloud' && (!evidence.source || evidence.source === 'selenium-remote')) {
        targetFailures.push('trusted-cloud provider description missing');
    }
    if (!evidence.checks?.coreEditUndoRedo) targetFailures.push('core edit check missing');
    if (!evidence.checks?.localResourceRequests) targetFailures.push('local request check missing');
    const exports = evidence.checks?.imageExports;
    const expectedTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif']);
    if (!Array.isArray(exports) || exports.length !== 4) {
        targetFailures.push('four-format export evidence missing');
    } else if (
        exports.some(({ name, type, size }) => !name || !expectedTypes.delete(type) || !Number.isFinite(size) || size <= 0)
        || expectedTypes.size
    ) {
        targetFailures.push('four-format export evidence invalid');
    }
    if (normalize(evidence.source).includes('playwright-webkit')) targetFailures.push('Playwright WebKit is not accepted');
    if (target.requiresTrustedSafari) {
        if (evidence.trustedSafari !== true) targetFailures.push('trusted Safari attestation missing');
        if (!evidence.safariEnvironment) targetFailures.push('Safari device/provider description missing');
        if (!/(mac|ios)/i.test(evidence.observed?.platformName || evidence.safariEnvironment || '')) {
            targetFailures.push('Apple platform evidence missing');
        }
        if (evidence.executionEnvironment === 'github-hosted-macos') {
            if (evidence.runner !== target.expectedRunner) targetFailures.push('hosted macOS runner mismatch');
            if (!normalize(evidence.source).includes(normalize(target.expectedRunner))) {
                targetFailures.push('hosted macOS source description missing');
            }
        }
    }

    if (targetFailures.length) failures.push(`${target.id}: ${targetFailures.join(', ')}`);
    results.push({
        target: target.id,
        observed: evidence.observed,
        source: evidence.source,
        executionEnvironment: evidence.executionEnvironment,
        testedAt: evidence.testedAt,
        status: targetFailures.length ? 'failed' : 'passed',
    });
}

if (releaseCandidates.size > 1) failures.push('evidence does not reference one release-candidate commit');
const expectedCandidate = process.env.SCREENHELLO_RELEASE_CANDIDATE;
if (expectedCandidate && (releaseCandidates.size !== 1 || !releaseCandidates.has(expectedCandidate))) {
    failures.push('evidence does not match SCREENHELLO_RELEASE_CANDIDATE');
}

console.log(JSON.stringify({ matrixVersion: matrix.schemaVersion, results, failures }, null, 2));
if (failures.length) process.exitCode = 1;
