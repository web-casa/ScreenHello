import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { candidateTargets } from './audit-desktop-release-contract.mjs';
import { desktopArtifactProvenanceRepositoryId } from './desktop-artifact-provenance.mjs';

const matrix = JSON.parse(await readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8'));
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const tauriConfig = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const evidenceDirectory = resolve(process.env.SCREENHELLO_DESKTOP_EVIDENCE_DIR || 'artifacts/release/desktop-matrix');
const scope = process.env.SCREENHELLO_DESKTOP_GATE_SCOPE || 'full';
const gateTargets = candidateTargets(matrix, scope);
const failures = [];
const results = [];
const candidateShas = new Set();
const sourceRuns = new Set();
const digestPattern = /^[0-9a-f]{64}$/u;
const candidatePattern = /^[0-9a-f]{40}$/u;
const sensitiveKeyPattern = /(?:auth|cookie|credential|key|pass|secret|session|token)/iu;
const applicationVersion = packageJson.version;
const codecFormats = ['avif', 'webp', 'png'];
const captureCapabilityBackends = new Set(['x11', 'wayland-portal', 'macos-core-graphics', 'windows-gdi']);
const captureCapabilityStatuses = new Set(['ready', 'system-permission-required', 'portal-required', 'no-display']);
const desktopStateStatuses = new Set(['initialized', 'ready', 'migrated', 'unavailable']);
const manualCaptureReason = 'Native consent was not exercised; no capture success is claimed.';

if (tauriConfig.version !== applicationVersion) failures.push('desktop application version source mismatch');

const hasExactValues = (actual, expected) => (
    Array.isArray(actual)
    && actual.length === expected.length
    && new Set(actual).size === expected.length
    && expected.every((value) => actual.includes(value))
);
const validCodecRuntime = (value) => (
    value?.status === 'passed'
    && hasExactValues(value.formats, codecFormats)
    && ['http:', 'https:', 'tauri:'].includes(value.resourceProtocol)
);
const hasExactObjectKeys = (value, keys) => (
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key))
);
const validCaptureCapability = (value, platform) => (
    hasExactObjectKeys(value, ['schemaVersion', 'backend', 'status', 'sourcePicker'])
    && value.schemaVersion === 1
    && captureCapabilityBackends.has(value.backend)
    && captureCapabilityStatuses.has(value.status)
    && typeof value.sourcePicker === 'boolean'
    && value.sourcePicker === (value.status === 'ready')
    && (platform === 'linux'
        ? ['x11', 'wayland-portal'].includes(value.backend)
        : platform === 'macos'
            ? value.backend === 'macos-core-graphics'
            : platform === 'windows'
                ? value.backend === 'windows-gdi'
                : false)
);
const validDesktopState = (value) => (
    hasExactObjectKeys(value, ['schemaVersion', 'status', 'dataSchemaVersion'])
    && value.schemaVersion === 1
    && desktopStateStatuses.has(value.status)
    && value.status !== 'unavailable'
    && value.dataSchemaVersion === 1
);
const validCaptureRuntime = (value) => {
    if (value?.status === 'manual') {
        return hasExactObjectKeys(value, ['status', 'reason']) && value.reason === manualCaptureReason;
    }
    return hasExactObjectKeys(value, ['status', 'sources', 'width', 'height', 'bytes', 'imported'])
        && value.status === 'passed'
        && Number.isInteger(value.sources) && value.sources >= 1 && value.sources <= 144
        && Number.isInteger(value.width) && value.width >= 1 && value.width <= 7_680
        && Number.isInteger(value.height) && value.height >= 1 && value.height <= 4_320
        && Number.isInteger(value.bytes) && value.bytes >= 24 && value.bytes <= 48 * 1024 * 1024
        && value.imported === true;
};

const safeArtifact = (artifact, kind) => (
    artifact
    && typeof artifact.name === 'string'
    && artifact.name.length > 0
    && artifact.name.length <= 160
    && !/[\\/]/u.test(artifact.name)
    && ![...artifact.name].some((character) => character.codePointAt(0) < 32)
    && Number.isSafeInteger(artifact.bytes)
    && artifact.bytes > 0
    && artifact.bytes <= 1024 * 1024 * 1024
    && digestPattern.test(artifact.sha256 || '')
    && (kind === undefined || artifact.kind === kind)
);

const safePayloadPath = (value) => (
    typeof value === 'string'
    && value.length > 0
    && value.length <= 512
    && !value.startsWith('/')
    && !value.includes('\\')
    && value.split('/').every((part) => part && part !== '.' && part !== '..')
    && ![...value].some((character) => character.codePointAt(0) < 32)
);

const nativePayloadValid = (packageResult, target) => {
    const nativeBinaries = packageResult?.nativeBinaries;
    if (!safePayloadPath(packageResult?.mainBinary)
        || !Array.isArray(nativeBinaries)
        || nativeBinaries.length < 1
        || nativeBinaries.length > 256
        || new Set(nativeBinaries.map((record) => record?.path)).size !== nativeBinaries.length) {
        return false;
    }
    const primary = nativeBinaries.find((record) => record?.path === packageResult.mainBinary);
    if (!primary || primary.format !== target.binaryFormat || primary.architecture !== target.binaryArchitecture) return false;
    return nativeBinaries.every((record) => {
        if (!safePayloadPath(record?.path) || record.format !== target.binaryFormat) return false;
        if (record.architecture === target.binaryArchitecture && record.architectures === undefined) return true;
        return record.architecture === 'universal'
            && Array.isArray(record.architectures)
            && record.architectures.length === 2
            && new Set(record.architectures).size === record.architectures.length
            && record.architectures.every((architecture) => ['x86_64', 'arm64'].includes(architecture))
            && record.architectures.includes(target.binaryArchitecture);
    });
};

const verifyArtifactFile = async (directory, artifact) => {
    if (!safeArtifact(artifact)) return false;
    try {
        const absolute = join(directory, artifact.name);
        const details = await lstat(absolute);
        if (details.isSymbolicLink() || !details.isFile() || details.size !== artifact.bytes) return false;
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(absolute)) hash.update(chunk);
        const digest = hash.digest('hex');
        return digest === artifact.sha256;
    } catch {
        return false;
    }
};

const findSensitiveKey = (value, path = 'evidence') => {
    if (!value || typeof value !== 'object') return null;
    for (const [key, child] of Object.entries(value)) {
        const childPath = `${path}.${key}`;
        if (sensitiveKeyPattern.test(key)) return childPath;
        const nested = findSensitiveKey(child, childPath);
        if (nested) return nested;
    }
    return null;
};

for (const target of gateTargets) {
    const evidencePath = resolve(evidenceDirectory, `${target.id}.json`);
    let evidence;
    try {
        const evidenceDetails = await lstat(evidencePath);
        if (evidenceDetails.isSymbolicLink() || !evidenceDetails.isFile()
            || evidenceDetails.size < 2 || evidenceDetails.size > 2 * 1024 * 1024) {
            throw new Error('evidence-file-boundary-invalid');
        }
        evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    } catch (error) {
        failures.push(`${target.id}: missing or invalid evidence (${error.code || error.message})`);
        continue;
    }

    const targetFailures = [];
    if (findSensitiveKey(evidence)) targetFailures.push('sensitive field is forbidden');
    if (evidence.schemaVersion !== matrix.schemaVersion) targetFailures.push('unsupported schemaVersion');
    if (evidence.scope !== scope) targetFailures.push('gate scope mismatch');
    if (evidence.target !== target.id) targetFailures.push('target mismatch');
    if (evidence.status !== 'conditional') targetFailures.push('status must preserve manual gate');
    if (!candidatePattern.test(evidence.candidateSha || '')) targetFailures.push('candidateSha is not a commit SHA');
    else candidateShas.add(evidence.candidateSha);
    if (!evidence.testedAt || Number.isNaN(Date.parse(evidence.testedAt))) targetFailures.push('invalid testedAt');

    const runner = evidence.runner;
    if (runner?.label !== target.runner) targetFailures.push('runner label mismatch');
    if (runner?.environment !== 'github-hosted') targetFailures.push('runner environment mismatch');
    if (runner?.os !== target.nodePlatform) targetFailures.push('runner OS mismatch');
    if (runner?.arch !== target.arch) targetFailures.push('runner architecture mismatch');
    if (runner?.rustTarget !== target.rustTarget) targetFailures.push('Rust target mismatch');
    if (typeof runner?.image?.os !== 'string' || !/^[A-Za-z0-9._-]{2,80}$/u.test(runner.image.os)
        || typeof runner?.image?.version !== 'string' || !/^[A-Za-z0-9._-]{2,80}$/u.test(runner.image.version)) {
        targetFailures.push('runner image evidence missing');
    }

    const source = evidence.source;
    if (typeof source?.repository !== 'string'
        || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(source.repository)
        || source?.repositoryId !== desktopArtifactProvenanceRepositoryId
        || source?.workflow !== 'Desktop Release Gate'
        || !['pull_request', 'workflow_dispatch'].includes(source?.event)
        || !Number.isSafeInteger(source?.runId) || source.runId < 1
        || !Number.isSafeInteger(source?.runAttempt) || source.runAttempt < 1) {
        targetFailures.push('GitHub Actions provenance invalid');
    } else {
        sourceRuns.add(`${source.runId}:${source.runAttempt}:${source.event}`);
    }

    if (!/^v24\.[0-9]+\.[0-9]+$/u.test(evidence.tools?.node || '')) targetFailures.push('Node 24 evidence missing');
    if (evidence.tools?.pnpm !== '10.12.1') targetFailures.push('pnpm version mismatch');
    if (!/^rustc 1\.96\.0(?:\s|$)/u.test(evidence.tools?.rustc || '')) targetFailures.push('rustc version mismatch');
    if (!/^cargo 1\.96\.0(?:\s|$)/u.test(evidence.tools?.cargo || '')) targetFailures.push('cargo version mismatch');
    if (evidence.tools?.tauri !== '2.11.4') targetFailures.push('Tauri CLI version mismatch');

    const build = evidence.build;
    if (build?.status !== 'passed') targetFailures.push('production build did not pass');
    if (!Number.isFinite(build?.durationMs) || build.durationMs <= 0) targetFailures.push('build duration missing');
    if (build?.signing !== 'unsigned-test-only') targetFailures.push('test artifact signing state invalid');
    if (!safeArtifact(build?.binary)) targetFailures.push('binary evidence invalid');
    if (!safeArtifact(build?.bundle, target.bundleKind)) targetFailures.push('bundle evidence invalid');
    if (!safeArtifact(build?.artifactInspection)) targetFailures.push('artifact inspection evidence invalid');
    if (build?.package?.kind !== target.bundleKind
        || build.package.channel !== target.channel
        || build.package.identity !== target.packageIdentity
        || build.package.identitySource !== target.packageIdentitySource
        || build.package.version !== applicationVersion
        || build.package.architecture !== target.packageArchitecture
        || build.package.payloadVerified !== true
        || !nativePayloadValid(build.package, target)) {
        targetFailures.push('package identity or architecture evidence invalid');
    }
    for (const check of matrix.requiredBuildChecks) {
        if (build?.checks?.[check] !== true) targetFailures.push(`build check failed: ${check}`);
    }

    const runtime = evidence.runtime;
    if (runtime?.status !== 'passed') targetFailures.push('runtime did not pass');
    if (runtime?.driver !== 'embedded-test-feature') targetFailures.push('runtime driver mismatch');
    if (!Number.isFinite(runtime?.durationMs) || runtime.durationMs <= 0) targetFailures.push('runtime duration missing');
    for (const check of matrix.requiredRuntimeChecks) {
        if (runtime?.checks?.[check] !== true) targetFailures.push(`runtime check failed: ${check}`);
    }
    if (!validCodecRuntime(runtime?.codecs)) targetFailures.push('runtime codec evidence invalid');
    if (runtime?.capturePermissionBoundary !== 'enforced') targetFailures.push('runtime capture permission boundary invalid');
    if (!validCaptureCapability(runtime?.captureCapability, target.platform)) targetFailures.push('runtime capture capability evidence invalid');
    if (!validDesktopState(runtime?.stateMigration)) targetFailures.push('runtime state migration evidence invalid');
    if (!validCaptureRuntime(runtime?.capture)) targetFailures.push('runtime capture evidence invalid');
    if (runtime?.editorImport !== 'passed') targetFailures.push('runtime editor import evidence invalid');
    if (!safeArtifact(runtime?.evidenceFile) || !safeArtifact(runtime?.screenshot)) {
        targetFailures.push('runtime artifact evidence invalid');
    }

    const sbom = evidence.supplyChain?.sbom;
    if (!Array.isArray(sbom)
        || sbom.length !== 2
        || !hasExactValues(sbom.map(({ name }) => name), ['npm.cdx.json', 'cargo.cdx.json'])
        || sbom.some((artifact) => !safeArtifact(artifact) || artifact.bytes > 16 * 1024 * 1024)) {
        targetFailures.push('SBOM evidence invalid');
    }
    if (!safeArtifact(evidence.supplyChain?.checksums)) targetFailures.push('checksum evidence invalid');

    const targetDirectory = join(evidenceDirectory, target.id);
    const artifactRecords = [
        build?.binary,
        build?.bundle,
        build?.artifactInspection,
        runtime?.evidenceFile,
        runtime?.screenshot,
        ...(Array.isArray(sbom) ? sbom : []),
    ];
    let artifactsMatch = new Set(artifactRecords.map((artifact) => artifact?.name)).size === artifactRecords.length
        && artifactRecords.every((artifact) => safeArtifact(artifact));
    for (const artifact of artifactRecords) {
        if (!artifactsMatch || !await verifyArtifactFile(targetDirectory, artifact)) {
            artifactsMatch = false;
            break;
        }
    }
    if (!artifactsMatch) {
        targetFailures.push('artifact file digest mismatch');
    }
    const checksums = evidence.supplyChain?.checksums;
    if (!await verifyArtifactFile(targetDirectory, checksums)) {
        targetFailures.push('checksum file digest mismatch');
    } else if (checksums.bytes > 64 * 1024) {
        targetFailures.push('checksum manifest too large');
    } else {
        const expectedChecksums = artifactRecords
            .map(({ sha256, name }) => `${sha256}  ${name}`)
            .sort((left, right) => left.localeCompare(right, 'en'))
            .join('\n');
        const checksumContent = (await readFile(join(targetDirectory, checksums.name), 'utf8')).trimEnd();
        if (checksumContent !== expectedChecksums) targetFailures.push('checksum manifest mismatch');
    }
    for (const artifact of Array.isArray(sbom) ? sbom : []) {
        if (!safeArtifact(artifact) || artifact.bytes > 16 * 1024 * 1024) continue;
        try {
            const document = JSON.parse(await readFile(join(targetDirectory, artifact.name), 'utf8'));
            const properties = Object.fromEntries((document.metadata?.properties || [])
                .map(({ name, value }) => [name, value]));
            if (document.bomFormat !== 'CycloneDX'
                || document.specVersion !== '1.6'
                || !Array.isArray(document.components) || document.components.length < 1
                || properties['screenhello:candidate-sha'] !== evidence.candidateSha
                || properties['screenhello:desktop-target'] !== target.id) {
                targetFailures.push(`SBOM content invalid: ${artifact.name}`);
            }
        } catch {
            targetFailures.push(`SBOM content invalid: ${artifact?.name || 'unknown'}`);
        }
    }
    try {
        if (!safeArtifact(build?.artifactInspection) || build.artifactInspection.bytes > 64 * 1024) {
            throw new Error('artifact-inspection-boundary-invalid');
        }
        const inspection = JSON.parse(await readFile(join(targetDirectory, build.artifactInspection.name), 'utf8'));
        if (inspection.schemaVersion !== 2
            || inspection.scope !== scope
            || inspection.candidateSha !== evidence.candidateSha
            || inspection.target !== target.id
            || inspection.application?.productName !== 'ScreenHello'
            || inspection.application?.identifier !== 'com.webcasa.screenhello'
            || inspection.application?.version !== applicationVersion
            || inspection.binary?.format !== target.binaryFormat
            || inspection.binary?.architecture !== target.binaryArchitecture
            || JSON.stringify(inspection.package) !== JSON.stringify(build.package)) {
            targetFailures.push('artifact inspection content invalid');
        }
    } catch {
        targetFailures.push('artifact inspection content invalid');
    }

    const manualChecks = evidence.manualChecks;
    if (!Array.isArray(manualChecks)
        || !hasExactValues(manualChecks.map(({ id }) => id), target.manualChecks)
        || manualChecks.some(({ status, reason }) => (
            status !== 'pending'
            || typeof reason !== 'string'
            || reason.length < 12
            || reason.length > 300
        ))) {
        targetFailures.push('manual checks must remain complete and pending in CI evidence');
    }

    if (targetFailures.length) failures.push(`${target.id}: ${targetFailures.join(', ')}`);
    results.push({
        target: target.id,
        runner: runner?.label,
        status: targetFailures.length ? 'failed' : 'passed',
        manualPending: Array.isArray(manualChecks)
            ? manualChecks.filter(({ status }) => status === 'pending').map(({ id }) => id)
            : [],
    });
}

if (candidateShas.size !== 1) failures.push('evidence does not reference one candidate commit');
if (sourceRuns.size !== 1) failures.push('evidence does not reference one workflow run attempt');
const [candidateSha] = candidateShas;
const expectedCandidate = process.env.SCREENHELLO_RELEASE_CANDIDATE;
if (expectedCandidate && candidateSha !== expectedCandidate) {
    failures.push('evidence does not match SCREENHELLO_RELEASE_CANDIDATE');
}

console.log(JSON.stringify({
    matrixVersion: matrix.schemaVersion,
    scope,
    candidateSha: candidateSha || null,
    automaticGate: failures.length ? 'failed' : 'passed',
    releaseReady: false,
    results,
    failures,
}, null, 2));
if (failures.length) process.exitCode = 1;
