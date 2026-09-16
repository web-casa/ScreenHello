import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
    desktopArtifactProvenanceRepositoryId,
    githubAttestActionReference,
} from './desktop-artifact-provenance.mjs';

export const expectedMacosSigningCandidate = Object.freeze({
    status: 'workflow-ready-not-run',
    workflow: '.github/workflows/macos-signed-candidate.yml',
    environment: 'macos-signing',
    target: 'macos-arm64',
    runner: 'macos-14',
    channel: 'github-actions-macos-signed-candidate',
    signing: 'developer-id-application',
    notarization: 'apple-id-app-specific-password',
    publicRelease: false,
    artifactRetentionDays: 14,
});

export const expectedMacosIntelSigningCandidate = Object.freeze({
    status: 'workflow-ready-not-run',
    workflow: '.github/workflows/macos-intel-signed-candidate.yml',
    environment: 'macos-signing',
    target: 'macos-x64',
    runner: 'macos-15-intel',
    channel: 'github-actions-macos-intel-signed-candidate',
    signing: 'developer-id-application',
    notarization: 'apple-id-app-specific-password',
    publicRelease: false,
    artifactRetentionDays: 14,
});

export const macosSigningCandidateProfiles = Object.freeze({
    arm64: Object.freeze({
        policyKey: 'macosSigningCandidate',
        expected: expectedMacosSigningCandidate,
        auditPrefix: 'macos-signed-candidate',
        workflowName: 'macOS Signed Candidate',
        confirmation: 'sign-macos-arm64-candidate',
        target: 'macos-arm64',
        runner: 'macos-14',
        channel: 'github-actions-macos-signed-candidate',
        artifactDirectory: 'artifacts/macos-signed-candidate',
        artifactName: 'macos-signed-candidate',
        artifactUploadLabel: 'Upload signed macOS candidate evidence',
    }),
    x64: Object.freeze({
        policyKey: 'macosIntelSigningCandidate',
        expected: expectedMacosIntelSigningCandidate,
        auditPrefix: 'macos-intel-signed-candidate',
        workflowName: 'macOS Intel Signed Candidate',
        confirmation: 'sign-macos-x64-candidate',
        target: 'macos-x64',
        runner: 'macos-15-intel',
        channel: 'github-actions-macos-intel-signed-candidate',
        artifactDirectory: 'artifacts/macos-intel-signed-candidate',
        artifactName: 'macos-intel-signed-candidate',
        artifactUploadLabel: 'Upload signed macOS Intel candidate evidence',
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
const failureId = (profile, suffix) => profile.auditPrefix + '-' + suffix;
const gitHubExpression = '$' + '{{';

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

const sameValues = (actual, expected) => (
    actual.length === expected.length
    && [...actual].sort().join(',') === [...expected].sort().join(',')
);

const protectedMainCondition = (block, confirmation) => {
    const condition = block.match(/^\s{4}if:\s*>-\n(?<body>(?: {6}[^\n]*(?:\n|$))*)/mu)?.groups?.body;
    const expected = "github.repository_id == '" + desktopArtifactProvenanceRepositoryId + "' && github.event.repository.private && github.ref == 'refs/heads/main' && inputs.confirm == '" + confirmation + "'";
    return condition?.replace(/\s+/gu, ' ').trim() === expected;
};

export const auditMacosSignedCandidateWorkflow = (
    workflow,
    matrix,
    profile = macosSigningCandidateProfiles.arm64,
) => {
    const source = String(workflow || '').replace(/\r\n?/gu, '\n');
    const failures = [];
    const id = (suffix) => failureId(profile, suffix);
    const expect = (condition, suffix) => {
        if (!condition) failures.push(id(suffix));
    };
    const requireText = (value, suffix) => expect(source.includes(value), suffix);
    const forbid = (pattern, suffix, value = source) => expect(!pattern.test(value), suffix);
    const globalPermissions = source.match(/^permissions:\n(?<body>(?: {2}[^\n]*(?:\n|$))*)/mu)?.groups?.body;
    const preflight = jobBlock(source, 'preflight', 'sign');
    const sign = jobBlock(source, 'sign');
    const signPermissions = sign.match(/^ {4}permissions:\n(?<body>(?: {6}[^\n]*(?:\n|$))*)/mu)?.groups?.body;
    const importCertificate = stepBlock(source, 'Import Developer ID certificate');
    const signedBuild = stepBlock(source, 'Build signed and notarized macOS candidate');
    const validation = stepBlock(source, 'Verify code signature, stapling, and Gatekeeper assessment');
    const cleanup = stepBlock(source, 'Remove the temporary signing keychain');
    const provenance = stepBlock(source, 'Generate signed candidate provenance attestation');
    const record = stepBlock(source, 'Record signed candidate provenance attestation');
    const sourceWithoutSign = sign ? source.replace(sign, '') : source;
    const actionLines = source.split('\n').filter((line) => /^\s*-?\s*uses:/u.test(line));
    const actionReferences = actionLines
        .map((line) => line.match(/uses:\s*([^\s#]+)/u)?.[1])
        .filter(Boolean);
    const secretReferences = [...source.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/gu)]
        .map((match) => match[1]);
    const expectedSecrets = [
        'MACOS_CERTIFICATE_P12_BASE64',
        'APPLE_ID',
        'APPLE_APP_SPECIFIC_PASSWORD',
        'APPLE_TEAM_ID',
    ];
    const sourceWithoutSigningSteps = source
        .replace(importCertificate, '')
        .replace(signedBuild, '');

    expect(sameJson(matrix?.[profile.policyKey], profile.expected), 'policy-invalid');
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
    expect(sign.includes('needs: preflight') && sign.includes('environment: macos-signing'), 'environment-boundary-invalid');
    expect(preflight.includes('runs-on: ' + profile.runner)
        && sign.includes('runs-on: ' + profile.runner), 'runner-invalid');
    requireText('SCREENHELLO_DESKTOP_TARGET: ' + profile.target, 'target-invalid');
    requireText('SCREENHELLO_DESKTOP_PACKAGE_CHANNEL: ' + profile.channel, 'channel-invalid');
    requireText('SCREENHELLO_MACOS_SIGNED_CANDIDATE_DIR: ' + profile.artifactDirectory, 'artifact-directory-invalid');
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
    expect(sameValues(secretReferences, expectedSecrets), 'secret-set-invalid');
    requireText('pnpm audit:github-actions', 'github-actions-audit-missing');
    expect(!/\$\{\{\s*secrets\./u.test(sourceWithoutSigningSteps), 'secret-scope-invalid');
    expect(importCertificate.includes('APPLE_CERTIFICATE: ' + gitHubExpression + ' secrets.MACOS_CERTIFICATE_P12_BASE64 }}')
        && importCertificate.includes('APPLE_CERTIFICATE_PASSWORD: ""')
        && importCertificate.includes('openssl rand -base64')
        && importCertificate.includes('security create-keychain')
        && importCertificate.includes("sed -E 's/^[[:space:]]*\"//; s/\"[[:space:]]*$//'")
        && importCertificate.includes("*$'\\n'*|*$'\\r'*)")
        && importCertificate.includes('security import "$certificate" -k "$keychain" -P "$APPLE_CERTIFICATE_PASSWORD"')
        && importCertificate.includes('security set-key-partition-list')
        && importCertificate.includes('security find-identity')
        && importCertificate.includes('Developer ID Application:'), 'keychain-import-invalid');
    expect(signedBuild.includes('APPLE_ID: ' + gitHubExpression + ' secrets.APPLE_ID }}')
        && signedBuild.includes('APPLE_PASSWORD: ' + gitHubExpression + ' secrets.APPLE_APP_SPECIFIC_PASSWORD }}')
        && signedBuild.includes('APPLE_TEAM_ID: ' + gitHubExpression + ' secrets.APPLE_TEAM_ID }}')
        && signedBuild.includes('pnpm exec tauri build --ci --bundles dmg --config src-tauri/tauri.phase9.conf.json'), 'signing-env-invalid');
    expect(!signedBuild.includes('--no-sign') && !signedBuild.includes('--skip-stapling'), 'signing-flags-invalid');
    expect(validation.includes('codesign --verify --deep --strict --verbose=2 "$application"')
        && validation.includes("sed -n 's/^Authority=\\(Developer ID Application:.*\\)$/\\1/p'")
        && validation.includes('xcrun stapler validate "$application"')
        && validation.includes('xcrun stapler validate "$SCREENHELLO_DESKTOP_BUNDLE"')
        && validation.includes('spctl --assess --type open --context context:primary-signature -vv "$application"')
        && validation.includes('signing-validation.json'), 'validation-missing');
    expect(
        importCertificate.includes('security delete-keychain')
            && cleanup.includes('security delete-keychain')
            && cleanup.includes('if: always()')
            && cleanup.includes('security default-keychain -s')
            && cleanup.includes('if [ -e "$SCREENHELLO_SIGNING_KEYCHAIN" ]; then')
            && !cleanup.includes('security delete-keychain "$SCREENHELLO_SIGNING_KEYCHAIN" || true'),
        'keychain-cleanup-missing',
    );
    requireText('pnpm audit:desktop:macos-signed-candidate', 'self-audit-missing');
    requireText('pnpm audit:desktop:artifact-provenance', 'provenance-audit-missing');
    requireText('pnpm desktop:inspect', 'payload-inspection-missing');
    requireText('pnpm desktop:sbom', 'sbom-missing');
    requireText('shasum -a 256', 'checksum-missing');
    expect(
        provenance.includes(`id: provenance\n        uses: ${githubAttestActionReference} # v4.2.2`)
            && provenance.includes(`subject-path: ${profile.artifactDirectory}/*.dmg`)
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

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const [matrix, workflows] = await Promise.all([
        readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8').then(JSON.parse),
        Promise.all(Object.entries(macosSigningCandidateProfiles).map(async ([name, profile]) => [
            name,
            await readFile(new URL('../' + profile.expected.workflow, import.meta.url), 'utf8'),
        ])),
    ]);
    const candidates = Object.fromEntries(workflows.map(([name, workflow]) => [
        name,
        auditMacosSignedCandidateWorkflow(workflow, matrix, macosSigningCandidateProfiles[name]),
    ]));
    const failures = Object.values(candidates).flat();
    console.log(JSON.stringify({ status: failures.length ? 'failed' : 'passed', candidates }, null, 2));
    if (failures.length) process.exitCode = 1;
}
