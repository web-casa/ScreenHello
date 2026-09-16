import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
    desktopArtifactProvenanceRepositoryId,
    githubAttestActionReference,
} from './desktop-artifact-provenance.mjs';

export const expectedWindowsSigningCandidate = Object.freeze({
    status: 'workflow-ready-not-run',
    workflow: '.github/workflows/windows-signed-candidate.yml',
    environment: 'windows-signing',
    target: 'windows-x64',
    runner: 'windows-2025',
    channel: 'github-actions-windows-signed-candidate',
    signing: 'authenticode-sha256',
    timestamp: 'rfc3161-sha256',
    config: 'src-tauri/tauri.windows-signed-candidate.conf.json',
    publicRelease: false,
    artifactRetentionDays: 14,
});

export const expectedWindowsArm64SigningCandidate = Object.freeze({
    status: 'workflow-ready-not-run',
    workflow: '.github/workflows/windows-arm64-signed-candidate.yml',
    environment: 'windows-signing',
    target: 'windows-arm64',
    runner: 'windows-11-arm',
    channel: 'github-actions-windows-arm64-signed-candidate',
    signing: 'authenticode-sha256',
    timestamp: 'rfc3161-sha256',
    config: 'src-tauri/tauri.windows-arm64-signed-candidate.conf.json',
    publicRelease: false,
    artifactRetentionDays: 14,
});

export const expectedWindowsSigningCandidateConfig = Object.freeze({
    bundle: {
        active: true,
        windows: {
            digestAlgorithm: 'sha256',
            timestampUrl: 'http://timestamp.digicert.com',
            tsp: true,
        },
    },
});

export const windowsSigningCandidateProfiles = Object.freeze({
    x64: Object.freeze({
        policyKey: 'windowsSigningCandidate',
        expected: expectedWindowsSigningCandidate,
        auditPrefix: 'windows-signed-candidate',
        workflowName: 'Windows Signed Candidate',
        confirmation: 'sign-windows-x64-candidate',
        target: 'windows-x64',
        runner: 'windows-2025',
        environment: 'windows-signing',
        channel: 'github-actions-windows-signed-candidate',
        config: 'src-tauri/tauri.windows-signed-candidate.conf.json',
        artifactDirectory: 'artifacts/windows-signed-candidate',
        artifactEnvironment: 'SCREENHELLO_WINDOWS_SIGNED_CANDIDATE_DIR',
        artifactName: 'windows-signed-candidate',
        artifactUploadLabel: 'Upload signed Windows candidate evidence',
        auditCommand: 'pnpm audit:desktop:windows-signed-candidate',
        signToolSelector: "Where-Object { $_.Directory.Name -eq 'x64' }",
    }),
    arm64: Object.freeze({
        policyKey: 'windowsArm64SigningCandidate',
        expected: expectedWindowsArm64SigningCandidate,
        auditPrefix: 'windows-arm64-signed-candidate',
        workflowName: 'Windows ARM64 Signed Candidate',
        confirmation: 'sign-windows-arm64-candidate',
        target: 'windows-arm64',
        runner: 'windows-11-arm',
        environment: 'windows-signing',
        channel: 'github-actions-windows-arm64-signed-candidate',
        config: 'src-tauri/tauri.windows-arm64-signed-candidate.conf.json',
        artifactDirectory: 'artifacts/windows-arm64-signed-candidate',
        artifactEnvironment: 'SCREENHELLO_WINDOWS_ARM64_SIGNED_CANDIDATE_DIR',
        artifactName: 'windows-arm64-signed-candidate',
        artifactUploadLabel: 'Upload signed Windows ARM64 candidate evidence',
        auditCommand: 'pnpm audit:desktop:windows-arm64-signed-candidate',
        rustTarget: 'aarch64-pc-windows-msvc',
        signToolSelector: "$signToolArchitectures = @('arm64', 'x64')",
    }),
});

const exactActionSha = /^[ \t]*uses:\s+[^\s@]+@[0-9a-f]{40}(?:\s+#.*)?$/u;
const localPnpmActionReference = './.github/actions/setup-pnpm';
const actionLineIsPinnedOrLocal = (line) => {
    const normalized = line.replace(/^\s*-\s*/u, '      ');
    return exactActionSha.test(normalized) || normalized.trim() === `uses: ${localPnpmActionReference}`;
};
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const normalizedPermissionBlock = (value) => value
    ?.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
const gitHubExpression = '$' + '{{';
const failureId = (profile, suffix) => profile.auditPrefix + '-' + suffix;

const stepBlock = (source, name) => {
    const marker = '      - name: ' + name + '\n';
    const start = source.indexOf(marker);
    if (start < 0) return '';
    const end = source.indexOf('\n      - name:', start + marker.length);
    return source.slice(start, end < 0 ? source.length : end);
};

const jobBlock = (source, name, nextName) => {
    const marker = '  ' + name + ':\n';
    const start = source.indexOf(marker);
    if (start < 0) return '';
    const next = nextName ? source.indexOf('\n  ' + nextName + ':', start + marker.length) : -1;
    return source.slice(start, next < 0 ? source.length : next);
};

const protectedMainCondition = (block, confirmation) => {
    const condition = block.match(/^\s{4}if:\s*>-\n(?<body>(?: {6}[^\n]*(?:\n|$))*)/mu)?.groups?.body;
    const expected = "github.repository_id == '" + desktopArtifactProvenanceRepositoryId + "' && github.event.repository.private && github.ref == 'refs/heads/main' && inputs.confirm == '" + confirmation + "'";
    return condition?.replace(/\s+/gu, ' ').trim() === expected;
};

const sameValues = (actual, expected) => (
    actual.length === expected.length
    && [...actual].sort().join(',') === [...expected].sort().join(',')
);

export const auditWindowsSigningCandidateWorkflow = (
    workflow,
    matrix,
    profile,
    candidateConfig,
) => {
    const source = String(workflow || '').replace(/\r\n?/gu, '\n');
    const failures = [];
    const expect = (condition, suffix) => {
        if (!condition) failures.push(failureId(profile, suffix));
    };
    const requireText = (value, suffix) => expect(source.includes(value), suffix);
    const forbid = (pattern, suffix, value = source) => expect(!pattern.test(value), suffix);
    const globalPermissions = source.match(/^permissions:\n(?<body>(?: {2}[^\n]*(?:\n|$))*)/mu)?.groups?.body;
    const preflight = jobBlock(source, 'preflight', 'sign');
    const sign = jobBlock(source, 'sign');
    const signPermissions = sign.match(/^ {4}permissions:\n(?<body>(?: {6}[^\n]*(?:\n|$))*)/mu)?.groups?.body;
    const importCertificate = stepBlock(source, 'Import Windows code-signing certificate');
    const signedBuild = stepBlock(source, 'Build signed and timestamped Windows candidate');
    const validation = stepBlock(source, 'Verify Authenticode signature and RFC 3161 timestamp');
    const cleanup = stepBlock(source, 'Remove temporary Windows signing material');
    const provenance = stepBlock(source, 'Generate signed candidate provenance attestation');
    const record = stepBlock(source, 'Record signed candidate provenance attestation');
    const sourceWithoutSign = sign ? source.replace(sign, '') : source;
    const actionLines = source.split('\n').filter((line) => /^\s*-?\s*uses:/u.test(line));
    const actionReferences = actionLines
        .map((line) => line.match(/uses:\s*([^\s#]+)/u)?.[1])
        .filter(Boolean);
    const secretReferences = [...source.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/gu)]
        .map((match) => match[1]);
    const sourceWithoutImport = source.replace(importCertificate, '');

    expect(sameJson(matrix?.[profile.policyKey], profile.expected), 'policy-invalid');
    expect(sameJson(candidateConfig, expectedWindowsSigningCandidateConfig), 'config-invalid');
    expect(!Object.hasOwn(candidateConfig?.bundle?.windows || {}, 'certificateThumbprint'), 'static-thumbprint-configured');
    expect(!Object.hasOwn(candidateConfig?.bundle?.windows || {}, 'signCommand'), 'custom-sign-command-configured');
    requireText('name: ' + profile.workflowName, 'name-missing');
    requireText('  workflow_dispatch:', 'manual-trigger-missing');
    requireText('      confirm:', 'confirmation-input-missing');
    requireText('          - ' + profile.confirmation, 'confirmation-choice-missing');
    forbid(/^\s{2}(?:pull_request|pull_request_target|push|release|schedule|workflow_call|workflow_run):/mu, 'extra-trigger-forbidden');
    expect(globalPermissions?.trim() === 'contents: read', 'permissions-invalid');
    expect(normalizedPermissionBlock(signPermissions) === [
        'contents: read',
        'id-token: write',
        'attestations: write',
        'artifact-metadata: write',
    ].join('\n'), 'provenance-permissions-invalid');
    forbid(/(?:contents|packages|id-token|attestations|artifact-metadata):\s*write/iu, 'write-permission-outside-sign', sourceWithoutSign);
    forbid(/^\s{4,}permissions:\s*$/mu, 'job-permissions-outside-sign', sourceWithoutSign);
    forbid(/(?:tauri-apps\/tauri-action|softprops\/action-gh-release|actions\/attest-build-provenance|gh\s+release|git\s+tag|npm\s+publish|pnpm\s+publish)/iu, 'release-operation-forbidden');
    expect(Boolean(preflight) && Boolean(sign), 'jobs-missing');
    expect(protectedMainCondition(preflight, profile.confirmation)
        && protectedMainCondition(sign, profile.confirmation), 'protected-main-condition-invalid');
    expect(!preflight.includes('environment:'), 'preflight-environment-forbidden');
    expect(sign.includes('needs: preflight') && sign.includes('environment: ' + profile.environment), 'environment-boundary-invalid');
    expect(preflight.includes('runs-on: ' + profile.runner) && sign.includes('runs-on: ' + profile.runner), 'runner-invalid');
    requireText('SCREENHELLO_DESKTOP_TARGET: ' + profile.target, 'target-invalid');
    requireText('SCREENHELLO_DESKTOP_PACKAGE_CHANNEL: ' + profile.channel, 'channel-invalid');
    requireText(profile.artifactEnvironment + ': ' + profile.artifactDirectory, 'artifact-directory-invalid');
    expect(
        preflight.includes('--config ' + profile.config)
            && importCertificate.includes("Get-Content -LiteralPath '" + profile.config + "' -Raw"),
        'config-path-invalid',
    );
    if (profile.rustTarget) {
        requireText('rustup target add ' + profile.rustTarget, 'rust-target-install-missing');
        expect(signedBuild.includes('--target ' + profile.rustTarget)
            && preflight.includes('--target ' + profile.rustTarget), 'rust-target-build-missing');
    }
    expect((source.match(/ref: \$\{\{\s*github\.sha\s*\}\}/gu) || []).length === 2, 'checkout-ref-invalid');
    expect((source.match(/persist-credentials: false/gu) || []).length === 2, 'checkout-credentials-invalid');
    expect(actionLines.length > 0
        && actionLines.every((line) => actionLineIsPinnedOrLocal(line)), 'action-pin-invalid');
    const allowedActions = new Map([
        ['actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 2],
        ['actions/setup-node@820762786026740c76f36085b0efc47a31fe5020', 2],
        [localPnpmActionReference, 2],
        [githubAttestActionReference, 1],
        ['actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a', 1],
    ]);
    expect(
        actionReferences.length === [...allowedActions.values()].reduce((total, value) => total + value, 0)
            && [...allowedActions].every(([action, count]) => actionReferences.filter((value) => value === action).length === count)
            && actionReferences.every((action) => allowedActions.has(action)),
        'action-allowlist-invalid',
    );
    expect(sameValues(secretReferences, ['WINDOWS_CERTIFICATE', 'WINDOWS_CERTIFICATE_PASSWORD']), 'secret-set-invalid');
    requireText('pnpm audit:github-actions', 'github-actions-audit-missing');
    expect(!/\$\{\{\s*secrets\./u.test(sourceWithoutImport), 'secret-scope-invalid');
    expect(importCertificate.includes('WINDOWS_CERTIFICATE: ' + gitHubExpression + ' secrets.WINDOWS_CERTIFICATE }}')
        && importCertificate.includes('WINDOWS_CERTIFICATE_PASSWORD: ' + gitHubExpression + ' secrets.WINDOWS_CERTIFICATE_PASSWORD }}')
        && importCertificate.includes('if ([string]::IsNullOrWhiteSpace($env:WINDOWS_CERTIFICATE_PASSWORD))')
        && importCertificate.includes('[Convert]::FromBase64String($env:WINDOWS_CERTIFICATE)')
        && importCertificate.includes("Import-PfxCertificate -FilePath $certificatePath -CertStoreLocation 'Cert:\\CurrentUser\\My' -Password $securePassword")
        && importCertificate.includes("'1.3.6.1.5.5.7.3.3'")
        && importCertificate.includes('certificateThumbprint')
        && importCertificate.includes('Remove-Item -LiteralPath $certificatePath'), 'certificate-import-invalid');
    expect(signedBuild.includes('pnpm exec tauri build --ci --bundles nsis')
        && signedBuild.includes('--config "$env:SCREENHELLO_WINDOWS_SIGNING_CONFIG"')
        && !signedBuild.includes('--no-sign'), 'signing-build-invalid');
    expect(validation.includes(profile.signToolSelector)
        && validation.includes('& $signTool verify /pa /all /tw /v $artifact')
        && validation.includes('signtool-validation.txt')
        && validation.includes("timestamp = 'rfc3161-sha256'"), 'signature-validation-invalid');
    expect(importCertificate.includes('} finally {')
        && importCertificate.includes('Cert:\\CurrentUser\\My\\$thumbprint')
        && cleanup.includes('if: always()')
        && cleanup.includes("$ErrorActionPreference = 'Stop'")
        && cleanup.includes('$certificateStorePath = "Cert:\\CurrentUser\\My\\$thumbprint"')
        && cleanup.includes('Remove-Item -LiteralPath $certificateStorePath -Force')
        && cleanup.includes('if (Test-Path -LiteralPath $certificateStorePath)')
        && cleanup.includes('Temporary code-signing certificate $thumbprint remains')
        && cleanup.includes('Remove-Item -LiteralPath $runtimeConfigPath -Force')
        && cleanup.includes('Temporary Windows signing runtime configuration remains after cleanup.')
        && !cleanup.includes('SilentlyContinue'), 'credential-cleanup-missing');
    requireText(profile.auditCommand, 'self-audit-missing');
    requireText('pnpm audit:desktop:artifact-provenance', 'provenance-audit-missing');
    requireText('pnpm desktop:inspect', 'payload-inspection-missing');
    requireText('pnpm desktop:sbom', 'sbom-missing');
    requireText('Get-FileHash -LiteralPath $file -Algorithm SHA256', 'checksum-missing');
    expect(
        provenance.includes(`id: provenance\n        uses: ${githubAttestActionReference} # v4.2.2`)
            && provenance.includes(`subject-path: ${profile.artifactDirectory}/*-setup.exe`)
            && provenance.includes('show-summary: false')
            && record.includes('node scripts/desktop-artifact-provenance.mjs')
            && record.includes(`--target ${profile.target}`)
            && record.includes('provenance.outputs.bundle-path'),
        'provenance-record-invalid',
    );
    requireText(profile.artifactUploadLabel, 'artifact-upload-missing');
    requireText('name: ' + profile.artifactName + '-' + gitHubExpression + ' github.sha }}-' + gitHubExpression + ' github.run_attempt }}', 'artifact-name-invalid');
    requireText('path: ' + profile.artifactDirectory + '/', 'artifact-path-invalid');
    expect((source.match(/retention-days: 14/gu) || []).length === 1, 'retention-invalid');

    return failures;
};

export const auditWindowsSignedCandidateWorkflow = (workflow, matrix, candidateConfig) => (
    auditWindowsSigningCandidateWorkflow(
        workflow,
        matrix,
        windowsSigningCandidateProfiles.x64,
        candidateConfig,
    )
);

export const auditWindowsArm64SignedCandidateWorkflow = (workflow, matrix, candidateConfig) => (
    auditWindowsSigningCandidateWorkflow(
        workflow,
        matrix,
        windowsSigningCandidateProfiles.arm64,
        candidateConfig,
    )
);

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const [matrix, workflow, candidateConfig] = await Promise.all([
        readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8').then(JSON.parse),
        readFile(new URL('../.github/workflows/windows-signed-candidate.yml', import.meta.url), 'utf8'),
        readFile(new URL('../src-tauri/tauri.windows-signed-candidate.conf.json', import.meta.url), 'utf8').then(JSON.parse),
    ]);
    const failures = auditWindowsSignedCandidateWorkflow(workflow, matrix, candidateConfig);
    console.log(JSON.stringify({ status: failures.length ? 'failed' : 'passed', failures }, null, 2));
    if (failures.length) process.exitCode = 1;
}
