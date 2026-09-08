import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const candidate = 'b'.repeat(40);
const auditScript = resolve('scripts/audit-desktop-release-evidence.mjs');
const matrix = JSON.parse(await readFile(resolve('config/desktop-release-matrix.json'), 'utf8'));

const createEvidence = (target) => ({
    schemaVersion: 1,
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
        repository: 'web-casa/ScreenHello',
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
            version: '0.1.0',
            architecture: target.packageArchitecture,
            payloadVerified: true,
        },
        checks: Object.fromEntries(matrix.requiredBuildChecks.map((id) => [id, true])),
    },
    runtime: {
        status: 'passed',
        driver: 'embedded-test-feature',
        durationMs: 20_000,
        checks: Object.fromEntries(matrix.requiredRuntimeChecks.map((id) => [id, true])),
        capture: { sources: 1, width: 640, height: 480, bytes: 4_096 },
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
});

const withEvidence = async (mutate, run) => {
    const evidenceDirectory = await mkdtemp(join(tmpdir(), 'screenhello-desktop-evidence-'));
    try {
        for (const target of matrix.targets) {
            const evidence = createEvidence(target);
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
                        schemaVersion: 1,
                        candidateSha: evidence.candidateSha,
                        target: target.id,
                        application: {
                            productName: 'ScreenHello',
                            identifier: 'com.webcasa.screenhello',
                            version: '0.1.0',
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

const audit = (evidenceDirectory) => execFileAsync(process.execPath, [auditScript], {
    cwd: process.cwd(),
    env: {
        ...process.env,
        SCREENHELLO_DESKTOP_EVIDENCE_DIR: evidenceDirectory,
        SCREENHELLO_RELEASE_CANDIDATE: candidate,
    },
});

describe('desktop release evidence audit', () => {
    it('accepts complete automatic evidence while preserving explicit manual gates', async () => {
        const { stdout } = await withEvidence(undefined, audit);
        expect(JSON.parse(stdout)).toMatchObject({
            candidateSha: candidate,
            automaticGate: 'passed',
            releaseReady: false,
            failures: [],
        });
    });

    it.each([
        ['a cross-candidate result', (evidence, target) => {
            if (target.id === 'windows-x64') evidence.candidateSha = 'd'.repeat(40);
        }],
        ['an unexpected runner', (evidence, target) => {
            if (target.id === 'macos-14-arm64') evidence.runner.label = 'macos-latest';
        }],
        ['a missing runtime assertion', (evidence, target) => {
            if (target.id === 'linux-x64') delete evidence.runtime.checks.capture;
        }],
        ['a leaked test driver', (evidence, target) => {
            if (target.id === 'windows-x64') evidence.build.checks.testDriverExcluded = false;
        }],
        ['a fabricated manual pass', (evidence, target) => {
            if (target.id === 'macos-14-arm64') evidence.manualChecks[0].status = 'passed';
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
        ['an unsafe SBOM artifact name', (evidence, target) => {
            if (target.id === 'macos-14-arm64') evidence.supplyChain.sbom[0].name = '../npm.cdx.json';
        }],
    ])('fails closed for %s', async (_name, mutate) => {
        await expect(withEvidence(mutate, audit)).rejects.toMatchObject({ code: 1 });
    });
});
