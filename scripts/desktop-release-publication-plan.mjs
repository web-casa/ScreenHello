import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
    desktopReleasePayloadManifestFilename,
    verifyDesktopReleasePayloadManifest,
} from './desktop-release-payload-manifest.mjs';

export const desktopReleasePublicationPlanFilename = 'desktop-release-publication-plan.json';

const directDownloadAssets = Object.freeze([
    Object.freeze({
        target: 'macos-arm64',
        sourcePath: '*.dmg',
        releaseName: 'ScreenHello-macos-arm64.dmg',
    }),
    Object.freeze({
        target: 'macos-x64',
        sourcePath: '*.dmg',
        releaseName: 'ScreenHello-macos-x64.dmg',
    }),
    Object.freeze({
        target: 'windows-x64',
        sourcePath: '*-setup.exe',
        releaseName: 'ScreenHello-windows-x64-setup.exe',
    }),
    Object.freeze({
        target: 'windows-arm64',
        sourcePath: '*-setup.exe',
        releaseName: 'ScreenHello-windows-arm64-setup.exe',
    }),
    Object.freeze({
        target: 'linux-deb-repository',
        sourcePath: 'repository/pool/main/s/screen-hello/*_amd64.deb',
        releaseName: 'ScreenHello-linux-amd64.deb',
    }),
    Object.freeze({
        target: 'linux-deb-repository',
        sourcePath: 'repository/pool/main/s/screen-hello/*_arm64.deb',
        releaseName: 'ScreenHello-linux-arm64.deb',
    }),
]);

const linuxRepositorySidecars = Object.freeze([
    Object.freeze({
        sourcePath: 'repository/dists/screenhello-beta/Release',
        releaseName: 'screenhello-beta-Release',
    }),
    Object.freeze({
        sourcePath: 'repository/dists/screenhello-beta/InRelease',
        releaseName: 'screenhello-beta-InRelease',
    }),
    Object.freeze({
        sourcePath: 'repository/dists/screenhello-beta/Release.gpg',
        releaseName: 'screenhello-beta-Release.gpg',
    }),
    Object.freeze({
        sourcePath: 'client-trust/screenhello-archive-keyring.gpg',
        releaseName: 'screenhello-archive-keyring.gpg',
    }),
    Object.freeze({
        sourcePath: 'client-trust/screenhello-archive-keyring.asc',
        releaseName: 'screenhello-archive-keyring.asc',
    }),
]);

export const expectedDesktopReleasePublicationPlan = Object.freeze({
    status: 'direct-download-promotion-plan-ready-not-run',
    input: {
        payloadManifest: desktopReleasePayloadManifestFilename,
        revalidation: 'phase19-payload-manifest-and-direct-download-subject-sha256-revalidation-required',
    },
    plan: {
        schemaVersion: 1,
        filename: desktopReleasePublicationPlanFilename,
        writeLocation: 'outside-cross-platform-bundle-release-review-and-payload-manifest',
        atomicCreate: 'outside-cross-platform-bundle-release-review-and-payload-manifest-no-overwrite',
        prerequisite: 'verified-payload-manifest-with-all-attested-subjects',
    },
    publicTarget: {
        repository: 'web-casa/ScreenHello',
        repositoryId: 1353846676,
        releaseAssets: 'direct-download-installers-only',
        protectedPromotionWorkflow: 'not-configured',
        protectedEnvironment: 'not-configured',
        publisherIdentity: 'not-configured',
    },
    directDownload: {
        source: 'phase19-attested-payload-manifest',
        assets: directDownloadAssets,
        tag: {
            prefix: 'v',
            source: 'candidate-commit-package-json',
            status: 'deferred-to-protected-publisher',
        },
    },
    linuxRepository: {
        sourceTarget: 'linux-deb-repository',
        sidecars: linuxRepositorySidecars,
        publication: 'separate-static-https-apt-dists-and-pool-layout-required',
        githubReleaseAssets: 'forbidden',
        endpoint: 'not-configured',
        publicKeyDistribution: 'not-configured',
        rotationAndRevocationDrill: 'not-configured',
    },
    decision: {
        releaseReady: false,
        authorization: 'explicit-user-authorization-required-before-public-release-or-deployment',
        remainingConfiguration: [
            'protected-public-release-workflow-not-configured',
            'public-direct-download-promotion-environment-and-publisher-identity-not-configured',
            'linux-apt-public-endpoint-key-distribution-and-rotation-drill-not-configured',
            'updater-trust-root-endpoints-and-key-rotation-not-configured',
            'store-channels-deferred',
        ],
    },
    publicRelease: false,
});

const maximumMetadataBytes = 16 * 1024 * 1024;
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const isInside = (directory, candidate) => {
    const relative = path.relative(directory, candidate);
    return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const expectedPolicy = (matrix) => {
    if (matrix?.schemaVersion !== 24) {
        throw new Error('desktop-release-publication-plan-schema-invalid');
    }
    if (!sameJson(matrix?.desktopReleasePublicationPlan, expectedDesktopReleasePublicationPlan)) {
        throw new Error('desktop-release-publication-plan-policy-invalid');
    }
    return matrix.desktopReleasePublicationPlan;
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
    throw new Error('desktop-release-publication-plan-output-already-exists');
};

const resolvePublicationPlanDirectoryOutsideInputs = async ({
    baseDirectory,
    bundleDirectory,
    reviewDirectory,
    manifestDirectory,
    value,
}) => {
    if (!value) throw new Error('desktop-release-publication-plan-directory-required');
    const requested = path.resolve(baseDirectory, String(value));
    const inputs = [bundleDirectory, reviewDirectory, manifestDirectory];
    if (inputs.some((directory) => requested === directory || isInside(directory, requested))) {
        throw new Error('desktop-release-publication-plan-directory-inside-input');
    }
    let entry;
    try {
        entry = await lstat(requested);
    } catch {
        throw new Error('desktop-release-publication-plan-directory-missing');
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error('desktop-release-publication-plan-directory-invalid');
    }
    const absolute = await realpath(requested);
    if (inputs.some((directory) => absolute === directory || isInside(directory, absolute))) {
        throw new Error('desktop-release-publication-plan-directory-inside-input');
    }
    return absolute;
};

const globExpression = (value) => new RegExp(`^${value
    .replace(/[|\\{}()[\]^$+?.]/gu, '\\$&')
    .replaceAll('*', '[^/]*')}$`, 'u');

const sourceRecord = ({ target, subject }) => ({
    target,
    path: subject.path,
    name: subject.name,
    bytes: subject.bytes,
    sha256: subject.sha256,
});

const publicationCoverage = ({ policy, payloadManifest }) => {
    if (!Array.isArray(payloadManifest?.payloads)) {
        throw new Error('desktop-release-publication-plan-payload-manifest-invalid');
    }
    const subjects = payloadManifest.payloads.flatMap(({ target, subjects: records }) => (
        Array.isArray(records) ? records.map((subject) => sourceRecord({ target, subject })) : []
    ));
    if (subjects.length !== payloadManifest?.coverage?.subjectCount
        || new Set(subjects.map(({ target, path: subjectPath }) => `${target}:${subjectPath}`)).size !== subjects.length) {
        throw new Error('desktop-release-publication-plan-source-subject-set-invalid');
    }

    const matched = new Set();
    const directDownload = policy.directDownload.assets.map((rule) => {
        const expression = globExpression(rule.sourcePath);
        const matches = subjects.filter((subject) => subject.target === rule.target && expression.test(subject.path));
        if (matches.length !== 1) {
            throw new Error('desktop-release-publication-plan-direct-download-source-invalid');
        }
        const [source] = matches;
        const key = `${source.target}:${source.path}`;
        if (matched.has(key)) {
            throw new Error('desktop-release-publication-plan-source-overlap');
        }
        matched.add(key);
        return { source, releaseName: rule.releaseName };
    });
    if (new Set(directDownload.map(({ releaseName }) => releaseName)).size !== directDownload.length) {
        throw new Error('desktop-release-publication-plan-direct-download-name-invalid');
    }

    const linuxRepository = policy.linuxRepository.sidecars.map((rule) => {
        const matches = subjects.filter((subject) => (
            subject.target === policy.linuxRepository.sourceTarget && subject.path === rule.sourcePath
        ));
        if (matches.length !== 1) {
            throw new Error('desktop-release-publication-plan-linux-repository-source-invalid');
        }
        const [source] = matches;
        const key = `${source.target}:${source.path}`;
        if (matched.has(key)) {
            throw new Error('desktop-release-publication-plan-source-overlap');
        }
        matched.add(key);
        return { source, releaseName: rule.releaseName };
    });
    if (new Set(linuxRepository.map(({ releaseName }) => releaseName)).size !== linuxRepository.length) {
        throw new Error('desktop-release-publication-plan-linux-repository-name-invalid');
    }
    if (matched.size !== subjects.length) {
        throw new Error('desktop-release-publication-plan-source-coverage-invalid');
    }
    return { directDownload, linuxRepository, sourceSubjectCount: subjects.length };
};

const readPayloadManifest = async ({ policy, verified }) => {
    await readRegularFile(verified.manifest.absolute, 'desktop-release-publication-plan-payload-manifest');
    const absolute = await realpath(verified.manifest.absolute);
    if (absolute !== verified.manifest.absolute || path.basename(absolute) !== policy.input.payloadManifest) {
        throw new Error('desktop-release-publication-plan-payload-manifest-invalid');
    }
    const buffer = await readFile(absolute);
    if (sha256(buffer) !== verified.manifest.sha256) {
        throw new Error('desktop-release-publication-plan-payload-manifest-mutated');
    }
    let json;
    try {
        json = JSON.parse(buffer.toString('utf8'));
    } catch {
        throw new Error('desktop-release-publication-plan-payload-manifest-json-invalid');
    }
    return { absolute, sha256: sha256(buffer), json };
};

const publicationPlanContextFor = async ({
    matrix,
    bundleDirectory,
    reviewDirectory,
    manifestDirectory,
    publicationPlanDirectory,
    baseDirectory = process.cwd(),
} = {}) => {
    const policy = expectedPolicy(matrix);
    const base = await realpath(path.resolve(baseDirectory));
    const verified = await verifyDesktopReleasePayloadManifest({
        matrix,
        bundleDirectory,
        reviewDirectory,
        manifestDirectory,
        baseDirectory: base,
    });
    if (!verified.crossPlatformAcceptanceComplete
        || !Number.isSafeInteger(verified.subjectCount)
        || verified.subjectCount <= 0
        || verified.releaseReady !== false) {
        throw new Error('desktop-release-publication-plan-payload-manifest-incomplete');
    }
    const inputDirectories = [
        verified.bundleDirectory,
        verified.reviewDirectory,
        verified.manifestDirectory,
    ];
    if (!inputDirectories.every((directory) => (
        typeof directory === 'string' && path.isAbsolute(directory)
    )) || path.dirname(verified.manifest?.absolute || '') !== verified.manifestDirectory) {
        throw new Error('desktop-release-publication-plan-payload-manifest-invalid');
    }
    const payloadManifest = await readPayloadManifest({ policy, verified });
    if (payloadManifest.json?.candidateSha !== verified.candidateSha
        || payloadManifest.json?.coverage?.candidateCount !== verified.candidateCount
        || payloadManifest.json?.coverage?.platformTargetCount !== verified.platformTargetCount
        || payloadManifest.json?.coverage?.subjectCount !== verified.subjectCount
        || payloadManifest.json?.releaseReady !== false) {
        throw new Error('desktop-release-publication-plan-payload-manifest-invalid');
    }
    const coverage = publicationCoverage({ policy, payloadManifest: payloadManifest.json });
    const directory = await resolvePublicationPlanDirectoryOutsideInputs({
        baseDirectory: base,
        bundleDirectory: verified.bundleDirectory,
        reviewDirectory: verified.reviewDirectory,
        manifestDirectory: verified.manifestDirectory,
        value: publicationPlanDirectory,
    });
    return {
        base,
        policy,
        verified,
        payloadManifest,
        coverage,
        publicationPlanDirectory: directory,
        output: path.join(directory, policy.plan.filename),
    };
};

const publicSource = ({ source, releaseName }) => ({
    target: source.target,
    path: source.path,
    name: source.name,
    bytes: source.bytes,
    sha256: source.sha256,
    releaseName,
});

const buildPublicationPlan = (context) => ({
    schemaVersion: context.policy.plan.schemaVersion,
    status: 'ready-for-protected-public-release-direct-download-promotion',
    releaseReady: context.policy.decision.releaseReady,
    candidateSha: context.verified.candidateSha,
    payloadManifest: {
        name: context.policy.input.payloadManifest,
        sha256: context.payloadManifest.sha256,
    },
    coverage: {
        candidateCount: context.verified.candidateCount,
        platformTargetCount: context.verified.platformTargetCount,
        sourceSubjectCount: context.coverage.sourceSubjectCount,
        directDownloadAssetCount: context.coverage.directDownload.length,
        linuxRepositorySidecarCount: context.coverage.linuxRepository.length,
    },
    publicTarget: context.policy.publicTarget,
    directDownload: {
        releaseTag: context.policy.directDownload.tag,
        assets: context.coverage.directDownload.map(publicSource),
    },
    linuxRepository: {
        publication: context.policy.linuxRepository.publication,
        githubReleaseAssets: context.policy.linuxRepository.githubReleaseAssets,
        endpoint: context.policy.linuxRepository.endpoint,
        publicKeyDistribution: context.policy.linuxRepository.publicKeyDistribution,
        rotationAndRevocationDrill: context.policy.linuxRepository.rotationAndRevocationDrill,
        sidecars: context.coverage.linuxRepository.map(publicSource),
    },
    decision: context.policy.decision,
});

const writeNewJsonFile = async (output, value) => {
    try {
        await writeFile(output, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644, flag: 'wx' });
    } catch (error) {
        if (error?.code === 'EEXIST') {
            throw new Error('desktop-release-publication-plan-output-already-exists');
        }
        throw error;
    }
};

const readPublicationPlan = async (context) => {
    await readRegularFile(context.output, 'desktop-release-publication-plan');
    const absolute = await realpath(context.output);
    if (absolute !== context.output || path.dirname(absolute) !== context.publicationPlanDirectory) {
        throw new Error('desktop-release-publication-plan-invalid');
    }
    const buffer = await readFile(absolute);
    let json;
    try {
        json = JSON.parse(buffer.toString('utf8'));
    } catch {
        throw new Error('desktop-release-publication-plan-json-invalid');
    }
    return {
        file: { absolute, sha256: sha256(buffer) },
        json,
    };
};

export const writeDesktopReleasePublicationPlan = async (options = {}) => {
    const context = await publicationPlanContextFor(options);
    await outputMissing(context.output);
    const revalidated = await publicationPlanContextFor({ ...options, baseDirectory: context.base });
    if (context.publicationPlanDirectory !== revalidated.publicationPlanDirectory
        || !sameJson(buildPublicationPlan(context), buildPublicationPlan(revalidated))) {
        throw new Error('desktop-release-publication-plan-input-mutated-during-write');
    }
    await outputMissing(revalidated.output);
    const plan = buildPublicationPlan(revalidated);
    await writeNewJsonFile(revalidated.output, plan);
    const finalized = await publicationPlanContextFor({ ...options, baseDirectory: context.base });
    if (revalidated.publicationPlanDirectory !== finalized.publicationPlanDirectory
        || !sameJson(plan, buildPublicationPlan(finalized))) {
        throw new Error('desktop-release-publication-plan-input-mutated-during-write');
    }
    const written = await readPublicationPlan(finalized);
    if (!sameJson(written.json, plan)) {
        throw new Error('desktop-release-publication-plan-output-mutated-during-write');
    }
    return { context: finalized, plan, output: finalized.output };
};

export const verifyDesktopReleasePublicationPlan = async (options = {}) => {
    const context = await publicationPlanContextFor(options);
    const plan = await readPublicationPlan(context);
    if (!sameJson(plan.json, buildPublicationPlan(context))) {
        throw new Error('desktop-release-publication-plan-invalid');
    }
    const revalidated = await publicationPlanContextFor({ ...options, baseDirectory: context.base });
    if (context.publicationPlanDirectory !== revalidated.publicationPlanDirectory
        || !sameJson(buildPublicationPlan(context), buildPublicationPlan(revalidated))) {
        throw new Error('desktop-release-publication-plan-input-mutated-during-verification');
    }
    const finalPlan = await readPublicationPlan(revalidated);
    if (finalPlan.file.sha256 !== plan.file.sha256
        || !sameJson(finalPlan.json, buildPublicationPlan(revalidated))) {
        throw new Error('desktop-release-publication-plan-mutated-during-verification');
    }
    return {
        candidateSha: revalidated.verified.candidateSha,
        candidateCount: revalidated.verified.candidateCount,
        platformTargetCount: revalidated.verified.platformTargetCount,
        sourceSubjectCount: revalidated.coverage.sourceSubjectCount,
        directDownloadAssetCount: revalidated.coverage.directDownload.length,
        linuxRepositorySidecarCount: revalidated.coverage.linuxRepository.length,
        crossPlatformAcceptanceComplete: true,
        releaseReady: revalidated.policy.decision.releaseReady,
        bundleDirectory: revalidated.verified.bundleDirectory,
        reviewDirectory: revalidated.verified.reviewDirectory,
        manifestDirectory: revalidated.verified.manifestDirectory,
        publicationPlanDirectory: revalidated.publicationPlanDirectory,
        plan: finalPlan.file,
    };
};

const readOption = (argumentsList, index, option) => {
    const value = argumentsList[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`desktop-release-publication-plan-option-value-required:${option}`);
    }
    return value;
};

export const parseDesktopReleasePublicationPlanArguments = (argumentsList) => {
    const options = {};
    const seenOptions = new Set();
    for (let index = 0; index < argumentsList.length; index += 1) {
        const option = argumentsList[index];
        if (seenOptions.has(option)) {
            throw new Error(`desktop-release-publication-plan-option-duplicate:${option}`);
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
        case '--publication-plan-dir':
            options.publicationPlanDirectory = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--base-directory':
            options.baseDirectory = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--write-publication-plan':
            options.mode = options.mode || 'write-publication-plan';
            if (options.mode !== 'write-publication-plan') {
                throw new Error('desktop-release-publication-plan-option-mode-conflict');
            }
            break;
        case '--verify-publication-plan':
            options.mode = options.mode || 'verify-publication-plan';
            if (options.mode !== 'verify-publication-plan') {
                throw new Error('desktop-release-publication-plan-option-mode-conflict');
            }
            break;
        default:
            throw new Error(`desktop-release-publication-plan-option-unsupported:${option}`);
        }
    }
    for (const [key, option] of [
        ['bundleDirectory', 'bundle-dir'],
        ['reviewDirectory', 'review-dir'],
        ['manifestDirectory', 'manifest-dir'],
        ['publicationPlanDirectory', 'publication-plan-dir'],
        ['mode', 'mode'],
    ]) {
        if (!options[key]) {
            throw new Error(`desktop-release-publication-plan-option-required:${option}`);
        }
    }
    return options;
};

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const options = parseDesktopReleasePublicationPlanArguments(process.argv.slice(2));
    const matrix = JSON.parse(await readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8'));
    const result = options.mode === 'write-publication-plan'
        ? await writeDesktopReleasePublicationPlan({ matrix, ...options })
        : await verifyDesktopReleasePublicationPlan({ matrix, ...options });
    const output = options.mode === 'write-publication-plan'
        ? {
            status: 'publication-plan-written',
            mode: options.mode,
            output: path.relative(process.cwd(), result.output),
            candidateSha: result.context.verified.candidateSha,
            directDownloadAssetCount: result.plan.coverage.directDownloadAssetCount,
            linuxRepositorySidecarCount: result.plan.coverage.linuxRepositorySidecarCount,
            releaseReady: false,
        }
        : {
            status: 'verified',
            mode: options.mode,
            candidateSha: result.candidateSha,
            directDownloadAssetCount: result.directDownloadAssetCount,
            linuxRepositorySidecarCount: result.linuxRepositorySidecarCount,
            releaseReady: result.releaseReady,
        };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
