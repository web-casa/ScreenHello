import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { writeDesktopArtifactProvenanceRecord } from '../../scripts/desktop-artifact-provenance.mjs';
import {
    executeDesktopArtifactProvenanceVerification,
    writeDesktopArtifactProvenanceVerificationPlan,
} from '../../scripts/desktop-artifact-provenance-verification.mjs';
import {
    parseDesktopCrossPlatformAcceptanceArguments,
    verifyDesktopCrossPlatformAcceptancePlan,
    writeDesktopCrossPlatformAcceptancePlan,
} from '../../scripts/desktop-cross-platform-acceptance.mjs';
import {
    parseDesktopReleaseReviewArguments,
    verifyDesktopReleaseReview,
    writeDesktopReleaseReview,
} from '../../scripts/desktop-release-review.mjs';
import {
    parseDesktopReleasePayloadManifestArguments,
    verifyDesktopReleasePayloadManifest,
    writeDesktopReleasePayloadManifest,
} from '../../scripts/desktop-release-payload-manifest.mjs';
import {
    parseDesktopReleasePublicationPlanArguments,
    verifyDesktopReleasePublicationPlan,
    writeDesktopReleasePublicationPlan,
} from '../../scripts/desktop-release-publication-plan.mjs';
import {
    parseDesktopReleasePublicationHandoffArguments,
    verifyDesktopReleasePublicationHandoff,
    writeDesktopReleasePublicationHandoff,
} from '../../scripts/desktop-release-publication-handoff.mjs';
import { writeDesktopPlatformAcceptancePlan } from '../../scripts/desktop-platform-acceptance.mjs';

const matrix = await readFile(new URL('../../config/desktop-release-matrix.json', import.meta.url), 'utf8').then(JSON.parse);
const primaryCandidateSha = 'a'.repeat(40);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const execFileAsync = promisify(execFile);

const fixtureProfiles = Object.freeze({
    'macos-arm64': {
        candidateDirectory: 'artifacts/macos-signed-candidate',
        subjects: ['ScreenHello-macos-arm64.dmg'],
    },
    'macos-x64': {
        candidateDirectory: 'artifacts/macos-intel-signed-candidate',
        subjects: ['ScreenHello-macos-x64.dmg'],
    },
    'windows-x64': {
        candidateDirectory: 'artifacts/windows-signed-candidate',
        subjects: ['ScreenHello-windows-x64-setup.exe'],
    },
    'windows-arm64': {
        candidateDirectory: 'artifacts/windows-arm64-signed-candidate',
        subjects: ['ScreenHello-windows-arm64-setup.exe'],
    },
    'linux-deb-repository': {
        candidateDirectory: 'artifacts/linux-deb-repository-signed-candidate',
        subjects: [
            'repository/pool/main/s/screen-hello/screen-hello_1.0.4_amd64.deb',
            'repository/pool/main/s/screen-hello/screen-hello_1.0.4_arm64.deb',
            'repository/dists/screenhello-beta/Release',
            'repository/dists/screenhello-beta/InRelease',
            'repository/dists/screenhello-beta/Release.gpg',
            'client-trust/screenhello-archive-keyring.gpg',
            'client-trust/screenhello-archive-keyring.asc',
        ],
    },
});

const createCandidateSource = async (root, { version = '1.0.4' } = {}) => {
    const source = path.join(root, 'candidate-source');
    const publicManifest = {
        schemaVersion: 1,
        targetRepository: 'https://github.com/web-casa/ScreenHello',
        include: {
            files: ['ASSET_PROVENANCE.md', 'LICENSE', 'NOTICE', 'package.json'],
            directories: ['src'],
        },
        generatedFiles: ['PUBLIC_REPOSITORY.json'],
        allowedVisualAssets: [],
        requiredFiles: [
            'ASSET_PROVENANCE.md',
            'LICENSE',
            'NOTICE',
            'PUBLIC_REPOSITORY.json',
            'package.json',
            'src/main.js',
        ],
    };
    const files = {
        'ASSET_PROVENANCE.md': '# Asset Provenance\nBuilt-in visuals are code-native. A download page is not a redistribution license.\n',
        LICENSE: 'MIT License\nCopyright (c) 2024 Chenliwen\n',
        NOTICE: 'ScreenHello is a modified work based on Shoteasy.\n',
        'package.json': JSON.stringify({
            version,
            private: true,
            repository: { url: 'https://github.com/web-casa/ScreenHello.git' },
            scripts: { release: 'node scripts/release-not-configured.mjs' },
        }, null, 2),
        'src/main.js': 'export const ready = true;\n',
        'config/public-export-manifest.json': JSON.stringify(publicManifest, null, 2),
    };
    for (const [relative, content] of Object.entries(files)) {
        const output = path.join(source, ...relative.split('/'));
        await mkdir(path.dirname(output), { recursive: true });
        await writeFile(output, `${content}\n`);
    }
    await execFileAsync('git', ['init', '--quiet'], { cwd: source });
    await execFileAsync('git', ['config', 'user.name', 'ScreenHello Test'], { cwd: source });
    await execFileAsync('git', ['config', 'user.email', 'test@screenhello.invalid'], { cwd: source });
    await execFileAsync('git', ['add', '.'], { cwd: source });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'candidate'], { cwd: source });
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: source });
    return { directory: source, sha: stdout.trim() };
};

const writeChecksums = async (candidateDirectory, relativePaths) => {
    const entries = await Promise.all(relativePaths.map(async (relative) => {
        const content = await readFile(path.join(candidateDirectory, ...relative.split('/')));
        return `${hash(content)}  ${relative}`;
    }));
    await writeFile(path.join(candidateDirectory, 'SHA256SUMS.txt'), `${entries.join('\n')}\n`);
};

const writeAcceptanceRecord = async ({ bundle, target, incomplete = false }) => {
    const reviewDirectory = path.join(bundle, 'reviews', target);
    const planPath = path.join(reviewDirectory, 'platform-acceptance-plan.json');
    const recordPath = path.join(reviewDirectory, 'platform-acceptance-record.json');
    const evidenceDirectory = path.join(reviewDirectory, 'evidence');
    const plan = JSON.parse(await readFile(planPath, 'utf8'));
    const planBytes = await readFile(planPath);
    const checks = await Promise.all(plan.checks.map(async (check, index) => {
        if (incomplete && index === 0) {
            return {
                target: check.target,
                id: check.id,
                status: 'not-run',
                reason: 'The platform acceptance item has not been completed.',
                evidence: [],
            };
        }
        const file = `${target}-${index}.txt`;
        const content = `${target}:${check.target}:${check.id}\n`;
        await writeFile(path.join(evidenceDirectory, file), content);
        return {
            target: check.target,
            id: check.id,
            status: 'passed',
            evidence: [{
                file,
                mediaType: 'text/plain',
                bytes: Buffer.byteLength(content),
                sha256: hash(content),
            }],
        };
    }));
    const record = {
        schemaVersion: 1,
        status: 'manual-platform-acceptance-recorded',
        testedAt: '2026-09-14T02:00:00.000Z',
        candidateSha: plan.candidateSha,
        target,
        plan: {
            name: 'platform-acceptance-plan.json',
            sha256: hash(planBytes),
        },
        candidateReceipt: plan.candidateReceipt,
        environments: plan.targets.map(({ id, platform, arch }) => ({
            target: id,
            system: `${platform} fixture system`,
            hardware: `${arch} fixture hardware`,
        })),
        checks,
    };
    await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);
    return record;
};

const stageCandidate = async ({
    root,
    bundle,
    target,
    candidateSha,
    attestationId,
    incomplete,
    offlineTrustedRoot,
}) => {
    const profile = fixtureProfiles[target];
    const workspace = path.join(root, 'staging', target);
    const candidateDirectory = path.join(workspace, ...profile.candidateDirectory.split('/'));
    const runnerTempDirectory = path.join(workspace, 'runner-temp');
    const bundlePath = path.join(runnerTempDirectory, 'created-attestation.json');
    const stagedCandidateDirectory = path.join(bundle, 'candidates', target);
    const reviewDirectory = path.join(bundle, 'reviews', target);
    await Promise.all([
        mkdir(candidateDirectory, { recursive: true }),
        mkdir(runnerTempDirectory, { recursive: true }),
        mkdir(reviewDirectory, { recursive: true }),
        mkdir(path.join(reviewDirectory, 'evidence'), { recursive: true }),
    ]);
    await Promise.all(profile.subjects.map(async (relative) => {
        const output = path.join(candidateDirectory, ...relative.split('/'));
        await mkdir(path.dirname(output), { recursive: true });
        await writeFile(output, `signed:${target}:${relative}`);
    }));
    await writeFile(bundlePath, '{"mediaType":"application/vnd.dev.sigstore.bundle+json"}\n');
    if (offlineTrustedRoot) {
        await writeFile(path.join(reviewDirectory, 'trusted-root.jsonl'), 'fixture trusted root\n');
    }
    const subjectPaths = profile.subjects.map((relative) => path.join(profile.candidateDirectory, ...relative.split('/')));
    const attestationUrl = `https://github.com/web-casa/signed-candidate/attestations/${attestationId}`;
    await writeDesktopArtifactProvenanceRecord({
        matrix: structuredClone(matrix),
        candidateSha,
        target,
        candidateDirectory: profile.candidateDirectory,
        subjectPaths,
        attestationId,
        attestationUrl,
        bundlePath,
        runnerTempDirectory,
        baseDirectory: workspace,
    });
    await writeDesktopArtifactProvenanceVerificationPlan({
        matrix: structuredClone(matrix),
        candidateDirectory: profile.candidateDirectory,
        baseDirectory: workspace,
    });
    await writeChecksums(candidateDirectory, [
        ...profile.subjects,
        'provenance-attestation.bundle.json',
        'provenance-attestation.json',
        'provenance-verification-plan.json',
    ]);
    await cp(candidateDirectory, stagedCandidateDirectory, { recursive: true, errorOnExist: true });
    await executeDesktopArtifactProvenanceVerification({
        matrix: structuredClone(matrix),
        candidateDirectory: path.join('candidates', target),
        receipt: path.join('reviews', target, 'provenance-verification-receipt.json'),
        ...(offlineTrustedRoot
            ? { offlineTrustedRoot: path.join('reviews', target, 'trusted-root.jsonl') }
            : {}),
        baseDirectory: bundle,
        now: () => new Date('2026-09-14T01:00:00.000Z'),
        runGh: async ({ argumentsList }) => {
            if (argumentsList[0] === 'api') {
                return {
                    exitCode: 0,
                    stdout: `${matrix.desktopArtifactProvenanceVerification.repositoryId}\n`,
                };
            }
            const relative = argumentsList[2];
            const content = await readFile(path.join(stagedCandidateDirectory, ...relative.split('/')));
            return {
                exitCode: 0,
                stdout: JSON.stringify([{
                    verificationResult: {
                        statement: {
                            predicateType: 'https://slsa.dev/provenance/v1',
                            subject: [{
                                name: path.posix.basename(relative),
                                digest: { sha256: hash(content) },
                            }],
                        },
                    },
                }]),
            };
        },
    });
    await writeDesktopPlatformAcceptancePlan({
        matrix: structuredClone(matrix),
        candidateDirectory: path.join('candidates', target),
        receipt: path.join('reviews', target, 'provenance-verification-receipt.json'),
        plan: path.join('reviews', target, 'platform-acceptance-plan.json'),
        ...(offlineTrustedRoot
            ? { offlineTrustedRoot: path.join('reviews', target, 'trusted-root.jsonl') }
            : {}),
        baseDirectory: bundle,
    });
    await writeAcceptanceRecord({ bundle, target, incomplete });
    return { candidateDirectory: stagedCandidateDirectory, firstSubject: profile.subjects[0] };
};

const createBundle = async ({
    incompleteTarget,
    offlineTarget,
    candidateShas = {},
    withCandidateSource = false,
    candidateSourceVersion,
} = {}) => {
    // 见 desktopArtifactProvenanceVerification.test.js：macOS 的 /var 是符号链接，
    // 生产代码对目录做 realpath，fixture 必须使用同一规范化路径才能断言错误码。
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'screenhello-cross-platform-acceptance-')));
    const bundle = path.join(root, 'bundle');
    const candidateSource = withCandidateSource
        ? await createCandidateSource(root, { version: candidateSourceVersion })
        : undefined;
    await Promise.all([
        mkdir(path.join(bundle, 'candidates'), { recursive: true }),
        mkdir(path.join(bundle, 'reviews'), { recursive: true }),
    ]);
    const staged = {};
    let index = 0;
    for (const target of Object.keys(fixtureProfiles)) {
        index += 1;
        staged[target] = await stageCandidate({
            root,
            bundle,
            target,
            candidateSha: candidateShas[target] ?? candidateSource?.sha ?? primaryCandidateSha,
            attestationId: String(10_000 + index),
            incomplete: incompleteTarget === target,
            offlineTrustedRoot: offlineTarget === target,
        });
    }
    return { root, bundle, staged, candidateSource };
};

const reviewOptions = (fixture) => ({
    matrix: structuredClone(matrix),
    bundleDirectory: fixture.bundle,
    baseDirectory: fixture.root,
});

const releaseReviewOptions = (fixture, reviewDirectory) => ({
    ...reviewOptions(fixture),
    reviewDirectory,
});

const payloadManifestOptions = (fixture, reviewDirectory, manifestDirectory) => ({
    ...releaseReviewOptions(fixture, reviewDirectory),
    manifestDirectory,
});

const publicationPlanOptions = (fixture, reviewDirectory, manifestDirectory, publicationPlanDirectory) => ({
    ...payloadManifestOptions(fixture, reviewDirectory, manifestDirectory),
    publicationPlanDirectory,
});

const publicationHandoffOptions = (
    fixture,
    reviewDirectory,
    manifestDirectory,
    publicationPlanDirectory,
    handoffDirectory,
) => ({
    ...publicationPlanOptions(fixture, reviewDirectory, manifestDirectory, publicationPlanDirectory),
    candidateGitDirectory: fixture.candidateSource?.directory,
    handoffDirectory,
});

// These integration fixtures repeatedly verify five on-disk candidate trees.
// Native Windows/Intel macOS runners need an I/O budget, not the unit-test 5s default.
describe('desktop cross-platform acceptance', { timeout: 120_000 }, () => {
    it('binds five candidate receipts and six platform targets to the same immutable SHA without becoming release-ready', async () => {
        const fixture = await createBundle();
        try {
            const written = await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            const verified = await verifyDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));

            expect(written.plan).toMatchObject({
                schemaVersion: 1,
                status: 'ready-for-cross-candidate-platform-acceptance-review',
                candidateSha: primaryCandidateSha,
                coverage: { candidateCount: 5, platformTargetCount: 6 },
                releaseReady: false,
            });
            expect(written.plan.candidates.map(({ target }) => target)).toEqual([
                'macos-arm64',
                'macos-x64',
                'windows-x64',
                'windows-arm64',
                'linux-deb-repository',
            ]);
            expect(verified).toMatchObject({
                candidateSha: primaryCandidateSha,
                candidateCount: 5,
                platformTargetCount: 6,
                completedChecks: 42,
                totalChecks: 42,
                crossPlatformAcceptanceComplete: true,
                releaseReady: false,
            });
            expect(JSON.stringify(written.plan)).not.toContain(fixture.root);
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('writes an external local release review that binds every current platform record without authorizing a release', async () => {
        const fixture = await createBundle();
        const reviewDirectory = path.join(fixture.root, 'release-review');
        try {
            await mkdir(reviewDirectory);
            await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            const written = await writeDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory));
            const verified = await verifyDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory));

            expect(written.review).toMatchObject({
                schemaVersion: 1,
                status: 'ready-for-human-release-review',
                candidateSha: primaryCandidateSha,
                releaseReady: false,
                crossPlatformAcceptance: {
                    candidateCount: 5,
                    platformTargetCount: 6,
                    completedChecks: 42,
                    totalChecks: 42,
                    records: expect.arrayContaining([
                        expect.objectContaining({ target: 'macos-arm64' }),
                        expect.objectContaining({ target: 'linux-deb-repository' }),
                    ]),
                },
            });
            expect(verified).toMatchObject({
                candidateSha: primaryCandidateSha,
                candidateCount: 5,
                platformTargetCount: 6,
                completedChecks: 42,
                totalChecks: 42,
                crossPlatformAcceptanceComplete: true,
                releaseReady: false,
            });
            expect(JSON.stringify(written.review)).not.toContain(fixture.root);
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    // This assembles five on-disk candidates, then performs both the write-time
    // and read-time hash revalidation for all 11 subjects. It is intentionally
    // a filesystem integration test rather than a 5 s in-memory unit operation.
    it('writes a release-review-bound inventory of every attested candidate payload without authorizing a release', async () => {
        const fixture = await createBundle();
        const reviewDirectory = path.join(fixture.root, 'release-review');
        const manifestDirectory = path.join(fixture.root, 'payload-manifest');
        try {
            await Promise.all([mkdir(reviewDirectory), mkdir(manifestDirectory)]);
            await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            await writeDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory));
            const written = await writeDesktopReleasePayloadManifest(
                payloadManifestOptions(fixture, reviewDirectory, manifestDirectory),
            );
            const verified = await verifyDesktopReleasePayloadManifest(
                payloadManifestOptions(fixture, reviewDirectory, manifestDirectory),
            );

            expect(written.manifest).toMatchObject({
                schemaVersion: 1,
                status: 'ready-for-protected-public-release-payload-handoff',
                candidateSha: primaryCandidateSha,
                releaseReady: false,
                coverage: {
                    candidateCount: 5,
                    platformTargetCount: 6,
                    subjectCount: 11,
                },
                payloads: [
                    expect.objectContaining({ target: 'macos-arm64' }),
                    expect.objectContaining({ target: 'macos-x64' }),
                    expect.objectContaining({ target: 'windows-x64' }),
                    expect.objectContaining({ target: 'windows-arm64' }),
                    expect.objectContaining({ target: 'linux-deb-repository' }),
                ],
            });
            expect(written.manifest.payloads.find(({ target }) => target === 'linux-deb-repository').subjects)
                .toHaveLength(7);
            expect(verified).toMatchObject({
                candidateSha: primaryCandidateSha,
                candidateCount: 5,
                platformTargetCount: 6,
                subjectCount: 11,
                crossPlatformAcceptanceComplete: true,
                releaseReady: false,
                bundleDirectory: fixture.bundle,
                reviewDirectory,
                manifestDirectory,
            });
            expect(JSON.stringify(written.manifest)).not.toContain(fixture.root);
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('separates six direct-download installers from five Linux APT sidecars without authorizing a release', async () => {
        const fixture = await createBundle();
        const reviewDirectory = path.join(fixture.root, 'release-review');
        const manifestDirectory = path.join(fixture.root, 'payload-manifest');
        const publicationPlanDirectory = path.join(fixture.root, 'publication-plan');
        try {
            await Promise.all([
                mkdir(reviewDirectory),
                mkdir(manifestDirectory),
                mkdir(publicationPlanDirectory),
            ]);
            await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            await writeDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory));
            await writeDesktopReleasePayloadManifest(
                payloadManifestOptions(fixture, reviewDirectory, manifestDirectory),
            );
            const written = await writeDesktopReleasePublicationPlan(
                publicationPlanOptions(fixture, reviewDirectory, manifestDirectory, publicationPlanDirectory),
            );
            const verified = await verifyDesktopReleasePublicationPlan(
                publicationPlanOptions(fixture, reviewDirectory, manifestDirectory, publicationPlanDirectory),
            );

            expect(written.plan).toMatchObject({
                schemaVersion: 1,
                status: 'ready-for-protected-public-release-direct-download-promotion',
                candidateSha: primaryCandidateSha,
                releaseReady: false,
                publicTarget: {
                    repository: 'web-casa/ScreenHello',
                    repositoryId: 1353846676,
                    releaseAssets: 'direct-download-installers-only',
                },
                coverage: {
                    candidateCount: 5,
                    platformTargetCount: 6,
                    sourceSubjectCount: 11,
                    directDownloadAssetCount: 6,
                    linuxRepositorySidecarCount: 5,
                },
                linuxRepository: {
                    githubReleaseAssets: 'forbidden',
                    endpoint: 'not-configured',
                },
            });
            expect(written.plan.directDownload.assets.map(({ releaseName }) => releaseName)).toEqual([
                'ScreenHello-macos-arm64.dmg',
                'ScreenHello-macos-x64.dmg',
                'ScreenHello-windows-x64-setup.exe',
                'ScreenHello-windows-arm64-setup.exe',
                'ScreenHello-linux-amd64.deb',
                'ScreenHello-linux-arm64.deb',
            ]);
            expect(written.plan.linuxRepository.sidecars.map(({ path: sourcePath }) => sourcePath)).toEqual([
                'repository/dists/screenhello-beta/Release',
                'repository/dists/screenhello-beta/InRelease',
                'repository/dists/screenhello-beta/Release.gpg',
                'client-trust/screenhello-archive-keyring.gpg',
                'client-trust/screenhello-archive-keyring.asc',
            ]);
            expect(verified).toMatchObject({
                candidateSha: primaryCandidateSha,
                sourceSubjectCount: 11,
                directDownloadAssetCount: 6,
                linuxRepositorySidecarCount: 5,
                crossPlatformAcceptanceComplete: true,
                releaseReady: false,
            });
            await expect(writeDesktopReleasePublicationPlan(
                publicationPlanOptions(fixture, reviewDirectory, manifestDirectory, publicationPlanDirectory),
            )).rejects.toThrow('desktop-release-publication-plan-output-already-exists');
            expect(JSON.stringify(written.plan)).not.toContain(fixture.root);
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('binds the reviewed payloads to a committed public-export snapshot without authorizing a release', async () => {
        const fixture = await createBundle({ withCandidateSource: true });
        const reviewDirectory = path.join(fixture.root, 'release-review');
        const manifestDirectory = path.join(fixture.root, 'payload-manifest');
        const publicationPlanDirectory = path.join(fixture.root, 'publication-plan');
        const handoffDirectory = path.join(fixture.root, 'publication-handoff');
        try {
            await Promise.all([
                mkdir(reviewDirectory),
                mkdir(manifestDirectory),
                mkdir(publicationPlanDirectory),
                mkdir(handoffDirectory),
                mkdir(path.join(fixture.candidateSource.directory, 'nested-handoff')),
            ]);
            await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            await writeDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory));
            await writeDesktopReleasePayloadManifest(
                payloadManifestOptions(fixture, reviewDirectory, manifestDirectory),
            );
            await writeDesktopReleasePublicationPlan(
                publicationPlanOptions(fixture, reviewDirectory, manifestDirectory, publicationPlanDirectory),
            );
            await expect(writeDesktopReleasePublicationHandoff(publicationHandoffOptions(
                fixture,
                reviewDirectory,
                manifestDirectory,
                publicationPlanDirectory,
                path.join(fixture.candidateSource.directory, 'nested-handoff'),
            ))).rejects.toThrow('desktop-release-publication-handoff-directory-inside-input');

            const written = await writeDesktopReleasePublicationHandoff(publicationHandoffOptions(
                fixture,
                reviewDirectory,
                manifestDirectory,
                publicationPlanDirectory,
                handoffDirectory,
            ));
            const verified = await verifyDesktopReleasePublicationHandoff(publicationHandoffOptions(
                fixture,
                reviewDirectory,
                manifestDirectory,
                publicationPlanDirectory,
                handoffDirectory,
            ));

            expect(written.handoff).toMatchObject({
                schemaVersion: 1,
                status: 'ready-for-protected-public-release-handoff',
                releaseReady: false,
                candidate: {
                    sha: fixture.candidateSource.sha,
                    packageJson: { path: 'package.json', version: '1.0.4' },
                },
                publicTarget: {
                    repository: 'web-casa/ScreenHello',
                    branch: 'main',
                },
                publicExport: {
                    sourceCommit: fixture.candidateSource.sha,
                    treeSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
                },
                directDownload: {
                    release: { tag: 'v1.0.4', prerelease: true, makeLatest: false },
                },
                coverage: {
                    candidateCount: 5,
                    platformTargetCount: 6,
                    sourceSubjectCount: 11,
                    directDownloadAssetCount: 6,
                    linuxRepositorySidecarCount: 5,
                },
            });
            expect(written.handoff.publicExport.files.map(({ path: repositoryPath }) => repositoryPath))
                .toContain('PUBLIC_REPOSITORY.json');
            expect(written.handoff.directDownload.assets).toHaveLength(6);
            expect(written.handoff.linuxRepository.sidecars).toHaveLength(5);
            expect(verified).toMatchObject({
                candidateSha: fixture.candidateSource.sha,
                version: '1.0.4',
                tag: 'v1.0.4',
                directDownloadAssetCount: 6,
                linuxRepositorySidecarCount: 5,
                releaseReady: false,
                candidateGitDirectory: fixture.candidateSource.directory,
                handoffDirectory,
            });
            expect(JSON.stringify(written.handoff)).not.toContain(fixture.root);
            await expect(writeDesktopReleasePublicationHandoff(publicationHandoffOptions(
                fixture,
                reviewDirectory,
                manifestDirectory,
                publicationPlanDirectory,
                handoffDirectory,
            ))).rejects.toThrow('desktop-release-publication-handoff-output-already-exists');

            const handoff = JSON.parse(await readFile(written.output, 'utf8'));
            handoff.directDownload.release.tag = 'v9.9.9';
            await writeFile(written.output, `${JSON.stringify(handoff, null, 2)}\n`);
            await expect(verifyDesktopReleasePublicationHandoff(publicationHandoffOptions(
                fixture,
                reviewDirectory,
                manifestDirectory,
                publicationPlanDirectory,
                handoffDirectory,
            ))).rejects.toThrow('desktop-release-publication-handoff-invalid');
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('rejects a candidate version with an invalid numeric prerelease identifier', async () => {
        const fixture = await createBundle({
            withCandidateSource: true,
            candidateSourceVersion: '1.0.4-01',
        });
        const reviewDirectory = path.join(fixture.root, 'release-review');
        const manifestDirectory = path.join(fixture.root, 'payload-manifest');
        const publicationPlanDirectory = path.join(fixture.root, 'publication-plan');
        const handoffDirectory = path.join(fixture.root, 'publication-handoff');
        try {
            await Promise.all([
                mkdir(reviewDirectory),
                mkdir(manifestDirectory),
                mkdir(publicationPlanDirectory),
                mkdir(handoffDirectory),
            ]);
            await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            await writeDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory));
            await writeDesktopReleasePayloadManifest(
                payloadManifestOptions(fixture, reviewDirectory, manifestDirectory),
            );
            await writeDesktopReleasePublicationPlan(
                publicationPlanOptions(fixture, reviewDirectory, manifestDirectory, publicationPlanDirectory),
            );
            await expect(writeDesktopReleasePublicationHandoff(publicationHandoffOptions(
                fixture,
                reviewDirectory,
                manifestDirectory,
                publicationPlanDirectory,
                handoffDirectory,
            ))).rejects.toThrow('desktop-release-publication-handoff-candidate-version-invalid');
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('automatically revalidates an offline receipt with its standard per-target trusted root', async () => {
        const fixture = await createBundle({ offlineTarget: 'macos-arm64' });
        try {
            await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            await expect(verifyDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture))).resolves.toMatchObject({
                candidateSha: primaryCandidateSha,
                crossPlatformAcceptanceComplete: true,
                releaseReady: false,
            });
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    if (process.platform !== 'win32') {
        it('rejects a target review directory that resolves outside the standard bundle', async () => {
            const fixture = await createBundle();
            try {
                const reviewDirectory = path.join(fixture.bundle, 'reviews');
                const outsideReviewDirectory = path.join(fixture.root, 'outside-reviews');
                await cp(reviewDirectory, outsideReviewDirectory, { recursive: true, errorOnExist: true });
                await rm(reviewDirectory, { recursive: true, force: true });
                await symlink(outsideReviewDirectory, reviewDirectory, 'dir');

                await expect(writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture))).rejects.toThrow(
                    'desktop-cross-platform-acceptance-review-directory-outside-bundle-directory',
                );
            } finally {
                await rm(fixture.root, { recursive: true, force: true });
            }
        });
    }

    it('keeps a cross-platform review incomplete when any single target record is incomplete', async () => {
        const fixture = await createBundle({ incompleteTarget: 'windows-arm64' });
        try {
            await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            await expect(verifyDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture))).resolves.toMatchObject({
                completedChecks: 41,
                totalChecks: 42,
                crossPlatformAcceptanceComplete: false,
                releaseReady: false,
            });
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('refuses to create a local release review before every platform acceptance check passes', async () => {
        const fixture = await createBundle({ incompleteTarget: 'windows-arm64' });
        const reviewDirectory = path.join(fixture.root, 'release-review');
        try {
            await mkdir(reviewDirectory);
            await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            await expect(writeDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory))).rejects.toThrow(
                'desktop-release-review-cross-platform-acceptance-incomplete',
            );
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('invalidates a local release review when a still-valid platform record changes after it is written', async () => {
        const fixture = await createBundle();
        const reviewDirectory = path.join(fixture.root, 'release-review');
        try {
            await mkdir(reviewDirectory);
            await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            await writeDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory));
            const recordPath = path.join(
                fixture.bundle,
                'reviews',
                'windows-arm64',
                'platform-acceptance-record.json',
            );
            const record = JSON.parse(await readFile(recordPath, 'utf8'));
            record.testedAt = '2026-09-14T03:00:00.000Z';
            await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);

            await expect(verifyDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory))).rejects.toThrow(
                'desktop-release-review-invalid',
            );
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('rejects a tampered local release review dossier', async () => {
        const fixture = await createBundle();
        const reviewDirectory = path.join(fixture.root, 'release-review');
        try {
            await mkdir(reviewDirectory);
            await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            const written = await writeDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory));
            const review = JSON.parse(await readFile(written.output, 'utf8'));
            review.releaseReady = true;
            await writeFile(written.output, `${JSON.stringify(review, null, 2)}\n`);

            await expect(verifyDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory))).rejects.toThrow(
                'desktop-release-review-invalid',
            );
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('never overwrites an existing local release review dossier', async () => {
        const fixture = await createBundle();
        const reviewDirectory = path.join(fixture.root, 'release-review');
        try {
            await mkdir(reviewDirectory);
            await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            await writeDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory));

            await expect(writeDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory))).rejects.toThrow(
                'desktop-release-review-output-already-exists',
            );
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('rejects a tampered release payload manifest', async () => {
        const fixture = await createBundle();
        const reviewDirectory = path.join(fixture.root, 'release-review');
        const manifestDirectory = path.join(fixture.root, 'payload-manifest');
        try {
            await Promise.all([mkdir(reviewDirectory), mkdir(manifestDirectory)]);
            await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            await writeDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory));
            const written = await writeDesktopReleasePayloadManifest(
                payloadManifestOptions(fixture, reviewDirectory, manifestDirectory),
            );
            const manifest = JSON.parse(await readFile(written.output, 'utf8'));
            manifest.coverage.subjectCount = 10;
            await writeFile(written.output, `${JSON.stringify(manifest, null, 2)}\n`);

            await expect(verifyDesktopReleasePayloadManifest(
                payloadManifestOptions(fixture, reviewDirectory, manifestDirectory),
            )).rejects.toThrow('desktop-release-payload-manifest-invalid');
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('rejects a changed release review after its payload manifest is written', async () => {
        const fixture = await createBundle();
        const reviewDirectory = path.join(fixture.root, 'release-review');
        const manifestDirectory = path.join(fixture.root, 'payload-manifest');
        try {
            await Promise.all([mkdir(reviewDirectory), mkdir(manifestDirectory)]);
            await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            await writeDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory));
            await writeDesktopReleasePayloadManifest(
                payloadManifestOptions(fixture, reviewDirectory, manifestDirectory),
            );
            const reviewPath = path.join(reviewDirectory, 'desktop-release-review.json');
            const review = JSON.parse(await readFile(reviewPath, 'utf8'));
            review.status = 'tampered';
            await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);

            await expect(verifyDesktopReleasePayloadManifest(
                payloadManifestOptions(fixture, reviewDirectory, manifestDirectory),
            )).rejects.toThrow('desktop-release-review-invalid');
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('rejects a changed candidate payload after its manifest is written', async () => {
        const fixture = await createBundle();
        const reviewDirectory = path.join(fixture.root, 'release-review');
        const manifestDirectory = path.join(fixture.root, 'payload-manifest');
        try {
            await Promise.all([mkdir(reviewDirectory), mkdir(manifestDirectory)]);
            await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            await writeDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory));
            await writeDesktopReleasePayloadManifest(
                payloadManifestOptions(fixture, reviewDirectory, manifestDirectory),
            );
            const staged = fixture.staged['macos-arm64'];
            await writeFile(path.join(staged.candidateDirectory, staged.firstSubject), 'replaced-payload');

            await expect(verifyDesktopReleasePayloadManifest(
                payloadManifestOptions(fixture, reviewDirectory, manifestDirectory),
            )).rejects.toThrow('desktop-artifact-provenance-verification-subject-hash-invalid');
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('rejects a tampered direct-download publication plan', async () => {
        const fixture = await createBundle();
        const reviewDirectory = path.join(fixture.root, 'release-review');
        const manifestDirectory = path.join(fixture.root, 'payload-manifest');
        const publicationPlanDirectory = path.join(fixture.root, 'publication-plan');
        try {
            await Promise.all([
                mkdir(reviewDirectory),
                mkdir(manifestDirectory),
                mkdir(publicationPlanDirectory),
            ]);
            await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            await writeDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory));
            await writeDesktopReleasePayloadManifest(
                payloadManifestOptions(fixture, reviewDirectory, manifestDirectory),
            );
            const written = await writeDesktopReleasePublicationPlan(
                publicationPlanOptions(fixture, reviewDirectory, manifestDirectory, publicationPlanDirectory),
            );
            const plan = JSON.parse(await readFile(written.output, 'utf8'));
            plan.directDownload.assets[0].releaseName = 'ScreenHello-anything.dmg';
            await writeFile(written.output, `${JSON.stringify(plan, null, 2)}\n`);

            await expect(verifyDesktopReleasePublicationPlan(
                publicationPlanOptions(fixture, reviewDirectory, manifestDirectory, publicationPlanDirectory),
            )).rejects.toThrow('desktop-release-publication-plan-invalid');
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('never overwrites an existing release payload manifest', async () => {
        const fixture = await createBundle();
        const reviewDirectory = path.join(fixture.root, 'release-review');
        const manifestDirectory = path.join(fixture.root, 'payload-manifest');
        try {
            await Promise.all([mkdir(reviewDirectory), mkdir(manifestDirectory)]);
            await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            await writeDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory));
            await writeDesktopReleasePayloadManifest(
                payloadManifestOptions(fixture, reviewDirectory, manifestDirectory),
            );

            await expect(writeDesktopReleasePayloadManifest(
                payloadManifestOptions(fixture, reviewDirectory, manifestDirectory),
            )).rejects.toThrow('desktop-release-payload-manifest-output-already-exists');
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('refuses a local release review directory inside the cross-platform bundle', async () => {
        const fixture = await createBundle();
        try {
            await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            await expect(writeDesktopReleaseReview(releaseReviewOptions(
                fixture,
                path.join(fixture.bundle, 'reviews', 'release-review'),
            ))).rejects.toThrow('desktop-release-review-directory-inside-bundle');
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('refuses a release payload manifest directory inside the release-review directory', async () => {
        const fixture = await createBundle();
        const reviewDirectory = path.join(fixture.root, 'release-review');
        try {
            await mkdir(reviewDirectory);
            await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            await writeDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory));

            await expect(writeDesktopReleasePayloadManifest(payloadManifestOptions(
                fixture,
                reviewDirectory,
                path.join(reviewDirectory, 'payload-manifest'),
            ))).rejects.toThrow('desktop-release-payload-manifest-directory-inside-input');
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('refuses a release payload manifest directory inside the cross-platform bundle', async () => {
        const fixture = await createBundle();
        const reviewDirectory = path.join(fixture.root, 'release-review');
        try {
            await mkdir(reviewDirectory);
            await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            await writeDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory));

            await expect(writeDesktopReleasePayloadManifest(payloadManifestOptions(
                fixture,
                reviewDirectory,
                path.join(fixture.bundle, 'payload-manifest'),
            ))).rejects.toThrow('desktop-release-payload-manifest-directory-inside-input');
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('refuses a publication plan directory inside its payload manifest', async () => {
        const fixture = await createBundle();
        const reviewDirectory = path.join(fixture.root, 'release-review');
        const manifestDirectory = path.join(fixture.root, 'payload-manifest');
        try {
            await Promise.all([mkdir(reviewDirectory), mkdir(manifestDirectory)]);
            await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            await writeDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory));
            await writeDesktopReleasePayloadManifest(
                payloadManifestOptions(fixture, reviewDirectory, manifestDirectory),
            );

            await expect(writeDesktopReleasePublicationPlan(publicationPlanOptions(
                fixture,
                reviewDirectory,
                manifestDirectory,
                path.join(manifestDirectory, 'publication-plan'),
            ))).rejects.toThrow('desktop-release-publication-plan-directory-inside-input');
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    if (process.platform !== 'win32') {
        it('rejects a symlinked external local release review directory', async () => {
            const fixture = await createBundle();
            const realReviewDirectory = path.join(fixture.root, 'real-release-review');
            const linkedReviewDirectory = path.join(fixture.root, 'release-review');
            try {
                await mkdir(realReviewDirectory);
                await symlink(realReviewDirectory, linkedReviewDirectory, 'dir');
                await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));

                await expect(writeDesktopReleaseReview(releaseReviewOptions(
                    fixture,
                    linkedReviewDirectory,
                ))).rejects.toThrow('desktop-release-review-directory-invalid');
            } finally {
                await rm(fixture.root, { recursive: true, force: true });
            }
        });

        it('rejects a symlinked release payload manifest directory', async () => {
            const fixture = await createBundle();
            const reviewDirectory = path.join(fixture.root, 'release-review');
            const realManifestDirectory = path.join(fixture.root, 'real-payload-manifest');
            const linkedManifestDirectory = path.join(fixture.root, 'payload-manifest');
            try {
                await Promise.all([mkdir(reviewDirectory), mkdir(realManifestDirectory)]);
                await symlink(realManifestDirectory, linkedManifestDirectory, 'dir');
                await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
                await writeDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory));

                await expect(writeDesktopReleasePayloadManifest(payloadManifestOptions(
                    fixture,
                    reviewDirectory,
                    linkedManifestDirectory,
                ))).rejects.toThrow('desktop-release-payload-manifest-directory-invalid');
            } finally {
                await rm(fixture.root, { recursive: true, force: true });
            }
        });

        it('rejects a symlinked publication plan directory', async () => {
            const fixture = await createBundle();
            const reviewDirectory = path.join(fixture.root, 'release-review');
            const manifestDirectory = path.join(fixture.root, 'payload-manifest');
            const realPublicationPlanDirectory = path.join(fixture.root, 'real-publication-plan');
            const linkedPublicationPlanDirectory = path.join(fixture.root, 'publication-plan');
            try {
                await Promise.all([
                    mkdir(reviewDirectory),
                    mkdir(manifestDirectory),
                    mkdir(realPublicationPlanDirectory),
                ]);
                await symlink(realPublicationPlanDirectory, linkedPublicationPlanDirectory, 'dir');
                await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
                await writeDesktopReleaseReview(releaseReviewOptions(fixture, reviewDirectory));
                await writeDesktopReleasePayloadManifest(
                    payloadManifestOptions(fixture, reviewDirectory, manifestDirectory),
                );

                await expect(writeDesktopReleasePublicationPlan(publicationPlanOptions(
                    fixture,
                    reviewDirectory,
                    manifestDirectory,
                    linkedPublicationPlanDirectory,
                ))).rejects.toThrow('desktop-release-publication-plan-directory-invalid');
            } finally {
                await rm(fixture.root, { recursive: true, force: true });
            }
        });
    }

    it.each([
        ['candidate artifacts from different source SHAs', async (fixture) => {
            await expect(writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture))).rejects.toThrow(
                'desktop-cross-platform-acceptance-candidate-sha-mismatch',
            );
        }, {
            'windows-arm64': 'b'.repeat(40),
        }],
        ['a review plan whose bound candidate receipt is altered', async (fixture) => {
            await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            const planPath = path.join(fixture.bundle, 'cross-platform-acceptance-plan.json');
            const plan = JSON.parse(await readFile(planPath, 'utf8'));
            plan.candidates[0].candidateReceipt.sha256 = 'c'.repeat(64);
            await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
            await expect(verifyDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture))).rejects.toThrow(
                'desktop-cross-platform-acceptance-plan-invalid',
            );
        }],
        ['a candidate artifact modified after its cross-platform plan', async (fixture) => {
            await writeDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture));
            const staged = fixture.staged['macos-arm64'];
            await writeFile(path.join(staged.candidateDirectory, staged.firstSubject), 'substituted-candidate');
            await expect(verifyDesktopCrossPlatformAcceptancePlan(reviewOptions(fixture))).rejects.toThrow(
                'desktop-artifact-provenance-verification-subject-hash-invalid',
            );
        }],
    ])('fails closed for %s', async (_name, verify, candidateShas) => {
        const fixture = await createBundle({ candidateShas });
        try {
            await verify(fixture);
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('requires an exact bundle and unambiguous mode', async () => {
        expect(parseDesktopCrossPlatformAcceptanceArguments([
            '--bundle-dir', 'bundle',
            '--write-plan',
        ])).toEqual({ bundleDirectory: 'bundle', mode: 'write-plan' });
        expect(() => parseDesktopCrossPlatformAcceptanceArguments([
            '--bundle-dir', 'bundle',
            '--bundle-dir', 'another-bundle',
            '--write-plan',
        ])).toThrow('desktop-cross-platform-acceptance-option-duplicate:--bundle-dir');
        expect(() => parseDesktopCrossPlatformAcceptanceArguments([
            '--bundle-dir', 'bundle',
            '--write-plan',
            '--verify-plan',
        ])).toThrow('desktop-cross-platform-acceptance-option-mode-conflict');
        expect(() => parseDesktopCrossPlatformAcceptanceArguments([
            '--verify-plan',
        ])).toThrow('desktop-cross-platform-acceptance-option-required:bundle-dir');
        expect(parseDesktopReleaseReviewArguments([
            '--bundle-dir', 'bundle',
            '--review-dir', 'review',
            '--write-review',
        ])).toEqual({
            bundleDirectory: 'bundle',
            reviewDirectory: 'review',
            mode: 'write-review',
        });
        expect(() => parseDesktopReleaseReviewArguments([
            '--bundle-dir', 'bundle',
            '--review-dir', 'review',
            '--write-review',
            '--verify-review',
        ])).toThrow('desktop-release-review-option-mode-conflict');
        expect(() => parseDesktopReleaseReviewArguments([
            '--bundle-dir', 'bundle',
            '--bundle-dir', 'another-bundle',
            '--review-dir', 'review',
            '--write-review',
        ])).toThrow('desktop-release-review-option-duplicate:--bundle-dir');
        expect(() => parseDesktopReleaseReviewArguments([
            '--bundle-dir', 'bundle',
            '--verify-review',
        ])).toThrow('desktop-release-review-option-required:review-dir');
        expect(parseDesktopReleasePayloadManifestArguments([
            '--bundle-dir', 'bundle',
            '--review-dir', 'review',
            '--manifest-dir', 'manifest',
            '--write-manifest',
        ])).toEqual({
            bundleDirectory: 'bundle',
            reviewDirectory: 'review',
            manifestDirectory: 'manifest',
            mode: 'write-manifest',
        });
        expect(() => parseDesktopReleasePayloadManifestArguments([
            '--bundle-dir', 'bundle',
            '--review-dir', 'review',
            '--manifest-dir', 'manifest',
            '--write-manifest',
            '--verify-manifest',
        ])).toThrow('desktop-release-payload-manifest-option-mode-conflict');
        expect(() => parseDesktopReleasePayloadManifestArguments([
            '--bundle-dir', 'bundle',
            '--review-dir', 'review',
            '--verify-manifest',
        ])).toThrow('desktop-release-payload-manifest-option-required:manifest-dir');
        expect(parseDesktopReleasePublicationPlanArguments([
            '--bundle-dir', 'bundle',
            '--review-dir', 'review',
            '--manifest-dir', 'manifest',
            '--publication-plan-dir', 'publication-plan',
            '--write-publication-plan',
        ])).toEqual({
            bundleDirectory: 'bundle',
            reviewDirectory: 'review',
            manifestDirectory: 'manifest',
            publicationPlanDirectory: 'publication-plan',
            mode: 'write-publication-plan',
        });
        expect(() => parseDesktopReleasePublicationPlanArguments([
            '--bundle-dir', 'bundle',
            '--review-dir', 'review',
            '--manifest-dir', 'manifest',
            '--publication-plan-dir', 'publication-plan',
            '--write-publication-plan',
            '--verify-publication-plan',
        ])).toThrow('desktop-release-publication-plan-option-mode-conflict');
        expect(() => parseDesktopReleasePublicationPlanArguments([
            '--bundle-dir', 'bundle',
            '--review-dir', 'review',
            '--manifest-dir', 'manifest',
            '--verify-publication-plan',
        ])).toThrow('desktop-release-publication-plan-option-required:publication-plan-dir');
        expect(parseDesktopReleasePublicationHandoffArguments([
            '--bundle-dir', 'bundle',
            '--review-dir', 'review',
            '--manifest-dir', 'manifest',
            '--publication-plan-dir', 'publication-plan',
            '--candidate-git-dir', 'candidate',
            '--handoff-dir', 'handoff',
            '--write-handoff',
        ])).toEqual({
            bundleDirectory: 'bundle',
            reviewDirectory: 'review',
            manifestDirectory: 'manifest',
            publicationPlanDirectory: 'publication-plan',
            candidateGitDirectory: 'candidate',
            handoffDirectory: 'handoff',
            mode: 'write-handoff',
        });
        expect(() => parseDesktopReleasePublicationHandoffArguments([
            '--bundle-dir', 'bundle',
            '--review-dir', 'review',
            '--manifest-dir', 'manifest',
            '--publication-plan-dir', 'publication-plan',
            '--candidate-git-dir', 'candidate',
            '--handoff-dir', 'handoff',
            '--write-handoff',
            '--verify-handoff',
        ])).toThrow('desktop-release-publication-handoff-option-mode-conflict');
        expect(() => parseDesktopReleasePublicationHandoffArguments([
            '--bundle-dir', 'bundle',
            '--review-dir', 'review',
            '--manifest-dir', 'manifest',
            '--publication-plan-dir', 'publication-plan',
            '--candidate-git-dir', 'candidate',
            '--verify-handoff',
        ])).toThrow('desktop-release-publication-handoff-option-required:handoff-dir');
    });
});
