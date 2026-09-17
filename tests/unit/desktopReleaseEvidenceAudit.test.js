import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { candidateTargets } from '../../scripts/audit-desktop-release-contract.mjs';

const execFileAsync = promisify(execFile);
const candidate = 'b'.repeat(40);
const auditScript = resolve('scripts/audit-desktop-release-evidence.mjs');
const [matrix, packageJson] = await Promise.all([
    readFile(resolve('config/desktop-release-matrix.json'), 'utf8').then(JSON.parse),
    readFile(resolve('package.json'), 'utf8').then(JSON.parse),
]);
const applicationVersion = packageJson.version;

const captureCapabilityForTarget = (target) => ({
    schemaVersion: 1,
    backend: target.platform === 'linux'
        ? 'x11'
        : target.platform === 'macos'
            ? 'macos-core-graphics'
            : 'windows-gdi',
    status: 'ready',
    sourcePicker: true,
});

const stateMigration = Object.freeze({
    schemaVersion: 1,
    status: 'ready',
    dataSchemaVersion: 1,
});

const createEvidence = (target, scope = 'full') => {
    const mainBinary = target.platform === 'linux'
        ? 'usr/bin/screenhello-desktop'
        : target.platform === 'macos'
            ? 'Contents/MacOS/screenhello-desktop'
            : 'screenhello-desktop.exe';
    return {
    schemaVersion: matrix.schemaVersion,
    scope,
    target: target.id,
    candidateSha: candidate,
    testedAt: '2026-09-05T00:00:00.000Z',
    status: 'conditional',
    runner: {
        label: target.runner,
        environment: 'github-hosted',
        os: target.nodePlatform,
        arch: target.arch,
        rustTarget: target.rustTarget,
        image: { os: 'runner-image', version: '20260901.1' },
    },
    source: {
        repository: 'web-casa/signed-candidate',
        repositoryId: 1353846102,
        workflow: 'Desktop Release Gate',
        event: 'pull_request',
        runId: 12345,
        runAttempt: 1,
    },
    tools: {
        node: 'v24.18.0',
        pnpm: '10.12.1',
        rustc: 'rustc 1.96.0',
        cargo: 'cargo 1.96.0',
        tauri: '2.11.4',
    },
    build: {
        status: 'passed',
        durationMs: 120_000,
        signing: 'unsigned-test-only',
        binary: { name: 'screenhello-desktop', bytes: 1, sha256: 'c'.repeat(64) },
        bundle: { name: `ScreenHello.${target.bundleKind}`, kind: target.bundleKind, bytes: 1, sha256: 'c'.repeat(64) },
        artifactInspection: { name: 'artifact-inspection.json', bytes: 1, sha256: 'c'.repeat(64) },
        package: {
            kind: target.bundleKind,
            channel: target.channel,
            identity: target.packageIdentity,
            identitySource: target.packageIdentitySource,
            version: applicationVersion,
            architecture: target.packageArchitecture,
            payloadVerified: true,
            mainBinary,
            nativeBinaries: [{
                path: mainBinary,
                format: target.binaryFormat,
                architecture: target.binaryArchitecture,
            }],
        },
        checks: Object.fromEntries(matrix.requiredBuildChecks.map((id) => [id, true])),
    },
    runtime: {
        status: 'passed',
        driver: 'embedded-test-feature',
        durationMs: 20_000,
        checks: Object.fromEntries(matrix.requiredRuntimeChecks.map((id) => [id, true])),
        capturePermissionBoundary: 'enforced',
        codecs: {
            status: 'passed',
            formats: ['avif', 'webp', 'png'],
            resourceProtocol: target.platform === 'windows' ? 'http:' : 'tauri:',
        },
        captureCapability: captureCapabilityForTarget(target),
        stateMigration: { ...stateMigration },
        capture: { status: 'passed', sources: 1, width: 640, height: 480, bytes: 4_096, imported: true },
        editorImport: 'passed',
        evidenceFile: { name: 'runtime.json', bytes: 1, sha256: 'c'.repeat(64) },
        screenshot: { name: 'runtime.png', bytes: 1, sha256: 'c'.repeat(64) },
    },
    supplyChain: {
        sbom: [
            { name: 'npm.cdx.json', bytes: 1, sha256: 'c'.repeat(64) },
            { name: 'cargo.cdx.json', bytes: 1, sha256: 'c'.repeat(64) },
        ],
        checksums: { name: 'SHA256SUMS.txt', bytes: 1, sha256: 'c'.repeat(64) },
    },
    manualChecks: target.manualChecks.map((id) => ({
        id,
        status: 'pending',
        reason: 'Requires an interactive physical or policy-controlled environment.',
    })),
    };
};

const withEvidence = async (mutate, run, scope = 'full') => {
    const evidenceDirectory = await mkdtemp(join(tmpdir(), 'screenhello-desktop-evidence-'));
    try {
        for (const target of candidateTargets(matrix, scope)) {
            const evidence = createEvidence(target, scope);
            const targetDirectory = join(evidenceDirectory, target.id);
            await mkdir(targetDirectory);
            const records = [
                evidence.build.binary,
                evidence.build.bundle,
                evidence.build.artifactInspection,
                evidence.runtime.evidenceFile,
                evidence.runtime.screenshot,
                ...evidence.supplyChain.sbom,
            ];
            for (const record of records) {
                let content = `${target.id}:${record.name}\n`;
                if (record.name.endsWith('.cdx.json')) {
                    content = `${JSON.stringify({
                        bomFormat: 'CycloneDX',
                        specVersion: '1.6',
                        metadata: { properties: [
                            { name: 'screenhello:candidate-sha', value: evidence.candidateSha },
                            { name: 'screenhello:desktop-target', value: target.id },
                        ] },
                        components: [{ type: 'application', name: 'fixture', version: '1.0.0' }],
                    })}\n`;
                } else if (record.name === 'artifact-inspection.json') {
                    content = `${JSON.stringify({
                        schemaVersion: 2,
                        scope: evidence.scope,
                        candidateSha: evidence.candidateSha,
                        target: target.id,
                        application: {
                            productName: 'ScreenHello',
                            identifier: 'com.webcasa.screenhello',
                            version: applicationVersion,
                        },
                        binary: { format: target.binaryFormat, architecture: target.binaryArchitecture },
                        package: evidence.build.package,
                    })}\n`;
                }
                record.bytes = Buffer.byteLength(content);
                record.sha256 = createHash('sha256').update(content).digest('hex');
                await writeFile(join(targetDirectory, record.name), content, 'utf8');
            }
            const checksumContent = `${records
                .map(({ sha256, name }) => `${sha256}  ${name}`)
                .sort((left, right) => left.localeCompare(right, 'en'))
                .join('\n')}\n`;
            evidence.supplyChain.checksums.bytes = Buffer.byteLength(checksumContent);
            evidence.supplyChain.checksums.sha256 = createHash('sha256').update(checksumContent).digest('hex');
            await writeFile(join(targetDirectory, 'SHA256SUMS.txt'), checksumContent, 'utf8');
            mutate?.(evidence, target);
            await writeFile(join(evidenceDirectory, `${target.id}.json`), `${JSON.stringify(evidence)}\n`, 'utf8');
        }
        return await run(evidenceDirectory);
    } finally {
        await rm(evidenceDirectory, { recursive: true, force: true });
    }
};

const audit = (evidenceDirectory, scope = 'full') => execFileAsync(process.execPath, [auditScript], {
    cwd: process.cwd(),
    env: {
        ...process.env,
        SCREENHELLO_DESKTOP_EVIDENCE_DIR: evidenceDirectory,
        SCREENHELLO_RELEASE_CANDIDATE: candidate,
        SCREENHELLO_DESKTOP_GATE_SCOPE: scope,
    },
});

describe('desktop release evidence audit', () => {
    it('accepts public-repository unsigned evidence without authorizing a release', async () => {
        const { stdout } = await withEvidence((evidence) => {
            evidence.source.repository = 'web-casa/ScreenHello';
            evidence.source.repositoryId = 1353846676;
        }, audit);
        expect(JSON.parse(stdout)).toMatchObject({ automaticGate: 'passed', releaseReady: false, failures: [] });
    });
    it('accepts complete automatic evidence while preserving explicit manual gates', async () => {
        const { stdout } = await withEvidence(undefined, audit);
        expect(JSON.parse(stdout)).toMatchObject({
            candidateSha: candidate,
            automaticGate: 'passed',
            releaseReady: false,
            failures: [],
        });
    });

    it('accepts only the bounded pull-request evidence set for the pr scope', async () => {
        const { stdout } = await withEvidence(undefined, (directory) => audit(directory, 'pr'), 'pr');
        expect(JSON.parse(stdout)).toMatchObject({
            scope: 'pr',
            automaticGate: 'passed',
            results: expect.arrayContaining([
                expect.objectContaining({ target: 'linux-x64', status: 'passed' }),
                expect.objectContaining({ target: 'macos-arm64', status: 'passed' }),
                expect.objectContaining({ target: 'windows-x64', status: 'passed' }),
            ]),
            failures: [],
        });
    });

    it('accepts a permission-boundary probe when no human approved native capture', async () => {
        const { stdout } = await withEvidence((evidence, target) => {
            if (target.id === 'linux-x64') {
                evidence.runtime.capture = {
                    status: 'manual',
                    reason: 'Native consent was not exercised; no capture success is claimed.',
                };
            }
        }, audit);
        expect(JSON.parse(stdout)).toMatchObject({
            automaticGate: 'passed',
            failures: [],
        });
    });

    it.each([
        ['an unrelated repository ID', (evidence) => { evidence.source.repositoryId = 42; }],
        ['a string repository ID', (evidence) => { evidence.source.repositoryId = '1353846676'; }],
        ['a cross-candidate result', (evidence, target) => {
            if (target.id === 'windows-x64') evidence.candidateSha = 'd'.repeat(40);
        }],
        ['an unexpected runner', (evidence, target) => {
            if (target.id === 'macos-arm64') evidence.runner.label = 'macos-latest';
        }],
        ['a missing runtime assertion', (evidence, target) => {
            if (target.id === 'linux-x64') delete evidence.runtime.checks.capture;
        }],
        ['a missing capture capability assertion', (evidence, target) => {
            if (target.id === 'linux-x64') delete evidence.runtime.checks.captureCapability;
        }],
        ['a missing state migration assertion', (evidence, target) => {
            if (target.id === 'linux-x64') delete evidence.runtime.checks.stateMigration;
        }],
        ['a state migration failure hidden as evidence', (evidence, target) => {
            if (target.id === 'windows-x64') evidence.runtime.stateMigration.status = 'unavailable';
        }],
        ['a cross-platform capture backend', (evidence, target) => {
            if (target.id === 'windows-x64') evidence.runtime.captureCapability.backend = 'x11';
        }],
        ['incomplete codec runtime evidence', (evidence, target) => {
            if (target.id === 'linux-x64') evidence.runtime.codecs.formats = ['png'];
        }],
        ['a leaked test driver', (evidence, target) => {
            if (target.id === 'windows-x64') evidence.build.checks.testDriverExcluded = false;
        }],
        ['a fabricated manual pass', (evidence, target) => {
            if (target.id === 'macos-arm64') evidence.manualChecks[0].status = 'passed';
        }],
        ['a sensitive field', (evidence, target) => {
            if (target.id === 'linux-x64') evidence.accessToken = 'should-never-be-recorded';
        }],
        ['a tampered artifact', (evidence, target) => {
            if (target.id === 'linux-x64') evidence.build.binary.sha256 = 'd'.repeat(64);
        }],
        ['a mismatched package architecture', (evidence, target) => {
            if (target.id === 'windows-x64') evidence.build.package.architecture = 'arm64';
        }],
        ['a mismatched native payload architecture', (evidence, target) => {
            if (target.id === 'linux-x64') evidence.build.package.nativeBinaries[0].architecture = 'arm64';
        }],
        ['a mismatched gate scope', (evidence, target) => {
            if (target.id === 'macos-arm64') evidence.scope = 'pr';
        }],
        ['an unsafe SBOM artifact name', (evidence, target) => {
            if (target.id === 'macos-arm64') evidence.supplyChain.sbom[0].name = '../npm.cdx.json';
        }],
    ])('fails closed for %s', async (_name, mutate) => {
        await expect(withEvidence(mutate, audit)).rejects.toMatchObject({ code: 1 });
    });
});
