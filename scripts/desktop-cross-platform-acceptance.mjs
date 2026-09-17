import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { desktopArtifactProvenanceProfiles } from './desktop-artifact-provenance.mjs';
import {
    desktopArtifactProvenanceVerificationReceiptFilename,
    verifyDesktopArtifactProvenanceReceiptLocally,
} from './desktop-artifact-provenance-verification.mjs';
import {
    desktopPlatformAcceptancePlanFilename,
    desktopPlatformAcceptanceRecordFilename,
    verifyDesktopPlatformAcceptanceRecord,
} from './desktop-platform-acceptance.mjs';

export const desktopCrossPlatformAcceptancePlanFilename = 'cross-platform-acceptance-plan.json';

const candidateTargets = Object.freeze(desktopArtifactProvenanceProfiles.map(({ target }) => target));
const platformTargets = Object.freeze([
    'macos-arm64',
    'macos-x64',
    'windows-x64',
    'windows-arm64',
    'linux-x64',
    'linux-arm64',
]);
const maximumMetadataBytes = 16 * 1024 * 1024;

export const expectedDesktopCrossPlatformAcceptance = Object.freeze({
    status: 'cross-candidate-platform-acceptance-plan-and-local-review-ready-not-run',
    bundle: {
        candidateDirectory: 'candidates',
        reviewDirectory: 'reviews',
        candidateReceiptFilename: desktopArtifactProvenanceVerificationReceiptFilename,
        acceptancePlanFilename: desktopPlatformAcceptancePlanFilename,
        acceptanceRecordFilename: desktopPlatformAcceptanceRecordFilename,
        evidenceDirectory: 'evidence',
        offlineTrustedRootFilename: 'trusted-root.jsonl',
    },
    plan: {
        schemaVersion: 1,
        filename: desktopCrossPlatformAcceptancePlanFilename,
        writeLocation: 'bundle-root-outside-candidate-directories',
        atomicCreate: 'bundle-root-no-overwrite',
    },
    coverage: {
        candidateTargets,
        platformTargets,
        candidateSha: 'exact-same-immutable-sha-required',
    },
    record: {
        revalidation: 'phase16-record-and-evidence-sha256-revalidation-required',
        result: 'does-not-change-release-ready',
    },
    publicRelease: false,
});

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const hasExactValues = (actual, expected) => (
    Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index])
);
const isInside = (directory, candidate) => {
    const relative = path.relative(directory, candidate);
    return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const readRegularFile = async (absolute, errorPrefix, maximumBytes = maximumMetadataBytes) => {
    let entry;
    try {
        entry = await lstat(absolute);
    } catch {
        throw new Error(`${errorPrefix}-missing`);
    }
    if (entry.isSymbolicLink() || !entry.isFile() || entry.size <= 0 || entry.size > maximumBytes) {
        throw new Error(`${errorPrefix}-invalid`);
    }
    return entry;
};

const resolveBundleDirectory = async (baseDirectory, value) => {
    if (!value) {
        throw new Error('desktop-cross-platform-acceptance-bundle-directory-required');
    }
    const requested = path.resolve(baseDirectory, String(value ?? ''));
    let entry;
    try {
        entry = await lstat(requested);
    } catch {
        throw new Error('desktop-cross-platform-acceptance-bundle-directory-missing');
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error('desktop-cross-platform-acceptance-bundle-directory-invalid');
    }
    return realpath(requested);
};

const resolveBundleSubdirectory = async ({ bundleDirectory, relative, errorPrefix }) => {
    const requested = path.resolve(bundleDirectory, relative);
    if (!isInside(bundleDirectory, requested)) {
        throw new Error(`${errorPrefix}-outside-bundle-directory`);
    }
    let entry;
    try {
        entry = await lstat(requested);
    } catch {
        throw new Error(`${errorPrefix}-missing`);
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error(`${errorPrefix}-invalid`);
    }
    const absolute = await realpath(requested);
    if (!isInside(bundleDirectory, absolute)) {
        throw new Error(`${errorPrefix}-outside-bundle-directory`);
    }
    return absolute;
};

const outputMissing = async (absolute) => {
    try {
        await lstat(absolute);
    } catch (error) {
        if (error?.code === 'ENOENT') return;
        throw error;
    }
    throw new Error('desktop-cross-platform-acceptance-output-already-exists');
};

const expectedPolicy = (matrix) => {
    if (matrix?.schemaVersion !== 24) {
        throw new Error('desktop-cross-platform-acceptance-schema-invalid');
    }
    if (!sameJson(matrix?.desktopCrossPlatformAcceptance, expectedDesktopCrossPlatformAcceptance)) {
        throw new Error('desktop-cross-platform-acceptance-policy-invalid');
    }
    return matrix.desktopCrossPlatformAcceptance;
};

const candidatePathsFor = ({ policy, profile }) => ({
    candidateDirectory: path.join(policy.bundle.candidateDirectory, profile.target),
    reviewDirectory: path.join(policy.bundle.reviewDirectory, profile.target),
});

const resolveCandidatePaths = async ({ bundleDirectory, policy, profile }) => {
    const relative = candidatePathsFor({ policy, profile });
    const candidateDirectory = await resolveBundleSubdirectory({
        bundleDirectory,
        relative: relative.candidateDirectory,
        errorPrefix: 'desktop-cross-platform-acceptance-candidate-directory',
    });
    const reviewDirectory = await resolveBundleSubdirectory({
        bundleDirectory,
        relative: relative.reviewDirectory,
        errorPrefix: 'desktop-cross-platform-acceptance-review-directory',
    });
    return {
        candidateDirectory,
        reviewDirectory,
        receipt: path.join(reviewDirectory, policy.bundle.candidateReceiptFilename),
        plan: path.join(reviewDirectory, policy.bundle.acceptancePlanFilename),
        record: path.join(reviewDirectory, policy.bundle.acceptanceRecordFilename),
        evidenceDirectory: path.join(reviewDirectory, policy.bundle.evidenceDirectory),
        offlineTrustedRoot: path.join(reviewDirectory, policy.bundle.offlineTrustedRootFilename),
    };
};

const assertCandidateReceiptLocation = ({ candidate, paths }) => {
    if (candidate.context.candidateDirectory !== paths.candidateDirectory
        || candidate.receiptFile.absolute !== paths.receipt
        || !isInside(paths.candidateDirectory, candidate.planFile.absolute)
        || !isInside(paths.candidateDirectory, candidate.checksumFile.absolute)
        || (candidate.trustedRoot && candidate.trustedRoot.absolute !== paths.offlineTrustedRoot)) {
        throw new Error('desktop-cross-platform-acceptance-bundle-layout-invalid');
    }
};

const assertAcceptanceLocation = ({ acceptance, paths }) => {
    if (acceptance.plan.file.absolute !== paths.plan
        || acceptance.record.file.absolute !== paths.record
        || acceptance.evidenceDirectory !== paths.evidenceDirectory) {
        throw new Error('desktop-cross-platform-acceptance-bundle-layout-invalid');
    }
};

const verifyCandidateReceipt = async ({ matrix, bundleDirectory, profile, policy }) => {
    const paths = await resolveCandidatePaths({ bundleDirectory, policy, profile });
    const options = {
        matrix,
        candidateDirectory: paths.candidateDirectory,
        receipt: paths.receipt,
        baseDirectory: bundleDirectory,
    };
    try {
        return {
            candidate: await verifyDesktopArtifactProvenanceReceiptLocally(options),
            offlineTrustedRoot: undefined,
            paths,
        };
    } catch (error) {
        if (error?.message !== 'desktop-artifact-provenance-verification-option-required:offline-trusted-root') {
            throw error;
        }
    }
    return {
        candidate: await verifyDesktopArtifactProvenanceReceiptLocally({
            ...options,
            offlineTrustedRoot: paths.offlineTrustedRoot,
        }),
        offlineTrustedRoot: paths.offlineTrustedRoot,
        paths,
    };
};

const verifyCandidateEntry = async ({ matrix, bundleDirectory, profile, policy, requireRecords }) => {
    const receipt = await verifyCandidateReceipt({ matrix, bundleDirectory, profile, policy });
    let candidate = receipt.candidate;
    let acceptance;
    if (requireRecords) {
        acceptance = await verifyDesktopPlatformAcceptanceRecord({
            matrix,
            candidateDirectory: receipt.paths.candidateDirectory,
            receipt: receipt.paths.receipt,
            plan: receipt.paths.plan,
            record: receipt.paths.record,
            evidenceDirectory: receipt.paths.evidenceDirectory,
            ...(receipt.offlineTrustedRoot
                ? { offlineTrustedRoot: receipt.offlineTrustedRoot }
                : {}),
            baseDirectory: bundleDirectory,
        });
        candidate = acceptance.context.candidate;
        assertAcceptanceLocation({ acceptance, paths: receipt.paths });
    }
    if (candidate.context.profile.target !== profile.target) {
        throw new Error('desktop-cross-platform-acceptance-candidate-target-invalid');
    }
    assertCandidateReceiptLocation({ candidate, paths: receipt.paths });
    return { profile, candidate, acceptance };
};

const validateCandidateCoverage = ({ policy, candidates }) => {
    const targets = candidates.map(({ profile }) => profile.target);
    if (!hasExactValues(targets, policy.coverage.candidateTargets)) {
        throw new Error('desktop-cross-platform-acceptance-candidate-set-invalid');
    }
    const shas = candidates.map(({ candidate }) => candidate.context.candidateSha);
    if (new Set(shas).size !== 1) {
        throw new Error('desktop-cross-platform-acceptance-candidate-sha-mismatch');
    }
    return shas[0];
};

const validatePlatformCoverage = ({ policy, candidates }) => {
    const targets = candidates.flatMap(({ acceptance }) => acceptance.plan.json.targets.map(({ id }) => id));
    if (!hasExactValues(targets, policy.coverage.platformTargets)) {
        throw new Error('desktop-cross-platform-acceptance-platform-target-set-invalid');
    }
    return targets;
};

const reviewContextFor = async ({
    matrix,
    bundleDirectory,
    baseDirectory = process.cwd(),
    requireRecords = false,
} = {}) => {
    const base = await realpath(path.resolve(baseDirectory));
    const policy = expectedPolicy(matrix);
    const bundle = await resolveBundleDirectory(base, bundleDirectory);
    const candidates = [];
    for (const profile of desktopArtifactProvenanceProfiles) {
        candidates.push(await verifyCandidateEntry({
            matrix,
            bundleDirectory: bundle,
            profile,
            policy,
            requireRecords,
        }));
    }
    const candidateSha = validateCandidateCoverage({ policy, candidates });
    const coveredPlatformTargets = requireRecords
        ? validatePlatformCoverage({ policy, candidates })
        : undefined;
    return { base, bundle, policy, candidates, candidateSha, coveredPlatformTargets };
};

const fileBinding = (file) => ({
    name: path.basename(file.absolute),
    sha256: file.sha256,
});

const buildReviewPlan = (context) => ({
    schemaVersion: context.policy.plan.schemaVersion,
    status: 'ready-for-cross-candidate-platform-acceptance-review',
    releaseReady: false,
    candidateSha: context.candidateSha,
    coverage: {
        candidateTargets: context.policy.coverage.candidateTargets,
        platformTargets: context.policy.coverage.platformTargets,
        candidateCount: context.policy.coverage.candidateTargets.length,
        platformTargetCount: context.policy.coverage.platformTargets.length,
    },
    candidates: context.candidates.map(({ profile, candidate }) => ({
        target: profile.target,
        candidateReceipt: fileBinding(candidate.receiptFile),
        provenanceVerificationPlan: fileBinding(candidate.planFile),
        checksums: fileBinding(candidate.checksumFile),
    })),
    record: {
        revalidation: context.policy.record.revalidation,
        result: context.policy.record.result,
    },
});

const reviewPlanOutput = (context) => path.join(context.bundle, context.policy.plan.filename);

const readReviewPlan = async (context) => {
    const output = reviewPlanOutput(context);
    await readRegularFile(output, 'desktop-cross-platform-acceptance-plan');
    const absolute = await realpath(output);
    if (absolute !== output || !isInside(context.bundle, absolute)) {
        throw new Error('desktop-cross-platform-acceptance-plan-invalid');
    }
    const buffer = await readFile(absolute);
    let json;
    try {
        json = JSON.parse(buffer.toString('utf8'));
    } catch {
        throw new Error('desktop-cross-platform-acceptance-plan-json-invalid');
    }
    return { absolute, sha256: sha256(buffer), json };
};

const outputPlan = async (context, value) => {
    const output = reviewPlanOutput(context);
    await outputMissing(output);
    try {
        await writeFile(output, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644, flag: 'wx' });
    } catch (error) {
        if (error?.code === 'EEXIST') {
            throw new Error('desktop-cross-platform-acceptance-output-already-exists');
        }
        throw error;
    }
    return output;
};

const acceptanceRecordBindings = (context) => context.candidates.map(({ profile, acceptance }) => ({
    target: profile.target,
    plan: fileBinding(acceptance.plan.file),
    record: fileBinding(acceptance.record.file),
}));

export const writeDesktopCrossPlatformAcceptancePlan = async (options = {}) => {
    const context = await reviewContextFor(options);
    await outputMissing(reviewPlanOutput(context));
    const revalidated = await reviewContextFor({ ...options, baseDirectory: context.base });
    const plan = buildReviewPlan(revalidated);
    if (!sameJson(buildReviewPlan(context), plan)) {
        throw new Error('desktop-cross-platform-acceptance-candidate-mutated-during-plan-write');
    }
    const output = await outputPlan(revalidated, plan);
    return { context: revalidated, plan, output };
};

export const verifyDesktopCrossPlatformAcceptancePlan = async (options = {}) => {
    const context = await reviewContextFor({ ...options, requireRecords: true });
    const plan = await readReviewPlan(context);
    if (!sameJson(plan.json, buildReviewPlan(context))) {
        throw new Error('desktop-cross-platform-acceptance-plan-invalid');
    }
    const records = acceptanceRecordBindings(context);
    const revalidated = await reviewContextFor({
        ...options,
        baseDirectory: context.base,
        requireRecords: true,
    });
    if (!sameJson(buildReviewPlan(context), buildReviewPlan(revalidated))) {
        throw new Error('desktop-cross-platform-acceptance-candidate-mutated-during-review');
    }
    const revalidatedRecords = acceptanceRecordBindings(revalidated);
    if (!sameJson(records, revalidatedRecords)) {
        throw new Error('desktop-cross-platform-acceptance-record-mutated-during-review');
    }
    const finalPlan = await readReviewPlan(revalidated);
    if (finalPlan.sha256 !== plan.sha256 || !sameJson(finalPlan.json, buildReviewPlan(revalidated))) {
        throw new Error('desktop-cross-platform-acceptance-plan-mutated-during-review');
    }
    const completedChecks = revalidated.candidates.reduce((total, { acceptance }) => (
        total + acceptance.record.json.checks.filter(({ status }) => status === 'passed').length
    ), 0);
    const totalChecks = revalidated.candidates.reduce((total, { acceptance }) => (
        total + acceptance.record.json.checks.length
    ), 0);
    return {
        candidateSha: revalidated.candidateSha,
        candidateCount: revalidated.candidates.length,
        platformTargetCount: revalidated.coveredPlatformTargets.length,
        completedChecks,
        totalChecks,
        crossPlatformAcceptanceComplete: revalidated.candidates.every(
            ({ acceptance }) => acceptance.acceptanceComplete,
        ),
        releaseReady: false,
        plan: finalPlan,
        records: revalidatedRecords,
    };
};

const readOption = (argumentsList, index, option) => {
    const value = argumentsList[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`desktop-cross-platform-acceptance-option-value-required:${option}`);
    }
    return value;
};

export const parseDesktopCrossPlatformAcceptanceArguments = (argumentsList) => {
    const options = {};
    const seenOptions = new Set();
    for (let index = 0; index < argumentsList.length; index += 1) {
        const option = argumentsList[index];
        if (seenOptions.has(option)) {
            throw new Error(`desktop-cross-platform-acceptance-option-duplicate:${option}`);
        }
        seenOptions.add(option);
        switch (option) {
        case '--bundle-dir':
            options.bundleDirectory = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--base-directory':
            options.baseDirectory = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--write-plan':
            options.mode = options.mode || 'write-plan';
            if (options.mode !== 'write-plan') {
                throw new Error('desktop-cross-platform-acceptance-option-mode-conflict');
            }
            break;
        case '--verify-plan':
            options.mode = options.mode || 'verify-plan';
            if (options.mode !== 'verify-plan') {
                throw new Error('desktop-cross-platform-acceptance-option-mode-conflict');
            }
            break;
        default:
            throw new Error(`desktop-cross-platform-acceptance-option-unsupported:${option}`);
        }
    }
    for (const [key, option] of [
        ['bundleDirectory', 'bundle-dir'],
        ['mode', 'mode'],
    ]) {
        if (!options[key]) {
            throw new Error(`desktop-cross-platform-acceptance-option-required:${option}`);
        }
    }
    return options;
};

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const options = parseDesktopCrossPlatformAcceptanceArguments(process.argv.slice(2));
    const matrix = JSON.parse(await readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8'));
    const result = options.mode === 'write-plan'
        ? await writeDesktopCrossPlatformAcceptancePlan({ matrix, ...options })
        : await verifyDesktopCrossPlatformAcceptancePlan({ matrix, ...options });
    const output = options.mode === 'write-plan'
        ? {
            status: 'plan-written',
            mode: options.mode,
            output: path.relative(process.cwd(), result.output),
            candidateSha: result.context.candidateSha,
            candidateCount: result.context.candidates.length,
            acceptance: 'not-verified',
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
