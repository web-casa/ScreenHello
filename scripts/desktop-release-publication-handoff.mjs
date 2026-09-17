import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
    createPublicExportSnapshot,
    readPublicManifestAtCommit,
} from './public-repository.mjs';
import {
    desktopReleasePublicationPlanFilename,
    verifyDesktopReleasePublicationPlan,
} from './desktop-release-publication-plan.mjs';

export const desktopReleasePublicationHandoffFilename = 'desktop-public-release-handoff.json';

export const expectedDesktopReleasePublicationHandoff = Object.freeze({
    status: 'candidate-public-export-and-direct-download-handoff-ready-not-run',
    input: {
        publicationPlan: desktopReleasePublicationPlanFilename,
        candidateSource: 'immutable-git-commit-package-json-and-reviewed-public-export-snapshot-required',
        revalidation: 'phase23-publication-plan-direct-download-subject-and-public-export-sha256-revalidation-required',
    },
    handoff: {
        schemaVersion: 1,
        filename: desktopReleasePublicationHandoffFilename,
        writeLocation: 'outside-cross-platform-bundle-release-review-payload-manifest-publication-plan-and-candidate-git-directory',
        atomicCreate: 'outside-all-authenticated-inputs-no-overwrite',
        prerequisite: 'verified-publication-plan-and-candidate-commit-public-export-snapshot',
    },
    publicTarget: {
        repository: 'web-casa/ScreenHello',
        repositoryId: 1353846676,
        branch: 'main',
        sourceCommit: 'candidate-public-export-snapshot-match-required',
        protectedPromotionWorkflow: 'not-configured',
        protectedEnvironment: 'not-configured',
        publisherCredential: {
            sourceRead: 'github-app-installation-token-actions-read-required',
            targetWrite: 'public-repository-github-token-contents-write-required',
            status: 'not-configured',
        },
    },
    directDownload: {
        release: {
            tag: 'v-plus-candidate-package-json-version',
            prerelease: true,
            makeLatest: false,
            releaseBody: 'sha256-per-asset-required',
        },
    },
    linuxRepository: {
        githubReleaseAssets: 'forbidden',
        publication: 'separate-static-https-apt-dists-and-pool-layout-required',
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
            'public-source-commit-must-match-candidate-export-snapshot',
            'linux-apt-public-endpoint-key-distribution-and-rotation-drill-not-configured',
            'updater-trust-root-endpoints-and-key-rotation-not-configured',
            'store-channels-deferred',
        ],
    },
    publicRelease: false,
});

const maximumMetadataBytes = 16 * 1024 * 1024;
const immutableShaPattern = /^[0-9a-f]{40}$/u;
const numericIdentifier = '(?:0|[1-9]\\d*)';
const nonNumericIdentifier = '(?:\\d*[A-Za-z-][0-9A-Za-z-]*)';
const prereleaseIdentifier = `(?:${numericIdentifier}|${nonNumericIdentifier})`;
const buildIdentifier = '[0-9A-Za-z-]+';
const versionPattern = new RegExp(
    `^${numericIdentifier}\\.${numericIdentifier}\\.${numericIdentifier}`
    + `(?:-${prereleaseIdentifier}(?:\\.${prereleaseIdentifier})*)?`
    + `(?:\\+${buildIdentifier}(?:\\.${buildIdentifier})*)?$`,
    'u',
);
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const isInside = (directory, candidate) => {
    const relative = path.relative(directory, candidate);
    return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const directoriesOverlap = (left, right) => (
    left === right || isInside(left, right) || isInside(right, left)
);

const expectedPolicy = (matrix) => {
    if (matrix?.schemaVersion !== 24) {
        throw new Error('desktop-release-publication-handoff-schema-invalid');
    }
    if (!sameJson(matrix?.desktopReleasePublicationHandoff, expectedDesktopReleasePublicationHandoff)) {
        throw new Error('desktop-release-publication-handoff-policy-invalid');
    }
    return matrix.desktopReleasePublicationHandoff;
};

const gitEnvironment = () => {
    const environment = { ...process.env };
    for (const name of [
        'GIT_ALTERNATE_OBJECT_DIRECTORIES',
        'GIT_CONFIG_COUNT',
        'GIT_CONFIG_GLOBAL',
        'GIT_CONFIG_NOSYSTEM',
        'GIT_CONFIG_PARAMETERS',
        'GIT_DIR',
        'GIT_INDEX_FILE',
        'GIT_OBJECT_DIRECTORY',
        'GIT_REPLACE_REF_BASE',
        'GIT_WORK_TREE',
    ]) delete environment[name];
    for (const name of Object.keys(environment)) {
        if (/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u.test(name)) delete environment[name];
    }
    environment.GIT_NO_REPLACE_OBJECTS = '1';
    return environment;
};

const runGit = (directory, argumentsList, { encoding = null, maxBuffer = maximumMetadataBytes } = {}) => new Promise((resolve, reject) => {
    execFile('git', ['-C', directory, '--no-replace-objects', ...argumentsList], {
        encoding,
        env: gitEnvironment(),
        maxBuffer,
        windowsHide: true,
    }, (error, stdout, stderr) => {
        if (error) {
            error.stdout = stdout;
            error.stderr = stderr;
            reject(error);
            return;
        }
        resolve(stdout);
    });
});

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
    throw new Error('desktop-release-publication-handoff-output-already-exists');
};

const resolveExistingDirectory = async ({
    baseDirectory,
    value,
    errorPrefix,
    inputs = [],
}) => {
    if (!value) throw new Error(`${errorPrefix}-directory-required`);
    const requested = path.resolve(baseDirectory, String(value));
    let entry;
    try {
        entry = await lstat(requested);
    } catch {
        throw new Error(`${errorPrefix}-directory-missing`);
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error(`${errorPrefix}-directory-invalid`);
    }
    const absolute = await realpath(requested);
    if (inputs.some((directory) => directoriesOverlap(directory, absolute))) {
        throw new Error(`${errorPrefix}-directory-inside-input`);
    }
    return absolute;
};

const resolveCandidateGitDirectory = async ({ baseDirectory, value, inputs }) => {
    const directory = await resolveExistingDirectory({
        baseDirectory,
        value,
        errorPrefix: 'desktop-release-publication-handoff-candidate-git',
        inputs,
    });
    let root;
    try {
        root = String(await runGit(directory, ['rev-parse', '--show-toplevel'], { encoding: 'utf8' })).trim();
    } catch {
        throw new Error('desktop-release-publication-handoff-candidate-git-not-repository');
    }
    if (!root || await realpath(root) !== directory) {
        throw new Error('desktop-release-publication-handoff-candidate-git-root-invalid');
    }
    return directory;
};

const resolveHandoffDirectory = async ({ baseDirectory, value, inputs }) => (
    resolveExistingDirectory({
        baseDirectory,
        value,
        errorPrefix: 'desktop-release-publication-handoff',
        inputs,
    })
);

const readPublicationPlan = async ({ policy, verified }) => {
    if (!verified?.plan?.absolute || typeof verified.plan.sha256 !== 'string') {
        throw new Error('desktop-release-publication-handoff-publication-plan-invalid');
    }
    await readRegularFile(verified.plan.absolute, 'desktop-release-publication-handoff-publication-plan');
    const absolute = await realpath(verified.plan.absolute);
    if (absolute !== verified.plan.absolute
        || path.dirname(absolute) !== verified.publicationPlanDirectory
        || path.basename(absolute) !== policy.input.publicationPlan) {
        throw new Error('desktop-release-publication-handoff-publication-plan-invalid');
    }
    const buffer = await readFile(absolute);
    if (sha256(buffer) !== verified.plan.sha256) {
        throw new Error('desktop-release-publication-handoff-publication-plan-mutated');
    }
    let json;
    try {
        json = JSON.parse(buffer.toString('utf8'));
    } catch {
        throw new Error('desktop-release-publication-handoff-publication-plan-json-invalid');
    }
    if (json?.candidateSha !== verified.candidateSha
        || json?.releaseReady !== false
        || json?.coverage?.candidateCount !== verified.candidateCount
        || json?.coverage?.platformTargetCount !== verified.platformTargetCount
        || json?.coverage?.sourceSubjectCount !== verified.sourceSubjectCount
        || json?.coverage?.directDownloadAssetCount !== verified.directDownloadAssetCount
        || json?.coverage?.linuxRepositorySidecarCount !== verified.linuxRepositorySidecarCount
        || !Array.isArray(json?.directDownload?.assets)
        || !Array.isArray(json?.linuxRepository?.sidecars)) {
        throw new Error('desktop-release-publication-handoff-publication-plan-invalid');
    }
    return { absolute, sha256: sha256(buffer), json };
};

const readCandidatePackage = async ({ candidateGitDirectory, candidateSha }) => {
    if (!immutableShaPattern.test(candidateSha)) {
        throw new Error('desktop-release-publication-handoff-candidate-sha-invalid');
    }
    let resolved;
    try {
        resolved = String(await runGit(candidateGitDirectory, [
            'rev-parse', '--verify', `${candidateSha}^{commit}`,
        ], { encoding: 'utf8' })).trim();
    } catch {
        throw new Error('desktop-release-publication-handoff-candidate-commit-missing');
    }
    if (resolved !== candidateSha) {
        throw new Error('desktop-release-publication-handoff-candidate-commit-invalid');
    }
    let buffer;
    try {
        buffer = await runGit(candidateGitDirectory, ['cat-file', 'blob', `${candidateSha}:package.json`]);
    } catch {
        throw new Error('desktop-release-publication-handoff-candidate-package-json-missing');
    }
    let packageJson;
    try {
        packageJson = JSON.parse(buffer.toString('utf8'));
    } catch {
        throw new Error('desktop-release-publication-handoff-candidate-package-json-invalid');
    }
    if (!versionPattern.test(String(packageJson?.version || ''))) {
        throw new Error('desktop-release-publication-handoff-candidate-version-invalid');
    }
    return {
        sha: candidateSha,
        packageJson: {
            path: 'package.json',
            sha256: sha256(buffer),
            version: packageJson.version,
        },
    };
};

const releaseBody = (assets) => [
    '## SHA-256',
    '',
    ...assets.map(({ releaseName, sha256: digest }) => `- \`${releaseName}\`: \`${digest}\``),
].join('\n');

const handoffContextFor = async ({
    matrix,
    bundleDirectory,
    reviewDirectory,
    manifestDirectory,
    publicationPlanDirectory,
    candidateGitDirectory,
    handoffDirectory,
    baseDirectory = process.cwd(),
} = {}) => {
    const policy = expectedPolicy(matrix);
    const base = await realpath(path.resolve(baseDirectory));
    const verified = await verifyDesktopReleasePublicationPlan({
        matrix,
        bundleDirectory,
        reviewDirectory,
        manifestDirectory,
        publicationPlanDirectory,
        baseDirectory: base,
    });
    if (!verified.crossPlatformAcceptanceComplete
        || verified.releaseReady !== false
        || !Number.isSafeInteger(verified.candidateCount)
        || verified.candidateCount <= 0
        || !Number.isSafeInteger(verified.directDownloadAssetCount)
        || verified.directDownloadAssetCount <= 0
        || !Number.isSafeInteger(verified.linuxRepositorySidecarCount)
        || verified.linuxRepositorySidecarCount <= 0) {
        throw new Error('desktop-release-publication-handoff-publication-plan-incomplete');
    }
    const inputDirectories = [
        verified.bundleDirectory,
        verified.reviewDirectory,
        verified.manifestDirectory,
        verified.publicationPlanDirectory,
    ];
    if (!inputDirectories.every((directory) => typeof directory === 'string' && path.isAbsolute(directory))) {
        throw new Error('desktop-release-publication-handoff-publication-plan-invalid');
    }
    const plan = await readPublicationPlan({ policy, verified });
    const candidateDirectory = await resolveCandidateGitDirectory({
        baseDirectory: base,
        value: candidateGitDirectory,
        inputs: inputDirectories,
    });
    const candidate = await readCandidatePackage({
        candidateGitDirectory: candidateDirectory,
        candidateSha: verified.candidateSha,
    });
    const sourceManifest = await readPublicManifestAtCommit({
        sourceRoot: candidateDirectory,
        ref: candidate.sha,
    });
    if (sourceManifest.commit !== candidate.sha) {
        throw new Error('desktop-release-publication-handoff-public-export-commit-invalid');
    }
    const publicExport = await createPublicExportSnapshot({
        sourceRoot: candidateDirectory,
        ref: candidate.sha,
        manifest: sourceManifest.manifest,
    });
    if (publicExport.sourceCommit !== candidate.sha
        || publicExport.repository !== `https://github.com/${policy.publicTarget.repository}`
        || !Array.isArray(publicExport.files)
        || publicExport.files.length === 0
        || !/^[0-9a-f]{64}$/u.test(publicExport.treeSha256)) {
        throw new Error('desktop-release-publication-handoff-public-export-invalid');
    }
    const handoff = await resolveHandoffDirectory({
        baseDirectory: base,
        value: handoffDirectory,
        inputs: [...inputDirectories, candidateDirectory],
    });
    return {
        base,
        policy,
        verified,
        plan,
        candidateGitDirectory: candidateDirectory,
        candidate,
        publicExport,
        handoffDirectory: handoff,
        output: path.join(handoff, policy.handoff.filename),
    };
};

const buildPublicationHandoff = (context) => {
    const assets = context.plan.json.directDownload.assets;
    return {
        schemaVersion: context.policy.handoff.schemaVersion,
        status: 'ready-for-protected-public-release-handoff',
        releaseReady: context.policy.decision.releaseReady,
        candidate: context.candidate,
        publicationPlan: {
            name: context.policy.input.publicationPlan,
            sha256: context.plan.sha256,
        },
        coverage: {
            candidateCount: context.verified.candidateCount,
            platformTargetCount: context.verified.platformTargetCount,
            sourceSubjectCount: context.verified.sourceSubjectCount,
            directDownloadAssetCount: context.verified.directDownloadAssetCount,
            linuxRepositorySidecarCount: context.verified.linuxRepositorySidecarCount,
        },
        publicTarget: context.policy.publicTarget,
        publicExport: context.publicExport,
        directDownload: {
            release: {
                tag: `v${context.candidate.packageJson.version}`,
                prerelease: context.policy.directDownload.release.prerelease,
                makeLatest: context.policy.directDownload.release.makeLatest,
                body: releaseBody(assets),
            },
            assets,
        },
        linuxRepository: {
            publication: context.policy.linuxRepository.publication,
            githubReleaseAssets: context.policy.linuxRepository.githubReleaseAssets,
            endpoint: context.policy.linuxRepository.endpoint,
            publicKeyDistribution: context.policy.linuxRepository.publicKeyDistribution,
            rotationAndRevocationDrill: context.policy.linuxRepository.rotationAndRevocationDrill,
            sidecars: context.plan.json.linuxRepository.sidecars,
        },
        decision: context.policy.decision,
    };
};

const writeNewJsonFile = async (output, value) => {
    try {
        await writeFile(output, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644, flag: 'wx' });
    } catch (error) {
        if (error?.code === 'EEXIST') {
            throw new Error('desktop-release-publication-handoff-output-already-exists');
        }
        throw error;
    }
};

const readPublicationHandoff = async (context) => {
    await readRegularFile(context.output, 'desktop-release-publication-handoff');
    const absolute = await realpath(context.output);
    if (absolute !== context.output || path.dirname(absolute) !== context.handoffDirectory) {
        throw new Error('desktop-release-publication-handoff-invalid');
    }
    const buffer = await readFile(absolute);
    let json;
    try {
        json = JSON.parse(buffer.toString('utf8'));
    } catch {
        throw new Error('desktop-release-publication-handoff-json-invalid');
    }
    return { file: { absolute, sha256: sha256(buffer) }, json };
};

const sameHandoffContext = (left, right) => (
    left.handoffDirectory === right.handoffDirectory
    && left.candidateGitDirectory === right.candidateGitDirectory
    && sameJson(buildPublicationHandoff(left), buildPublicationHandoff(right))
);

export const writeDesktopReleasePublicationHandoff = async (options = {}) => {
    const context = await handoffContextFor(options);
    await outputMissing(context.output);
    const revalidated = await handoffContextFor({ ...options, baseDirectory: context.base });
    if (!sameHandoffContext(context, revalidated)) {
        throw new Error('desktop-release-publication-handoff-input-mutated-during-write');
    }
    await outputMissing(revalidated.output);
    const handoff = buildPublicationHandoff(revalidated);
    await writeNewJsonFile(revalidated.output, handoff);
    const finalized = await handoffContextFor({ ...options, baseDirectory: context.base });
    if (!sameHandoffContext(revalidated, finalized)) {
        throw new Error('desktop-release-publication-handoff-input-mutated-during-write');
    }
    const written = await readPublicationHandoff(finalized);
    if (!sameJson(written.json, handoff)) {
        throw new Error('desktop-release-publication-handoff-output-mutated-during-write');
    }
    return { context: finalized, handoff, output: finalized.output };
};

export const verifyDesktopReleasePublicationHandoff = async (options = {}) => {
    const context = await handoffContextFor(options);
    const handoff = await readPublicationHandoff(context);
    if (!sameJson(handoff.json, buildPublicationHandoff(context))) {
        throw new Error('desktop-release-publication-handoff-invalid');
    }
    const revalidated = await handoffContextFor({ ...options, baseDirectory: context.base });
    if (!sameHandoffContext(context, revalidated)) {
        throw new Error('desktop-release-publication-handoff-input-mutated-during-verification');
    }
    const finalHandoff = await readPublicationHandoff(revalidated);
    if (finalHandoff.file.sha256 !== handoff.file.sha256
        || !sameJson(finalHandoff.json, buildPublicationHandoff(revalidated))) {
        throw new Error('desktop-release-publication-handoff-mutated-during-verification');
    }
    return {
        candidateSha: revalidated.candidate.sha,
        version: revalidated.candidate.packageJson.version,
        tag: `v${revalidated.candidate.packageJson.version}`,
        directDownloadAssetCount: revalidated.verified.directDownloadAssetCount,
        linuxRepositorySidecarCount: revalidated.verified.linuxRepositorySidecarCount,
        publicExportTreeSha256: revalidated.publicExport.treeSha256,
        crossPlatformAcceptanceComplete: true,
        releaseReady: revalidated.policy.decision.releaseReady,
        bundleDirectory: revalidated.verified.bundleDirectory,
        reviewDirectory: revalidated.verified.reviewDirectory,
        manifestDirectory: revalidated.verified.manifestDirectory,
        publicationPlanDirectory: revalidated.verified.publicationPlanDirectory,
        candidateGitDirectory: revalidated.candidateGitDirectory,
        handoffDirectory: revalidated.handoffDirectory,
        handoff: finalHandoff.file,
    };
};

const readOption = (argumentsList, index, option) => {
    const value = argumentsList[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`desktop-release-publication-handoff-option-value-required:${option}`);
    }
    return value;
};

export const parseDesktopReleasePublicationHandoffArguments = (argumentsList) => {
    const options = {};
    const seenOptions = new Set();
    for (let index = 0; index < argumentsList.length; index += 1) {
        const option = argumentsList[index];
        if (seenOptions.has(option)) {
            throw new Error(`desktop-release-publication-handoff-option-duplicate:${option}`);
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
        case '--candidate-git-dir':
            options.candidateGitDirectory = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--handoff-dir':
            options.handoffDirectory = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--base-directory':
            options.baseDirectory = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--write-handoff':
            options.mode = options.mode || 'write-handoff';
            if (options.mode !== 'write-handoff') {
                throw new Error('desktop-release-publication-handoff-option-mode-conflict');
            }
            break;
        case '--verify-handoff':
            options.mode = options.mode || 'verify-handoff';
            if (options.mode !== 'verify-handoff') {
                throw new Error('desktop-release-publication-handoff-option-mode-conflict');
            }
            break;
        default:
            throw new Error(`desktop-release-publication-handoff-option-unsupported:${option}`);
        }
    }
    for (const [key, option] of [
        ['bundleDirectory', 'bundle-dir'],
        ['reviewDirectory', 'review-dir'],
        ['manifestDirectory', 'manifest-dir'],
        ['publicationPlanDirectory', 'publication-plan-dir'],
        ['candidateGitDirectory', 'candidate-git-dir'],
        ['handoffDirectory', 'handoff-dir'],
        ['mode', 'mode'],
    ]) {
        if (!options[key]) {
            throw new Error(`desktop-release-publication-handoff-option-required:${option}`);
        }
    }
    return options;
};

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const options = parseDesktopReleasePublicationHandoffArguments(process.argv.slice(2));
    const matrix = JSON.parse(await readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8'));
    const result = options.mode === 'write-handoff'
        ? await writeDesktopReleasePublicationHandoff({ matrix, ...options })
        : await verifyDesktopReleasePublicationHandoff({ matrix, ...options });
    const output = options.mode === 'write-handoff'
        ? {
            status: 'publication-handoff-written',
            mode: options.mode,
            output: path.relative(process.cwd(), result.output),
            candidateSha: result.handoff.candidate.sha,
            version: result.handoff.candidate.packageJson.version,
            tag: result.handoff.directDownload.release.tag,
            directDownloadAssetCount: result.handoff.coverage.directDownloadAssetCount,
            linuxRepositorySidecarCount: result.handoff.coverage.linuxRepositorySidecarCount,
            releaseReady: false,
        }
        : {
            status: 'verified',
            mode: options.mode,
            candidateSha: result.candidateSha,
            version: result.version,
            tag: result.tag,
            directDownloadAssetCount: result.directDownloadAssetCount,
            linuxRepositorySidecarCount: result.linuxRepositorySidecarCount,
            publicExportTreeSha256: result.publicExportTreeSha256,
            releaseReady: result.releaseReady,
        };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
