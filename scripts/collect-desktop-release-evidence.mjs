import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { candidateTargets } from './audit-desktop-release-contract.mjs';
import { desktopGateRepositoryIds } from './desktop-release-matrix.mjs';
import { isNsisInstallerBinaryRecord } from './inspect-desktop-artifacts.mjs';

const execFileAsync = promisify(execFile);
const root = await realpath(process.cwd());
const matrix = JSON.parse(await readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8'));
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const tauriConfig = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const targetId = process.env.SCREENHELLO_DESKTOP_TARGET;
const candidateSha = process.env.SCREENHELLO_RELEASE_CANDIDATE;
const scope = process.env.SCREENHELLO_DESKTOP_GATE_SCOPE || 'full';
const target = candidateTargets(matrix, scope).find(({ id }) => id === targetId);
const candidatePattern = /^[0-9a-f]{40}$/u;
const forbiddenDriverMarkers = ['wdio-webdriver', 'WDIO WebDriver plugin initialized', 'TAURI_WEBDRIVER_PORT', 'SCREENHELLO_RUNNER_ONLY_TEST_BINARY'];
const codecFormats = ['avif', 'webp', 'png'];
const captureCapabilityBackends = new Set(['x11', 'wayland-portal', 'macos-core-graphics', 'windows-gdi']);
const captureCapabilityStatuses = new Set(['ready', 'system-permission-required', 'portal-required', 'no-display']);
const desktopStateStatuses = new Set(['initialized', 'ready', 'migrated', 'unavailable']);
const manualCaptureReason = 'Native consent was not exercised; no capture success is claimed.';
const validCodecRuntime = (value) => (
    value?.status === 'passed'
    && Array.isArray(value.formats)
    && value.formats.length === codecFormats.length
    && new Set(value.formats).size === codecFormats.length
    && codecFormats.every((format) => value.formats.includes(format))
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

if (!target) throw new Error('desktop-evidence-target-invalid');
if (tauriConfig.version !== packageJson.version) throw new Error('desktop-evidence-version-source-mismatch');
if (!candidatePattern.test(candidateSha || '')) throw new Error('desktop-evidence-candidate-invalid');
if (process.platform !== target.nodePlatform || process.arch !== target.arch) {
    throw new Error('desktop-evidence-host-mismatch');
}

const resolveRepositoryFile = async (value, id) => {
    if (!value) throw new Error(`${id}-missing`);
    const requested = path.resolve(root, value);
    const requestedDetails = await lstat(requested);
    if (requestedDetails.isSymbolicLink()) throw new Error(`${id}-symlink-forbidden`);
    const absolute = await realpath(requested);
    const relative = path.relative(root, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${id}-outside-repository`);
    const details = await lstat(absolute);
    if (!details.isFile() || details.size <= 0 || details.size > 1024 * 1024 * 1024) {
        throw new Error(`${id}-invalid`);
    }
    return { absolute, details };
};

const sha256 = async (absolute) => {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(absolute)) hash.update(chunk);
    return hash.digest('hex');
};
const artifactEvidence = async (value, id, kind) => {
    const { absolute, details } = await resolveRepositoryFile(value, id);
    return {
        absolute,
        record: {
            name: path.basename(absolute),
            ...(kind ? { kind } : {}),
            bytes: details.size,
            sha256: await sha256(absolute),
        },
    };
};

const commandVersion = async (command, args) => {
    const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
    });
    return `${stdout}${stderr}`.trim();
};

const safePayloadPath = (value) => (
    typeof value === 'string'
    && value.length > 0
    && value.length <= 512
    && !value.startsWith('/')
    && !value.includes('\\')
    && value.split('/').every((part) => part && part !== '.' && part !== '..')
    && ![...value].some((character) => character.codePointAt(0) < 32)
);

const nativePayloadValid = (packageResult) => {
    const installerBinaries = packageResult?.installerBinaries;
    if (installerBinaries !== undefined && (target.platform !== 'windows'
        || !Array.isArray(installerBinaries) || installerBinaries.length > 5
        || !installerBinaries.every(isNsisInstallerBinaryRecord)
        || new Set(installerBinaries.map((record) => record.path.toLowerCase())).size !== installerBinaries.length)) return false;
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

const pnpmCli = process.env.npm_execpath;
if (!pnpmCli || !path.isAbsolute(pnpmCli)) {
    throw new Error('desktop-evidence-run-via-pnpm');
}
const pnpmVersion = (args) => commandVersion(process.execPath, [pnpmCli, ...args]);

const repositorySha = await commandVersion('git', ['rev-parse', 'HEAD']);
if (repositorySha !== candidateSha) throw new Error('desktop-evidence-checkout-mismatch');
if (await commandVersion('git', ['status', '--porcelain=v1', '--untracked-files=all'])) {
    throw new Error('desktop-evidence-working-tree-dirty');
}
if (process.env.SCREENHELLO_RUNNER_LABEL !== target.runner) throw new Error('desktop-evidence-runner-mismatch');
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(process.env.GITHUB_REPOSITORY || '')
    || !desktopGateRepositoryIds.some((id) => process.env.GITHUB_REPOSITORY_ID === String(id))
    || process.env.GITHUB_WORKFLOW !== 'Desktop Release Gate'
    || !['pull_request', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)
    || !/^\d+$/u.test(process.env.GITHUB_RUN_ID || '')
    || !/^\d+$/u.test(process.env.GITHUB_RUN_ATTEMPT || '')
    || !/^[A-Za-z0-9._-]{2,80}$/u.test(process.env.ImageOS || '')
    || !/^[A-Za-z0-9._-]{2,80}$/u.test(process.env.ImageVersion || '')) {
    throw new Error('desktop-evidence-github-provenance-invalid');
}

const runtimePath = await resolveRepositoryFile(process.env.SCREENHELLO_DESKTOP_RUNTIME_EVIDENCE, 'desktop-runtime-evidence');
if (runtimePath.details.size > 2 * 1024 * 1024) throw new Error('desktop-runtime-evidence-too-large');
const runtimeResult = JSON.parse(await readFile(runtimePath.absolute, 'utf8'));
const expectedPlatform = target.platform;
if (runtimeResult.status !== 'ready'
    || runtimeResult.platform !== expectedPlatform
    || runtimeResult.arch !== target.rustTarget.split('-')[0]
    || runtimeResult.clipboardImage !== 'written'
    || runtimeResult.editorImport !== 'passed'
    || runtimeResult.shortcut !== 'registered'
    || runtimeResult.tray !== 'ready'
    || runtimeResult.singleInstance !== 'enforced'
    || runtimeResult.capturePermissionBoundary !== 'enforced'
    || !validCodecRuntime(runtimeResult.codecs)
    || !validCaptureCapability(runtimeResult.captureCapability, target.platform)
    || !validDesktopState(runtimeResult.stateMigration)
    || !validCaptureRuntime(runtimeResult.capture)) {
    throw new Error('desktop-runtime-evidence-invalid');
}
const runtimeEvidence = await artifactEvidence(process.env.SCREENHELLO_DESKTOP_RUNTIME_EVIDENCE, 'desktop-runtime-evidence');
const runtimeScreenshot = await artifactEvidence(process.env.SCREENHELLO_DESKTOP_SCREENSHOT, 'desktop-runtime-screenshot');

const binary = await artifactEvidence(process.env.SCREENHELLO_DESKTOP_BINARY, 'desktop-binary');
const markerBuffers = forbiddenDriverMarkers.map((marker) => Buffer.from(marker));
const markerOverlap = Math.max(...markerBuffers.map(({ length }) => length)) - 1;
let markerTail = Buffer.alloc(0);
for await (const chunk of createReadStream(binary.absolute)) {
    const combined = Buffer.concat([markerTail, chunk]);
    if (markerBuffers.some((marker) => combined.includes(marker))) {
        throw new Error('desktop-production-binary-contains-test-driver');
    }
    markerTail = combined.subarray(Math.max(0, combined.length - markerOverlap));
}
const bundle = await artifactEvidence(process.env.SCREENHELLO_DESKTOP_BUNDLE, 'desktop-bundle', target.bundleKind);
const artifactInspection = await artifactEvidence(
    process.env.SCREENHELLO_DESKTOP_ARTIFACT_INSPECTION,
    'desktop-artifact-inspection',
);
if (artifactInspection.record.bytes > 64 * 1024) throw new Error('desktop-artifact-inspection-too-large');
const artifactInspectionResult = JSON.parse(await readFile(artifactInspection.absolute, 'utf8'));
if (artifactInspectionResult.schemaVersion !== 2
    || artifactInspectionResult.scope !== scope
    || artifactInspectionResult.candidateSha !== candidateSha
    || artifactInspectionResult.target !== target.id
    || artifactInspectionResult.application?.productName !== 'ScreenHello'
    || artifactInspectionResult.application?.identifier !== 'com.webcasa.screenhello'
    || artifactInspectionResult.application?.version !== packageJson.version
    || artifactInspectionResult.binary?.format !== target.binaryFormat
    || artifactInspectionResult.binary?.architecture !== target.binaryArchitecture
    || artifactInspectionResult.package?.kind !== target.bundleKind
    || artifactInspectionResult.package?.channel !== target.channel
    || artifactInspectionResult.package?.identity !== target.packageIdentity
    || artifactInspectionResult.package?.identitySource !== target.packageIdentitySource
    || artifactInspectionResult.package?.version !== packageJson.version
    || artifactInspectionResult.package?.architecture !== target.packageArchitecture
    || artifactInspectionResult.package?.payloadVerified !== true
    || !nativePayloadValid(artifactInspectionResult.package)) {
    throw new Error('desktop-artifact-inspection-invalid');
}
const outputDirectory = path.resolve(root, 'artifacts/release/desktop-matrix');
const targetDirectory = path.join(outputDirectory, target.id);
await mkdir(targetDirectory, { recursive: true });

const copiedBinary = path.join(targetDirectory, binary.record.name);
const copiedBundle = path.join(targetDirectory, bundle.record.name);
await Promise.all([
    copyFile(binary.absolute, copiedBinary),
    copyFile(bundle.absolute, copiedBundle),
]);

const sbom = [];
for (const name of ['npm.cdx.json', 'cargo.cdx.json']) {
    const artifact = await artifactEvidence(path.join(targetDirectory, name), `desktop-sbom-${name}`);
    if (artifact.record.bytes > 16 * 1024 * 1024) throw new Error(`desktop-sbom-too-large:${name}`);
    const document = JSON.parse(await readFile(artifact.absolute, 'utf8'));
    const properties = Object.fromEntries((document.metadata?.properties || []).map(({ name: key, value }) => [key, value]));
    if (document.bomFormat !== 'CycloneDX'
        || document.specVersion !== '1.6'
        || !Array.isArray(document.components)
        || document.components.length < 1
        || properties['screenhello:candidate-sha'] !== candidateSha
        || properties['screenhello:desktop-target'] !== target.id) {
        throw new Error(`desktop-sbom-invalid:${name}`);
    }
    sbom.push(artifact.record);
}

const checksumLines = [
    binary.record,
    bundle.record,
    artifactInspection.record,
    runtimeEvidence.record,
    runtimeScreenshot.record,
    ...sbom,
]
    .map(({ sha256: digest, name }) => `${digest}  ${name}`)
    .sort((left, right) => left.localeCompare(right, 'en'));
const checksumPath = path.join(targetDirectory, 'SHA256SUMS.txt');
await writeFile(checksumPath, `${checksumLines.join('\n')}\n`, 'utf8');
const checksums = (await artifactEvidence(checksumPath, 'desktop-checksums')).record;

const tauriVersion = await pnpmVersion(['exec', 'tauri', '--version']);
const buildDurationMs = Number.parseInt(process.env.SCREENHELLO_DESKTOP_BUILD_DURATION_MS || '', 10);
if (!Number.isInteger(buildDurationMs) || buildDurationMs <= 0) throw new Error('desktop-build-duration-invalid');

const evidence = {
    schemaVersion: matrix.schemaVersion,
    scope,
    target: target.id,
    candidateSha,
    testedAt: process.env.SCREENHELLO_EVIDENCE_TIMESTAMP || new Date().toISOString(),
    status: 'conditional',
    runner: {
        label: process.env.SCREENHELLO_RUNNER_LABEL,
        environment: 'github-hosted',
        os: process.platform,
        arch: process.arch,
        rustTarget: target.rustTarget,
        image: {
            os: process.env.ImageOS,
            version: process.env.ImageVersion,
        },
    },
    source: {
        repository: process.env.GITHUB_REPOSITORY,
        repositoryId: Number.parseInt(process.env.GITHUB_REPOSITORY_ID || '', 10),
        workflow: process.env.GITHUB_WORKFLOW,
        event: process.env.GITHUB_EVENT_NAME,
        runId: Number.parseInt(process.env.GITHUB_RUN_ID || '', 10),
        runAttempt: Number.parseInt(process.env.GITHUB_RUN_ATTEMPT || '', 10),
    },
    tools: {
        node: process.version,
        pnpm: await pnpmVersion(['--version']),
        rustc: await commandVersion('rustc', ['--version']),
        cargo: await commandVersion('cargo', ['--version']),
        tauri: tauriVersion.replace(/^tauri-cli\s+/u, ''),
    },
    build: {
        status: 'passed',
        durationMs: buildDurationMs,
        signing: 'unsigned-test-only',
        binary: binary.record,
        bundle: bundle.record,
        artifactInspection: artifactInspection.record,
        package: artifactInspectionResult.package,
        checks: Object.fromEntries(matrix.requiredBuildChecks.map((id) => [id, true])),
    },
    runtime: {
        status: 'passed',
        driver: 'embedded-test-feature',
        durationMs: runtimeResult.durationMs,
        checks: {
            webviewBoot: runtimeResult.rootChildren > 0,
            environmentIpc: runtimeResult.status === 'ready',
            stateMigration: validDesktopState(runtimeResult.stateMigration),
            codecs: validCodecRuntime(runtimeResult.codecs),
            capture: runtimeResult.capturePermissionBoundary === 'enforced'
                && validCaptureRuntime(runtimeResult.capture),
            captureCapability: validCaptureCapability(runtimeResult.captureCapability, target.platform),
            editorImport: runtimeResult.editorImport === 'passed',
            clipboard: runtimeResult.clipboardImage === 'written',
            shortcut: runtimeResult.shortcut === 'registered',
            tray: runtimeResult.tray === 'ready',
            singleInstance: runtimeResult.singleInstance === 'enforced',
        },
        codecs: runtimeResult.codecs,
        capturePermissionBoundary: runtimeResult.capturePermissionBoundary,
        captureCapability: runtimeResult.captureCapability,
        stateMigration: runtimeResult.stateMigration,
        capture: runtimeResult.capture,
        editorImport: runtimeResult.editorImport,
        evidenceFile: runtimeEvidence.record,
        screenshot: runtimeScreenshot.record,
    },
    supplyChain: { sbom, checksums },
    manualChecks: target.manualChecks.map((id) => ({
        id,
        status: 'pending',
        reason: 'Requires an interactive physical or policy-controlled environment outside hosted CI.',
    })),
};

const evidencePath = path.join(outputDirectory, `${target.id}.json`);
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
    target: target.id,
    scope,
    candidateSha,
    evidence: path.relative(root, evidencePath),
    binary: binary.record,
    bundle: bundle.record,
    manualPending: target.manualChecks,
}, null, 2));
