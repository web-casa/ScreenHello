import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    parseDesktopArtifactProvenanceArguments,
    writeDesktopArtifactProvenanceRecord,
} from '../../scripts/desktop-artifact-provenance.mjs';

const matrix = await readFile(new URL('../../config/desktop-release-matrix.json', import.meta.url), 'utf8').then(JSON.parse);
const candidateSha = 'a'.repeat(40);
const attestationId = '123456';
const attestationUrl = `https://github.com/web-casa/signed-candidate/attestations/${attestationId}`;

const createFixture = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'screenhello-artifact-provenance-'));
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
    return {
        root,
        workspace,
        runnerTemp,
        candidateDirectory,
        subjectPath,
        bundlePath,
    };
};

const inputFor = (fixture) => ({
    matrix: structuredClone(matrix),
    candidateSha,
    target: 'macos-arm64',
    candidateDirectory: 'artifacts/macos-signed-candidate',
    subjectPaths: ['artifacts/macos-signed-candidate/ScreenHello.dmg'],
    attestationId,
    attestationUrl,
    bundlePath: fixture.bundlePath,
    runnerTempDirectory: fixture.runnerTemp,
    baseDirectory: fixture.workspace,
});

describe('desktop artifact provenance record', () => {
    it('copies a runner-generated Sigstore bundle into the signed candidate with public verification metadata', async () => {
        const fixture = await createFixture();
        try {
            const result = await writeDesktopArtifactProvenanceRecord(inputFor(fixture));
            const record = JSON.parse(await readFile(result.output, 'utf8'));
            const bundle = await readFile(result.bundle, 'utf8');

            expect(record).toMatchObject({
                schemaVersion: 1,
                status: 'attestation-created',
                candidateSha,
                target: 'macos-arm64',
                provenance: {
                    action: 'actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6',
                    predicate: 'slsa-build-provenance',
                    publicRelease: false,
                },
                attestation: {
                    id: attestationId,
                    url: attestationUrl,
                    bundle: {
                        name: 'provenance-attestation.bundle.json',
                    },
                },
            });
            expect(record.subjects).toEqual([{
                path: 'artifacts/macos-signed-candidate/ScreenHello.dmg',
                name: 'ScreenHello.dmg',
                bytes: Buffer.byteLength('signed-macos-candidate'),
                sha256: createHash('sha256').update('signed-macos-candidate').digest('hex'),
            }]);
            expect(bundle).toContain('application/vnd.dev.sigstore.bundle+json');
            expect(JSON.stringify(record)).not.toContain(fixture.runnerTemp);
            expect(JSON.stringify(record)).not.toContain(fixture.workspace);
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it.each([
        ['an untrusted bundle path', async (value, fixture) => {
            const external = path.join(fixture.root, 'untrusted-attestation.json');
            await writeFile(external, '{}');
            value.bundlePath = external;
        }, 'desktop-artifact-provenance-bundle-outside-workspace-or-runner-directory'],
        ['an altered provenance policy', async (value) => {
            value.matrix.desktopArtifactProvenanceCandidate.action.version = 'v0';
        }, 'desktop-artifact-provenance-policy-invalid'],
        ['an incomplete subject set', async (value) => {
            value.subjectPaths = [];
        }, 'desktop-artifact-provenance-subject-set-invalid'],
        ['an unrelated attestation URL', async (value) => {
            value.attestationUrl = 'https://github.com/web-casa/signed-candidate/attestations/999999';
        }, 'desktop-artifact-provenance-attestation-url-invalid'],
    ])('fails closed for %s', async (_name, mutate, error) => {
        const fixture = await createFixture();
        try {
            const value = inputFor(fixture);
            await mutate(value, fixture);
            await expect(writeDesktopArtifactProvenanceRecord(value)).rejects.toThrow(error);
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('parses the repeatable command-line subject inputs', () => {
        expect(parseDesktopArtifactProvenanceArguments([
            '--candidate-sha', candidateSha,
            '--target', 'macos-arm64',
            '--candidate-dir', 'artifacts/macos-signed-candidate',
            '--subject', 'artifacts/macos-signed-candidate/ScreenHello.dmg',
            '--attestation-id', attestationId,
            '--attestation-url', attestationUrl,
            '--bundle', '/runner-temp/created-attestation.json',
            '--runner-temp', '/runner-temp',
        ])).toMatchObject({
            candidateSha,
            target: 'macos-arm64',
            candidateDirectory: 'artifacts/macos-signed-candidate',
            subjectPaths: ['artifacts/macos-signed-candidate/ScreenHello.dmg'],
            attestationId,
            attestationUrl,
            bundlePath: '/runner-temp/created-attestation.json',
            runnerTempDirectory: '/runner-temp',
        });
    });
});
