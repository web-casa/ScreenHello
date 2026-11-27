import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
    auditMacosSignedCandidateWorkflow,
    expectedMacosIntelSigningCandidate,
    expectedMacosSigningCandidate,
    macosSigningCandidateProfiles,
} from './audit-macos-signed-candidate-workflow.mjs';
import {
    auditWindowsArm64SignedCandidateWorkflow,
    auditWindowsSignedCandidateWorkflow,
    expectedWindowsArm64SigningCandidate,
    expectedWindowsSigningCandidate,
    expectedWindowsSigningCandidateConfig,
} from './audit-windows-signed-candidate-workflow.mjs';
import {
    auditLinuxDebRepositorySignedCandidateWorkflow,
    expectedLinuxDebRepositorySigningCandidate,
} from './audit-linux-deb-repository-signed-candidate-workflow.mjs';
import { auditLinuxDebRepositoryKeyLifecycleCandidateWorkflow } from './audit-linux-deb-repository-key-lifecycle-candidate-workflow.mjs';
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
import { auditDesktopArtifactProvenanceCandidateWorkflows } from './audit-desktop-artifact-provenance-candidate-workflows.mjs';

export const expectedReleaseTrustPolicy = Object.freeze({
    status: 'macos-windows-linux-deb-provenance-platform-acceptance-release-review-payload-manifest-publication-plan-public-export-handoff-and-github-readiness-candidate-workflows-ready',
    candidateIsolation: 'unsigned-test-only-no-secrets',
    macos: {
        status: 'arm64-and-x64-workflows-ready-not-run',
        protection: 'environment-and-org-secret-scope-pending-verification',
        directDownload: 'developer-id-application-and-notarization-required',
        identity: 'developer-id-application',
    },
    windows: {
        status: 'x64-and-arm64-workflows-ready-not-run',
        protection: 'environment-and-org-secret-scope-pending-verification',
        directDownload: 'authenticode-sha256-and-rfc3161-timestamp-required',
        signingMechanism: 'pfx-current-user-store',
        timestamp: 'rfc3161-sha256',
    },
    linux: {
        status: 'amd64-and-arm64-repository-and-key-lifecycle-workflow-ready-not-run',
        currentBundle: 'deb',
        repositorySigning: 'openpgp-release-and-inrelease',
        protection: 'environment-and-secret-scope-pending-verification',
        keyDistribution: 'internal-client-trust-bundle-candidate-no-public-endpoint',
        keyRotation: 'optional-next-public-key-overlap-workflow-ready-not-run',
        revocation: 'offline-certificate-and-out-of-band-bootstrap-policy-ready-not-run',
    },
    updater: {
        status: 'disabled',
        plugin: 'not-installed',
        trustRoot: 'not-configured',
        endpoints: 'not-configured',
        keyRotation: 'not-configured',
    },
    provenance: {
        status: 'protected-signed-candidate-attestation-and-local-receipt-revalidation-ready-not-run',
        githubAttestation: 'actions-attest-v4-minimum-permissions-ready-not-run',
        localVerification: 'gh-cli-strict-identity-atomic-receipt-and-local-revalidation-ready-not-run',
        privateRepositoryAvailability: 'github-enterprise-cloud-required-for-private-artifact-attestations',
        publicRelease: false,
    },
    platformAcceptance: {
        status: 'per-target-candidate-receipt-bound-manual-evidence-and-cross-candidate-review-ready-not-run',
        localVerification: 'plan-record-evidence-and-cross-candidate-sha256-revalidation-required',
        crossCandidateReview: 'same-immutable-candidate-sha-required',
        publicRelease: false,
    },
    releaseReview: {
        status: 'cross-platform-acceptance-bound-external-dossier-ready-not-run',
        localVerification: 'cross-platform-plan-and-record-evidence-sha256-revalidation-required',
        publicRelease: false,
    },
    releasePayloadManifest: {
        status: 'release-review-bound-attested-candidate-payload-inventory-ready-not-run',
        localVerification: 'release-review-and-attested-subject-sha256-revalidation-required',
        publicRelease: false,
    },
    publicReleasePromotion: {
        status: 'candidate-public-export-and-direct-download-handoff-ready-not-run',
        localVerification: 'publication-plan-candidate-package-json-and-public-export-snapshot-sha256-revalidation-required',
        publicTarget: 'github-release-direct-download-target-identity-verified-public-source-commit-and-publisher-not-configured',
        linuxAptRepository: 'separate-static-https-layout-endpoint-required',
        publicRelease: false,
    },
    githubReadiness: {
        status: 'enterprise-cloud-private-candidate-repository-identity-and-remote-configuration-audit-ready-not-run',
        localVerification: 'read-only-gh-api-private-repository-organization-plan-branch-environment-secret-scope-and-action-policy-required',
        publicRelease: false,
    },
});

export const desktopReleaseTrustBlockers = Object.freeze([
    'protected-public-release-workflow-not-configured',
    'public-direct-download-promotion-environment-and-publisher-identity-not-configured',
    'public-source-commit-must-match-candidate-export-snapshot',
    'macos-arm64-and-x64-signed-candidate-environment-protection-and-run-evidence-pending',
    'macos-install-permission-and-lifecycle-manual-checks-pending',
    'windows-x64-and-arm64-signed-candidate-environment-protection-and-run-evidence-pending',
    'linux-deb-repository-signed-candidate-environment-protection-and-run-evidence-pending',
    'linux-deb-client-trust-bundle-environment-protection-and-run-evidence-pending',
    'linux-deb-public-key-distribution-rotation-and-revocation-drill-pending',
    'linux-apt-public-endpoint-key-distribution-and-rotation-drill-not-configured',
    'updater-trust-root-endpoints-and-key-rotation-not-configured',
    'github-artifact-attestation-private-plan-protected-environment-and-run-evidence-pending',
    'github-enterprise-cloud-private-candidate-entitlement-pending',
    'private-candidate-repository-identity-and-github-configuration-pending',
    'platform-install-permission-and-lifecycle-manual-checks-pending',
    'cross-platform-acceptance-local-release-review-and-payload-manifest-pending',
]);

const hasOwn = (value, key) => Boolean(value && Object.hasOwn(value, key));
const hasDependency = (packageJson, name) => (
    ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
        .some((group) => hasOwn(packageJson?.[group], name))
);
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export const auditDesktopReleaseTrust = ({
    matrix,
    packageJson,
    tauriConfig,
    candidateConfig,
    cargoToml,
    workflow,
    macosSignedCandidateWorkflow,
    macosIntelSignedCandidateWorkflow,
    windowsSignedCandidateWorkflow,
    windowsSigningCandidateConfig,
    windowsArm64SignedCandidateWorkflow,
    windowsArm64SigningCandidateConfig,
    linuxDebRepositorySignedCandidateWorkflow,
}) => {
    const failures = [];
    const expect = (condition, id) => {
        if (!condition) failures.push(id);
    };
    const candidateWorkflow = String(workflow || '').replace(/\r\n?/gu, '\n');
    const forbid = (pattern, id) => expect(!pattern.test(candidateWorkflow), id);
    const bundle = tauriConfig?.bundle;
    const globalPermissions = candidateWorkflow.match(/^permissions:\n(?<body>(?: {2}[^\n]*(?:\n|$))*)/mu)?.groups?.body;

    expect(matrix?.schemaVersion === 24, 'desktop-release-trust-schema-invalid');
    expect(sameJson(matrix?.releaseTrustPolicy, expectedReleaseTrustPolicy), 'desktop-release-trust-policy-invalid');
    expect(sameJson(matrix?.macosSigningCandidate, expectedMacosSigningCandidate), 'desktop-release-trust-macos-signed-candidate-policy-invalid');
    expect(sameJson(matrix?.macosIntelSigningCandidate, expectedMacosIntelSigningCandidate), 'desktop-release-trust-macos-intel-signed-candidate-policy-invalid');
    expect(sameJson(matrix?.windowsSigningCandidate, expectedWindowsSigningCandidate), 'desktop-release-trust-windows-signed-candidate-policy-invalid');
    expect(sameJson(matrix?.windowsArm64SigningCandidate, expectedWindowsArm64SigningCandidate), 'desktop-release-trust-windows-arm64-signed-candidate-policy-invalid');
    expect(sameJson(matrix?.linuxDebRepositorySigningCandidate, expectedLinuxDebRepositorySigningCandidate), 'desktop-release-trust-linux-deb-repository-signed-candidate-policy-invalid');
    expect(sameJson(matrix?.linuxDebRepositoryKeyLifecycleCandidate, expectedLinuxDebRepositoryKeyLifecycleCandidate), 'desktop-release-trust-linux-deb-key-lifecycle-candidate-policy-invalid');
    expect(sameJson(matrix?.desktopArtifactProvenanceCandidate, expectedDesktopArtifactProvenanceCandidate), 'desktop-release-trust-desktop-artifact-provenance-candidate-policy-invalid');
    expect(sameJson(matrix?.desktopArtifactProvenanceVerification, expectedDesktopArtifactProvenanceVerification), 'desktop-release-trust-desktop-artifact-provenance-verification-policy-invalid');
    expect(sameJson(matrix?.desktopPlatformAcceptance, expectedDesktopPlatformAcceptance), 'desktop-release-trust-desktop-platform-acceptance-policy-invalid');
    expect(sameJson(matrix?.desktopCrossPlatformAcceptance, expectedDesktopCrossPlatformAcceptance), 'desktop-release-trust-desktop-cross-platform-acceptance-policy-invalid');
    expect(sameJson(matrix?.desktopReleaseReview, expectedDesktopReleaseReview), 'desktop-release-trust-desktop-release-review-policy-invalid');
    expect(sameJson(matrix?.desktopReleasePayloadManifest, expectedDesktopReleasePayloadManifest), 'desktop-release-trust-desktop-release-payload-manifest-policy-invalid');
    expect(sameJson(matrix?.desktopReleasePublicationPlan, expectedDesktopReleasePublicationPlan), 'desktop-release-trust-desktop-release-publication-plan-policy-invalid');
    expect(sameJson(matrix?.desktopReleasePublicationHandoff, expectedDesktopReleasePublicationHandoff), 'desktop-release-trust-desktop-release-publication-handoff-policy-invalid');
    expect(sameJson(matrix?.desktopReleaseGitHubReadiness, expectedDesktopReleaseGitHubReadiness), 'desktop-release-trust-desktop-release-github-readiness-policy-invalid');
    expect(matrix?.candidateGate?.signing === 'unsigned-test-only', 'desktop-release-trust-candidate-signing-invalid');
    expect(sameJson(candidateConfig, { bundle: { active: true } }), 'desktop-release-trust-candidate-config-invalid');
    expect(sameJson(windowsSigningCandidateConfig, expectedWindowsSigningCandidateConfig), 'desktop-release-trust-windows-signed-candidate-config-invalid');
    expect(sameJson(windowsArm64SigningCandidateConfig, expectedWindowsSigningCandidateConfig), 'desktop-release-trust-windows-arm64-signed-candidate-config-invalid');

    expect(bundle?.active === false, 'desktop-release-trust-base-bundle-state-invalid');
    expect(!hasOwn(bundle, 'createUpdaterArtifacts'), 'desktop-release-trust-updater-artifacts-configured');
    expect(!hasOwn(tauriConfig?.plugins, 'updater'), 'desktop-release-trust-updater-plugin-configured');
    expect(!hasOwn(bundle?.macOS, 'signingIdentity'), 'desktop-release-trust-macos-signing-identity-configured');
    expect(!hasOwn(bundle?.windows, 'signCommand'), 'desktop-release-trust-windows-sign-command-configured');
    expect(!hasDependency(packageJson, '@tauri-apps/plugin-updater'), 'desktop-release-trust-js-updater-plugin-configured');
    expect(!/\btauri-plugin-updater\b/u.test(String(cargoToml || '')), 'desktop-release-trust-rust-updater-plugin-configured');

    expect(globalPermissions?.trim() === 'contents: read', 'desktop-release-trust-candidate-permissions-invalid');
    expect(candidateWorkflow.includes('--no-sign'), 'desktop-release-trust-candidate-no-sign-missing');
    expect(candidateWorkflow.includes('Upload unsigned test evidence'), 'desktop-release-trust-candidate-evidence-label-invalid');
    forbid(/\$\{\{\s*secrets\./iu, 'desktop-release-trust-candidate-secret-context-configured');
    forbid(/^\s{4,}permissions:\s*$/mu, 'desktop-release-trust-candidate-job-permissions-configured');
    forbid(/\b(?:TAURI_SIGNING(?:_PRIVATE_KEY(?:_PASSWORD)?)?|APPLE_(?:CERTIFICATE(?:_PASSWORD)?|ID|PASSWORD|TEAM_ID|API_(?:KEY(?:_ID|_ISSUER|_PATH)?|ISSUER))|WINDOWS_(?:CERTIFICATE|CERTIFICATE_PASSWORD)|LINUX_REPOSITORY_SIGNING_(?:PRIVATE_KEY|PASSPHRASE)|CSC_(?:LINK|KEY_PASSWORD))\b/iu, 'desktop-release-trust-candidate-signing-credential-reference-configured');
    forbid(/\b(?:id-token|attestations|artifact-metadata)\s*:\s*write\b/iu, 'desktop-release-trust-candidate-provenance-permission-configured');
    forbid(/actions\/attest(?:-build-provenance)?@/iu, 'desktop-release-trust-candidate-attestation-action-configured');
    forbid(/(?:tauri-apps\/tauri-action|softprops\/action-gh-release|gh\s+release|git\s+tag|npm\s+publish|pnpm\s+publish)/iu, 'desktop-release-trust-candidate-release-operation-configured');
    expect(
        auditMacosSignedCandidateWorkflow(
            macosSignedCandidateWorkflow,
            matrix,
            macosSigningCandidateProfiles.arm64,
        ).length === 0,
        'desktop-release-trust-macos-signed-candidate-workflow-invalid',
    );
    expect(
        auditMacosSignedCandidateWorkflow(
            macosIntelSignedCandidateWorkflow,
            matrix,
            macosSigningCandidateProfiles.x64,
        ).length === 0,
        'desktop-release-trust-macos-intel-signed-candidate-workflow-invalid',
    );
    expect(
        auditWindowsSignedCandidateWorkflow(
            windowsSignedCandidateWorkflow,
            matrix,
            windowsSigningCandidateConfig,
        ).length === 0,
        'desktop-release-trust-windows-signed-candidate-workflow-invalid',
    );
    expect(
        auditWindowsArm64SignedCandidateWorkflow(
            windowsArm64SignedCandidateWorkflow,
            matrix,
            windowsArm64SigningCandidateConfig,
        ).length === 0,
        'desktop-release-trust-windows-arm64-signed-candidate-workflow-invalid',
    );
    expect(
        auditLinuxDebRepositorySignedCandidateWorkflow(
            linuxDebRepositorySignedCandidateWorkflow,
            matrix,
        ).length === 0,
        'desktop-release-trust-linux-deb-repository-signed-candidate-workflow-invalid',
    );
    expect(
        auditLinuxDebRepositoryKeyLifecycleCandidateWorkflow(
            linuxDebRepositorySignedCandidateWorkflow,
            matrix,
        ).length === 0,
        'desktop-release-trust-linux-deb-key-lifecycle-candidate-workflow-invalid',
    );
    expect(
        auditDesktopArtifactProvenanceCandidateWorkflows({
            matrix,
            macosArm64Workflow: macosSignedCandidateWorkflow,
            macosX64Workflow: macosIntelSignedCandidateWorkflow,
            windowsX64Workflow: windowsSignedCandidateWorkflow,
            windowsArm64Workflow: windowsArm64SignedCandidateWorkflow,
            linuxDebRepositoryWorkflow: linuxDebRepositorySignedCandidateWorkflow,
        }).length === 0,
        'desktop-release-trust-desktop-artifact-provenance-candidate-workflows-invalid',
    );

    return failures;
};

export const desktopReleaseTrustReport = (input) => {
    const failures = auditDesktopReleaseTrust(input);
    return {
        status: failures.length ? 'failed' : 'passed',
        phase: 'signing-readiness',
        releaseReady: false,
        blockers: desktopReleaseTrustBlockers,
        failures,
    };
};

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const [
        matrix,
        packageJson,
        tauriConfig,
        candidateConfig,
        cargoToml,
        workflow,
        macosSignedCandidateWorkflow,
        macosIntelSignedCandidateWorkflow,
        windowsSignedCandidateWorkflow,
        windowsSigningCandidateConfig,
        windowsArm64SignedCandidateWorkflow,
        windowsArm64SigningCandidateConfig,
        linuxDebRepositorySignedCandidateWorkflow,
    ] = await Promise.all([
        readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8').then(JSON.parse),
        readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
        readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8').then(JSON.parse),
        readFile(new URL('../src-tauri/tauri.phase9.conf.json', import.meta.url), 'utf8').then(JSON.parse),
        readFile(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8'),
        readFile(new URL('../.github/workflows/desktop-release-gate.yml', import.meta.url), 'utf8'),
        readFile(new URL('../.github/workflows/macos-signed-candidate.yml', import.meta.url), 'utf8'),
        readFile(new URL('../.github/workflows/macos-intel-signed-candidate.yml', import.meta.url), 'utf8'),
        readFile(new URL('../.github/workflows/windows-signed-candidate.yml', import.meta.url), 'utf8'),
        readFile(new URL('../src-tauri/tauri.windows-signed-candidate.conf.json', import.meta.url), 'utf8').then(JSON.parse),
        readFile(new URL('../.github/workflows/windows-arm64-signed-candidate.yml', import.meta.url), 'utf8'),
        readFile(new URL('../src-tauri/tauri.windows-arm64-signed-candidate.conf.json', import.meta.url), 'utf8').then(JSON.parse),
        readFile(new URL('../.github/workflows/linux-deb-repository-signed-candidate.yml', import.meta.url), 'utf8'),
    ]);
    const report = desktopReleaseTrustReport({
        matrix,
        packageJson,
        tauriConfig,
        candidateConfig,
        cargoToml,
        workflow,
        macosSignedCandidateWorkflow,
        macosIntelSignedCandidateWorkflow,
        windowsSignedCandidateWorkflow,
        windowsSigningCandidateConfig,
        windowsArm64SignedCandidateWorkflow,
        windowsArm64SigningCandidateConfig,
        linuxDebRepositorySignedCandidateWorkflow,
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.failures.length) process.exitCode = 1;
}
