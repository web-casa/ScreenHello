import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
    expectedMacosIntelSigningCandidate,
    expectedMacosSigningCandidate,
} from './audit-macos-signed-candidate-workflow.mjs';
import {
    expectedWindowsArm64SigningCandidate,
    expectedWindowsSigningCandidate,
    expectedWindowsSigningCandidateConfig,
} from './audit-windows-signed-candidate-workflow.mjs';
import { expectedLinuxDebRepositorySigningCandidate } from './audit-linux-deb-repository-signed-candidate-workflow.mjs';
import { expectedReleaseTrustPolicy } from './audit-desktop-release-trust.mjs';
import { expectedLinuxDebRepositoryKeyLifecycleCandidate } from './linux-deb-key-lifecycle.mjs';
import { expectedDesktopArtifactProvenanceCandidate } from './desktop-artifact-provenance.mjs';
import { expectedDesktopArtifactProvenanceVerification } from './desktop-artifact-provenance-verification.mjs';
import { expectedDesktopPlatformAcceptance } from './desktop-platform-acceptance.mjs';
import { expectedDesktopCrossPlatformAcceptance } from './desktop-cross-platform-acceptance.mjs';
import { expectedDesktopReleaseReview } from './desktop-release-review.mjs';
import { expectedDesktopReleasePayloadManifest } from './desktop-release-payload-manifest.mjs';
import { expectedDesktopReleasePublicationPlan } from './desktop-release-publication-plan.mjs';
import { expectedDesktopReleasePublicationHandoff } from './desktop-release-publication-handoff.mjs';
import { expectedDesktopReleaseGitHubReadiness } from './desktop-release-github-readiness.mjs';

const expectedTargets = Object.freeze({
    'linux-x64': {
        developmentStatus: 'candidate-gated',
        evidenceStatus: 'not-run',
        runner: 'ubuntu-22.04',
        platform: 'linux',
        nodePlatform: 'linux',
        arch: 'x64',
        rustTarget: 'x86_64-unknown-linux-gnu',
        bundleKind: 'deb',
        releaseBundleKind: 'deb',
        channel: 'github-actions-unsigned-test',
        binaryFormat: 'elf',
        binaryArchitecture: 'x86_64',
        packageIdentity: 'screen-hello',
        packageIdentitySource: 'deb-control',
        packageArchitecture: 'amd64',
    },
    'linux-arm64': {
        developmentStatus: 'candidate-gated',
        evidenceStatus: 'not-run',
        runner: 'ubuntu-22.04-arm',
        platform: 'linux',
        nodePlatform: 'linux',
        arch: 'arm64',
        rustTarget: 'aarch64-unknown-linux-gnu',
        bundleKind: 'deb',
        releaseBundleKind: 'deb',
        channel: 'github-actions-unsigned-test',
        binaryFormat: 'elf',
        binaryArchitecture: 'arm64',
        packageIdentity: 'screen-hello',
        packageIdentitySource: 'deb-control',
        packageArchitecture: 'arm64',
    },
    'macos-x64': {
        developmentStatus: 'candidate-gated',
        evidenceStatus: 'not-run',
        runner: 'macos-15-intel',
        platform: 'macos',
        nodePlatform: 'darwin',
        arch: 'x64',
        rustTarget: 'x86_64-apple-darwin',
        bundleKind: 'dmg',
        releaseBundleKind: 'dmg',
        channel: 'github-actions-unsigned-test',
        binaryFormat: 'mach-o',
        binaryArchitecture: 'x86_64',
        packageIdentity: 'com.webcasa.screenhello',
        packageIdentitySource: 'info-plist',
        packageArchitecture: 'x86_64',
    },
    'macos-arm64': {
        developmentStatus: 'candidate-gated',
        evidenceStatus: 'not-run',
        runner: 'macos-14',
        platform: 'macos',
        nodePlatform: 'darwin',
        arch: 'arm64',
        rustTarget: 'aarch64-apple-darwin',
        bundleKind: 'dmg',
        releaseBundleKind: 'dmg',
        channel: 'github-actions-unsigned-test',
        binaryFormat: 'mach-o',
        binaryArchitecture: 'arm64',
        packageIdentity: 'com.webcasa.screenhello',
        packageIdentitySource: 'info-plist',
        packageArchitecture: 'arm64',
    },
    'windows-x64': {
        developmentStatus: 'candidate-gated',
        evidenceStatus: 'not-run',
        runner: 'windows-2025',
        platform: 'windows',
        nodePlatform: 'win32',
        arch: 'x64',
        rustTarget: 'x86_64-pc-windows-msvc',
        bundleKind: 'nsis',
        releaseBundleKind: 'nsis',
        channel: 'github-actions-unsigned-test',
        binaryFormat: 'pe',
        binaryArchitecture: 'x86_64',
        packageIdentity: 'com.webcasa.screenhello',
        packageIdentitySource: 'tauri-config',
        packageArchitecture: 'x64',
    },
    'windows-arm64': {
        developmentStatus: 'candidate-gated',
        evidenceStatus: 'not-run',
        runner: 'windows-11-arm',
        platform: 'windows',
        nodePlatform: 'win32',
        arch: 'arm64',
        rustTarget: 'aarch64-pc-windows-msvc',
        bundleKind: 'nsis',
        releaseBundleKind: 'nsis',
        channel: 'github-actions-unsigned-test',
        binaryFormat: 'pe',
        binaryArchitecture: 'arm64',
        packageIdentity: 'com.webcasa.screenhello',
        packageIdentitySource: 'tauri-config',
        packageArchitecture: 'arm64',
    },
});

const candidateTargetIds = Object.freeze([
    'linux-x64',
    'linux-arm64',
    'macos-x64',
    'macos-arm64',
    'windows-x64',
    'windows-arm64',
]);
const prCandidateTargetIds = Object.freeze(['linux-x64', 'macos-arm64', 'windows-x64']);
const requiredRuntimeChecks = Object.freeze([
    'webviewBoot',
    'environmentIpc',
    'stateMigration',
    'codecs',
    'capture',
    'captureCapability',
    'editorImport',
    'clipboard',
    'shortcut',
    'tray',
    'singleInstance',
]);
const requiredBuildChecks = Object.freeze([
    'lockedInstall',
    'dependencyAudit',
    'licenseAudit',
    'rustTests',
    'desktopAudit',
    'workflowAudit',
    'trustPolicy',
    'testDriverFeatureBuild',
    'productionRebuild',
    'testDriverExcluded',
    'bundleBuilt',
    'codecAssets',
    'artifactInspection',
    'sbomGenerated',
    'checksumsGenerated',
]);
const semverNumericIdentifier = '(?:0|[1-9]\\d*)';
const semverNonNumericIdentifier = '(?:\\d*[A-Za-z-][0-9A-Za-z-]*)';
const semverPrereleaseIdentifier = `(?:${semverNumericIdentifier}|${semverNonNumericIdentifier})`;
const semverBuildIdentifier = '[0-9A-Za-z-]+';
const semver = new RegExp(
    `^${semverNumericIdentifier}\\.${semverNumericIdentifier}\\.${semverNumericIdentifier}`
    + `(?:-${semverPrereleaseIdentifier}(?:\\.${semverPrereleaseIdentifier})*)?`
    + `(?:\\+${semverBuildIdentifier}(?:\\.${semverBuildIdentifier})*)?$`,
    'u',
);
const hasExactValues = (actual, expected) => (
    Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index])
);

export const candidateTargets = (matrix, scope = 'full') => {
    const targetIds = scope === 'full'
        ? matrix?.candidateGate?.targetIds
        : scope === 'pr'
            ? matrix?.candidateGate?.prTargetIds
            : null;
    const targets = matrix?.targets;
    if (!Array.isArray(targetIds) || new Set(targetIds).size !== targetIds.length || !Array.isArray(targets)) {
        throw new Error(`desktop-release-candidate-targets-invalid:${scope}`);
    }
    return targetIds.map((id) => {
        const target = targets.find((candidate) => candidate?.id === id);
        if (!target || typeof target !== 'object') throw new Error(`desktop-release-candidate-target-missing:${id}`);
        return target;
    });
};

const cargoPackageVersion = (cargoToml) => (
    String(cargoToml).match(/^version\s*=\s*"(?<version>[^"]+)"\s*$/mu)?.groups?.version
);

const cargoLockPackageVersion = (cargoLock) => (
    String(cargoLock).match(/\[\[package\]\]\s*\nname = "screenhello-desktop"\s*\nversion = "(?<version>[^"]+)"/u)?.groups?.version
);

const platformChecks = Object.freeze({
    linux: ['native-picker-visual', 'tray-visual', 'multi-monitor-dpi-negative-coordinates', 'wayland-portal', 'remote-desktop', 'no-display', 'install-upgrade-uninstall-local-data'],
    macos: ['native-picker-visual', 'tray-visual', 'multi-monitor-dpi-negative-coordinates', 'screen-recording-permission-prompt', 'remote-desktop', 'no-display', 'install-upgrade-uninstall-local-data'],
    windows: ['native-picker-visual', 'tray-visual', 'multi-monitor-dpi-negative-coordinates', 'screen-capture-permission-policy', 'remote-desktop', 'no-display', 'install-upgrade-uninstall-local-data'],
});

export const auditDesktopReleaseContract = ({
    matrix,
    packageJson,
    tauriConfig,
    candidateConfig,
    windowsSigningCandidateConfig,
    windowsArm64SigningCandidateConfig,
    cargoToml,
    cargoLock,
}) => {
    const failures = [];
    const expect = (condition, id) => {
        if (!condition) failures.push(id);
    };
    const version = packageJson?.version;

    expect(matrix?.schemaVersion === 24, 'desktop-release-contract-schema-invalid');
    expect(matrix?.application?.productName === 'ScreenHello', 'desktop-release-contract-product-name-invalid');
    expect(matrix?.application?.identifier === 'com.webcasa.screenhello', 'desktop-release-contract-identifier-invalid');
    expect(matrix?.application?.versionSource === 'package.json', 'desktop-release-contract-version-source-invalid');
    expect(matrix?.application?.baseConfig === 'src-tauri/tauri.conf.json', 'desktop-release-contract-base-config-invalid');
    expect(matrix?.application?.candidateConfig === 'src-tauri/tauri.phase9.conf.json', 'desktop-release-contract-candidate-config-invalid');
    expect(typeof version === 'string' && semver.test(version), 'desktop-release-contract-package-version-invalid');
    expect(tauriConfig?.productName === matrix?.application?.productName, 'desktop-release-contract-tauri-product-name-invalid');
    expect(tauriConfig?.identifier === matrix?.application?.identifier, 'desktop-release-contract-tauri-identifier-invalid');
    expect(tauriConfig?.version === version, 'desktop-release-contract-tauri-version-mismatch');
    expect(cargoPackageVersion(cargoToml) === version, 'desktop-release-contract-cargo-version-mismatch');
    expect(cargoLockPackageVersion(cargoLock) === version, 'desktop-release-contract-cargo-lock-version-mismatch');
    expect(tauriConfig?.bundle?.active === false, 'desktop-release-contract-base-bundle-state-invalid');
    expect(tauriConfig?.bundle?.windows?.allowDowngrades === false, 'desktop-release-contract-windows-downgrade-policy-invalid');
    expect(tauriConfig?.bundle?.windows?.nsis?.installMode === 'currentUser', 'desktop-release-contract-windows-installer-mode-invalid');
    expect(JSON.stringify(candidateConfig) === JSON.stringify({ bundle: { active: true } }), 'desktop-release-contract-candidate-bundle-state-invalid');
    expect(
        JSON.stringify(windowsSigningCandidateConfig) === JSON.stringify(expectedWindowsSigningCandidateConfig),
        'desktop-release-contract-windows-signed-candidate-config-invalid',
    );
    expect(
        JSON.stringify(windowsArm64SigningCandidateConfig) === JSON.stringify(expectedWindowsSigningCandidateConfig),
        'desktop-release-contract-windows-arm64-signed-candidate-config-invalid',
    );

    const targetIds = Array.isArray(matrix?.targets) ? matrix.targets.map((target) => target?.id) : [];
    expect(targetIds.length === Object.keys(expectedTargets).length, 'desktop-release-contract-target-count-invalid');
    expect(new Set(targetIds).size === targetIds.length, 'desktop-release-contract-target-ids-duplicate');
    expect([...targetIds].sort().join(',') === Object.keys(expectedTargets).sort().join(','), 'desktop-release-contract-target-set-invalid');
    for (const [id, expected] of Object.entries(expectedTargets)) {
        const target = matrix?.targets?.find((candidate) => candidate?.id === id);
        const requiredManualChecks = platformChecks[target?.platform];
        for (const [key, value] of Object.entries(expected)) {
            expect(target?.[key] === value, `desktop-release-contract-target-${id}-${key}-invalid`);
        }
        expect(
            Array.isArray(requiredManualChecks)
                && Array.isArray(target?.manualChecks)
                && new Set(target.manualChecks).size === target.manualChecks.length
                && requiredManualChecks.every((check) => target.manualChecks.includes(check)),
            `desktop-release-contract-target-${id}-manual-checks-invalid`,
        );
    }

    expect(matrix?.supportPolicy?.releaseChannel === 'direct-download-beta', 'desktop-release-contract-release-channel-invalid');
    expect(matrix?.supportPolicy?.linux?.minimumBuildSystem === 'ubuntu-22.04-or-debian-12', 'desktop-release-contract-linux-build-baseline-invalid');
    expect(
        hasExactValues(matrix?.supportPolicy?.linux?.minimumRuntimeSystems, ['ubuntu-22.04', 'ubuntu-24.04', 'debian-12']),
        'desktop-release-contract-linux-runtime-baseline-invalid',
    );
    expect(matrix?.supportPolicy?.linux?.x11 === 'planned-native-validation', 'desktop-release-contract-linux-x11-status-invalid');
    expect(matrix?.supportPolicy?.linux?.wayland === 'planned-portal-validation', 'desktop-release-contract-linux-wayland-status-invalid');
    expect(matrix?.supportPolicy?.updater === 'deferred', 'desktop-release-contract-updater-status-invalid');
    expect(matrix?.supportPolicy?.storeChannels === 'deferred', 'desktop-release-contract-store-status-invalid');
    expect(matrix?.lifecyclePolicy?.markerSchemaVersion === 1, 'desktop-release-contract-marker-schema-invalid');
    expect(matrix?.lifecyclePolicy?.unknownMarkerPolicy === 'preserve-and-report-unavailable', 'desktop-release-contract-unknown-marker-policy-invalid');
    expect(matrix?.lifecyclePolicy?.nativeUninstallPolicy === 'no-app-data-cleanup-hook', 'desktop-release-contract-uninstall-policy-invalid');
    expect(matrix?.lifecyclePolicy?.windowsNsis === 'current-user-no-downgrade', 'desktop-release-contract-windows-lifecycle-policy-invalid');
    expect(matrix?.lifecyclePolicy?.manualCheck === 'install-upgrade-uninstall-local-data', 'desktop-release-contract-lifecycle-manual-check-invalid');
    expect(matrix?.candidateGate?.channel === 'github-actions-unsigned-test', 'desktop-release-contract-candidate-channel-invalid');
    expect(matrix?.candidateGate?.signing === 'unsigned-test-only', 'desktop-release-contract-candidate-signing-invalid');
    expect(
        JSON.stringify(matrix?.releaseTrustPolicy) === JSON.stringify(expectedReleaseTrustPolicy),
        'desktop-release-contract-trust-policy-invalid',
    );
    expect(
        JSON.stringify(matrix?.macosSigningCandidate) === JSON.stringify(expectedMacosSigningCandidate),
        'desktop-release-contract-macos-signed-candidate-invalid',
    );
    expect(
        JSON.stringify(matrix?.macosIntelSigningCandidate) === JSON.stringify(expectedMacosIntelSigningCandidate),
        'desktop-release-contract-macos-intel-signed-candidate-invalid',
    );
    expect(
        JSON.stringify(matrix?.windowsSigningCandidate) === JSON.stringify(expectedWindowsSigningCandidate),
        'desktop-release-contract-windows-signed-candidate-invalid',
    );
    expect(
        JSON.stringify(matrix?.windowsArm64SigningCandidate) === JSON.stringify(expectedWindowsArm64SigningCandidate),
        'desktop-release-contract-windows-arm64-signed-candidate-invalid',
    );
    expect(
        JSON.stringify(matrix?.linuxDebRepositorySigningCandidate) === JSON.stringify(expectedLinuxDebRepositorySigningCandidate),
        'desktop-release-contract-linux-deb-repository-signed-candidate-invalid',
    );
    expect(
        JSON.stringify(matrix?.linuxDebRepositoryKeyLifecycleCandidate) === JSON.stringify(expectedLinuxDebRepositoryKeyLifecycleCandidate),
        'desktop-release-contract-linux-deb-key-lifecycle-candidate-invalid',
    );
    expect(
        JSON.stringify(matrix?.desktopArtifactProvenanceCandidate) === JSON.stringify(expectedDesktopArtifactProvenanceCandidate),
        'desktop-release-contract-desktop-artifact-provenance-candidate-invalid',
    );
    expect(
        JSON.stringify(matrix?.desktopArtifactProvenanceVerification) === JSON.stringify(expectedDesktopArtifactProvenanceVerification),
        'desktop-release-contract-desktop-artifact-provenance-verification-invalid',
    );
    expect(
        JSON.stringify(matrix?.desktopPlatformAcceptance) === JSON.stringify(expectedDesktopPlatformAcceptance),
        'desktop-release-contract-desktop-platform-acceptance-invalid',
    );
    expect(
        JSON.stringify(matrix?.desktopCrossPlatformAcceptance) === JSON.stringify(expectedDesktopCrossPlatformAcceptance),
        'desktop-release-contract-desktop-cross-platform-acceptance-invalid',
    );
    expect(
        JSON.stringify(matrix?.desktopReleaseReview) === JSON.stringify(expectedDesktopReleaseReview),
        'desktop-release-contract-desktop-release-review-invalid',
    );
    expect(
        JSON.stringify(matrix?.desktopReleasePayloadManifest) === JSON.stringify(expectedDesktopReleasePayloadManifest),
        'desktop-release-contract-desktop-release-payload-manifest-invalid',
    );
    expect(
        JSON.stringify(matrix?.desktopReleasePublicationPlan) === JSON.stringify(expectedDesktopReleasePublicationPlan),
        'desktop-release-contract-desktop-release-publication-plan-invalid',
    );
    expect(
        JSON.stringify(matrix?.desktopReleasePublicationHandoff) === JSON.stringify(expectedDesktopReleasePublicationHandoff),
        'desktop-release-contract-desktop-release-publication-handoff-invalid',
    );
    expect(
        JSON.stringify(matrix?.desktopReleaseGitHubReadiness) === JSON.stringify(expectedDesktopReleaseGitHubReadiness),
        'desktop-release-contract-desktop-release-github-readiness-invalid',
    );
    expect(hasExactValues(matrix?.candidateGate?.targetIds, candidateTargetIds), 'desktop-release-contract-candidate-target-order-invalid');
    expect(hasExactValues(matrix?.candidateGate?.prTargetIds, prCandidateTargetIds), 'desktop-release-contract-pr-target-order-invalid');
    expect(hasExactValues(matrix?.requiredRuntimeChecks, requiredRuntimeChecks), 'desktop-release-contract-runtime-checks-invalid');
    expect(hasExactValues(matrix?.requiredBuildChecks, requiredBuildChecks), 'desktop-release-contract-build-checks-invalid');
    try {
        const candidates = candidateTargets(matrix, 'full');
        const prCandidates = candidateTargets(matrix, 'pr');
        expect(candidates.every(({ developmentStatus, channel, evidenceStatus }) => (
            developmentStatus === 'candidate-gated' && channel === matrix.candidateGate.channel
                && evidenceStatus === 'not-run'
        )), 'desktop-release-contract-candidate-target-status-invalid');
        expect(
            prCandidates.length < candidates.length
                && prCandidates.every((target) => candidates.includes(target)),
            'desktop-release-contract-pr-targets-invalid',
        );
    } catch (error) {
        failures.push(error.message);
    }

    return failures;
};

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const [matrix, packageJson, tauriConfig, candidateConfig, windowsSigningCandidateConfig, windowsArm64SigningCandidateConfig, cargoToml, cargoLock] = await Promise.all([
        readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8').then(JSON.parse),
        readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
        readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8').then(JSON.parse),
        readFile(new URL('../src-tauri/tauri.phase9.conf.json', import.meta.url), 'utf8').then(JSON.parse),
        readFile(new URL('../src-tauri/tauri.windows-signed-candidate.conf.json', import.meta.url), 'utf8').then(JSON.parse),
        readFile(new URL('../src-tauri/tauri.windows-arm64-signed-candidate.conf.json', import.meta.url), 'utf8').then(JSON.parse),
        readFile(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8'),
        readFile(new URL('../src-tauri/Cargo.lock', import.meta.url), 'utf8'),
    ]);
    const failures = auditDesktopReleaseContract({
        matrix,
        packageJson,
        tauriConfig,
        candidateConfig,
        windowsSigningCandidateConfig,
        windowsArm64SigningCandidateConfig,
        cargoToml,
        cargoLock,
    });
    console.log(JSON.stringify({ status: failures.length ? 'failed' : 'passed', failures }, null, 2));
    if (failures.length) process.exitCode = 1;
}
