import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const expectedLinuxDebRepositoryKeyLifecycleCandidate = Object.freeze({
    status: 'workflow-ready-not-run',
    workflow: '.github/workflows/linux-deb-repository-signed-candidate.yml',
    environment: 'linux-repository-signing',
    channel: 'github-actions-linux-deb-repository-signed-candidate',
    distribution: 'internal-candidate-artifact-only-no-public-endpoint',
    keyring: {
        binaryFormat: 'openpgp-gpg',
        armorFormat: 'openpgp-asc',
        exportOptions: 'export-minimal',
        clientInstallPath: '/etc/apt/keyrings/screenhello-archive-keyring.gpg',
        clientArmorPath: '/etc/apt/keyrings/screenhello-archive-keyring.asc',
    },
    rotation: {
        mode: 'optional-next-public-key-overlap',
        nextPublicKeyVariable: 'LINUX_REPOSITORY_SIGNING_NEXT_PUBLIC_KEY',
        nextFingerprintVariable: 'LINUX_REPOSITORY_SIGNING_NEXT_FINGERPRINT',
        minimumOverlapDays: 30,
        minimumRemainingDaysWhenExpiring: 30,
        retirement: 'manual-after-supported-client-rollout',
    },
    revocation: {
        mode: 'offline-revocation-certificate-and-out-of-band-bootstrap',
        repositoryResponse: 'disable-publication-and-endpoint-before-recovery',
        candidateArtifact: 'no-revocation-certificate',
        publicRelease: false,
    },
    artifactRetentionDays: 14,
});

const fingerprintPattern = /^(?:[0-9A-F]{40}|[0-9A-F]{64})$/u;
const candidateShaPattern = /^[0-9a-f]{40}$/u;
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export const normalizeOpenPgpFingerprint = (value) => {
    const fingerprint = String(value ?? '')
        .replace(/\s/gu, '')
        .toUpperCase();
    if (!fingerprintPattern.test(fingerprint)) {
        throw new Error('linux-deb-key-lifecycle-fingerprint-invalid');
    }
    return fingerprint;
};

const normalizeCandidateSha = (value) => {
    const candidateSha = String(value ?? '').trim().toLowerCase();
    if (!candidateShaPattern.test(candidateSha)) {
        throw new Error('linux-deb-key-lifecycle-candidate-sha-invalid');
    }
    return candidateSha;
};

const normalizeExpiration = (value, field) => {
    if (value === undefined || value === null || value === '') return undefined;
    const expiration = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(expiration) || expiration <= 0) {
        throw new Error(`linux-deb-key-lifecycle-${field}-invalid`);
    }
    return expiration;
};

const expectedPolicy = (matrix) => {
    if (!sameJson(
        matrix?.linuxDebRepositoryKeyLifecycleCandidate,
        expectedLinuxDebRepositoryKeyLifecycleCandidate,
    )) {
        throw new Error('linux-deb-key-lifecycle-policy-invalid');
    }
    return matrix.linuxDebRepositoryKeyLifecycleCandidate;
};

export const createLinuxDebClientTrustManifest = ({
    matrix,
    candidateSha,
    activeFingerprint,
    activeExpiresAtUnix,
    nextFingerprint,
    nextExpiresAtUnix,
} = {}) => {
    const policy = expectedPolicy(matrix);
    const active = normalizeOpenPgpFingerprint(activeFingerprint);
    const next = nextFingerprint === undefined || nextFingerprint === null || nextFingerprint === ''
        ? undefined
        : normalizeOpenPgpFingerprint(nextFingerprint);
    if (next === active) throw new Error('linux-deb-key-lifecycle-next-fingerprint-duplicate');
    const activeExpiration = normalizeExpiration(activeExpiresAtUnix, 'active-expiration');
    const nextExpiration = normalizeExpiration(nextExpiresAtUnix, 'next-expiration');
    if (nextExpiration !== undefined && !next) {
        throw new Error('linux-deb-key-lifecycle-next-expiration-without-next-key');
    }

    return {
        schemaVersion: 1,
        candidateSha: normalizeCandidateSha(candidateSha),
        repository: {
            suite: 'screenhello-beta',
            component: 'main',
            signing: 'openpgp-release-and-inrelease',
            distribution: policy.distribution,
            publicRelease: false,
        },
        keyring: {
            binaryPath: policy.keyring.clientInstallPath,
            armoredPath: policy.keyring.clientArmorPath,
            exportOptions: policy.keyring.exportOptions,
            fingerprints: next ? [active, next] : [active],
            activeFingerprint: active,
            ...(next ? { nextFingerprint: next } : {}),
            ...(activeExpiration ? { activeExpiresAtUnix: activeExpiration } : {}),
            ...(nextExpiration ? { nextExpiresAtUnix: nextExpiration } : {}),
        },
        rotation: {
            ...policy.rotation,
            state: next ? 'overlap-candidate' : 'single-key-candidate',
        },
        revocation: policy.revocation,
    };
};

const readOption = (argumentsList, index, option) => {
    const value = argumentsList[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`linux-deb-key-lifecycle-option-value-required:${option}`);
    }
    return value;
};

export const parseLinuxDebKeyLifecycleArguments = (argumentsList) => {
    const options = {};
    for (let index = 0; index < argumentsList.length; index += 1) {
        const option = argumentsList[index];
        switch (option) {
        case '--candidate-sha':
            options.candidateSha = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--active-fingerprint':
            options.activeFingerprint = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--active-expires-at-unix':
            options.activeExpiresAtUnix = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--next-fingerprint':
            options.nextFingerprint = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--next-expires-at-unix':
            options.nextExpiresAtUnix = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--output':
            options.output = readOption(argumentsList, index, option);
            index += 1;
            break;
        default:
            throw new Error(`linux-deb-key-lifecycle-option-unsupported:${option}`);
        }
    }
    for (const required of ['candidateSha', 'activeFingerprint', 'output']) {
        if (!options[required]) throw new Error(`linux-deb-key-lifecycle-option-required:${required}`);
    }
    return options;
};

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const options = parseLinuxDebKeyLifecycleArguments(process.argv.slice(2));
    const matrix = JSON.parse(await readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8'));
    const manifest = createLinuxDebClientTrustManifest({ matrix, ...options });
    const output = path.resolve(options.output);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
    process.stdout.write(`${JSON.stringify({ status: 'passed', output }, null, 2)}\n`);
}
