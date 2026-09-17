import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
    desktopArtifactProvenanceBundleFilename,
    desktopArtifactProvenanceProfiles,
    desktopArtifactProvenanceRecordFilename,
    desktopArtifactProvenanceRepositoryFromAttestationUrl,
    desktopArtifactProvenanceRepositoryId,
    expectedDesktopArtifactProvenanceCandidate,
    normalizeDesktopArtifactProvenanceAttestationId,
    normalizeDesktopArtifactProvenanceAttestationUrl,
    normalizeDesktopArtifactProvenanceCandidateSha,
} from './desktop-artifact-provenance.mjs';

export const desktopArtifactProvenanceVerificationPlanFilename = 'provenance-verification-plan.json';
export const desktopArtifactProvenanceVerificationReceiptFilename = 'provenance-verification-receipt.json';
export const githubArtifactProvenancePredicateType = 'https://slsa.dev/provenance/v1';

export const expectedDesktopArtifactProvenanceVerification = Object.freeze({
    status: 'local-precheck-gh-cli-receipt-and-local-revalidation-ready-not-run',
    repository: 'attestation-url-derived',
    signerRepository: 'attestation-url-derived',
    repositoryId: desktopArtifactProvenanceRepositoryId,
    sourceRef: 'refs/heads/main',
    predicateType: githubArtifactProvenancePredicateType,
    candidateArtifact: {
        verificationPlan: desktopArtifactProvenanceVerificationPlanFilename,
        checksum: 'required',
        workflowGhExecution: 'forbidden',
        finalLocalRecheck: 'required-after-gh-cli-before-receipt',
    },
    ghCli: {
        command: 'attestation verify',
        bundle: 'required',
        outputFormat: 'json',
        denySelfHostedRunners: true,
        noPublicGood: true,
        offlineTrustedRoot: 'fresh-gh-attestation-trusted-root-not-in-candidate',
    },
    localReceipt: {
        schemaVersion: 2,
        filename: desktopArtifactProvenanceVerificationReceiptFilename,
        writeLocation: 'outside-candidate-directory',
        atomicCreate: 'outside-candidate-directory-no-overwrite',
        revalidation: 'local-candidate-and-offline-trusted-root-rehash-required',
        status: 'created-only-after-gh-attestation-verify-and-final-local-recheck-success',
    },
    publicRelease: false,
});

const maximumSubjectBytes = 4 * 1024 * 1024 * 1024;
const maximumMetadataBytes = 16 * 1024 * 1024;
const maximumChecksumBytes = 2 * 1024 * 1024;
const maximumGhOutputBytes = 16 * 1024 * 1024;
const maximumCandidateFiles = 10_000;
const maximumReceiptSubjectVerificationCount = 10_000;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const offlineTrustedRootPlaceholder = '<fresh-trusted-root.jsonl-outside-candidate>';
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const hasExactKeys = (value, keys) => (
    Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && sameJson(Object.keys(value).sort(), [...keys].sort())
);

const isInside = (directory, candidate) => {
    const relative = path.relative(directory, candidate);
    return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const sha256 = async (absolute) => {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(absolute)) {
        hash.update(chunk);
    }
    return hash.digest('hex');
};

const outputMissing = async (absolute) => {
    try {
        await lstat(absolute);
    } catch (error) {
        if (error?.code === 'ENOENT') return;
        throw error;
    }
    throw new Error('desktop-artifact-provenance-verification-output-already-exists');
};

const normalizeCandidateRelativePath = (value, error) => {
    const relative = String(value ?? '');
    if (!relative
        || relative.includes('\\')
        || relative.includes('\0')
        || path.posix.isAbsolute(relative)
        || path.posix.normalize(relative) !== relative
        || relative === '.'
        || relative === '..'
        || relative.startsWith('../')) {
        throw new Error(error);
    }
    return relative;
};

const readRegularFile = async (absolute, errorPrefix, maximumBytes) => {
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

const resolveCandidateDirectory = async (baseDirectory, value) => {
    const requested = path.resolve(baseDirectory, String(value ?? ''));
    let entry;
    try {
        entry = await lstat(requested);
    } catch {
        throw new Error('desktop-artifact-provenance-verification-candidate-directory-missing');
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error('desktop-artifact-provenance-verification-candidate-directory-invalid');
    }
    return realpath(requested);
};

const resolveCandidateFile = async ({ candidateDirectory, relative, errorPrefix, maximumBytes }) => {
    const normalizedRelative = normalizeCandidateRelativePath(relative, `${errorPrefix}-path-invalid`);
    const requested = path.resolve(candidateDirectory, ...normalizedRelative.split('/'));
    const initial = await readRegularFile(requested, errorPrefix, maximumBytes);
    const absolute = await realpath(requested);
    if (!isInside(candidateDirectory, absolute)) {
        throw new Error(`${errorPrefix}-outside-candidate-directory`);
    }
    const entry = await readRegularFile(absolute, errorPrefix, maximumBytes);
    return {
        absolute,
        relative: normalizedRelative,
        bytes: entry.size,
        initialBytes: initial.size,
        sha256: await sha256(absolute),
    };
};

const readJsonCandidateFile = async ({ candidateDirectory, relative, errorPrefix }) => {
    const file = await resolveCandidateFile({
        candidateDirectory,
        relative,
        errorPrefix,
        maximumBytes: maximumMetadataBytes,
    });
    let value;
    try {
        value = JSON.parse(await readFile(file.absolute, 'utf8'));
    } catch {
        throw new Error(`${errorPrefix}-json-invalid`);
    }
    return { file, value };
};

const listCandidateRegularFiles = async (candidateDirectory) => {
    const files = [];
    const visit = async (directory, relativeDirectory = '') => {
        let entries;
        try {
            entries = await readdir(directory, { withFileTypes: true });
        } catch {
            throw new Error('desktop-artifact-provenance-verification-candidate-directory-read-invalid');
        }
        for (const entry of entries) {
            const relative = normalizeCandidateRelativePath(
                relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name,
                'desktop-artifact-provenance-verification-candidate-entry-path-invalid',
            );
            const absolute = path.join(directory, entry.name);
            let stat;
            try {
                stat = await lstat(absolute);
            } catch {
                throw new Error('desktop-artifact-provenance-verification-candidate-entry-missing');
            }
            if (stat.isSymbolicLink()) {
                throw new Error('desktop-artifact-provenance-verification-candidate-entry-symlink');
            }
            if (stat.isDirectory()) {
                await visit(absolute, relative);
                continue;
            }
            if (!stat.isFile()) {
                throw new Error('desktop-artifact-provenance-verification-candidate-entry-invalid');
            }
            files.push(relative);
            if (files.length > maximumCandidateFiles) {
                throw new Error('desktop-artifact-provenance-verification-candidate-entry-count-invalid');
            }
        }
    };
    await visit(candidateDirectory);
    return files;
};

const profileForTarget = (target) => {
    const profile = desktopArtifactProvenanceProfiles.find((candidate) => candidate.target === target);
    if (!profile) throw new Error('desktop-artifact-provenance-verification-target-invalid');
    return profile;
};

const expectedPolicy = (matrix) => {
    if (matrix?.schemaVersion !== 24) {
        throw new Error('desktop-artifact-provenance-verification-schema-invalid');
    }
    if (!sameJson(
        matrix?.desktopArtifactProvenanceCandidate,
        expectedDesktopArtifactProvenanceCandidate,
    )) {
        throw new Error('desktop-artifact-provenance-verification-provenance-policy-invalid');
    }
    if (!sameJson(
        matrix?.desktopArtifactProvenanceVerification,
        expectedDesktopArtifactProvenanceVerification,
    )) {
        throw new Error('desktop-artifact-provenance-verification-policy-invalid');
    }
    return matrix.desktopArtifactProvenanceVerification;
};

const subjectPattern = (value) => new RegExp(`^${value
    .replace(/[|\\{}()[\]^$+?.]/gu, '\\$&')
    .replaceAll('*', '[^/]*')}$`, 'u');

const validateRecordSubjectSet = (record, profile) => {
    if (!Array.isArray(record?.subjects) || record.subjects.length !== profile.subjectCount) {
        throw new Error('desktop-artifact-provenance-verification-subject-set-invalid');
    }
    const patterns = profile.subjectPaths.map((value) => ({
        value,
        wildcard: value.includes('*'),
        expression: subjectPattern(value),
    }));
    const subjectPaths = record.subjects.map((subject) => subject?.path);
    if (new Set(subjectPaths).size !== subjectPaths.length
        || subjectPaths.some((value) => typeof value !== 'string')) {
        throw new Error('desktop-artifact-provenance-verification-subject-set-invalid');
    }
    for (const subjectPath of subjectPaths) {
        if (patterns.filter((pattern) => pattern.expression.test(subjectPath)).length !== 1) {
            throw new Error('desktop-artifact-provenance-verification-subject-policy-invalid');
        }
    }
    for (const pattern of patterns.filter((candidate) => !candidate.wildcard)) {
        if (subjectPaths.filter((subjectPath) => subjectPath === pattern.value).length !== 1) {
            throw new Error('desktop-artifact-provenance-verification-subject-policy-invalid');
        }
    }
};

const validateRecord = async ({ matrix, candidateDirectory }) => {
    const policy = expectedPolicy(matrix);
    const { file: recordFile, value: record } = await readJsonCandidateFile({
        candidateDirectory,
        relative: desktopArtifactProvenanceRecordFilename,
        errorPrefix: 'desktop-artifact-provenance-verification-record',
    });
    if (!hasExactKeys(record, [
        'schemaVersion',
        'status',
        'candidateSha',
        'target',
        'workflow',
        'job',
        'environment',
        'provenance',
        'subjects',
        'attestation',
    ])
        || record.schemaVersion !== 1
        || record.status !== 'attestation-created') {
        throw new Error('desktop-artifact-provenance-verification-record-shape-invalid');
    }
    const candidateSha = normalizeDesktopArtifactProvenanceCandidateSha(record.candidateSha);
    const profile = profileForTarget(record.target);
    if (record.workflow !== profile.workflow
        || record.job !== profile.job
        || record.environment !== profile.environment
        || !hasExactKeys(record.provenance, ['action', 'predicate', 'verification', 'publicRelease'])
        || record.provenance.action !== expectedDesktopArtifactProvenanceCandidate.action.reference
        || record.provenance.predicate !== expectedDesktopArtifactProvenanceCandidate.action.predicate
        || record.provenance.verification !== expectedDesktopArtifactProvenanceCandidate.verification
        || record.provenance.publicRelease !== false) {
        throw new Error('desktop-artifact-provenance-verification-record-policy-invalid');
    }
    validateRecordSubjectSet(record, profile);
    const candidatePrefix = `${profile.candidateDirectory}/`;
    const subjects = await Promise.all(record.subjects.map(async (subject) => {
        if (!hasExactKeys(subject, ['path', 'name', 'bytes', 'sha256'])
            || !subject.path.startsWith(candidatePrefix)
            || subject.name !== path.posix.basename(subject.path)
            || !Number.isSafeInteger(subject.bytes)
            || subject.bytes <= 0
            || !sha256Pattern.test(subject.sha256)) {
            throw new Error('desktop-artifact-provenance-verification-subject-record-invalid');
        }
        const candidatePath = normalizeCandidateRelativePath(
            subject.path.slice(candidatePrefix.length),
            'desktop-artifact-provenance-verification-subject-path-invalid',
        );
        const file = await resolveCandidateFile({
            candidateDirectory,
            relative: candidatePath,
            errorPrefix: 'desktop-artifact-provenance-verification-subject',
            maximumBytes: maximumSubjectBytes,
        });
        if (file.bytes !== subject.bytes || file.sha256 !== subject.sha256) {
            throw new Error('desktop-artifact-provenance-verification-subject-hash-invalid');
        }
        return {
            attestedPath: subject.path,
            attestedName: subject.name,
            candidatePath,
            name: subject.name,
            bytes: subject.bytes,
            sha256: subject.sha256,
        };
    }));
    if (!hasExactKeys(record.attestation, ['id', 'url', 'bundle'])
        || !hasExactKeys(record.attestation.bundle, ['name', 'bytes', 'sha256'])
        || record.attestation.bundle.name !== desktopArtifactProvenanceBundleFilename
        || !Number.isSafeInteger(record.attestation.bundle.bytes)
        || record.attestation.bundle.bytes <= 0
        || !sha256Pattern.test(record.attestation.bundle.sha256)) {
        throw new Error('desktop-artifact-provenance-verification-attestation-record-invalid');
    }
    const attestationId = normalizeDesktopArtifactProvenanceAttestationId(record.attestation.id);
    const attestationUrl = normalizeDesktopArtifactProvenanceAttestationUrl(record.attestation.url, attestationId);
    const repository = desktopArtifactProvenanceRepositoryFromAttestationUrl(attestationUrl, attestationId);
    const bundle = await resolveCandidateFile({
        candidateDirectory,
        relative: desktopArtifactProvenanceBundleFilename,
        errorPrefix: 'desktop-artifact-provenance-verification-bundle',
        maximumBytes: maximumMetadataBytes,
    });
    if (bundle.bytes !== record.attestation.bundle.bytes || bundle.sha256 !== record.attestation.bundle.sha256) {
        throw new Error('desktop-artifact-provenance-verification-bundle-hash-invalid');
    }
    return {
        policy,
        candidateDirectory,
        record,
        recordFile,
        candidateSha,
        profile,
        subjects,
        attestation: {
            id: attestationId,
            url: attestationUrl,
            bundle: {
                name: desktopArtifactProvenanceBundleFilename,
                bytes: bundle.bytes,
                sha256: bundle.sha256,
            },
        },
        repository,
    };
};

const ghVerifyArguments = ({ context, subject, trustedRoot }) => [
    'attestation',
    'verify',
    subject.candidatePath,
    '--repo', context.repository,
    '--bundle', context.attestation.bundle.name,
    '--predicate-type', context.policy.predicateType,
    '--signer-repo', context.repository,
    '--signer-workflow', `${context.repository}/${context.profile.workflow}`,
    '--source-digest', context.candidateSha,
    '--source-ref', context.policy.sourceRef,
    '--deny-self-hosted-runners',
    '--no-public-good',
    '--format', context.policy.ghCli.outputFormat,
    ...(trustedRoot ? ['--custom-trusted-root', trustedRoot] : []),
];

const ghRepositoryIdentityArguments = (context) => [
    'api',
    `repos/${context.repository}`,
    '--jq',
    '.id',
];

const buildVerificationPlan = (context) => ({
    schemaVersion: 1,
    status: 'ready-for-local-precheck-and-gh-cli-receipt',
    candidateSha: context.candidateSha,
    target: context.profile.target,
    provenanceRecord: {
        name: desktopArtifactProvenanceRecordFilename,
        sha256: context.recordFile.sha256,
    },
    attestation: context.attestation,
    subjects: context.subjects.map((subject) => ({
        attestedPath: subject.attestedPath,
        attestedName: subject.attestedName,
        candidatePath: subject.candidatePath,
        bytes: subject.bytes,
        sha256: subject.sha256,
    })),
    verification: {
        workingDirectory: 'candidate-artifact-root',
        repository: context.repository,
        signerRepository: context.repository,
        repositoryId: context.policy.repositoryId,
        signerWorkflow: `${context.repository}/${context.profile.workflow}`,
        repositoryIdentity: {
            executable: 'gh',
            arguments: ghRepositoryIdentityArguments(context),
            expectedRepositoryId: String(context.policy.repositoryId),
        },
        predicateType: context.policy.predicateType,
        sourceDigest: context.candidateSha,
        sourceRef: context.policy.sourceRef,
        denySelfHostedRunners: context.policy.ghCli.denySelfHostedRunners,
        noPublicGood: context.policy.ghCli.noPublicGood,
        online: {
            executable: 'gh',
            commands: context.subjects.map((subject) => ({
                artifact: subject.candidatePath,
                arguments: ghVerifyArguments({ context, subject }),
            })),
        },
        offline: {
            trustedRoot: {
                executable: 'gh',
                arguments: ['attestation', 'trusted-root'],
                output: 'trusted_root.jsonl',
                freshness: 'generate-immediately-before-verification',
            },
            commands: context.subjects.map((subject) => ({
                artifact: subject.candidatePath,
                arguments: ghVerifyArguments({ context, subject, trustedRoot: offlineTrustedRootPlaceholder }),
            })),
        },
    },
    receipt: {
        schemaVersion: context.policy.localReceipt.schemaVersion,
        filename: context.policy.localReceipt.filename,
        writeLocation: context.policy.localReceipt.writeLocation,
        atomicCreate: context.policy.localReceipt.atomicCreate,
        revalidation: context.policy.localReceipt.revalidation,
        status: context.policy.localReceipt.status,
    },
});

const verifyChecksums = async (context) => {
    const checksumFile = await resolveCandidateFile({
        candidateDirectory: context.candidateDirectory,
        relative: 'SHA256SUMS.txt',
        errorPrefix: 'desktop-artifact-provenance-verification-checksums',
        maximumBytes: maximumChecksumBytes,
    });
    const lines = (await readFile(checksumFile.absolute, 'utf8')).split('\n');
    const entries = new Map();
    for (const rawLine of lines) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (!line) continue;
        const match = line.match(/^([0-9a-f]{64}) {2}\*?(.+)$/u);
        if (!match) throw new Error('desktop-artifact-provenance-verification-checksums-format-invalid');
        const [, digest, relative] = match;
        const normalizedRelative = normalizeCandidateRelativePath(
            relative,
            'desktop-artifact-provenance-verification-checksums-path-invalid',
        );
        if (entries.has(normalizedRelative)) {
            throw new Error('desktop-artifact-provenance-verification-checksums-duplicate-entry');
        }
        entries.set(normalizedRelative, digest);
    }
    if (!entries.size) throw new Error('desktop-artifact-provenance-verification-checksums-empty');
    for (const [relative, digest] of entries) {
        const file = await resolveCandidateFile({
            candidateDirectory: context.candidateDirectory,
            relative,
            errorPrefix: 'desktop-artifact-provenance-verification-checksums-entry',
            maximumBytes: maximumSubjectBytes,
        });
        if (file.sha256 !== digest) {
            throw new Error('desktop-artifact-provenance-verification-checksums-hash-invalid');
        }
    }
    const required = [
        desktopArtifactProvenanceRecordFilename,
        desktopArtifactProvenanceBundleFilename,
        desktopArtifactProvenanceVerificationPlanFilename,
        ...context.subjects.map((subject) => subject.candidatePath),
    ];
    for (const relative of required) {
        if (!entries.has(relative)) {
            throw new Error('desktop-artifact-provenance-verification-checksums-required-entry-missing');
        }
    }
    const unlistedFiles = (await listCandidateRegularFiles(context.candidateDirectory)).filter((relative) => (
        relative !== 'SHA256SUMS.txt' && !entries.has(relative)
    ));
    if (unlistedFiles.length) {
        throw new Error('desktop-artifact-provenance-verification-checksums-unlisted-file');
    }
    return { checksumFile, entryCount: entries.size };
};

const contextFor = async ({ matrix, candidateDirectory, baseDirectory = process.cwd() } = {}) => {
    const base = await realpath(path.resolve(baseDirectory));
    const candidateDirectoryAbsolute = await resolveCandidateDirectory(base, candidateDirectory);
    return validateRecord({ matrix, candidateDirectory: candidateDirectoryAbsolute });
};

export const writeDesktopArtifactProvenanceVerificationPlan = async (options = {}) => {
    const context = await contextFor(options);
    const output = path.join(context.candidateDirectory, desktopArtifactProvenanceVerificationPlanFilename);
    await outputMissing(output);
    const plan = buildVerificationPlan(context);
    await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o644 });
    return { plan, output };
};

export const verifyDesktopArtifactProvenanceLocally = async (options = {}) => {
    const context = await contextFor(options);
    const { file: planFile, value: plan } = await readJsonCandidateFile({
        candidateDirectory: context.candidateDirectory,
        relative: desktopArtifactProvenanceVerificationPlanFilename,
        errorPrefix: 'desktop-artifact-provenance-verification-plan',
    });
    if (!sameJson(plan, buildVerificationPlan(context))) {
        throw new Error('desktop-artifact-provenance-verification-plan-invalid');
    }
    const checksums = await verifyChecksums(context);
    return {
        context,
        plan,
        planFile,
        checksumFile: checksums.checksumFile,
        checksumEntryCount: checksums.entryCount,
    };
};

const resolveExternalRegularFile = async (baseDirectory, value, errorPrefix) => {
    const requested = path.resolve(baseDirectory, String(value ?? ''));
    const entry = await readRegularFile(requested, errorPrefix, maximumMetadataBytes);
    const absolute = await realpath(requested);
    const resolvedEntry = await readRegularFile(absolute, errorPrefix, maximumMetadataBytes);
    return {
        absolute,
        name: path.basename(absolute),
        bytes: resolvedEntry.size,
        initialBytes: entry.size,
        sha256: await sha256(absolute),
    };
};

const resolveExternalRegularFileOutsideCandidate = async ({
    baseDirectory,
    candidateDirectory,
    value,
    errorPrefix,
}) => {
    const file = await resolveExternalRegularFile(baseDirectory, value, errorPrefix);
    if (file.absolute === candidateDirectory || isInside(candidateDirectory, file.absolute)) {
        throw new Error(`${errorPrefix}-inside-candidate-directory`);
    }
    return file;
};

const readExternalJsonFileOutsideCandidate = async ({
    baseDirectory,
    candidateDirectory,
    expectedFilename,
    value,
    errorPrefix,
}) => {
    const requested = path.resolve(baseDirectory, String(value ?? ''));
    if (requested === candidateDirectory || isInside(candidateDirectory, requested)) {
        throw new Error(`${errorPrefix}-inside-candidate-directory`);
    }
    if (expectedFilename
        && path.basename(requested) !== expectedFilename) {
        throw new Error(`${errorPrefix}-filename-invalid`);
    }
    const file = await resolveExternalRegularFileOutsideCandidate({
        baseDirectory,
        candidateDirectory,
        value,
        errorPrefix,
    });
    if (expectedFilename && file.name !== expectedFilename) {
        throw new Error(`${errorPrefix}-filename-invalid`);
    }
    let receipt;
    try {
        receipt = JSON.parse(await readFile(file.absolute, 'utf8'));
    } catch {
        throw new Error(`${errorPrefix}-json-invalid`);
    }
    return { file, receipt };
};

const resolveReceiptOutput = async ({ baseDirectory, candidateDirectory, receiptFilename, value }) => {
    if (!value) {
        throw new Error('desktop-artifact-provenance-verification-receipt-required');
    }
    const requested = path.resolve(baseDirectory, String(value ?? ''));
    if (path.basename(requested) !== receiptFilename) {
        throw new Error('desktop-artifact-provenance-verification-receipt-filename-invalid');
    }
    if (isInside(candidateDirectory, requested) || requested === candidateDirectory) {
        throw new Error('desktop-artifact-provenance-verification-receipt-inside-candidate-directory');
    }
    const parent = path.dirname(requested);
    let parentEntry;
    try {
        parentEntry = await lstat(parent);
    } catch {
        throw new Error('desktop-artifact-provenance-verification-receipt-directory-missing');
    }
    if (parentEntry.isSymbolicLink() || !parentEntry.isDirectory()) {
        throw new Error('desktop-artifact-provenance-verification-receipt-directory-invalid');
    }
    const canonicalParent = await realpath(parent);
    const output = path.join(canonicalParent, path.basename(requested));
    if (isInside(candidateDirectory, output) || output === candidateDirectory) {
        throw new Error('desktop-artifact-provenance-verification-receipt-inside-candidate-directory');
    }
    await outputMissing(output);
    return output;
};

const receiptVerification = (plan) => ({
    repository: plan.verification.repository,
    signerRepository: plan.verification.signerRepository,
    repositoryId: plan.verification.repositoryId,
    signerWorkflow: plan.verification.signerWorkflow,
    predicateType: plan.verification.predicateType,
    sourceDigest: plan.verification.sourceDigest,
    sourceRef: plan.verification.sourceRef,
    denySelfHostedRunners: plan.verification.denySelfHostedRunners,
    noPublicGood: plan.verification.noPublicGood,
});

const isCanonicalIsoDate = (value) => {
    if (typeof value !== 'string' || value.length > 64) return false;
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
};

const validateReceipt = ({ receipt, local, trustedRoot }) => {
    const expectedMode = trustedRoot ? 'offline-custom-trusted-root' : 'online';
    const commonKeys = [
        'schemaVersion',
        'status',
        'verifiedAt',
        'mode',
        'candidateSha',
        'target',
        'verificationPlan',
        'attestation',
        'verification',
        'subjects',
        'candidateArtifactMutated',
        'candidateArtifactRevalidated',
    ];
    const expectedKeys = trustedRoot ? [...commonKeys, 'trustedRoot'] : commonKeys;
    if (!hasExactKeys(receipt, expectedKeys)) {
        throw new Error('desktop-artifact-provenance-verification-receipt-shape-invalid');
    }
    if (receipt.schemaVersion !== local.context.policy.localReceipt.schemaVersion
        || receipt.status !== 'gh-attestation-verify-passed') {
        throw new Error('desktop-artifact-provenance-verification-receipt-status-invalid');
    }
    if (!isCanonicalIsoDate(receipt.verifiedAt)) {
        throw new Error('desktop-artifact-provenance-verification-receipt-verified-at-invalid');
    }
    if (receipt.mode !== expectedMode) {
        throw new Error('desktop-artifact-provenance-verification-receipt-mode-invalid');
    }
    if (receipt.candidateSha !== local.context.candidateSha
        || receipt.target !== local.context.profile.target) {
        throw new Error('desktop-artifact-provenance-verification-receipt-candidate-invalid');
    }
    if (!hasExactKeys(receipt.verificationPlan, ['name', 'sha256'])
        || receipt.verificationPlan.name !== desktopArtifactProvenanceVerificationPlanFilename
        || receipt.verificationPlan.sha256 !== local.planFile.sha256) {
        throw new Error('desktop-artifact-provenance-verification-receipt-plan-invalid');
    }
    if (!sameJson(receipt.attestation, local.context.attestation)) {
        throw new Error('desktop-artifact-provenance-verification-receipt-attestation-invalid');
    }
    if (!sameJson(receipt.verification, receiptVerification(local.plan))) {
        throw new Error('desktop-artifact-provenance-verification-receipt-verification-invalid');
    }
    if (!Array.isArray(receipt.subjects) || receipt.subjects.length !== local.context.subjects.length) {
        throw new Error('desktop-artifact-provenance-verification-receipt-subject-set-invalid');
    }
    for (let index = 0; index < local.context.subjects.length; index += 1) {
        const subject = local.context.subjects[index];
        const result = receipt.subjects[index];
        if (!hasExactKeys(result, [
            'attestedPath',
            'attestedName',
            'candidatePath',
            'sha256',
            'outputSha256',
            'verifiedAttestationCount',
        ])
            || result.attestedPath !== subject.attestedPath
            || result.attestedName !== subject.attestedName
            || result.candidatePath !== subject.candidatePath
            || result.sha256 !== subject.sha256
            || !sha256Pattern.test(result.outputSha256)
            || !Number.isSafeInteger(result.verifiedAttestationCount)
            || result.verifiedAttestationCount < 1
            || result.verifiedAttestationCount > maximumReceiptSubjectVerificationCount) {
            throw new Error('desktop-artifact-provenance-verification-receipt-subject-invalid');
        }
    }
    if (receipt.candidateArtifactMutated !== false || receipt.candidateArtifactRevalidated !== true) {
        throw new Error('desktop-artifact-provenance-verification-receipt-revalidation-invalid');
    }
    if (trustedRoot) {
        if (!hasExactKeys(receipt.trustedRoot, ['name', 'bytes', 'sha256', 'freshness'])
            || receipt.trustedRoot.name !== trustedRoot.name
            || receipt.trustedRoot.bytes !== trustedRoot.bytes
            || receipt.trustedRoot.sha256 !== trustedRoot.sha256
            || receipt.trustedRoot.freshness !== local.plan.verification.offline.trustedRoot.freshness) {
            throw new Error('desktop-artifact-provenance-verification-receipt-trusted-root-invalid');
        }
    }
};

export const verifyDesktopArtifactProvenanceReceiptLocally = async ({
    matrix,
    candidateDirectory,
    receipt,
    offlineTrustedRoot,
    baseDirectory = process.cwd(),
} = {}) => {
    if (!receipt) {
        throw new Error('desktop-artifact-provenance-verification-receipt-required');
    }
    const base = await realpath(path.resolve(baseDirectory));
    const local = await verifyDesktopArtifactProvenanceLocally({
        matrix,
        candidateDirectory,
        baseDirectory: base,
    });
    const receiptFile = await readExternalJsonFileOutsideCandidate({
        baseDirectory: base,
        candidateDirectory: local.context.candidateDirectory,
        expectedFilename: local.context.policy.localReceipt.filename,
        value: receipt,
        errorPrefix: 'desktop-artifact-provenance-verification-receipt',
    });
    if (receiptFile.receipt?.mode !== 'online'
        && receiptFile.receipt?.mode !== 'offline-custom-trusted-root') {
        throw new Error('desktop-artifact-provenance-verification-receipt-mode-invalid');
    }
    if (receiptFile.receipt.mode === 'offline-custom-trusted-root' && !offlineTrustedRoot) {
        throw new Error('desktop-artifact-provenance-verification-option-required:offline-trusted-root');
    }
    if (receiptFile.receipt.mode === 'online' && offlineTrustedRoot) {
        throw new Error('desktop-artifact-provenance-verification-option-invalid-for-mode');
    }
    const trustedRoot = receiptFile.receipt.mode === 'offline-custom-trusted-root'
        ? await resolveExternalRegularFileOutsideCandidate({
            baseDirectory: base,
            candidateDirectory: local.context.candidateDirectory,
            value: offlineTrustedRoot,
            errorPrefix: 'desktop-artifact-provenance-verification-trusted-root',
        })
        : undefined;
    if (trustedRoot?.absolute === receiptFile.file.absolute) {
        throw new Error('desktop-artifact-provenance-verification-trusted-root-receipt-overlap');
    }
    validateReceipt({ receipt: receiptFile.receipt, local, trustedRoot });
    return {
        ...local,
        receipt: receiptFile.receipt,
        receiptFile: receiptFile.file,
        trustedRoot,
    };
};

const candidateSnapshotMatches = (initial, revalidated) => (
    sameJson(initial.plan, revalidated.plan)
    && initial.planFile.sha256 === revalidated.planFile.sha256
    && initial.checksumFile.sha256 === revalidated.checksumFile.sha256
);

const writeReceipt = async (output, value) => {
    try {
        await writeFile(output, `${JSON.stringify(value, null, 2)}\n`, {
            mode: 0o644,
            flag: 'wx',
        });
    } catch (error) {
        if (error?.code === 'EEXIST') {
            throw new Error('desktop-artifact-provenance-verification-output-already-exists');
        }
        throw error;
    }
};

const defaultGhRunner = ({ argumentsList, cwd }) => new Promise((resolve, reject) => {
    const child = spawn('gh', argumentsList, {
        cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = [];
    const errors = [];
    let outputBytes = 0;
    let outputExceeded = false;
    const collect = (destination) => (chunk) => {
        if (outputExceeded) return;
        outputBytes += chunk.length;
        if (outputBytes > maximumGhOutputBytes) {
            outputExceeded = true;
            child.kill();
            return;
        }
        destination.push(chunk);
    };
    child.stdout.on('data', collect(output));
    child.stderr.on('data', collect(errors));
    child.once('error', reject);
    child.once('close', (exitCode) => {
        if (outputExceeded) {
            reject(new Error('desktop-artifact-provenance-verification-gh-output-too-large'));
            return;
        }
        resolve({
            exitCode,
            stdout: Buffer.concat(output).toString('utf8'),
            stderr: Buffer.concat(errors).toString('utf8'),
        });
    });
});

const parseGhVerificationOutput = ({ stdout, subject, predicateType }) => {
    let entries;
    try {
        entries = JSON.parse(stdout);
    } catch {
        throw new Error('desktop-artifact-provenance-verification-gh-output-json-invalid');
    }
    if (!Array.isArray(entries) || !entries.length) {
        throw new Error('desktop-artifact-provenance-verification-gh-output-invalid');
    }
    const hasSubject = entries.some((entry) => {
        const statement = entry?.verificationResult?.statement;
        if (statement?.predicateType !== predicateType || !Array.isArray(statement.subject)) return false;
        return statement.subject.some((candidate) => (
            candidate?.name === subject.attestedName
            && String(candidate?.digest?.sha256 ?? '').toLowerCase() === subject.sha256
        ));
    });
    if (!hasSubject) {
        throw new Error('desktop-artifact-provenance-verification-gh-output-subject-invalid');
    }
    return entries.length;
};

export const executeDesktopArtifactProvenanceVerification = async ({
    matrix,
    candidateDirectory,
    receipt,
    offlineTrustedRoot,
    baseDirectory = process.cwd(),
    runGh = defaultGhRunner,
    now = () => new Date(),
} = {}) => {
    const base = await realpath(path.resolve(baseDirectory));
    const candidateDirectoryAbsolute = await resolveCandidateDirectory(base, candidateDirectory);
    const trustedRoot = offlineTrustedRoot
        ? await resolveExternalRegularFile(base, offlineTrustedRoot, 'desktop-artifact-provenance-verification-trusted-root')
        : undefined;
    if (trustedRoot && (trustedRoot.absolute === candidateDirectoryAbsolute
        || isInside(candidateDirectoryAbsolute, trustedRoot.absolute))) {
        throw new Error('desktop-artifact-provenance-verification-trusted-root-inside-candidate-directory');
    }
    const local = await verifyDesktopArtifactProvenanceLocally({
        matrix,
        candidateDirectory,
        baseDirectory: base,
    });
    const receiptOutput = await resolveReceiptOutput({
        baseDirectory: base,
        candidateDirectory: local.context.candidateDirectory,
        receiptFilename: local.context.policy.localReceipt.filename,
        value: receipt,
    });
    const repositoryIdentity = await runGh({
        argumentsList: local.plan.verification.repositoryIdentity.arguments,
        cwd: local.context.candidateDirectory,
    });
    if (repositoryIdentity?.exitCode !== 0
        || String(repositoryIdentity?.stdout ?? '').trim() !== String(local.context.policy.repositoryId)) {
        throw new Error('desktop-artifact-provenance-verification-repository-identity-invalid');
    }
    const commands = trustedRoot
        ? local.context.subjects.map((subject) => ({
            arguments: ghVerifyArguments({ context: local.context, subject, trustedRoot: trustedRoot.absolute }),
        }))
        : local.plan.verification.online.commands;
    const subjectResults = [];
    for (let index = 0; index < commands.length; index += 1) {
        const command = commands[index];
        const subject = local.context.subjects[index];
        const result = await runGh({
            argumentsList: command.arguments,
            cwd: local.context.candidateDirectory,
        });
        if (result?.exitCode !== 0) {
            throw new Error('desktop-artifact-provenance-verification-gh-failed');
        }
        const stdout = String(result?.stdout ?? '');
        subjectResults.push({
            attestedPath: subject.attestedPath,
            attestedName: subject.attestedName,
            candidatePath: subject.candidatePath,
            sha256: subject.sha256,
            outputSha256: createHash('sha256').update(stdout).digest('hex'),
            verifiedAttestationCount: parseGhVerificationOutput({
                stdout,
                subject,
                predicateType: local.plan.verification.predicateType,
            }),
        });
    }
    const revalidated = await verifyDesktopArtifactProvenanceLocally({
        matrix,
        candidateDirectory,
        baseDirectory: base,
    });
    if (!candidateSnapshotMatches(local, revalidated)) {
        throw new Error('desktop-artifact-provenance-verification-candidate-mutated-during-gh-verification');
    }
    const revalidatedTrustedRoot = trustedRoot
        ? await resolveExternalRegularFileOutsideCandidate({
            baseDirectory: base,
            candidateDirectory: revalidated.context.candidateDirectory,
            value: trustedRoot.absolute,
            errorPrefix: 'desktop-artifact-provenance-verification-trusted-root',
        })
        : undefined;
    if (trustedRoot && (!revalidatedTrustedRoot
        || trustedRoot.name !== revalidatedTrustedRoot.name
        || trustedRoot.bytes !== revalidatedTrustedRoot.bytes
        || trustedRoot.sha256 !== revalidatedTrustedRoot.sha256)) {
        throw new Error('desktop-artifact-provenance-verification-trusted-root-mutated-during-gh-verification');
    }
    const verifiedAt = now();
    if (!(verifiedAt instanceof Date) || Number.isNaN(verifiedAt.getTime())) {
        throw new Error('desktop-artifact-provenance-verification-clock-invalid');
    }
    const receiptValue = {
        schemaVersion: revalidated.context.policy.localReceipt.schemaVersion,
        status: 'gh-attestation-verify-passed',
        verifiedAt: verifiedAt.toISOString(),
        mode: trustedRoot ? 'offline-custom-trusted-root' : 'online',
        candidateSha: revalidated.context.candidateSha,
        target: revalidated.context.profile.target,
        verificationPlan: {
            name: desktopArtifactProvenanceVerificationPlanFilename,
            sha256: revalidated.planFile.sha256,
        },
        attestation: revalidated.context.attestation,
        verification: receiptVerification(revalidated.plan),
        ...(revalidatedTrustedRoot ? {
            trustedRoot: {
                name: revalidatedTrustedRoot.name,
                bytes: revalidatedTrustedRoot.bytes,
                sha256: revalidatedTrustedRoot.sha256,
                freshness: revalidated.plan.verification.offline.trustedRoot.freshness,
            },
        } : {}),
        subjects: subjectResults,
        candidateArtifactMutated: false,
        candidateArtifactRevalidated: true,
    };
    await writeReceipt(receiptOutput, receiptValue);
    return { receipt: receiptValue, output: receiptOutput };
};

const readOption = (argumentsList, index, option) => {
    const value = argumentsList[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`desktop-artifact-provenance-verification-option-value-required:${option}`);
    }
    return value;
};

export const parseDesktopArtifactProvenanceVerificationArguments = (argumentsList) => {
    const options = {};
    const seenOptions = new Set();
    for (let index = 0; index < argumentsList.length; index += 1) {
        const option = argumentsList[index];
        if (seenOptions.has(option)) {
            throw new Error(`desktop-artifact-provenance-verification-option-duplicate:${option}`);
        }
        seenOptions.add(option);
        switch (option) {
        case '--candidate-dir':
            options.candidateDirectory = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--base-directory':
            options.baseDirectory = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--receipt':
            options.receipt = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--offline-trusted-root':
            options.offlineTrustedRoot = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--write-plan':
            options.mode = options.mode || 'write-plan';
            if (options.mode !== 'write-plan') {
                throw new Error('desktop-artifact-provenance-verification-option-mode-conflict');
            }
            break;
        case '--verify-local':
            options.mode = options.mode || 'verify-local';
            if (options.mode !== 'verify-local') {
                throw new Error('desktop-artifact-provenance-verification-option-mode-conflict');
            }
            break;
        case '--verify-receipt':
            options.mode = options.mode || 'verify-receipt';
            if (options.mode !== 'verify-receipt') {
                throw new Error('desktop-artifact-provenance-verification-option-mode-conflict');
            }
            break;
        case '--execute-gh':
            options.mode = options.mode || 'execute-gh';
            if (options.mode !== 'execute-gh') {
                throw new Error('desktop-artifact-provenance-verification-option-mode-conflict');
            }
            break;
        default:
            throw new Error(`desktop-artifact-provenance-verification-option-unsupported:${option}`);
        }
    }
    if (!options.candidateDirectory) {
        throw new Error('desktop-artifact-provenance-verification-option-required:candidate-dir');
    }
    if (!options.mode) {
        throw new Error('desktop-artifact-provenance-verification-option-required:mode');
    }
    if ((options.mode === 'execute-gh' || options.mode === 'verify-receipt') && !options.receipt) {
        throw new Error('desktop-artifact-provenance-verification-option-required:receipt');
    }
    if (options.mode !== 'execute-gh' && options.mode !== 'verify-receipt'
        && (options.receipt || options.offlineTrustedRoot)) {
        throw new Error('desktop-artifact-provenance-verification-option-invalid-for-mode');
    }
    return options;
};

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const options = parseDesktopArtifactProvenanceVerificationArguments(process.argv.slice(2));
    const matrix = JSON.parse(await readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8'));
    const result = options.mode === 'write-plan'
        ? await writeDesktopArtifactProvenanceVerificationPlan({ matrix, ...options })
        : options.mode === 'verify-local'
            ? await verifyDesktopArtifactProvenanceLocally({ matrix, ...options })
            : options.mode === 'verify-receipt'
                ? await verifyDesktopArtifactProvenanceReceiptLocally({ matrix, ...options })
                : await executeDesktopArtifactProvenanceVerification({ matrix, ...options });
    const output = options.mode === 'verify-local'
        ? {
            status: 'passed',
            mode: options.mode,
            target: result.context.profile.target,
            candidateSha: result.context.candidateSha,
            checksumEntryCount: result.checksumEntryCount,
        }
        : options.mode === 'verify-receipt'
            ? {
                status: 'passed',
                mode: options.mode,
                receiptSha256: result.receiptFile.sha256,
                target: result.context.profile.target,
                candidateSha: result.context.candidateSha,
                checksumEntryCount: result.checksumEntryCount,
            }
            : {
            status: 'passed',
            mode: options.mode,
            output: path.relative(process.cwd(), result.output),
            target: options.mode === 'write-plan' ? result.plan.target : result.receipt.target,
            candidateSha: options.mode === 'write-plan' ? result.plan.candidateSha : result.receipt.candidateSha,
            };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
