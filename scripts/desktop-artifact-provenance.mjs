import { createReadStream } from 'node:fs';
import { copyFile, lstat, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const githubAttestActionReference = 'actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6';
export const desktopArtifactProvenanceRecordFilename = 'provenance-attestation.json';
export const desktopArtifactProvenanceBundleFilename = 'provenance-attestation.bundle.json';
export const desktopArtifactProvenanceRepositoryId = 1353846102;

export const desktopArtifactProvenanceProfiles = Object.freeze([
    Object.freeze({
        target: 'macos-arm64',
        workflow: '.github/workflows/macos-signed-candidate.yml',
        job: 'sign',
        environment: 'macos-signing',
        candidateDirectory: 'artifacts/macos-signed-candidate',
        subjectPaths: ['artifacts/macos-signed-candidate/*.dmg'],
        subjectCount: 1,
    }),
    Object.freeze({
        target: 'macos-x64',
        workflow: '.github/workflows/macos-intel-signed-candidate.yml',
        job: 'sign',
        environment: 'macos-signing',
        candidateDirectory: 'artifacts/macos-intel-signed-candidate',
        subjectPaths: ['artifacts/macos-intel-signed-candidate/*.dmg'],
        subjectCount: 1,
    }),
    Object.freeze({
        target: 'windows-x64',
        workflow: '.github/workflows/windows-signed-candidate.yml',
        job: 'sign',
        environment: 'windows-signing',
        candidateDirectory: 'artifacts/windows-signed-candidate',
        subjectPaths: ['artifacts/windows-signed-candidate/*-setup.exe'],
        subjectCount: 1,
    }),
    Object.freeze({
        target: 'windows-arm64',
        workflow: '.github/workflows/windows-arm64-signed-candidate.yml',
        job: 'sign',
        environment: 'windows-signing',
        candidateDirectory: 'artifacts/windows-arm64-signed-candidate',
        subjectPaths: ['artifacts/windows-arm64-signed-candidate/*-setup.exe'],
        subjectCount: 1,
    }),
    Object.freeze({
        target: 'linux-deb-repository',
        workflow: '.github/workflows/linux-deb-repository-signed-candidate.yml',
        job: 'sign',
        environment: 'linux-repository-signing',
        candidateDirectory: 'artifacts/linux-deb-repository-signed-candidate',
        subjectPaths: [
            'artifacts/linux-deb-repository-signed-candidate/repository/pool/main/s/screen-hello/*.deb',
            'artifacts/linux-deb-repository-signed-candidate/repository/dists/screenhello-beta/Release',
            'artifacts/linux-deb-repository-signed-candidate/repository/dists/screenhello-beta/InRelease',
            'artifacts/linux-deb-repository-signed-candidate/repository/dists/screenhello-beta/Release.gpg',
            'artifacts/linux-deb-repository-signed-candidate/client-trust/screenhello-archive-keyring.gpg',
            'artifacts/linux-deb-repository-signed-candidate/client-trust/screenhello-archive-keyring.asc',
        ],
        subjectCount: 7,
    }),
]);

export const expectedDesktopArtifactProvenanceCandidate = Object.freeze({
    status: 'workflow-ready-not-run',
    action: {
        reference: githubAttestActionReference,
        version: 'v4.2.2',
        predicate: 'slsa-build-provenance',
        permissions: [
            'contents: read',
            'id-token: write',
            'attestations: write',
            'artifact-metadata: write',
        ],
        privateRepositoryAvailability: 'github-enterprise-cloud-plan-pending-verification',
    },
    distribution: 'internal-candidate-artifact-only-no-public-release',
    verification: 'gh-attestation-verify-after-remote-run',
    subjects: desktopArtifactProvenanceProfiles.map((profile) => ({
        target: profile.target,
        workflow: profile.workflow,
        job: profile.job,
        environment: profile.environment,
        candidateDirectory: profile.candidateDirectory,
        subjectPaths: profile.subjectPaths,
        subjectCount: profile.subjectCount,
    })),
    artifactRetentionDays: 14,
    publicRelease: false,
});

const candidateShaPattern = /^[0-9a-f]{40}$/u;
const attestationIdPattern = /^[1-9][0-9]{0,19}$/u;
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const expectedPolicy = (matrix) => {
    if (!sameJson(
        matrix?.desktopArtifactProvenanceCandidate,
        expectedDesktopArtifactProvenanceCandidate,
    )) {
        throw new Error('desktop-artifact-provenance-policy-invalid');
    }
    return matrix.desktopArtifactProvenanceCandidate;
};

export const normalizeDesktopArtifactProvenanceCandidateSha = (value) => {
    const candidateSha = String(value ?? '').trim().toLowerCase();
    if (!candidateShaPattern.test(candidateSha)) {
        throw new Error('desktop-artifact-provenance-candidate-sha-invalid');
    }
    return candidateSha;
};

export const normalizeDesktopArtifactProvenanceAttestationId = (value) => {
    const attestationId = String(value ?? '').trim();
    if (!attestationIdPattern.test(attestationId)) {
        throw new Error('desktop-artifact-provenance-attestation-id-invalid');
    }
    return attestationId;
};

export const normalizeDesktopArtifactProvenanceAttestationUrl = (value, attestationId) => {
    let url;
    try {
        url = new URL(String(value ?? '').trim());
    } catch {
        throw new Error('desktop-artifact-provenance-attestation-url-invalid');
    }
    const segments = url.pathname.split('/');
    if (url.protocol !== 'https:'
        || url.hostname !== 'github.com'
        || url.username
        || url.password
        || url.search
        || url.hash
        || segments.length !== 5
        || segments[0] !== ''
        || !/^[A-Za-z0-9_.-]+$/u.test(segments[1])
        || !/^[A-Za-z0-9_.-]+$/u.test(segments[2])
        || segments[3] !== 'attestations'
        || segments[4] !== attestationId) {
        throw new Error('desktop-artifact-provenance-attestation-url-invalid');
    }
    return url.toString();
};

export const desktopArtifactProvenanceRepositoryFromAttestationUrl = (value, attestationId) => {
    const url = new URL(normalizeDesktopArtifactProvenanceAttestationUrl(value, attestationId));
    return url.pathname.split('/').slice(1, 3).join('/');
};

const inside = (directory, candidate) => {
    const relative = path.relative(directory, candidate);
    return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
};

const assertRegularFile = async (absolute, errorPrefix, maximumBytes) => {
    let entry;
    try {
        entry = await lstat(absolute);
    } catch {
        throw new Error(`${errorPrefix}-missing`);
    }
    if (entry.isSymbolicLink() || !entry.isFile() || entry.size <= 0 || entry.size > maximumBytes) {
        throw new Error(`${errorPrefix}-invalid`);
    }
    return entry;
};

const sha256 = async (absolute) => {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(absolute)) {
        hash.update(chunk);
    }
    return hash.digest('hex');
};

const profileForTarget = (target) => {
    const profile = desktopArtifactProvenanceProfiles.find((candidate) => candidate.target === target);
    if (!profile) throw new Error('desktop-artifact-provenance-target-invalid');
    return profile;
};

const resolveDirectory = async (baseDirectory, value, errorPrefix) => {
    const absolute = path.resolve(baseDirectory, String(value ?? ''));
    let entry;
    try {
        entry = await lstat(absolute);
    } catch {
        throw new Error(`${errorPrefix}-missing`);
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error(`${errorPrefix}-invalid`);
    }
    return realpath(absolute);
};

const subjectRecord = async ({ baseDirectory, candidateDirectory, value }) => {
    const requested = path.resolve(baseDirectory, String(value ?? ''));
    await assertRegularFile(requested, 'desktop-artifact-provenance-subject', 4 * 1024 * 1024 * 1024);
    const absolute = await realpath(requested);
    if (!inside(candidateDirectory, absolute)) {
        throw new Error('desktop-artifact-provenance-subject-outside-candidate-directory');
    }
    const entry = await assertRegularFile(absolute, 'desktop-artifact-provenance-subject', 4 * 1024 * 1024 * 1024);
    return {
        absolute,
        path: path.relative(baseDirectory, absolute).split(path.sep).join('/'),
        name: path.basename(absolute),
        bytes: entry.size,
        sha256: await sha256(absolute),
    };
};

const bundleRecord = async ({ baseDirectory, runnerTempDirectory, value }) => {
    const requested = path.resolve(baseDirectory, String(value ?? ''));
    const entry = await assertRegularFile(requested, 'desktop-artifact-provenance-bundle', 16 * 1024 * 1024);
    const absolute = await realpath(requested);
    if (!inside(baseDirectory, absolute)
        && (!runnerTempDirectory || !inside(runnerTempDirectory, absolute))) {
        throw new Error('desktop-artifact-provenance-bundle-outside-workspace-or-runner-directory');
    }
    return {
        absolute,
        name: desktopArtifactProvenanceBundleFilename,
        bytes: entry.size,
        sha256: await sha256(absolute),
    };
};

const outputMissing = async (absolute) => {
    try {
        await lstat(absolute);
    } catch (error) {
        if (error?.code === 'ENOENT') return;
        throw error;
    }
    throw new Error('desktop-artifact-provenance-output-already-exists');
};

export const writeDesktopArtifactProvenanceRecord = async ({
    matrix,
    candidateSha,
    target,
    candidateDirectory,
    subjectPaths,
    attestationId,
    attestationUrl,
    bundlePath,
    runnerTempDirectory,
    baseDirectory = process.cwd(),
} = {}) => {
    const policy = expectedPolicy(matrix);
    const profile = profileForTarget(target);
    const normalizedCandidateSha = normalizeDesktopArtifactProvenanceCandidateSha(candidateSha);
    const normalizedAttestationId = normalizeDesktopArtifactProvenanceAttestationId(attestationId);
    const normalizedAttestationUrl = normalizeDesktopArtifactProvenanceAttestationUrl(attestationUrl, normalizedAttestationId);
    const base = await realpath(path.resolve(baseDirectory));
    const candidateDirectoryAbsolute = await resolveDirectory(
        base,
        candidateDirectory,
        'desktop-artifact-provenance-candidate-directory',
    );
    const runnerTempDirectoryAbsolute = runnerTempDirectory
        ? await resolveDirectory(base, runnerTempDirectory, 'desktop-artifact-provenance-runner-temp-directory')
        : undefined;
    if (path.relative(base, candidateDirectoryAbsolute).split(path.sep).join('/') !== profile.candidateDirectory) {
        throw new Error('desktop-artifact-provenance-candidate-directory-policy-invalid');
    }
    if (!Array.isArray(subjectPaths)
        || subjectPaths.length !== profile.subjectCount
        || new Set(subjectPaths).size !== subjectPaths.length) {
        throw new Error('desktop-artifact-provenance-subject-set-invalid');
    }
    const subjects = await Promise.all(subjectPaths.map((value) => subjectRecord({
        baseDirectory: base,
        candidateDirectory: candidateDirectoryAbsolute,
        value,
    })));
    const bundle = await bundleRecord({
        baseDirectory: base,
        runnerTempDirectory: runnerTempDirectoryAbsolute,
        value: bundlePath,
    });
    const outputBundle = path.join(candidateDirectoryAbsolute, bundle.name);
    const outputRecord = path.join(candidateDirectoryAbsolute, desktopArtifactProvenanceRecordFilename);
    await Promise.all([outputMissing(outputBundle), outputMissing(outputRecord)]);
    const record = {
        schemaVersion: 1,
        status: 'attestation-created',
        candidateSha: normalizedCandidateSha,
        target: profile.target,
        workflow: profile.workflow,
        job: profile.job,
        environment: profile.environment,
        provenance: {
            action: policy.action.reference,
            predicate: policy.action.predicate,
            verification: policy.verification,
            publicRelease: false,
        },
        subjects: subjects.map((subject) => ({
            path: subject.path,
            name: subject.name,
            bytes: subject.bytes,
            sha256: subject.sha256,
        })),
        attestation: {
            id: normalizedAttestationId,
            url: normalizedAttestationUrl,
            bundle: {
                name: bundle.name,
                bytes: bundle.bytes,
                sha256: bundle.sha256,
            },
        },
    };
    try {
        await copyFile(bundle.absolute, outputBundle);
        await writeFile(outputRecord, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o644 });
    } catch (error) {
        await Promise.all([
            rm(outputBundle, { force: true }),
            rm(outputRecord, { force: true }),
        ]);
        throw error;
    }
    return {
        record,
        output: outputRecord,
        bundle: outputBundle,
    };
};

const readOption = (argumentsList, index, option) => {
    const value = argumentsList[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`desktop-artifact-provenance-option-value-required:${option}`);
    }
    return value;
};

export const parseDesktopArtifactProvenanceArguments = (argumentsList) => {
    const options = { subjectPaths: [] };
    for (let index = 0; index < argumentsList.length; index += 1) {
        const option = argumentsList[index];
        switch (option) {
        case '--candidate-sha':
            options.candidateSha = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--target':
            options.target = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--candidate-dir':
            options.candidateDirectory = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--subject':
            options.subjectPaths.push(readOption(argumentsList, index, option));
            index += 1;
            break;
        case '--attestation-id':
            options.attestationId = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--attestation-url':
            options.attestationUrl = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--bundle':
            options.bundlePath = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--runner-temp':
            options.runnerTempDirectory = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--base-directory':
            options.baseDirectory = readOption(argumentsList, index, option);
            index += 1;
            break;
        default:
            throw new Error(`desktop-artifact-provenance-option-unsupported:${option}`);
        }
    }
    for (const required of ['candidateSha', 'target', 'candidateDirectory', 'attestationId', 'attestationUrl', 'bundlePath']) {
        if (!options[required]) throw new Error(`desktop-artifact-provenance-option-required:${required}`);
    }
    if (!options.subjectPaths.length) throw new Error('desktop-artifact-provenance-option-required:subject');
    return options;
};

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const options = parseDesktopArtifactProvenanceArguments(process.argv.slice(2));
    const matrix = JSON.parse(await readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8'));
    const result = await writeDesktopArtifactProvenanceRecord({ matrix, ...options });
    process.stdout.write(`${JSON.stringify({
        status: 'passed',
        output: path.relative(process.cwd(), result.output),
        subjectCount: result.record.subjects.length,
    }, null, 2)}\n`);
}
