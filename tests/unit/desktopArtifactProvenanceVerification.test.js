import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    writeDesktopArtifactProvenanceRecord,
} from '../../scripts/desktop-artifact-provenance.mjs';
import {
    executeDesktopArtifactProvenanceVerification,
    parseDesktopArtifactProvenanceVerificationArguments,
    verifyDesktopArtifactProvenanceLocally,
    verifyDesktopArtifactProvenanceReceiptLocally,
    writeDesktopArtifactProvenanceVerificationPlan,
} from '../../scripts/desktop-artifact-provenance-verification.mjs';

const matrix = await readFile(new URL('../../config/desktop-release-matrix.json', import.meta.url), 'utf8').then(JSON.parse);
const candidateSha = 'a'.repeat(40);
const attestationId = '123456';
const repository = 'web-casa/signed-candidate';
const repositoryId = matrix.desktopArtifactProvenanceVerification.repositoryId;
const attestationUrl = `https://github.com/${repository}/attestations/${attestationId}`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const verifiedGhResult = (subject, content = 'signed-macos-candidate') => ({
    exitCode: 0,
    stdout: JSON.stringify([{
        verificationResult: {
            statement: {
                predicateType: 'https://slsa.dev/provenance/v1',
                subject: [{
                    name: subject,
                    digest: { sha256: hash(content) },
                }],
            },
        },
    }]),
});

const repositoryIdentityResult = (id = repositoryId) => ({
    exitCode: 0,
    stdout: `${id}\n`,
});

const verifiedGhRunner = async ({ argumentsList }) => {
    if (argumentsList[0] === 'api') return repositoryIdentityResult();
    return verifiedGhResult(path.posix.basename(argumentsList[2]));
};

const writeChecksums = async (candidateDirectory, relativePaths) => {
    const checksums = await Promise.all(relativePaths.map(async (relative) => {
        const content = await readFile(path.join(candidateDirectory, relative));
        return `${hash(content)}  ${relative}`;
    }));
    await writeFile(path.join(candidateDirectory, 'SHA256SUMS.txt'), `${checksums.join('\n')}\n`);
};

const createFixture = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'screenhello-artifact-provenance-verification-'));
    const workspace = path.join(root, 'workspace');
    const runnerTemp = path.join(root, 'runner-temp');
    const candidateDirectory = path.join(workspace, 'artifacts', 'macos-signed-candidate');
    const subjectPath = path.join(candidateDirectory, 'ScreenHello.dmg');
    const bundlePath = path.join(runnerTemp, 'created-attestation.json');
    await Promise.all([
        mkdir(candidateDirectory, { recursive: true }),
        mkdir(runnerTemp, { recursive: true }),
    ]);
    await Promise.all([
        writeFile(subjectPath, 'signed-macos-candidate'),
        writeFile(bundlePath, '{"mediaType":"application/vnd.dev.sigstore.bundle+json"}\n'),
    ]);
    const provenance = await writeDesktopArtifactProvenanceRecord({
        matrix: structuredClone(matrix),
        candidateSha,
        target: 'macos-arm64',
        candidateDirectory: 'artifacts/macos-signed-candidate',
        subjectPaths: ['artifacts/macos-signed-candidate/ScreenHello.dmg'],
        attestationId,
        attestationUrl,
        bundlePath,
        runnerTempDirectory: runnerTemp,
        baseDirectory: workspace,
    });
    const verificationPlan = await writeDesktopArtifactProvenanceVerificationPlan({
        matrix: structuredClone(matrix),
        candidateDirectory: 'artifacts/macos-signed-candidate',
        baseDirectory: workspace,
    });
    const checksummedFiles = [
        'ScreenHello.dmg',
        'provenance-attestation.bundle.json',
        'provenance-attestation.json',
        'provenance-verification-plan.json',
    ];
    await writeChecksums(candidateDirectory, checksummedFiles);
    return {
        root,
        workspace,
        runnerTemp,
        candidateDirectory,
        subjectPath,
        provenance,
        verificationPlan,
        checksummedFiles,
    };
};

const createLinuxFixture = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'screenhello-artifact-provenance-verification-linux-'));
    const workspace = path.join(root, 'workspace');
    const runnerTemp = path.join(root, 'runner-temp');
    const candidateDirectory = path.join(workspace, 'artifacts', 'linux-deb-repository-signed-candidate');
    const subjectRelativePaths = [
        'repository/pool/main/s/screen-hello/screen-hello_1.0.4_amd64.deb',
        'repository/pool/main/s/screen-hello/screen-hello_1.0.4_arm64.deb',
        'repository/dists/screenhello-beta/Release',
        'repository/dists/screenhello-beta/InRelease',
        'repository/dists/screenhello-beta/Release.gpg',
        'client-trust/screenhello-archive-keyring.gpg',
        'client-trust/screenhello-archive-keyring.asc',
    ];
    const subjectPaths = subjectRelativePaths.map((relative) => (
        path.join('artifacts', 'linux-deb-repository-signed-candidate', ...relative.split('/'))
    ));
    const bundlePath = path.join(runnerTemp, 'created-attestation.json');
    await Promise.all([
        mkdir(candidateDirectory, { recursive: true }),
        mkdir(runnerTemp, { recursive: true }),
    ]);
    await Promise.all(subjectRelativePaths.map(async (relative) => {
        const output = path.join(candidateDirectory, ...relative.split('/'));
        await mkdir(path.dirname(output), { recursive: true });
        await writeFile(output, `signed-${relative}`);
    }));
    await writeFile(bundlePath, '{"mediaType":"application/vnd.dev.sigstore.bundle+json"}\n');
    await writeDesktopArtifactProvenanceRecord({
        matrix: structuredClone(matrix),
        candidateSha,
        target: 'linux-deb-repository',
        candidateDirectory: 'artifacts/linux-deb-repository-signed-candidate',
        subjectPaths,
        attestationId,
        attestationUrl,
        bundlePath,
        runnerTempDirectory: runnerTemp,
        baseDirectory: workspace,
    });
    const verificationPlan = await writeDesktopArtifactProvenanceVerificationPlan({
        matrix: structuredClone(matrix),
        candidateDirectory: 'artifacts/linux-deb-repository-signed-candidate',
        baseDirectory: workspace,
    });
    const checksummedFiles = [
        ...subjectRelativePaths,
        'provenance-attestation.bundle.json',
        'provenance-attestation.json',
        'provenance-verification-plan.json',
    ];
    await writeChecksums(candidateDirectory, checksummedFiles);
    return {
        root,
        workspace,
        candidateDirectory,
        verificationPlan,
        checksummedFiles,
    };
};

const localOptions = (fixture) => ({
    matrix: structuredClone(matrix),
    candidateDirectory: 'artifacts/macos-signed-candidate',
    baseDirectory: fixture.workspace,
});

describe('desktop artifact provenance verification', () => {
    it('writes a strict GH CLI command plan and locally validates the downloaded candidate', async () => {
        const fixture = await createFixture();
        try {
            const local = await verifyDesktopArtifactProvenanceLocally(localOptions(fixture));
            const plan = JSON.parse(await readFile(fixture.verificationPlan.output, 'utf8'));

            expect(local.checksumEntryCount).toBe(fixture.checksummedFiles.length);
            expect(plan).toMatchObject({
                schemaVersion: 1,
                status: 'ready-for-local-precheck-and-gh-cli-receipt',
                candidateSha,
                target: 'macos-arm64',
                verification: {
                    repository,
                    signerRepository: repository,
                    repositoryId,
                    signerWorkflow: `${repository}/.github/workflows/macos-signed-candidate.yml`,
                    predicateType: 'https://slsa.dev/provenance/v1',
                    sourceDigest: candidateSha,
                    sourceRef: 'refs/heads/main',
                    denySelfHostedRunners: true,
                    noPublicGood: true,
                },
            });
            expect(plan.verification.online.commands).toEqual([{
                artifact: 'ScreenHello.dmg',
                arguments: [
                    'attestation',
                    'verify',
                    'ScreenHello.dmg',
                    '--repo', repository,
                    '--bundle', 'provenance-attestation.bundle.json',
                    '--predicate-type', 'https://slsa.dev/provenance/v1',
                    '--signer-repo', repository,
                    '--signer-workflow', `${repository}/.github/workflows/macos-signed-candidate.yml`,
                    '--source-digest', candidateSha,
                    '--source-ref', 'refs/heads/main',
                    '--deny-self-hosted-runners',
                    '--no-public-good',
                    '--format', 'json',
                ],
            }]);
            expect(plan.verification.repositoryIdentity).toEqual({
                executable: 'gh',
                arguments: ['api', `repos/${repository}`, '--jq', '.id'],
                expectedRepositoryId: String(repositoryId),
            });
            expect(plan.receipt).toEqual({
                schemaVersion: 2,
                filename: 'provenance-verification-receipt.json',
                writeLocation: 'outside-candidate-directory',
                atomicCreate: 'outside-candidate-directory-no-overwrite',
                revalidation: 'local-candidate-and-offline-trusted-root-rehash-required',
                status: 'created-only-after-gh-attestation-verify-and-final-local-recheck-success',
            });
            expect(JSON.stringify(plan)).not.toContain(fixture.workspace);
            expect(JSON.stringify(plan)).not.toContain(fixture.runnerTemp);
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('writes a receipt outside the candidate only after every strict GH CLI result verifies its subject', async () => {
        const fixture = await createFixture();
        try {
            const calls = [];
            const result = await executeDesktopArtifactProvenanceVerification({
                ...localOptions(fixture),
                receipt: path.join(fixture.root, 'provenance-verification-receipt.json'),
                now: () => new Date('2026-09-14T00:00:00.000Z'),
                runGh: async ({ argumentsList, cwd }) => {
                    calls.push({ argumentsList, cwd });
                    if (argumentsList[0] === 'api') return repositoryIdentityResult();
                    const subject = 'ScreenHello.dmg';
                    return {
                        exitCode: 0,
                        stdout: JSON.stringify([{
                            verificationResult: {
                                statement: {
                                    predicateType: 'https://slsa.dev/provenance/v1',
                                    subject: [{
                                        name: subject,
                                        digest: { sha256: hash('signed-macos-candidate') },
                                    }],
                                },
                            },
                        }]),
                    };
                },
            });
            const receipt = JSON.parse(await readFile(result.output, 'utf8'));

            expect(calls).toEqual([{
                argumentsList: ['api', `repos/${repository}`, '--jq', '.id'],
                cwd: fixture.candidateDirectory,
            }, {
                argumentsList: expect.arrayContaining([
                    'attestation',
                    'verify',
                    '--repo',
                    repository,
                    '--signer-workflow',
                    `${repository}/.github/workflows/macos-signed-candidate.yml`,
                    '--deny-self-hosted-runners',
                    '--no-public-good',
                ]),
                cwd: fixture.candidateDirectory,
            }]);
            expect(receipt).toMatchObject({
                schemaVersion: 2,
                status: 'gh-attestation-verify-passed',
                verifiedAt: '2026-09-14T00:00:00.000Z',
                mode: 'online',
                candidateSha,
                target: 'macos-arm64',
                candidateArtifactMutated: false,
                candidateArtifactRevalidated: true,
            });
            expect(receipt.subjects).toHaveLength(1);
            expect(JSON.stringify(receipt)).not.toContain(fixture.workspace);
            expect(JSON.stringify(receipt)).not.toContain(fixture.candidateDirectory);
            await expect(readFile(path.join(fixture.candidateDirectory, 'provenance-verification-receipt.json'))).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('fails before attestation verification when the attestation URL repository does not resolve to the pinned repository ID', async () => {
        const fixture = await createFixture();
        try {
            const calls = [];
            await expect(executeDesktopArtifactProvenanceVerification({
                ...localOptions(fixture),
                receipt: path.join(fixture.root, 'provenance-verification-receipt.json'),
                runGh: async ({ argumentsList }) => {
                    calls.push(argumentsList);
                    return repositoryIdentityResult(42);
                },
            })).rejects.toThrow('desktop-artifact-provenance-verification-repository-identity-invalid');
            expect(calls).toEqual([['api', `repos/${repository}`, '--jq', '.id']]);
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('revalidates an external online receipt against the current candidate without running GH again', async () => {
        const fixture = await createFixture();
        try {
            const receiptPath = path.join(fixture.root, 'provenance-verification-receipt.json');
            await executeDesktopArtifactProvenanceVerification({
                ...localOptions(fixture),
                receipt: receiptPath,
                now: () => new Date('2026-09-14T00:00:00.000Z'),
                runGh: verifiedGhRunner,
            });

            const revalidated = await verifyDesktopArtifactProvenanceReceiptLocally({
                ...localOptions(fixture),
                receipt: receiptPath,
            });

            expect(revalidated.receipt).toMatchObject({
                schemaVersion: 2,
                mode: 'online',
                candidateSha,
                candidateArtifactRevalidated: true,
            });
            expect(revalidated.receiptFile.sha256).toMatch(/^[0-9a-f]{64}$/u);
            expect(revalidated.checksumEntryCount).toBe(fixture.checksummedFiles.length);
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('fails closed when a receipt no longer matches its candidate', async () => {
        const fixture = await createFixture();
        try {
            const receiptPath = path.join(fixture.root, 'provenance-verification-receipt.json');
            await executeDesktopArtifactProvenanceVerification({
                ...localOptions(fixture),
                receipt: receiptPath,
                runGh: verifiedGhRunner,
            });
            const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
            receipt.subjects[0].sha256 = 'b'.repeat(64);
            await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

            await expect(verifyDesktopArtifactProvenanceReceiptLocally({
                ...localOptions(fixture),
                receipt: receiptPath,
            })).rejects.toThrow('desktop-artifact-provenance-verification-receipt-subject-invalid');
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('rechecks the candidate after GH verification before creating a receipt', async () => {
        const fixture = await createFixture();
        try {
            const receiptPath = path.join(fixture.root, 'provenance-verification-receipt.json');
            await expect(executeDesktopArtifactProvenanceVerification({
                ...localOptions(fixture),
                receipt: receiptPath,
                runGh: async ({ argumentsList }) => {
                    if (argumentsList[0] === 'api') return repositoryIdentityResult();
                    await writeFile(fixture.subjectPath, 'changed-after-gh-verification');
                    return verifiedGhResult('ScreenHello.dmg');
                },
            })).rejects.toThrow('desktop-artifact-provenance-verification-subject-hash-invalid');
            await expect(readFile(receiptPath)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('rejects a candidate whose checksum manifest changes after GH even when it remains locally valid', async () => {
        const fixture = await createFixture();
        try {
            const receiptPath = path.join(fixture.root, 'provenance-verification-receipt.json');
            const checksumsPath = path.join(fixture.candidateDirectory, 'SHA256SUMS.txt');
            await expect(executeDesktopArtifactProvenanceVerification({
                ...localOptions(fixture),
                receipt: receiptPath,
                runGh: async ({ argumentsList }) => {
                    if (argumentsList[0] === 'api') return repositoryIdentityResult();
                    const entries = (await readFile(checksumsPath, 'utf8'))
                        .trim()
                        .split('\n')
                        .reverse();
                    await writeFile(checksumsPath, `${entries.join('\n')}\n`);
                    return verifiedGhResult('ScreenHello.dmg');
                },
            })).rejects.toThrow('desktop-artifact-provenance-verification-candidate-mutated-during-gh-verification');
            await expect(readFile(receiptPath)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('uses an atomic external receipt create if another process writes the path during GH verification', async () => {
        const fixture = await createFixture();
        try {
            const receiptPath = path.join(fixture.root, 'provenance-verification-receipt.json');
            await expect(executeDesktopArtifactProvenanceVerification({
                ...localOptions(fixture),
                receipt: receiptPath,
                runGh: async ({ argumentsList }) => {
                    if (argumentsList[0] === 'api') return repositoryIdentityResult();
                    await writeFile(receiptPath, 'intervening-file');
                    return verifiedGhResult('ScreenHello.dmg');
                },
            })).rejects.toThrow('desktop-artifact-provenance-verification-output-already-exists');
            await expect(readFile(receiptPath, 'utf8')).resolves.toBe('intervening-file');
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('requires the policy receipt filename before it invokes GH', async () => {
        const fixture = await createFixture();
        try {
            await expect(executeDesktopArtifactProvenanceVerification({
                ...localOptions(fixture),
                receipt: path.join(fixture.root, 'receipt.json'),
                runGh: async () => {
                    throw new Error('GH CLI must not run');
                },
            })).rejects.toThrow('desktop-artifact-provenance-verification-receipt-filename-invalid');
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('rejects a receipt stored in the candidate artifact', async () => {
        const fixture = await createFixture();
        try {
            await expect(verifyDesktopArtifactProvenanceReceiptLocally({
                ...localOptions(fixture),
                receipt: path.join(fixture.candidateDirectory, 'provenance-verification-plan.json'),
            })).rejects.toThrow('desktop-artifact-provenance-verification-receipt-inside-candidate-directory');
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('covers every Linux repository provenance subject, including both DEB packages', async () => {
        const fixture = await createLinuxFixture();
        try {
            const local = await verifyDesktopArtifactProvenanceLocally({
                matrix: structuredClone(matrix),
                candidateDirectory: 'artifacts/linux-deb-repository-signed-candidate',
                baseDirectory: fixture.workspace,
            });

            expect(local.context.subjects).toHaveLength(7);
            expect(local.plan.verification.online.commands).toHaveLength(7);
            expect(local.plan.verification.online.commands.map(({ artifact }) => artifact)).toContain(
                'repository/pool/main/s/screen-hello/screen-hello_1.0.4_amd64.deb',
            );
            expect(local.plan.verification.online.commands.map(({ artifact }) => artifact)).toContain(
                'repository/pool/main/s/screen-hello/screen-hello_1.0.4_arm64.deb',
            );
            expect(local.checksumEntryCount).toBe(fixture.checksummedFiles.length);
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it.each([
        ['a changed verification source ref', async (fixture) => {
            const plan = JSON.parse(await readFile(fixture.verificationPlan.output, 'utf8'));
            plan.verification.sourceRef = 'refs/heads/feature';
            await writeFile(fixture.verificationPlan.output, `${JSON.stringify(plan, null, 2)}\n`);
        }, 'desktop-artifact-provenance-verification-plan-invalid'],
        ['a required plan missing from SHA256SUMS', async (fixture) => {
            const records = (await readFile(path.join(fixture.candidateDirectory, 'SHA256SUMS.txt'), 'utf8'))
                .split('\n')
                .filter((line) => line && !line.endsWith('  provenance-verification-plan.json'));
            await writeFile(path.join(fixture.candidateDirectory, 'SHA256SUMS.txt'), `${records.join('\n')}\n`);
        }, 'desktop-artifact-provenance-verification-checksums-required-entry-missing'],
        ['an altered signed subject', async (fixture) => {
            await writeFile(fixture.subjectPath, 'substituted-candidate');
        }, 'desktop-artifact-provenance-verification-subject-hash-invalid'],
        ['an unchecksummed candidate file', async (fixture) => {
            await writeFile(path.join(fixture.candidateDirectory, 'unexpected-file.txt'), 'unexpected');
        }, 'desktop-artifact-provenance-verification-checksums-unlisted-file'],
    ])('fails closed for %s', async (_name, mutate, error) => {
        const fixture = await createFixture();
        try {
            await mutate(fixture);
            await expect(verifyDesktopArtifactProvenanceLocally(localOptions(fixture))).rejects.toThrow(error);
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('rejects a matrix that does not carry the Phase 20 schema', async () => {
        const fixture = await createFixture();
        try {
            const options = localOptions(fixture);
            options.matrix.schemaVersion = 15;
            await expect(verifyDesktopArtifactProvenanceLocally(options)).rejects.toThrow(
                'desktop-artifact-provenance-verification-schema-invalid',
            );
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('rejects a GH success result that uses the workspace path instead of the attested basename', async () => {
        const fixture = await createFixture();
        try {
            await expect(executeDesktopArtifactProvenanceVerification({
                ...localOptions(fixture),
                receipt: path.join(fixture.root, 'provenance-verification-receipt.json'),
                runGh: async ({ argumentsList }) => {
                    if (argumentsList[0] === 'api') return repositoryIdentityResult();
                    return {
                        exitCode: 0,
                        stdout: JSON.stringify([{
                            verificationResult: {
                                statement: {
                                    predicateType: 'https://slsa.dev/provenance/v1',
                                    subject: [{
                                        name: 'artifacts/macos-signed-candidate/ScreenHello.dmg',
                                        digest: { sha256: hash('signed-macos-candidate') },
                                    }],
                                },
                            },
                        }]),
                    };
                },
            })).rejects.toThrow('desktop-artifact-provenance-verification-gh-output-subject-invalid');
            await expect(readFile(path.join(fixture.root, 'provenance-verification-receipt.json'))).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('substitutes an external fresh trusted root for explicit offline GH verification', async () => {
        const fixture = await createFixture();
        try {
            const trustedRoot = path.join(fixture.root, 'trusted_root.jsonl');
            const reviewDirectory = path.join(fixture.root, 'offline-review');
            const receiptPath = path.join(reviewDirectory, 'provenance-verification-receipt.json');
            await mkdir(reviewDirectory);
            await writeFile(trustedRoot, '{"trusted_root":"fresh"}\n');
            const calls = [];
            const result = await executeDesktopArtifactProvenanceVerification({
                ...localOptions(fixture),
                receipt: receiptPath,
                offlineTrustedRoot: trustedRoot,
                runGh: async ({ argumentsList }) => {
                    calls.push(argumentsList);
                    if (argumentsList[0] === 'api') return repositoryIdentityResult();
                    return {
                        exitCode: 0,
                        stdout: JSON.stringify([{
                            verificationResult: {
                                statement: {
                                    predicateType: 'https://slsa.dev/provenance/v1',
                                    subject: [{
                                        name: 'ScreenHello.dmg',
                                        digest: { sha256: hash('signed-macos-candidate') },
                                    }],
                                },
                            },
                        }]),
                    };
                },
            });

            expect(calls[0]).toEqual(['api', `repos/${repository}`, '--jq', '.id']);
            expect(calls[1]).toEqual(expect.arrayContaining(['--custom-trusted-root', trustedRoot]));
            expect(result.receipt.mode).toBe('offline-custom-trusted-root');
            expect(result.receipt.trustedRoot).toMatchObject({
                name: 'trusted_root.jsonl',
                sha256: hash('{"trusted_root":"fresh"}\n'),
                freshness: 'generate-immediately-before-verification',
            });
            await expect(verifyDesktopArtifactProvenanceReceiptLocally({
                ...localOptions(fixture),
                receipt: receiptPath,
                offlineTrustedRoot: trustedRoot,
            })).resolves.toMatchObject({
                receipt: {
                    mode: 'offline-custom-trusted-root',
                },
                trustedRoot: {
                    sha256: hash('{"trusted_root":"fresh"}\n'),
                },
            });
            await writeFile(trustedRoot, '{"trusted_root":"replaced"}\n');
            await expect(verifyDesktopArtifactProvenanceReceiptLocally({
                ...localOptions(fixture),
                receipt: receiptPath,
                offlineTrustedRoot: trustedRoot,
            })).rejects.toThrow('desktop-artifact-provenance-verification-receipt-trusted-root-invalid');
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('rejects a trusted root placed inside the candidate artifact', async () => {
        const fixture = await createFixture();
        try {
            const trustedRoot = path.join(fixture.candidateDirectory, 'trusted_root.jsonl');
            await writeFile(trustedRoot, '{"trusted_root":"candidate-copy"}\n');
            await expect(executeDesktopArtifactProvenanceVerification({
                ...localOptions(fixture),
                receipt: path.join(fixture.root, 'offline-receipt.json'),
                offlineTrustedRoot: trustedRoot,
                runGh: async () => {
                    throw new Error('GH CLI must not run');
                },
            })).rejects.toThrow('desktop-artifact-provenance-verification-trusted-root-inside-candidate-directory');
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('rechecks the offline trusted root after GH verification before creating a receipt', async () => {
        const fixture = await createFixture();
        try {
            const trustedRoot = path.join(fixture.root, 'trusted_root.jsonl');
            const reviewDirectory = path.join(fixture.root, 'offline-review');
            const receiptPath = path.join(reviewDirectory, 'provenance-verification-receipt.json');
            await Promise.all([
                mkdir(reviewDirectory),
                writeFile(trustedRoot, '{"trusted_root":"fresh"}\n'),
            ]);

            await expect(executeDesktopArtifactProvenanceVerification({
                ...localOptions(fixture),
                receipt: receiptPath,
                offlineTrustedRoot: trustedRoot,
                runGh: async ({ argumentsList }) => {
                    if (argumentsList[0] === 'api') return repositoryIdentityResult();
                    await writeFile(trustedRoot, '{"trusted_root":"changed"}\n');
                    return verifiedGhResult('ScreenHello.dmg');
                },
            })).rejects.toThrow('desktop-artifact-provenance-verification-trusted-root-mutated-during-gh-verification');
            await expect(readFile(receiptPath)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('parses mutually exclusive local, receipt, plan, and explicit GH execution modes', () => {
        expect(parseDesktopArtifactProvenanceVerificationArguments([
            '--candidate-dir', 'candidate',
            '--verify-local',
        ])).toEqual({
            candidateDirectory: 'candidate',
            mode: 'verify-local',
        });
        expect(() => parseDesktopArtifactProvenanceVerificationArguments([
            '--candidate-dir', 'candidate',
            '--execute-gh',
        ])).toThrow('desktop-artifact-provenance-verification-option-required:receipt');
        expect(parseDesktopArtifactProvenanceVerificationArguments([
            '--candidate-dir', 'candidate',
            '--verify-receipt',
            '--receipt', 'receipt.json',
            '--offline-trusted-root', 'trusted_root.jsonl',
        ])).toEqual({
            candidateDirectory: 'candidate',
            mode: 'verify-receipt',
            receipt: 'receipt.json',
            offlineTrustedRoot: 'trusted_root.jsonl',
        });
        expect(() => parseDesktopArtifactProvenanceVerificationArguments([
            '--candidate-dir', 'candidate',
            '--verify-receipt',
        ])).toThrow('desktop-artifact-provenance-verification-option-required:receipt');
        expect(() => parseDesktopArtifactProvenanceVerificationArguments([
            '--candidate-dir', 'candidate',
            '--write-plan',
            '--execute-gh',
            '--receipt', 'receipt.json',
        ])).toThrow('desktop-artifact-provenance-verification-option-mode-conflict');
        expect(() => parseDesktopArtifactProvenanceVerificationArguments([
            '--candidate-dir', 'candidate',
            '--candidate-dir', 'other-candidate',
            '--verify-local',
        ])).toThrow('desktop-artifact-provenance-verification-option-duplicate:--candidate-dir');
    });
});
