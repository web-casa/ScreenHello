import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { desktopArtifactProvenanceProfiles } from './desktop-artifact-provenance.mjs';
import { verifyDesktopArtifactProvenanceReceiptLocally } from './desktop-artifact-provenance-verification.mjs';
import {
    desktopReleaseReviewFilename,
    expectedDesktopReleaseReview,
    verifyDesktopReleaseReview,
} from './desktop-release-review.mjs';

export const desktopReleasePayloadManifestFilename = 'desktop-release-payload-manifest.json';

const candidateTargets = Object.freeze(desktopArtifactProvenanceProfiles.map(({ target }) => target));
const expectedSubjectCount = desktopArtifactProvenanceProfiles.reduce(
    (total, profile) => total + profile.subjectCount,
    0,
);

export const expectedDesktopReleasePayloadManifest = Object.freeze({
    status: 'release-review-bound-candidate-payload-manifest-ready-not-run',
    input: {
        releaseReview: desktopReleaseReviewFilename,
        revalidation: 'phase18-release-review-and-attested-subject-sha256-revalidation-required',
    },
    manifest: {
        schemaVersion: 1,
        filename: desktopReleasePayloadManifestFilename,
        writeLocation: 'outside-cross-platform-bundle-and-release-review-directory',
        atomicCreate: 'outside-cross-platform-bundle-and-release-review-directory-no-overwrite',
        prerequisite: 'verified-release-review-with-all-attested-subjects',
    },
    payload: {
        source: 'phase13-attested-candidate-subjects',
        candidateTargets,
        subjectCount: expectedSubjectCount,
    },
    decision: expectedDesktopReleaseReview.decision,
    publicRelease: false,
});

const maximumMetadataBytes = 16 * 1024 * 1024;

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const isInside = (directory, candidate) => {
    const relative = path.relative(directory, candidate);
    return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const expectedPolicy = (matrix) => {
    if (matrix?.schemaVersion !== 24) {
        throw new Error('desktop-release-payload-manifest-schema-invalid');
    }
    if (!sameJson(matrix?.desktopReleasePayloadManifest, expectedDesktopReleasePayloadManifest)) {
        throw new Error('desktop-release-payload-manifest-policy-invalid');
    }
    return matrix.desktopReleasePayloadManifest;
};

const readRegularFile = async (absolute, errorPrefix) => {
    let entry;
    try {
        entry = await lstat(absolute);
    } catch {
        throw new Error(`${errorPrefix}-missing`);
    }
    if (entry.isSymbolicLink() || !entry.isFile() || entry.size <= 0 || entry.size > maximumMetadataBytes) {
        throw new Error(`${errorPrefix}-invalid`);
    }
    return entry;
};

const outputMissing = async (absolute) => {
    try {
        await lstat(absolute);
    } catch (error) {
        if (error?.code === 'ENOENT') return;
        throw error;
    }
    throw new Error('desktop-release-payload-manifest-output-already-exists');
};

const resolveManifestDirectoryOutsideInputs = async ({
    baseDirectory,
    bundleDirectory,
    reviewDirectory,
    value,
}) => {
    if (!value) {
        throw new Error('desktop-release-payload-manifest-directory-required');
    }
    const requested = path.resolve(baseDirectory, String(value));
    if (requested === bundleDirectory
        || requested === reviewDirectory
        || isInside(bundleDirectory, requested)
        || isInside(reviewDirectory, requested)) {
        throw new Error('desktop-release-payload-manifest-directory-inside-input');
    }
    let entry;
    try {
        entry = await lstat(requested);
    } catch {
        throw new Error('desktop-release-payload-manifest-directory-missing');
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error('desktop-release-payload-manifest-directory-invalid');
    }
    const absolute = await realpath(requested);
    if (absolute === bundleDirectory
        || absolute === reviewDirectory
        || isInside(bundleDirectory, absolute)
        || isInside(reviewDirectory, absolute)) {
        throw new Error('desktop-release-payload-manifest-directory-inside-input');
    }
    return absolute;
};

const verifyCandidatePayload = async ({ matrix, bundleDirectory, bundlePolicy, profile, candidateSha }) => {
    const candidateDirectory = path.join(
        bundleDirectory,
        bundlePolicy.candidateDirectory,
        profile.target,
    );
    const reviewDirectory = path.join(
        bundleDirectory,
        bundlePolicy.reviewDirectory,
        profile.target,
    );
    const receipt = path.join(reviewDirectory, bundlePolicy.candidateReceiptFilename);
    const options = {
        matrix,
        candidateDirectory,
        receipt,
        baseDirectory: bundleDirectory,
    };
    let candidate;
    try {
        candidate = await verifyDesktopArtifactProvenanceReceiptLocally(options);
    } catch (error) {
        if (error?.message !== 'desktop-artifact-provenance-verification-option-required:offline-trusted-root') {
            throw error;
        }
        candidate = await verifyDesktopArtifactProvenanceReceiptLocally({
            ...options,
            offlineTrustedRoot: path.join(reviewDirectory, bundlePolicy.offlineTrustedRootFilename),
        });
    }
    if (candidate.context.candidateDirectory !== candidateDirectory
        || candidate.receiptFile.absolute !== receipt
        || candidate.context.profile.target !== profile.target
        || candidate.context.candidateSha !== candidateSha) {
        throw new Error('desktop-release-payload-manifest-bundle-layout-invalid');
    }
    return {
        target: profile.target,
        subjects: candidate.context.subjects.map(({ candidatePath, name, bytes, sha256: digest }) => ({
            path: candidatePath,
            name,
            bytes,
            sha256: digest,
        })),
    };
};

const payloadContextFor = async ({
    matrix,
    bundleDirectory,
    reviewDirectory,
    manifestDirectory,
    baseDirectory = process.cwd(),
} = {}) => {
    const policy = expectedPolicy(matrix);
    const base = await realpath(path.resolve(baseDirectory));
    const releaseReview = await verifyDesktopReleaseReview({
        matrix,
        bundleDirectory,
        reviewDirectory,
        baseDirectory: base,
    });
    if (!releaseReview.crossPlatformAcceptanceComplete
        || releaseReview.completedChecks !== releaseReview.totalChecks
        || releaseReview.totalChecks <= 0
        || releaseReview.candidateCount !== policy.payload.candidateTargets.length
        || releaseReview.review.name !== policy.input.releaseReview) {
        throw new Error('desktop-release-payload-manifest-release-review-incomplete');
    }
    const bundlePolicy = matrix.desktopCrossPlatformAcceptance?.bundle;
    if (!bundlePolicy) {
        throw new Error('desktop-release-payload-manifest-bundle-policy-invalid');
    }
    const payloads = [];
    for (const profile of desktopArtifactProvenanceProfiles) {
        payloads.push(await verifyCandidatePayload({
            matrix,
            bundleDirectory: releaseReview.bundleDirectory,
            bundlePolicy,
            profile,
            candidateSha: releaseReview.candidateSha,
        }));
    }
    if (payloads.length !== policy.payload.candidateTargets.length
        || payloads.some(({ target }, index) => target !== policy.payload.candidateTargets[index])
        || payloads.reduce((total, { subjects }) => total + subjects.length, 0) !== policy.payload.subjectCount) {
        throw new Error('desktop-release-payload-manifest-payload-set-invalid');
    }
    const directory = await resolveManifestDirectoryOutsideInputs({
        baseDirectory: base,
        bundleDirectory: releaseReview.bundleDirectory,
        reviewDirectory: releaseReview.reviewDirectory,
        value: manifestDirectory,
    });
    return {
        base,
        policy,
        releaseReview,
        payloads,
        manifestDirectory: directory,
        output: path.join(directory, policy.manifest.filename),
    };
};

const buildPayloadManifest = (context) => ({
    schemaVersion: context.policy.manifest.schemaVersion,
    status: 'ready-for-protected-public-release-payload-handoff',
    releaseReady: context.policy.decision.releaseReady,
    candidateSha: context.releaseReview.candidateSha,
    releaseReview: {
        name: context.releaseReview.review.name,
        sha256: context.releaseReview.review.sha256,
    },
    coverage: {
        candidateCount: context.releaseReview.candidateCount,
        platformTargetCount: context.releaseReview.platformTargetCount,
        subjectCount: context.payloads.reduce((total, { subjects }) => total + subjects.length, 0),
    },
    payloads: context.payloads,
    decision: context.policy.decision,
});

const writeNewJsonFile = async (output, value) => {
    try {
        await writeFile(output, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644, flag: 'wx' });
    } catch (error) {
        if (error?.code === 'EEXIST') {
            throw new Error('desktop-release-payload-manifest-output-already-exists');
        }
        throw error;
    }
};

const readPayloadManifest = async (context) => {
    await readRegularFile(context.output, 'desktop-release-payload-manifest');
    const absolute = await realpath(context.output);
    if (absolute !== context.output || path.dirname(absolute) !== context.manifestDirectory) {
        throw new Error('desktop-release-payload-manifest-invalid');
    }
    const buffer = await readFile(absolute);
    let json;
    try {
        json = JSON.parse(buffer.toString('utf8'));
    } catch {
        throw new Error('desktop-release-payload-manifest-json-invalid');
    }
    return {
        file: {
            absolute,
            sha256: sha256(buffer),
        },
        json,
    };
};

export const writeDesktopReleasePayloadManifest = async (options = {}) => {
    const context = await payloadContextFor(options);
    await outputMissing(context.output);
    const revalidated = await payloadContextFor({ ...options, baseDirectory: context.base });
    if (context.manifestDirectory !== revalidated.manifestDirectory
        || !sameJson(buildPayloadManifest(context), buildPayloadManifest(revalidated))) {
        throw new Error('desktop-release-payload-manifest-input-mutated-during-write');
    }
    await outputMissing(revalidated.output);
    const manifest = buildPayloadManifest(revalidated);
    await writeNewJsonFile(revalidated.output, manifest);
    const finalized = await payloadContextFor({ ...options, baseDirectory: context.base });
    if (revalidated.manifestDirectory !== finalized.manifestDirectory
        || !sameJson(manifest, buildPayloadManifest(finalized))) {
        throw new Error('desktop-release-payload-manifest-input-mutated-during-write');
    }
    const written = await readPayloadManifest(finalized);
    if (!sameJson(written.json, manifest)) {
        throw new Error('desktop-release-payload-manifest-output-mutated-during-write');
    }
    return { context: finalized, manifest, output: finalized.output };
};

export const verifyDesktopReleasePayloadManifest = async (options = {}) => {
    const context = await payloadContextFor(options);
    const manifest = await readPayloadManifest(context);
    if (!sameJson(manifest.json, buildPayloadManifest(context))) {
        throw new Error('desktop-release-payload-manifest-invalid');
    }
    const revalidated = await payloadContextFor({ ...options, baseDirectory: context.base });
    if (context.manifestDirectory !== revalidated.manifestDirectory
        || !sameJson(buildPayloadManifest(context), buildPayloadManifest(revalidated))) {
        throw new Error('desktop-release-payload-manifest-input-mutated-during-verification');
    }
    const finalManifest = await readPayloadManifest(revalidated);
    if (finalManifest.file.sha256 !== manifest.file.sha256
        || !sameJson(finalManifest.json, buildPayloadManifest(revalidated))) {
        throw new Error('desktop-release-payload-manifest-mutated-during-verification');
    }
    return {
        candidateSha: revalidated.releaseReview.candidateSha,
        candidateCount: revalidated.releaseReview.candidateCount,
        platformTargetCount: revalidated.releaseReview.platformTargetCount,
        subjectCount: revalidated.payloads.reduce((total, { subjects }) => total + subjects.length, 0),
        crossPlatformAcceptanceComplete: true,
        releaseReady: revalidated.policy.decision.releaseReady,
        bundleDirectory: revalidated.releaseReview.bundleDirectory,
        reviewDirectory: revalidated.releaseReview.reviewDirectory,
        manifestDirectory: revalidated.manifestDirectory,
        manifest: finalManifest.file,
    };
};

const readOption = (argumentsList, index, option) => {
    const value = argumentsList[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`desktop-release-payload-manifest-option-value-required:${option}`);
    }
    return value;
};

export const parseDesktopReleasePayloadManifestArguments = (argumentsList) => {
    const options = {};
    const seenOptions = new Set();
    for (let index = 0; index < argumentsList.length; index += 1) {
        const option = argumentsList[index];
        if (seenOptions.has(option)) {
            throw new Error(`desktop-release-payload-manifest-option-duplicate:${option}`);
        }
        seenOptions.add(option);
        switch (option) {
        case '--bundle-dir':
            options.bundleDirectory = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--review-dir':
            options.reviewDirectory = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--manifest-dir':
            options.manifestDirectory = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--base-directory':
            options.baseDirectory = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--write-manifest':
            options.mode = options.mode || 'write-manifest';
            if (options.mode !== 'write-manifest') {
                throw new Error('desktop-release-payload-manifest-option-mode-conflict');
            }
            break;
        case '--verify-manifest':
            options.mode = options.mode || 'verify-manifest';
            if (options.mode !== 'verify-manifest') {
                throw new Error('desktop-release-payload-manifest-option-mode-conflict');
            }
            break;
        default:
            throw new Error(`desktop-release-payload-manifest-option-unsupported:${option}`);
        }
    }
    for (const [key, option] of [
        ['bundleDirectory', 'bundle-dir'],
        ['reviewDirectory', 'review-dir'],
        ['manifestDirectory', 'manifest-dir'],
        ['mode', 'mode'],
    ]) {
        if (!options[key]) {
            throw new Error(`desktop-release-payload-manifest-option-required:${option}`);
        }
    }
    return options;
};

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const options = parseDesktopReleasePayloadManifestArguments(process.argv.slice(2));
    const matrix = JSON.parse(await readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8'));
    const result = options.mode === 'write-manifest'
        ? await writeDesktopReleasePayloadManifest({ matrix, ...options })
        : await verifyDesktopReleasePayloadManifest({ matrix, ...options });
    const output = options.mode === 'write-manifest'
        ? {
            status: 'manifest-written',
            mode: options.mode,
            output: path.relative(process.cwd(), result.output),
            candidateSha: result.context.releaseReview.candidateSha,
            candidateCount: result.context.releaseReview.candidateCount,
            platformTargetCount: result.context.releaseReview.platformTargetCount,
            subjectCount: result.manifest.coverage.subjectCount,
            releaseReady: false,
        }
        : {
            status: 'verified',
            mode: options.mode,
            candidateSha: result.candidateSha,
            candidateCount: result.candidateCount,
            platformTargetCount: result.platformTargetCount,
            subjectCount: result.subjectCount,
            crossPlatformAcceptanceComplete: result.crossPlatformAcceptanceComplete,
            releaseReady: result.releaseReady,
        };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
