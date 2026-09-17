import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
    desktopCrossPlatformAcceptancePlanFilename,
    verifyDesktopCrossPlatformAcceptancePlan,
} from './desktop-cross-platform-acceptance.mjs';

export const desktopReleaseReviewFilename = 'desktop-release-review.json';

export const expectedDesktopReleaseReview = Object.freeze({
    status: 'cross-platform-acceptance-bound-local-release-review-ready-not-run',
    input: {
        crossPlatformAcceptancePlan: desktopCrossPlatformAcceptancePlanFilename,
        revalidation: 'phase17-cross-platform-plan-and-record-evidence-sha256-revalidation-required',
    },
    review: {
        schemaVersion: 1,
        filename: desktopReleaseReviewFilename,
        writeLocation: 'outside-cross-platform-bundle',
        atomicCreate: 'outside-cross-platform-bundle-no-overwrite',
        prerequisite: 'all-platform-acceptance-checks-passed',
    },
    decision: {
        releaseReady: false,
        authorization: 'explicit-user-authorization-required-before-public-release-or-deployment',
        remainingConfiguration: [
            'protected-public-release-workflow-not-configured',
            'updater-trust-root-endpoints-and-key-rotation-not-configured',
            'store-channels-deferred',
        ],
    },
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
        throw new Error('desktop-release-review-schema-invalid');
    }
    if (!sameJson(matrix?.desktopReleaseReview, expectedDesktopReleaseReview)) {
        throw new Error('desktop-release-review-policy-invalid');
    }
    return matrix.desktopReleaseReview;
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
    throw new Error('desktop-release-review-output-already-exists');
};

const resolveReviewDirectoryOutsideBundle = async ({
    baseDirectory,
    bundleDirectory,
    value,
}) => {
    if (!value) {
        throw new Error('desktop-release-review-directory-required');
    }
    const requested = path.resolve(baseDirectory, String(value));
    if (requested === bundleDirectory || isInside(bundleDirectory, requested)) {
        throw new Error('desktop-release-review-directory-inside-bundle');
    }
    let entry;
    try {
        entry = await lstat(requested);
    } catch {
        throw new Error('desktop-release-review-directory-missing');
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error('desktop-release-review-directory-invalid');
    }
    const absolute = await realpath(requested);
    if (absolute === bundleDirectory || isInside(bundleDirectory, absolute)) {
        throw new Error('desktop-release-review-directory-inside-bundle');
    }
    return absolute;
};

const reviewContextFor = async ({
    matrix,
    bundleDirectory,
    reviewDirectory,
    baseDirectory = process.cwd(),
} = {}) => {
    const policy = expectedPolicy(matrix);
    const base = await realpath(path.resolve(baseDirectory));
    const acceptance = await verifyDesktopCrossPlatformAcceptancePlan({
        matrix,
        bundleDirectory,
        baseDirectory: base,
    });
    if (!acceptance.crossPlatformAcceptanceComplete
        || acceptance.completedChecks !== acceptance.totalChecks
        || acceptance.totalChecks <= 0
        || !Array.isArray(acceptance.records)
        || !acceptance.records.length
        || path.basename(acceptance.plan.absolute) !== policy.input.crossPlatformAcceptancePlan) {
        throw new Error('desktop-release-review-cross-platform-acceptance-incomplete');
    }
    const bundle = await realpath(path.dirname(acceptance.plan.absolute));
    const review = await resolveReviewDirectoryOutsideBundle({
        baseDirectory: base,
        bundleDirectory: bundle,
        value: reviewDirectory,
    });
    return {
        base,
        bundle,
        policy,
        acceptance,
        reviewDirectory: review,
        output: path.join(review, policy.review.filename),
    };
};

const fileBinding = (file) => ({
    name: path.basename(file.absolute),
    sha256: file.sha256,
});

const buildReleaseReview = (context) => ({
    schemaVersion: context.policy.review.schemaVersion,
    status: 'ready-for-human-release-review',
    releaseReady: context.policy.decision.releaseReady,
    candidateSha: context.acceptance.candidateSha,
    crossPlatformAcceptance: {
        plan: fileBinding(context.acceptance.plan),
        records: context.acceptance.records,
        candidateCount: context.acceptance.candidateCount,
        platformTargetCount: context.acceptance.platformTargetCount,
        completedChecks: context.acceptance.completedChecks,
        totalChecks: context.acceptance.totalChecks,
    },
    decision: context.policy.decision,
});

const writeNewJsonFile = async (output, value) => {
    try {
        await writeFile(output, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644, flag: 'wx' });
    } catch (error) {
        if (error?.code === 'EEXIST') {
            throw new Error('desktop-release-review-output-already-exists');
        }
        throw error;
    }
};

const readReleaseReview = async (context) => {
    await readRegularFile(context.output, 'desktop-release-review');
    const absolute = await realpath(context.output);
    if (absolute !== context.output || path.dirname(absolute) !== context.reviewDirectory) {
        throw new Error('desktop-release-review-invalid');
    }
    const buffer = await readFile(absolute);
    let json;
    try {
        json = JSON.parse(buffer.toString('utf8'));
    } catch {
        throw new Error('desktop-release-review-json-invalid');
    }
    return {
        file: {
            absolute,
            name: path.basename(absolute),
            sha256: sha256(buffer),
        },
        json,
    };
};

export const writeDesktopReleaseReview = async (options = {}) => {
    const context = await reviewContextFor(options);
    await outputMissing(context.output);
    const revalidated = await reviewContextFor({ ...options, baseDirectory: context.base });
    if (context.reviewDirectory !== revalidated.reviewDirectory
        || !sameJson(buildReleaseReview(context), buildReleaseReview(revalidated))) {
        throw new Error('desktop-release-review-cross-platform-acceptance-mutated-during-write');
    }
    await outputMissing(revalidated.output);
    const review = buildReleaseReview(revalidated);
    await writeNewJsonFile(revalidated.output, review);
    const finalized = await reviewContextFor({ ...options, baseDirectory: context.base });
    if (revalidated.reviewDirectory !== finalized.reviewDirectory
        || !sameJson(review, buildReleaseReview(finalized))) {
        throw new Error('desktop-release-review-cross-platform-acceptance-mutated-during-write');
    }
    const written = await readReleaseReview(finalized);
    if (!sameJson(written.json, review)) {
        throw new Error('desktop-release-review-output-mutated-during-write');
    }
    return { context: finalized, review, output: finalized.output };
};

export const verifyDesktopReleaseReview = async (options = {}) => {
    const context = await reviewContextFor(options);
    const review = await readReleaseReview(context);
    if (!sameJson(review.json, buildReleaseReview(context))) {
        throw new Error('desktop-release-review-invalid');
    }
    const revalidated = await reviewContextFor({ ...options, baseDirectory: context.base });
    if (context.reviewDirectory !== revalidated.reviewDirectory
        || !sameJson(buildReleaseReview(context), buildReleaseReview(revalidated))) {
        throw new Error('desktop-release-review-cross-platform-acceptance-mutated-during-verification');
    }
    const finalReview = await readReleaseReview(revalidated);
    if (finalReview.file.sha256 !== review.file.sha256
        || !sameJson(finalReview.json, buildReleaseReview(revalidated))) {
        throw new Error('desktop-release-review-mutated-during-verification');
    }
    return {
        candidateSha: revalidated.acceptance.candidateSha,
        candidateCount: revalidated.acceptance.candidateCount,
        platformTargetCount: revalidated.acceptance.platformTargetCount,
        completedChecks: revalidated.acceptance.completedChecks,
        totalChecks: revalidated.acceptance.totalChecks,
        crossPlatformAcceptanceComplete: true,
        releaseReady: revalidated.policy.decision.releaseReady,
        bundleDirectory: revalidated.bundle,
        reviewDirectory: revalidated.reviewDirectory,
        review: finalReview.file,
    };
};

const readOption = (argumentsList, index, option) => {
    const value = argumentsList[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`desktop-release-review-option-value-required:${option}`);
    }
    return value;
};

export const parseDesktopReleaseReviewArguments = (argumentsList) => {
    const options = {};
    const seenOptions = new Set();
    for (let index = 0; index < argumentsList.length; index += 1) {
        const option = argumentsList[index];
        if (seenOptions.has(option)) {
            throw new Error(`desktop-release-review-option-duplicate:${option}`);
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
        case '--base-directory':
            options.baseDirectory = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--write-review':
            options.mode = options.mode || 'write-review';
            if (options.mode !== 'write-review') {
                throw new Error('desktop-release-review-option-mode-conflict');
            }
            break;
        case '--verify-review':
            options.mode = options.mode || 'verify-review';
            if (options.mode !== 'verify-review') {
                throw new Error('desktop-release-review-option-mode-conflict');
            }
            break;
        default:
            throw new Error(`desktop-release-review-option-unsupported:${option}`);
        }
    }
    for (const [key, option] of [
        ['bundleDirectory', 'bundle-dir'],
        ['reviewDirectory', 'review-dir'],
        ['mode', 'mode'],
    ]) {
        if (!options[key]) {
            throw new Error(`desktop-release-review-option-required:${option}`);
        }
    }
    return options;
};

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const options = parseDesktopReleaseReviewArguments(process.argv.slice(2));
    const matrix = JSON.parse(await readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8'));
    const result = options.mode === 'write-review'
        ? await writeDesktopReleaseReview({ matrix, ...options })
        : await verifyDesktopReleaseReview({ matrix, ...options });
    const output = options.mode === 'write-review'
        ? {
            status: 'review-written',
            mode: options.mode,
            output: path.relative(process.cwd(), result.output),
            candidateSha: result.context.acceptance.candidateSha,
            candidateCount: result.context.acceptance.candidateCount,
            platformTargetCount: result.context.acceptance.platformTargetCount,
            releaseReady: false,
        }
        : {
            status: 'verified',
            mode: options.mode,
            candidateSha: result.candidateSha,
            candidateCount: result.candidateCount,
            platformTargetCount: result.platformTargetCount,
            completedChecks: result.completedChecks,
            totalChecks: result.totalChecks,
            crossPlatformAcceptanceComplete: result.crossPlatformAcceptanceComplete,
            releaseReady: result.releaseReady,
        };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
