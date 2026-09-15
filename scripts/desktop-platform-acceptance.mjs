import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
    desktopArtifactProvenanceVerificationReceiptFilename,
    verifyDesktopArtifactProvenanceReceiptLocally,
} from './desktop-artifact-provenance-verification.mjs';

export const desktopPlatformAcceptancePlanFilename = 'platform-acceptance-plan.json';
export const desktopPlatformAcceptanceRecordFilename = 'platform-acceptance-record.json';

const linuxManualChecks = Object.freeze([
    'native-picker-visual',
    'tray-visual',
    'multi-monitor-dpi-negative-coordinates',
    'wayland-portal',
    'remote-desktop',
    'no-display',
    'install-upgrade-uninstall-local-data',
]);
const macosManualChecks = Object.freeze([
    'native-picker-visual',
    'tray-visual',
    'multi-monitor-dpi-negative-coordinates',
    'screen-recording-permission-prompt',
    'remote-desktop',
    'no-display',
    'install-upgrade-uninstall-local-data',
]);
const windowsManualChecks = Object.freeze([
    'native-picker-visual',
    'tray-visual',
    'multi-monitor-dpi-negative-coordinates',
    'screen-capture-permission-policy',
    'remote-desktop',
    'no-display',
    'install-upgrade-uninstall-local-data',
]);

const manualProfiles = Object.freeze({
    'linux-deb-repository': Object.freeze({
        platform: 'linux',
        targetIds: ['linux-x64', 'linux-arm64'],
        architectures: ['x64', 'arm64'],
        manualChecks: linuxManualChecks,
    }),
    'macos-arm64': Object.freeze({
        platform: 'macos',
        targetIds: ['macos-arm64'],
        architectures: ['arm64'],
        manualChecks: macosManualChecks,
    }),
    'macos-x64': Object.freeze({
        platform: 'macos',
        targetIds: ['macos-x64'],
        architectures: ['x64'],
        manualChecks: macosManualChecks,
    }),
    'windows-arm64': Object.freeze({
        platform: 'windows',
        targetIds: ['windows-arm64'],
        architectures: ['arm64'],
        manualChecks: windowsManualChecks,
    }),
    'windows-x64': Object.freeze({
        platform: 'windows',
        targetIds: ['windows-x64'],
        architectures: ['x64'],
        manualChecks: windowsManualChecks,
    }),
});

export const expectedDesktopPlatformAcceptance = Object.freeze({
    status: 'candidate-receipt-bound-manual-platform-acceptance-ready-not-run',
    candidateReceipt: {
        filename: desktopArtifactProvenanceVerificationReceiptFilename,
        revalidation: 'required-before-plan-and-record-verification',
    },
    plan: {
        schemaVersion: 1,
        filename: desktopPlatformAcceptancePlanFilename,
        writeLocation: 'outside-candidate-directory',
        atomicCreate: 'outside-candidate-directory-no-overwrite',
    },
    record: {
        schemaVersion: 1,
        filename: desktopPlatformAcceptanceRecordFilename,
        writeLocation: 'outside-candidate-directory',
        evidenceDirectory: 'outside-candidate-directory',
        evidence: 'regular-file-sha256-and-media-type-required-for-passed-check',
        statuses: ['passed', 'failed', 'not-run'],
        result: 'does-not-change-release-ready',
    },
    publicRelease: false,
});

const maximumMetadataBytes = 16 * 1024 * 1024;
const maximumEvidenceBytes = 1024 * 1024 * 1024;
const maximumEvidencePerCheck = 32;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const canonicalDateLength = 64;
const evidenceMediaTypes = new Map([
    ['.jpeg', 'image/jpeg'],
    ['.jpg', 'image/jpeg'],
    ['.json', 'application/json'],
    ['.log', 'text/plain'],
    ['.mov', 'video/quicktime'],
    ['.mp4', 'video/mp4'],
    ['.pdf', 'application/pdf'],
    ['.png', 'image/png'],
    ['.txt', 'text/plain'],
    ['.webp', 'image/webp'],
]);

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const hasExactKeys = (value, keys) => (
    Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && sameJson(Object.keys(value).sort(), [...keys].sort())
);
const hasExactValues = (actual, expected) => (
    Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index])
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

const normalizeRelativePath = (value, error) => {
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

const isCanonicalIsoDate = (value) => {
    if (typeof value !== 'string' || value.length > canonicalDateLength) return false;
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
};

const isSafeSummary = (value) => (
    typeof value === 'string'
    && value.length > 0
    && value.length <= 160
    && !/[\0\r\n]/u.test(value)
);

const expectedPolicy = (matrix) => {
    if (matrix?.schemaVersion !== 24) {
        throw new Error('desktop-platform-acceptance-schema-invalid');
    }
    if (!sameJson(matrix?.desktopPlatformAcceptance, expectedDesktopPlatformAcceptance)) {
        throw new Error('desktop-platform-acceptance-policy-invalid');
    }
    return matrix.desktopPlatformAcceptance;
};

const resolveExternalDirectoryOutsideCandidate = async ({
    baseDirectory,
    candidateDirectory,
    value,
    errorPrefix,
}) => {
    const requested = path.resolve(baseDirectory, String(value ?? ''));
    if (requested === candidateDirectory || isInside(candidateDirectory, requested)) {
        throw new Error(`${errorPrefix}-inside-candidate-directory`);
    }
    let entry;
    try {
        entry = await lstat(requested);
    } catch {
        throw new Error(`${errorPrefix}-missing`);
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error(`${errorPrefix}-invalid`);
    }
    const absolute = await realpath(requested);
    if (absolute === candidateDirectory || isInside(candidateDirectory, absolute)) {
        throw new Error(`${errorPrefix}-inside-candidate-directory`);
    }
    return absolute;
};

const resolveExternalRegularFileOutsideCandidate = async ({
    baseDirectory,
    candidateDirectory,
    value,
    errorPrefix,
    maximumBytes = maximumMetadataBytes,
}) => {
    const requested = path.resolve(baseDirectory, String(value ?? ''));
    if (requested === candidateDirectory || isInside(candidateDirectory, requested)) {
        throw new Error(`${errorPrefix}-inside-candidate-directory`);
    }
    const initial = await readRegularFile(requested, errorPrefix, maximumBytes);
    const absolute = await realpath(requested);
    if (absolute === candidateDirectory || isInside(candidateDirectory, absolute)) {
        throw new Error(`${errorPrefix}-inside-candidate-directory`);
    }
    const entry = await readRegularFile(absolute, errorPrefix, maximumBytes);
    return {
        absolute,
        name: path.basename(absolute),
        bytes: entry.size,
        initialBytes: initial.size,
        sha256: await sha256(absolute),
    };
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
    if (path.basename(requested) !== expectedFilename) {
        throw new Error(`${errorPrefix}-filename-invalid`);
    }
    const file = await resolveExternalRegularFileOutsideCandidate({
        baseDirectory,
        candidateDirectory,
        value,
        errorPrefix,
    });
    if (file.name !== expectedFilename) {
        throw new Error(`${errorPrefix}-filename-invalid`);
    }
    let json;
    try {
        json = JSON.parse(await readFile(file.absolute, 'utf8'));
    } catch {
        throw new Error(`${errorPrefix}-json-invalid`);
    }
    return { file, json };
};

const outputMissing = async (absolute) => {
    try {
        await lstat(absolute);
    } catch (error) {
        if (error?.code === 'ENOENT') return;
        throw error;
    }
    throw new Error('desktop-platform-acceptance-output-already-exists');
};

const resolveExternalOutput = async ({
    baseDirectory,
    candidateDirectory,
    expectedFilename,
    value,
    errorPrefix,
}) => {
    if (!value) {
        throw new Error(`${errorPrefix}-required`);
    }
    const requested = path.resolve(baseDirectory, String(value));
    if (path.basename(requested) !== expectedFilename) {
        throw new Error(`${errorPrefix}-filename-invalid`);
    }
    if (requested === candidateDirectory || isInside(candidateDirectory, requested)) {
        throw new Error(`${errorPrefix}-inside-candidate-directory`);
    }
    const parent = path.dirname(requested);
    let parentEntry;
    try {
        parentEntry = await lstat(parent);
    } catch {
        throw new Error(`${errorPrefix}-directory-missing`);
    }
    if (parentEntry.isSymbolicLink() || !parentEntry.isDirectory()) {
        throw new Error(`${errorPrefix}-directory-invalid`);
    }
    const canonicalParent = await realpath(parent);
    const output = path.join(canonicalParent, expectedFilename);
    if (output === candidateDirectory || isInside(candidateDirectory, output)) {
        throw new Error(`${errorPrefix}-inside-candidate-directory`);
    }
    await outputMissing(output);
    return output;
};

const writeNewJsonFile = async (output, value) => {
    try {
        await writeFile(output, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644, flag: 'wx' });
    } catch (error) {
        if (error?.code === 'EEXIST') {
            throw new Error('desktop-platform-acceptance-output-already-exists');
        }
        throw error;
    }
};

const manualTargetsFor = ({ matrix, candidate }) => {
    const profile = manualProfiles[candidate.context.profile.target];
    if (!profile) {
        throw new Error('desktop-platform-acceptance-target-invalid');
    }
    const targets = profile.targetIds.map((id) => matrix?.targets?.find((target) => target?.id === id));
    if (targets.some((target, index) => !target
        || target.platform !== profile.platform
        || target.arch !== profile.architectures[index]
        || !hasExactValues(target.manualChecks, profile.manualChecks))) {
        throw new Error('desktop-platform-acceptance-target-policy-invalid');
    }
    return targets;
};

const contextFor = async ({
    matrix,
    candidateDirectory,
    receipt,
    offlineTrustedRoot,
    baseDirectory = process.cwd(),
} = {}) => {
    const base = await realpath(path.resolve(baseDirectory));
    const policy = expectedPolicy(matrix);
    const candidate = await verifyDesktopArtifactProvenanceReceiptLocally({
        matrix,
        candidateDirectory,
        receipt,
        offlineTrustedRoot,
        baseDirectory: base,
    });
    const targets = manualTargetsFor({ matrix, candidate });
    return { base, policy, candidate, targets };
};

const candidateReceiptBinding = (candidate) => ({
    name: desktopArtifactProvenanceVerificationReceiptFilename,
    sha256: candidate.receiptFile.sha256,
});

const buildPlan = (context) => ({
    schemaVersion: context.policy.plan.schemaVersion,
    status: 'ready-for-manual-platform-acceptance',
    candidateSha: context.candidate.context.candidateSha,
    target: context.candidate.context.profile.target,
    candidateReceipt: candidateReceiptBinding(context.candidate),
    targets: context.targets.map((target) => ({
        id: target.id,
        platform: target.platform,
        arch: target.arch,
    })),
    checks: context.targets.flatMap((target) => target.manualChecks.map((id) => ({
        target: target.id,
        id,
        status: 'required-manual-evidence',
    }))),
    record: {
        schemaVersion: context.policy.record.schemaVersion,
        filename: context.policy.record.filename,
        evidenceDirectory: context.policy.record.evidenceDirectory,
        evidence: context.policy.record.evidence,
        statuses: context.policy.record.statuses,
        result: context.policy.record.result,
    },
});

const buildRecordTemplate = ({ context, plan, testedAt }) => ({
    schemaVersion: context.policy.record.schemaVersion,
    status: 'manual-platform-acceptance-recorded',
    testedAt,
    candidateSha: context.candidate.context.candidateSha,
    target: context.candidate.context.profile.target,
    plan: {
        name: context.policy.plan.filename,
        sha256: plan.file.sha256,
    },
    candidateReceipt: candidateReceiptBinding(context.candidate),
    environments: context.targets.map((target) => ({
        target: target.id,
        system: 'not-recorded',
        hardware: 'not-recorded',
    })),
    checks: plan.json.checks.map((check) => ({
        target: check.target,
        id: check.id,
        status: 'not-run',
        reason: 'Manual platform acceptance has not been completed.',
        evidence: [],
    })),
});

const readPlan = async ({ context, value }) => {
    const plan = await readExternalJsonFileOutsideCandidate({
        baseDirectory: context.base,
        candidateDirectory: context.candidate.context.candidateDirectory,
        expectedFilename: context.policy.plan.filename,
        value,
        errorPrefix: 'desktop-platform-acceptance-plan',
    });
    if (!sameJson(plan.json, buildPlan(context))) {
        throw new Error('desktop-platform-acceptance-plan-invalid');
    }
    return plan;
};

const mediaTypeFor = (relative) => evidenceMediaTypes.get(path.posix.extname(relative).toLowerCase());

const verifyEvidence = async ({ evidenceDirectory, forbiddenFiles, value }) => {
    if (!hasExactKeys(value, ['file', 'mediaType', 'bytes', 'sha256'])
        || !Number.isSafeInteger(value.bytes)
        || value.bytes <= 0
        || !sha256Pattern.test(value.sha256)) {
        throw new Error('desktop-platform-acceptance-record-evidence-invalid');
    }
    const relative = normalizeRelativePath(
        value.file,
        'desktop-platform-acceptance-record-evidence-path-invalid',
    );
    const expectedMediaType = mediaTypeFor(relative);
    if (!expectedMediaType || value.mediaType !== expectedMediaType) {
        throw new Error('desktop-platform-acceptance-record-evidence-media-type-invalid');
    }
    const requested = path.resolve(evidenceDirectory, ...relative.split('/'));
    const initial = await readRegularFile(
        requested,
        'desktop-platform-acceptance-record-evidence',
        maximumEvidenceBytes,
    );
    const absolute = await realpath(requested);
    if (!isInside(evidenceDirectory, absolute)) {
        throw new Error('desktop-platform-acceptance-record-evidence-outside-directory');
    }
    if (forbiddenFiles.includes(absolute)) {
        throw new Error('desktop-platform-acceptance-record-evidence-control-file');
    }
    const entry = await readRegularFile(
        absolute,
        'desktop-platform-acceptance-record-evidence',
        maximumEvidenceBytes,
    );
    const digest = await sha256(absolute);
    if (entry.size !== value.bytes || digest !== value.sha256 || initial.size !== entry.size) {
        throw new Error('desktop-platform-acceptance-record-evidence-hash-invalid');
    }
    return { relative, bytes: entry.size, sha256: digest, mediaType: expectedMediaType };
};

const validateRecord = async ({ context, plan, record, evidenceDirectory, forbiddenFiles }) => {
    if (!hasExactKeys(record, [
        'schemaVersion',
        'status',
        'testedAt',
        'candidateSha',
        'target',
        'plan',
        'candidateReceipt',
        'environments',
        'checks',
    ])
        || record.schemaVersion !== context.policy.record.schemaVersion
        || record.status !== 'manual-platform-acceptance-recorded'
        || !isCanonicalIsoDate(record.testedAt)
        || record.candidateSha !== context.candidate.context.candidateSha
        || record.target !== context.candidate.context.profile.target
        || !hasExactKeys(record.plan, ['name', 'sha256'])
        || record.plan.name !== context.policy.plan.filename
        || record.plan.sha256 !== plan.file.sha256
        || !sameJson(record.candidateReceipt, candidateReceiptBinding(context.candidate))) {
        throw new Error('desktop-platform-acceptance-record-invalid');
    }
    if (!Array.isArray(record.environments) || record.environments.length !== context.targets.length) {
        throw new Error('desktop-platform-acceptance-record-environment-set-invalid');
    }
    for (let index = 0; index < context.targets.length; index += 1) {
        const target = context.targets[index];
        const environment = record.environments[index];
        if (!hasExactKeys(environment, ['target', 'system', 'hardware'])
            || environment.target !== target.id
            || !isSafeSummary(environment.system)
            || !isSafeSummary(environment.hardware)) {
            throw new Error('desktop-platform-acceptance-record-environment-invalid');
        }
    }
    if (!Array.isArray(record.checks) || record.checks.length !== plan.json.checks.length) {
        throw new Error('desktop-platform-acceptance-record-check-set-invalid');
    }
    const evidence = [];
    let acceptanceComplete = true;
    for (let index = 0; index < plan.json.checks.length; index += 1) {
        const expected = plan.json.checks[index];
        const check = record.checks[index];
        if (!check || check.target !== expected.target || check.id !== expected.id
            || !context.policy.record.statuses.includes(check.status)) {
            throw new Error('desktop-platform-acceptance-record-check-invalid');
        }
        const expectedKeys = check.status === 'passed'
            ? ['target', 'id', 'status', 'evidence']
            : ['target', 'id', 'status', 'reason', 'evidence'];
        if (!hasExactKeys(check, expectedKeys) || !Array.isArray(check.evidence)
            || check.evidence.length > maximumEvidencePerCheck
            || (check.status === 'passed' && !check.evidence.length)
            || (check.status !== 'passed' && !isSafeSummary(check.reason))) {
            throw new Error('desktop-platform-acceptance-record-check-invalid');
        }
        if (check.status !== 'passed') acceptanceComplete = false;
        for (const item of check.evidence) {
            evidence.push(await verifyEvidence({ evidenceDirectory, forbiddenFiles, value: item }));
        }
    }
    return { acceptanceComplete, evidence };
};

const candidateBindingMatches = (left, right) => (
    left.candidate.receiptFile.sha256 === right.candidate.receiptFile.sha256
    && left.candidate.planFile.sha256 === right.candidate.planFile.sha256
    && left.candidate.checksumFile.sha256 === right.candidate.checksumFile.sha256
    && sameJson(left.candidate.plan, right.candidate.plan)
    && (!left.candidate.trustedRoot || (
        right.candidate.trustedRoot
        && left.candidate.trustedRoot.sha256 === right.candidate.trustedRoot.sha256
        && left.candidate.trustedRoot.bytes === right.candidate.trustedRoot.bytes
    ))
);

export const writeDesktopPlatformAcceptancePlan = async (options = {}) => {
    const context = await contextFor(options);
    const output = await resolveExternalOutput({
        baseDirectory: context.base,
        candidateDirectory: context.candidate.context.candidateDirectory,
        expectedFilename: context.policy.plan.filename,
        value: options.plan,
        errorPrefix: 'desktop-platform-acceptance-plan',
    });
    const revalidated = await contextFor({ ...options, baseDirectory: context.base });
    if (!candidateBindingMatches(context, revalidated)) {
        throw new Error('desktop-platform-acceptance-candidate-mutated-during-plan-write');
    }
    const plan = buildPlan(revalidated);
    await writeNewJsonFile(output, plan);
    return { context: revalidated, plan, output };
};

export const writeDesktopPlatformAcceptanceRecordTemplate = async (options = {}) => {
    const context = await contextFor(options);
    const plan = await readPlan({ context, value: options.plan });
    const output = await resolveExternalOutput({
        baseDirectory: context.base,
        candidateDirectory: context.candidate.context.candidateDirectory,
        expectedFilename: context.policy.record.filename,
        value: options.record,
        errorPrefix: 'desktop-platform-acceptance-record',
    });
    const now = options.now ? options.now() : new Date();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new Error('desktop-platform-acceptance-clock-invalid');
    }
    const revalidated = await contextFor({ ...options, baseDirectory: context.base });
    if (!candidateBindingMatches(context, revalidated)) {
        throw new Error('desktop-platform-acceptance-candidate-mutated-during-template-write');
    }
    const finalPlan = await readPlan({ context: revalidated, value: options.plan });
    if (finalPlan.file.sha256 !== plan.file.sha256) {
        throw new Error('desktop-platform-acceptance-plan-mutated-during-template-write');
    }
    const record = buildRecordTemplate({
        context: revalidated,
        plan: finalPlan,
        testedAt: now.toISOString(),
    });
    await writeNewJsonFile(output, record);
    return { context: revalidated, plan: finalPlan, record, output };
};

export const verifyDesktopPlatformAcceptanceRecord = async (options = {}) => {
    const context = await contextFor(options);
    const plan = await readPlan({ context, value: options.plan });
    const record = await readExternalJsonFileOutsideCandidate({
        baseDirectory: context.base,
        candidateDirectory: context.candidate.context.candidateDirectory,
        expectedFilename: context.policy.record.filename,
        value: options.record,
        errorPrefix: 'desktop-platform-acceptance-record',
    });
    const evidenceDirectory = await resolveExternalDirectoryOutsideCandidate({
        baseDirectory: context.base,
        candidateDirectory: context.candidate.context.candidateDirectory,
        value: options.evidenceDirectory,
        errorPrefix: 'desktop-platform-acceptance-evidence-directory',
    });
    const validation = await validateRecord({
        context,
        plan,
        record: record.json,
        evidenceDirectory,
        forbiddenFiles: [
            context.candidate.receiptFile.absolute,
            ...(context.candidate.trustedRoot ? [context.candidate.trustedRoot.absolute] : []),
            plan.file.absolute,
            record.file.absolute,
        ],
    });
    const revalidated = await contextFor({ ...options, baseDirectory: context.base });
    if (!candidateBindingMatches(context, revalidated)) {
        throw new Error('desktop-platform-acceptance-candidate-mutated-during-record-verification');
    }
    const finalPlan = await readPlan({ context: revalidated, value: options.plan });
    if (finalPlan.file.sha256 !== plan.file.sha256) {
        throw new Error('desktop-platform-acceptance-plan-mutated-during-record-verification');
    }
    const finalRecord = await readExternalJsonFileOutsideCandidate({
        baseDirectory: revalidated.base,
        candidateDirectory: revalidated.candidate.context.candidateDirectory,
        expectedFilename: revalidated.policy.record.filename,
        value: options.record,
        errorPrefix: 'desktop-platform-acceptance-record',
    });
    if (finalRecord.file.sha256 !== record.file.sha256) {
        throw new Error('desktop-platform-acceptance-record-mutated-during-record-verification');
    }
    for (const evidence of validation.evidence) {
        const refreshed = await verifyEvidence({ evidenceDirectory, forbiddenFiles: [
            revalidated.candidate.receiptFile.absolute,
            ...(revalidated.candidate.trustedRoot ? [revalidated.candidate.trustedRoot.absolute] : []),
            finalPlan.file.absolute,
            finalRecord.file.absolute,
        ], value: {
            file: evidence.relative,
            mediaType: evidence.mediaType,
            bytes: evidence.bytes,
            sha256: evidence.sha256,
        } });
        if (!sameJson(evidence, refreshed)) {
            throw new Error('desktop-platform-acceptance-evidence-mutated-during-record-verification');
        }
    }
    return {
        context: revalidated,
        plan: finalPlan,
        record: finalRecord,
        evidenceDirectory,
        acceptanceComplete: validation.acceptanceComplete,
        releaseReady: false,
    };
};

const readOption = (argumentsList, index, option) => {
    const value = argumentsList[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`desktop-platform-acceptance-option-value-required:${option}`);
    }
    return value;
};

export const parseDesktopPlatformAcceptanceArguments = (argumentsList) => {
    const options = {};
    const seenOptions = new Set();
    for (let index = 0; index < argumentsList.length; index += 1) {
        const option = argumentsList[index];
        if (seenOptions.has(option)) {
            throw new Error(`desktop-platform-acceptance-option-duplicate:${option}`);
        }
        seenOptions.add(option);
        switch (option) {
        case '--candidate-dir':
            options.candidateDirectory = readOption(argumentsList, index, option);
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
        case '--plan':
            options.plan = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--record':
            options.record = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--evidence-dir':
            options.evidenceDirectory = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--base-directory':
            options.baseDirectory = readOption(argumentsList, index, option);
            index += 1;
            break;
        case '--write-plan':
            options.mode = options.mode || 'write-plan';
            if (options.mode !== 'write-plan') {
                throw new Error('desktop-platform-acceptance-option-mode-conflict');
            }
            break;
        case '--write-record-template':
            options.mode = options.mode || 'write-record-template';
            if (options.mode !== 'write-record-template') {
                throw new Error('desktop-platform-acceptance-option-mode-conflict');
            }
            break;
        case '--verify-record':
            options.mode = options.mode || 'verify-record';
            if (options.mode !== 'verify-record') {
                throw new Error('desktop-platform-acceptance-option-mode-conflict');
            }
            break;
        default:
            throw new Error(`desktop-platform-acceptance-option-unsupported:${option}`);
        }
    }
    for (const [key, option] of [
        ['candidateDirectory', 'candidate-dir'],
        ['receipt', 'receipt'],
        ['plan', 'plan'],
        ['mode', 'mode'],
    ]) {
        if (!options[key]) {
            throw new Error(`desktop-platform-acceptance-option-required:${option}`);
        }
    }
    if (options.mode === 'write-plan' && (options.record || options.evidenceDirectory)) {
        throw new Error('desktop-platform-acceptance-option-invalid-for-mode');
    }
    if (options.mode === 'write-record-template' && !options.record) {
        throw new Error('desktop-platform-acceptance-option-required:record');
    }
    if (options.mode === 'write-record-template' && options.evidenceDirectory) {
        throw new Error('desktop-platform-acceptance-option-invalid-for-mode');
    }
    if (options.mode === 'verify-record' && (!options.record || !options.evidenceDirectory)) {
        throw new Error('desktop-platform-acceptance-option-required:record-and-evidence-dir');
    }
    return options;
};

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const options = parseDesktopPlatformAcceptanceArguments(process.argv.slice(2));
    const matrix = JSON.parse(await readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8'));
    const result = options.mode === 'write-plan'
        ? await writeDesktopPlatformAcceptancePlan({ matrix, ...options })
        : options.mode === 'write-record-template'
            ? await writeDesktopPlatformAcceptanceRecordTemplate({ matrix, ...options })
            : await verifyDesktopPlatformAcceptanceRecord({ matrix, ...options });
    const output = options.mode === 'write-plan'
        ? {
            status: 'plan-written',
            mode: options.mode,
            output: path.relative(process.cwd(), result.output),
            target: result.context.candidate.context.profile.target,
            candidateSha: result.context.candidate.context.candidateSha,
            acceptanceComplete: false,
            releaseReady: false,
        }
        : options.mode === 'write-record-template'
            ? {
                status: 'template-written',
                mode: options.mode,
                output: path.relative(process.cwd(), result.output),
                target: result.context.candidate.context.profile.target,
                candidateSha: result.context.candidate.context.candidateSha,
                acceptanceComplete: false,
                releaseReady: false,
            }
        : {
            status: 'verified',
            mode: options.mode,
            target: result.context.candidate.context.profile.target,
            candidateSha: result.context.candidate.context.candidateSha,
            acceptanceComplete: result.acceptanceComplete,
            releaseReady: result.releaseReady,
            completedChecks: result.record.json.checks.filter(({ status }) => status === 'passed').length,
            totalChecks: result.record.json.checks.length,
        };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
