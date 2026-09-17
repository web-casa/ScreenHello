import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeDesktopArtifactProvenanceRecord } from '../../scripts/desktop-artifact-provenance.mjs';
import {
    executeDesktopArtifactProvenanceVerification,
    writeDesktopArtifactProvenanceVerificationPlan,
} from '../../scripts/desktop-artifact-provenance-verification.mjs';
import {
    parseDesktopPlatformAcceptanceArguments,
    verifyDesktopPlatformAcceptanceRecord,
    writeDesktopPlatformAcceptancePlan,
    writeDesktopPlatformAcceptanceRecordTemplate,
} from '../../scripts/desktop-platform-acceptance.mjs';

const matrix = await readFile(new URL('../../config/desktop-release-matrix.json', import.meta.url), 'utf8').then(JSON.parse);
const candidateSha = 'a'.repeat(40);
const attestationId = '123456';
const attestationUrl = `https://github.com/web-casa/signed-candidate/attestations/${attestationId}`;
const hash = (value) => createHash('sha256').update(value).digest('hex');

const fixtureProfiles = Object.freeze({
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
    'macos-arm64': {
        candidateDirectory: 'artifacts/macos-signed-candidate',
        subjects: ['ScreenHello.dmg'],
    },
});

const writeChecksums = async (candidateDirectory, relativePaths) => {
    const entries = await Promise.all(relativePaths.map(async (relative) => {
        const content = await readFile(path.join(candidateDirectory, ...relative.split('/')));
        return `${hash(content)}  ${relative}`;
    }));
    await writeFile(path.join(candidateDirectory, 'SHA256SUMS.txt'), `${entries.join('\n')}\n`);
};

const createFixture = async (target = 'macos-arm64') => {
    const profile = fixtureProfiles[target];
    const root = await mkdtemp(path.join(os.tmpdir(), 'screenhello-platform-acceptance-'));
    const workspace = path.join(root, 'workspace');
    const runnerTemp = path.join(root, 'runner-temp');
    const candidateDirectory = path.join(workspace, ...profile.candidateDirectory.split('/'));
    const bundlePath = path.join(runnerTemp, 'created-attestation.json');
    const reviewDirectory = path.join(root, 'review');
    const receiptPath = path.join(reviewDirectory, 'provenance-verification-receipt.json');
    const planPath = path.join(reviewDirectory, 'platform-acceptance-plan.json');
    const recordPath = path.join(reviewDirectory, 'platform-acceptance-record.json');
    const evidenceDirectory = path.join(reviewDirectory, 'evidence');
    await Promise.all([
        mkdir(candidateDirectory, { recursive: true }),
        mkdir(runnerTemp, { recursive: true }),
        mkdir(reviewDirectory, { recursive: true }),
        mkdir(evidenceDirectory, { recursive: true }),
    ]);
    await Promise.all(profile.subjects.map(async (relative) => {
        const output = path.join(candidateDirectory, ...relative.split('/'));
        await mkdir(path.dirname(output), { recursive: true });
        await writeFile(output, `signed:${relative}`);
    }));
    await writeFile(bundlePath, '{"mediaType":"application/vnd.dev.sigstore.bundle+json"}\n');
    const subjectPaths = profile.subjects.map((relative) => path.join(profile.candidateDirectory, ...relative.split('/')));
    await writeDesktopArtifactProvenanceRecord({
        matrix: structuredClone(matrix),
        candidateSha,
        target,
        candidateDirectory: profile.candidateDirectory,
        subjectPaths,
        attestationId,
        attestationUrl,
        bundlePath,
        runnerTempDirectory: runnerTemp,
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
    await executeDesktopArtifactProvenanceVerification({
        matrix: structuredClone(matrix),
        candidateDirectory: profile.candidateDirectory,
        baseDirectory: workspace,
        receipt: receiptPath,
        now: () => new Date('2026-09-14T00:00:00.000Z'),
        runGh: async ({ argumentsList }) => {
            if (argumentsList[0] === 'api') {
                return {
                    exitCode: 0,
                    stdout: `${matrix.desktopArtifactProvenanceVerification.repositoryId}\n`,
                };
            }
            const relative = argumentsList[2];
            const content = await readFile(path.join(candidateDirectory, ...relative.split('/')));
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
    return {
        root,
        workspace,
        candidateDirectory,
        candidateDirectoryRelative: profile.candidateDirectory,
        receiptPath,
        reviewDirectory,
        planPath,
        recordPath,
        evidenceDirectory,
        firstSubject: path.join(candidateDirectory, ...profile.subjects[0].split('/')),
    };
};

const acceptanceOptions = (fixture) => ({
    matrix: structuredClone(matrix),
    candidateDirectory: fixture.candidateDirectoryRelative,
    receipt: fixture.receiptPath,
    plan: fixture.planPath,
    baseDirectory: fixture.workspace,
});

const writeRecord = async (fixture, { status = 'passed' } = {}) => {
    const plan = JSON.parse(await readFile(fixture.planPath, 'utf8'));
    const planBytes = await readFile(fixture.planPath);
    const checks = await Promise.all(plan.checks.map(async (check, index) => {
        if (status !== 'passed' && index === 0) {
            return {
                target: check.target,
                id: check.id,
                status,
                reason: 'Interactive acceptance has not been completed.',
                evidence: [],
            };
        }
        const file = `${check.target}-${index}.txt`;
        const content = `${check.target}:${check.id}\n`;
        await writeFile(path.join(fixture.evidenceDirectory, file), content);
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
        testedAt: '2026-09-14T01:00:00.000Z',
        candidateSha,
        target: plan.target,
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
    await writeFile(fixture.recordPath, `${JSON.stringify(record, null, 2)}\n`);
    return record;
};

describe('desktop platform acceptance', () => {
    it('binds a complete manual acceptance record to a revalidated signed candidate without making it release-ready', async () => {
        const fixture = await createFixture();
        try {
            const written = await writeDesktopPlatformAcceptancePlan(acceptanceOptions(fixture));
            const record = await writeRecord(fixture);
            const result = await verifyDesktopPlatformAcceptanceRecord({
                ...acceptanceOptions(fixture),
                record: fixture.recordPath,
                evidenceDirectory: fixture.evidenceDirectory,
            });

            expect(written.plan).toMatchObject({
                schemaVersion: 1,
                status: 'ready-for-manual-platform-acceptance',
                target: 'macos-arm64',
                candidateSha,
            });
            expect(written.plan.checks).toHaveLength(7);
            expect(record.checks).toHaveLength(written.plan.checks.length);
            expect(result).toMatchObject({
                acceptanceComplete: true,
                releaseReady: false,
                context: {
                    candidate: {
                        context: { candidateSha },
                    },
                },
            });
            expect(JSON.stringify(written.plan)).not.toContain(fixture.workspace);
            expect(JSON.stringify(record)).not.toContain(fixture.workspace);
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('keeps a valid but unfinished manual record explicitly incomplete', async () => {
        const fixture = await createFixture();
        try {
            await writeDesktopPlatformAcceptancePlan(acceptanceOptions(fixture));
            await writeRecord(fixture, { status: 'not-run' });
            await expect(verifyDesktopPlatformAcceptanceRecord({
                ...acceptanceOptions(fixture),
                record: fixture.recordPath,
                evidenceDirectory: fixture.evidenceDirectory,
            })).resolves.toMatchObject({ acceptanceComplete: false, releaseReady: false });
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('writes an explicitly incomplete record template that verifies without claiming acceptance', async () => {
        const fixture = await createFixture();
        try {
            await writeDesktopPlatformAcceptancePlan(acceptanceOptions(fixture));
            const template = await writeDesktopPlatformAcceptanceRecordTemplate({
                ...acceptanceOptions(fixture),
                record: fixture.recordPath,
                now: () => new Date('2026-09-14T01:00:00.000Z'),
            });
            const verified = await verifyDesktopPlatformAcceptanceRecord({
                ...acceptanceOptions(fixture),
                record: fixture.recordPath,
                evidenceDirectory: fixture.evidenceDirectory,
            });
            expect(template.record.checks).toHaveLength(7);
            expect(template.record.checks.every(({ status }) => status === 'not-run')).toBe(true);
            expect(verified).toMatchObject({ acceptanceComplete: false, releaseReady: false });
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('expands the Linux repository candidate into both architecture-specific manual check sets', async () => {
        const fixture = await createFixture('linux-deb-repository');
        try {
            const result = await writeDesktopPlatformAcceptancePlan(acceptanceOptions(fixture));
            expect(result.plan.targets).toEqual([
                { id: 'linux-x64', platform: 'linux', arch: 'x64' },
                { id: 'linux-arm64', platform: 'linux', arch: 'arm64' },
            ]);
            expect(result.plan.checks).toHaveLength(14);
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it.each([
        ['a plan output inside the candidate', async (fixture) => {
            await expect(writeDesktopPlatformAcceptancePlan({
                ...acceptanceOptions(fixture),
                plan: path.join(fixture.candidateDirectory, 'platform-acceptance-plan.json'),
            })).rejects.toThrow('desktop-platform-acceptance-plan-inside-candidate-directory');
        }],
        ['a plan output with the wrong filename', async (fixture) => {
            await expect(writeDesktopPlatformAcceptancePlan({
                ...acceptanceOptions(fixture),
                plan: path.join(fixture.root, 'plan.json'),
            })).rejects.toThrow('desktop-platform-acceptance-plan-filename-invalid');
        }],
        ['a passed check without evidence', async (fixture) => {
            await writeDesktopPlatformAcceptancePlan(acceptanceOptions(fixture));
            const record = await writeRecord(fixture);
            record.checks[0].evidence = [];
            await writeFile(fixture.recordPath, `${JSON.stringify(record)}\n`);
            await expect(verifyDesktopPlatformAcceptanceRecord({
                ...acceptanceOptions(fixture),
                record: fixture.recordPath,
                evidenceDirectory: fixture.evidenceDirectory,
            })).rejects.toThrow('desktop-platform-acceptance-record-check-invalid');
        }],
        ['a tampered evidence file', async (fixture) => {
            await writeDesktopPlatformAcceptancePlan(acceptanceOptions(fixture));
            const record = await writeRecord(fixture);
            await writeFile(path.join(fixture.evidenceDirectory, record.checks[0].evidence[0].file), 'changed');
            await expect(verifyDesktopPlatformAcceptanceRecord({
                ...acceptanceOptions(fixture),
                record: fixture.recordPath,
                evidenceDirectory: fixture.evidenceDirectory,
            })).rejects.toThrow('desktop-platform-acceptance-record-evidence-hash-invalid');
        }],
        ['an evidence path escape', async (fixture) => {
            await writeDesktopPlatformAcceptancePlan(acceptanceOptions(fixture));
            const record = await writeRecord(fixture);
            record.checks[0].evidence[0].file = '../outside.txt';
            await writeFile(fixture.recordPath, `${JSON.stringify(record)}\n`);
            await expect(verifyDesktopPlatformAcceptanceRecord({
                ...acceptanceOptions(fixture),
                record: fixture.recordPath,
                evidenceDirectory: fixture.evidenceDirectory,
            })).rejects.toThrow('desktop-platform-acceptance-record-evidence-path-invalid');
        }],
        ['a plan, receipt, or record reused as manual evidence', async (fixture) => {
            await writeDesktopPlatformAcceptancePlan(acceptanceOptions(fixture));
            const record = await writeRecord(fixture);
            const planBytes = await readFile(fixture.planPath);
            record.checks[0].evidence = [{
                file: 'platform-acceptance-plan.json',
                mediaType: 'application/json',
                bytes: planBytes.length,
                sha256: hash(planBytes),
            }];
            await writeFile(fixture.recordPath, `${JSON.stringify(record)}\n`);
            await expect(verifyDesktopPlatformAcceptanceRecord({
                ...acceptanceOptions(fixture),
                record: fixture.recordPath,
                evidenceDirectory: fixture.reviewDirectory,
            })).rejects.toThrow('desktop-platform-acceptance-record-evidence-control-file');
        }],
        ['a record whose plan hash does not match', async (fixture) => {
            await writeDesktopPlatformAcceptancePlan(acceptanceOptions(fixture));
            const record = await writeRecord(fixture);
            record.plan.sha256 = 'b'.repeat(64);
            await writeFile(fixture.recordPath, `${JSON.stringify(record)}\n`);
            await expect(verifyDesktopPlatformAcceptanceRecord({
                ...acceptanceOptions(fixture),
                record: fixture.recordPath,
                evidenceDirectory: fixture.evidenceDirectory,
            })).rejects.toThrow('desktop-platform-acceptance-record-invalid');
        }],
        ['a candidate that changes after its receipt', async (fixture) => {
            await writeDesktopPlatformAcceptancePlan(acceptanceOptions(fixture));
            await writeRecord(fixture);
            await writeFile(fixture.firstSubject, 'substituted-candidate');
            await expect(verifyDesktopPlatformAcceptanceRecord({
                ...acceptanceOptions(fixture),
                record: fixture.recordPath,
                evidenceDirectory: fixture.evidenceDirectory,
            })).rejects.toThrow('desktop-artifact-provenance-verification-subject-hash-invalid');
        }],
        ['a matrix outside the Phase 16 schema', async (fixture) => {
            const options = acceptanceOptions(fixture);
            options.matrix.schemaVersion = 16;
            await expect(writeDesktopPlatformAcceptancePlan(options)).rejects.toThrow(
                'desktop-platform-acceptance-schema-invalid',
            );
        }],
    ])('fails closed for %s', async (_name, verify) => {
        const fixture = await createFixture();
        try {
            await verify(fixture);
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('parses only complete, unambiguous plan and record modes', () => {
        expect(parseDesktopPlatformAcceptanceArguments([
            '--candidate-dir', 'candidate',
            '--receipt', 'receipt.json',
            '--plan', 'platform-acceptance-plan.json',
            '--write-plan',
        ])).toEqual({
            candidateDirectory: 'candidate',
            receipt: 'receipt.json',
            plan: 'platform-acceptance-plan.json',
            mode: 'write-plan',
        });
        expect(() => parseDesktopPlatformAcceptanceArguments([
            '--candidate-dir', 'candidate',
            '--receipt', 'receipt.json',
            '--plan', 'platform-acceptance-plan.json',
            '--verify-record',
        ])).toThrow('desktop-platform-acceptance-option-required:record-and-evidence-dir');
        expect(() => parseDesktopPlatformAcceptanceArguments([
            '--candidate-dir', 'candidate',
            '--candidate-dir', 'other-candidate',
            '--receipt', 'receipt.json',
            '--plan', 'platform-acceptance-plan.json',
            '--write-plan',
        ])).toThrow('desktop-platform-acceptance-option-duplicate:--candidate-dir');
        expect(parseDesktopPlatformAcceptanceArguments([
            '--candidate-dir', 'candidate',
            '--receipt', 'receipt.json',
            '--plan', 'platform-acceptance-plan.json',
            '--record', 'platform-acceptance-record.json',
            '--write-record-template',
        ])).toMatchObject({ mode: 'write-record-template' });
    });
});
