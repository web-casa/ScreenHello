import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
    createLinuxDebClientTrustManifest,
    normalizeOpenPgpFingerprint,
    parseLinuxDebKeyLifecycleArguments,
} from '../../scripts/linux-deb-key-lifecycle.mjs';

const matrix = JSON.parse(await readFile(new URL('../../config/desktop-release-matrix.json', import.meta.url), 'utf8'));
const candidateSha = 'a'.repeat(40);
const activeFingerprint = '1'.repeat(40);
const nextFingerprint = '2'.repeat(40);

describe('Linux DEB client trust lifecycle manifest', () => {
    it('normalizes full OpenPGP fingerprints without accepting shortened key ids', () => {
        expect(normalizeOpenPgpFingerprint('  abcd abcd abcd abcd abcd abcd abcd abcd abcd abcd  '))
            .toBe('ABCDABCDABCDABCDABCDABCDABCDABCDABCDABCD');
        expect(() => normalizeOpenPgpFingerprint('ABCD1234')).toThrow('linux-deb-key-lifecycle-fingerprint-invalid');
    });

    it('creates a public-only active-and-next overlap manifest', () => {
        const manifest = createLinuxDebClientTrustManifest({
            matrix: structuredClone(matrix),
            candidateSha,
            activeFingerprint,
            activeExpiresAtUnix: 1_900_000_000,
            nextFingerprint,
            nextExpiresAtUnix: 1_950_000_000,
        });

        expect(manifest).toMatchObject({
            schemaVersion: 1,
            candidateSha,
            repository: {
                suite: 'screenhello-beta',
                component: 'main',
                signing: 'openpgp-release-and-inrelease',
                distribution: 'internal-candidate-artifact-only-no-public-endpoint',
                publicRelease: false,
            },
            keyring: {
                binaryPath: '/etc/apt/keyrings/screenhello-archive-keyring.gpg',
                armoredPath: '/etc/apt/keyrings/screenhello-archive-keyring.asc',
                exportOptions: 'export-minimal',
                fingerprints: [activeFingerprint, nextFingerprint],
                activeFingerprint,
                nextFingerprint,
                activeExpiresAtUnix: 1_900_000_000,
                nextExpiresAtUnix: 1_950_000_000,
            },
            rotation: {
                state: 'overlap-candidate',
                minimumOverlapDays: 30,
                minimumRemainingDaysWhenExpiring: 30,
            },
            revocation: {
                candidateArtifact: 'no-revocation-certificate',
                publicRelease: false,
            },
        });
        expect(JSON.stringify(manifest)).not.toContain('PRIVATE_KEY');
        expect(JSON.stringify(manifest)).not.toContain('PASSPHRASE');
    });

    it.each([
        ['a non-Git candidate SHA', { candidateSha: 'not-a-sha' }, 'linux-deb-key-lifecycle-candidate-sha-invalid'],
        ['a duplicate next key', { nextFingerprint: activeFingerprint }, 'linux-deb-key-lifecycle-next-fingerprint-duplicate'],
        ['a next expiry without a next key', { nextExpiresAtUnix: 1_900_000_000 }, 'linux-deb-key-lifecycle-next-expiration-without-next-key'],
        ['a changed lifecycle policy', { mutateMatrix: true }, 'linux-deb-key-lifecycle-policy-invalid'],
    ])('fails closed for %s', (_name, changes, expectedError) => {
        const inputMatrix = structuredClone(matrix);
        if (changes.mutateMatrix) inputMatrix.linuxDebRepositoryKeyLifecycleCandidate.rotation.minimumOverlapDays = 1;
        expect(() => createLinuxDebClientTrustManifest({
            matrix: inputMatrix,
            candidateSha,
            activeFingerprint,
            ...changes,
        })).toThrow(expectedError);
    });

    it('parses only explicit manifest CLI inputs', () => {
        expect(parseLinuxDebKeyLifecycleArguments([
            '--candidate-sha', candidateSha,
            '--active-fingerprint', activeFingerprint,
            '--output', 'artifacts/client-trust.json',
        ])).toEqual({
            candidateSha,
            activeFingerprint,
            output: 'artifacts/client-trust.json',
        });
        expect(() => parseLinuxDebKeyLifecycleArguments(['--candidate-sha', candidateSha]))
            .toThrow('linux-deb-key-lifecycle-option-required:activeFingerprint');
    });
});
