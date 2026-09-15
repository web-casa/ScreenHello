import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
    desktopArtifactProvenanceRepositoryId,
    githubAttestActionReference,
} from './desktop-artifact-provenance.mjs';
import { linuxDebRepositoryWorkflowMatrix } from './linux-deb-repository-matrix.mjs';

export const expectedLinuxDebRepositorySigningCandidate = Object.freeze({
    status: 'workflow-ready-not-run',
    workflow: '.github/workflows/linux-deb-repository-signed-candidate.yml',
    environment: 'linux-repository-signing',
    targets: ['linux-x64', 'linux-arm64'],
    runner: 'ubuntu-22.04',
    channel: 'github-actions-linux-deb-repository-signed-candidate',
    suite: 'screenhello-beta',
    component: 'main',
    signing: 'openpgp-release-and-inrelease',
    keyring: 'openpgp-binary-keyring',
    publicRelease: false,
    artifactRetentionDays: 14,
});

const exactActionSha = /^[ \t]*uses:\s+[^\s@]+@[0-9a-f]{40}(?:\s+#.*)?$/u;
const localPnpmActionReference = './.github/actions/setup-pnpm';
const actionLineIsPinnedOrLocal = (line) => {
    const normalized = line.replace(/^\s*-\s*/u, '      ');
    return exactActionSha.test(normalized) || normalized.trim() === `uses: ${localPnpmActionReference}`;
};
const gitHubExpression = '$' + '{{';
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const normalizedPermissionBlock = (value) => value
    ?.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
const sameValues = (actual, expected) => (
    actual.length === expected.length
    && [...actual].sort().join(',') === [...expected].sort().join(',')
);

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

export const auditLinuxDebRepositorySignedCandidateWorkflow = (workflow, matrix) => {
    const source = String(workflow || '').replace(/\r\n?/gu, '\n');
    const failures = [];
    const expect = (condition, suffix) => {
        if (!condition) failures.push(`linux-deb-repository-signed-candidate-${suffix}`);
    };
    const requireText = (value, suffix) => expect(source.includes(value), suffix);
    const forbid = (pattern, suffix, value = source) => expect(!pattern.test(value), suffix);
    const globalPermissions = source.match(/^permissions:\n(?<body>(?: {2}[^\n]*(?:\n|$))*)/mu)?.groups?.body;
    const preflight = jobBlock(source, 'preflight', 'package');
    const packageJob = jobBlock(source, 'package', 'sign');
    const sign = jobBlock(source, 'sign');
    const signPermissions = sign.match(/^ {4}permissions:\n(?<body>(?: {6}[^\n]*(?:\n|$))*)/mu)?.groups?.body;
    const signing = stepBlock(source, 'Build, sign, and verify APT repository metadata');
    const provenance = stepBlock(source, 'Generate signed candidate provenance attestation');
    const record = stepBlock(source, 'Record signed candidate provenance attestation');
    const checksum = stepBlock(source, 'Write signed Linux DEB repository candidate checksums');
    const uploadInput = stepBlock(source, 'Upload verified DEB repository input');
    const uploadCandidate = stepBlock(source, 'Upload signed Linux DEB repository candidate evidence');
    const actionLines = source.split('\n').filter((line) => /^\s*-?\s*uses:/u.test(line));
    const actionReferences = actionLines
        .map((line) => line.match(/uses:\s*([^\s#]+)/u)?.[1])
        .filter(Boolean);
    const secretReferences = [...source.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/gu)]
        .map((match) => match[1]);
    const sourceWithoutSigning = source.replace(signing, '');
    const sourceWithoutSign = sign ? source.replace(sign, '') : source;

    expect(sameJson(matrix?.linuxDebRepositorySigningCandidate, expectedLinuxDebRepositorySigningCandidate), 'policy-invalid');
    try {
        expect(
            sameJson(linuxDebRepositoryWorkflowMatrix(matrix), {
                include: [
                    {
                        target: 'linux-x64',
                        runner: 'ubuntu-22.04',
                        'rust-target': 'x86_64-unknown-linux-gnu',
                        'package-architecture': 'amd64',
                    },
                    {
                        target: 'linux-arm64',
                        runner: 'ubuntu-22.04-arm',
                        'rust-target': 'aarch64-unknown-linux-gnu',
                        'package-architecture': 'arm64',
                    },
                ],
            }),
            'package-matrix-invalid',
        );
    } catch (error) {
        failures.push(`linux-deb-repository-signed-candidate-package-matrix-invalid:${error.message}`);
    }

    requireText('name: Linux DEB Repository Signed Candidate', 'name-missing');
    requireText('  workflow_dispatch:', 'manual-trigger-missing');
    requireText('      confirm:', 'confirmation-input-missing');
    requireText('          - sign-linux-deb-repository-candidate', 'confirmation-choice-missing');
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
    forbid(/\bapt-key\b/iu, 'deprecated-apt-key-configured');
    forbid(/--export-secret-keys|--export-secret-subkeys/iu, 'secret-key-export-configured');

    expect(Boolean(preflight) && Boolean(packageJob) && Boolean(sign), 'jobs-missing');
    expect(
        protectedMainCondition(preflight, 'sign-linux-deb-repository-candidate')
            && protectedMainCondition(packageJob, 'sign-linux-deb-repository-candidate')
            && protectedMainCondition(sign, 'sign-linux-deb-repository-candidate'),
        'protected-main-condition-invalid',
    );
    expect(!preflight.includes('environment:') && !packageJob.includes('environment:'), 'unprotected-environment-forbidden');
    expect(
        sign.includes('needs: [preflight, package]')
            && sign.includes('environment: linux-repository-signing'),
        'environment-boundary-invalid',
    );
    expect(
        preflight.includes('runs-on: ubuntu-22.04')
            && packageJob.includes('runs-on: ${{ matrix.runner }}')
            && sign.includes('runs-on: ubuntu-22.04'),
        'runner-invalid',
    );
    expect(
        preflight.includes('id: package-matrix')
            && preflight.includes('node scripts/linux-deb-repository-matrix.mjs')
            && packageJob.includes('matrix: ${{ fromJSON(needs.preflight.outputs.package-matrix) }}'),
        'package-matrix-source-invalid',
    );
    requireText('SCREENHELLO_DESKTOP_PACKAGE_CHANNEL: github-actions-linux-deb-repository-signed-candidate', 'channel-invalid');
    requireText('SCREENHELLO_LINUX_DEB_REPOSITORY_SIGNED_CANDIDATE_DIR: artifacts/linux-deb-repository-signed-candidate', 'artifact-directory-invalid');
    expect((source.match(/ref: \$\{\{\s*github\.sha\s*\}\}/gu) || []).length === 3, 'checkout-ref-invalid');
    expect((source.match(/persist-credentials: false/gu) || []).length === 3, 'checkout-credentials-invalid');
    expect(
        actionLines.length > 0
            && actionLines.every((line) => actionLineIsPinnedOrLocal(line)),
        'action-pin-invalid',
    );
    const allowedActions = new Map([
        ['actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 3],
        ['actions/setup-node@820762786026740c76f36085b0efc47a31fe5020', 3],
        [localPnpmActionReference, 3],
        ['actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a', 2],
        ['actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c', 2],
        [githubAttestActionReference, 1],
    ]);
    expect(
        actionReferences.length === [...allowedActions.values()].reduce((total, value) => total + value, 0)
            && [...allowedActions].every(([action, count]) => actionReferences.filter((value) => value === action).length === count)
            && actionReferences.every((action) => allowedActions.has(action)),
        'action-allowlist-invalid',
    );

    expect(sameValues(secretReferences, [
        'LINUX_REPOSITORY_SIGNING_PRIVATE_KEY',
        'LINUX_REPOSITORY_SIGNING_PASSPHRASE',
    ]), 'secret-set-invalid');
    requireText('pnpm audit:github-actions', 'github-actions-audit-missing');
    expect(!/\$\{\{\s*secrets\./u.test(sourceWithoutSigning), 'secret-scope-invalid');
    expect(
        signing.includes('LINUX_REPOSITORY_SIGNING_PRIVATE_KEY: ' + gitHubExpression + ' secrets.LINUX_REPOSITORY_SIGNING_PRIVATE_KEY }}')
            && signing.includes('LINUX_REPOSITORY_SIGNING_PASSPHRASE: ' + gitHubExpression + ' secrets.LINUX_REPOSITORY_SIGNING_PASSPHRASE }}')
            && signing.includes('LINUX_REPOSITORY_SIGNING_FINGERPRINT: ' + gitHubExpression + ' vars.LINUX_REPOSITORY_SIGNING_FINGERPRINT }}')
            && signing.includes('base64 --decode')
            && signing.includes('--pinentry-mode loopback')
            && signing.includes('--passphrase-fd 3')
            && signing.includes('--local-user "$expected_fingerprint"')
            && signing.includes('LINUX_REPOSITORY_SIGNING_PASSPHRASE')
            && signing.includes('primary_fingerprints')
            && signing.includes('exactly one primary secret key'),
        'secret-import-invalid',
    );
    expect(
        signing.includes('apt-ftparchive --arch amd64 packages pool/main')
            && signing.includes('apt-ftparchive --arch arm64 packages pool/main')
            && signing.includes('apt-ftparchive')
            && signing.includes('APT::FTPArchive::Release::Suite=screenhello-beta')
            && signing.includes('APT::FTPArchive::Release::Components=main')
            && signing.includes("date --utc --date='+14 days' --rfc-email")
            && signing.includes('APT::FTPArchive::Release::Valid-Until=$valid_until')
            && signing.includes('gzip -9n')
            && signing.includes('InRelease')
            && signing.includes('Release.gpg'),
        'repository-metadata-invalid',
    );
    expect(
        signing.includes('gpgv --homedir "$verification_home" --keyring "$keyring" "$release_directory/InRelease"')
            && signing.includes('gpgv --homedir "$verification_home" --keyring "$keyring" "$release_directory/Release.gpg" "$release_directory/Release"')
            && signing.includes("printf 'deb [signed-by=%s] file:%s screenhello-beta main\\n' \"$keyring\" \"$repository_root\"")
            && signing.includes('Dir::Etc=$apt_root/etc/apt')
            && signing.includes("Dir::Etc::sourcelist='sources.list'")
            && signing.includes("Dir::Etc::sourceparts='empty-sourceparts'")
            && signing.includes('Dir::State=$apt_root/var/lib/apt')
            && signing.includes('Dir::State::lists=$apt_root/var/lib/apt/lists')
            && signing.includes('apt-get')
            && signing.includes(' update')
            && signing.includes("grep -R -qx 'Codename: screenhello-beta' \"$apt_root/var/lib/apt/lists\""),
        'repository-verification-invalid',
    );
    expect(
        signing.includes('--clearsign "$release_directory/Release"')
            && signing.includes('--detach-sign "$release_directory/Release"')
            && signing.includes('find "$repository_root" -type d -exec chmod 755 {} +')
            && signing.includes('find "$repository_root" -type f -exec chmod 644 {} +'),
        'repository-signing-or-readable-permissions-invalid',
    );
    expect(
        signing.includes('gpgconf --homedir "$signing_home" --kill all')
            && signing.includes('gpgconf --homedir "$trust_home" --kill all')
            && signing.includes('gpgconf --homedir "$armor_validation_home" --kill all')
            && signing.includes('gpgconf --homedir "$verification_home" --kill all')
            && signing.includes('trap cleanup EXIT')
            && signing.includes('cleanup_failed=false')
            && signing.includes('if ! rm -rf "$signing_home" "$trust_home" "$armor_validation_home" "$verification_home" "$apt_root" "$repository_root"; then')
            && signing.includes('for temporary_directory in "$signing_home" "$trust_home" "$armor_validation_home" "$verification_home" "$apt_root" "$repository_root"; do')
            && signing.includes('if [ -e "$temporary_directory" ]; then')
            && signing.includes('return 1'),
        'credential-cleanup-missing',
    );
    expect(
        packageJob.includes('needs: preflight')
            && packageJob.includes('--bundles deb --no-sign --config src-tauri/tauri.phase9.conf.json')
            && packageJob.includes('pnpm desktop:inspect')
            && packageJob.includes('pnpm desktop:sbom')
            && packageJob.includes('SHA256SUMS.txt')
            && uploadInput.includes('retention-days: 14'),
        'package-input-validation-invalid',
    );
    expect(
        sign.includes('apt-utils')
            && sign.includes('gnupg')
            && sign.includes('sha256sum --strict --check SHA256SUMS.txt')
            && sign.includes('inspection.candidateSha')
            && sign.includes('linux-deb-repository-input-inspection-invalid')
            && sign.includes('linux-deb-repository-input-amd64-')
            && sign.includes('linux-deb-repository-input-arm64-'),
        'signed-input-retrieval-invalid',
    );
    requireText('pnpm audit:desktop:linux-deb-repository-signed-candidate', 'self-audit-missing');
    requireText('pnpm audit:desktop:artifact-provenance', 'provenance-audit-missing');
    requireText('pnpm audit:desktop:contract', 'contract-audit-missing');
    requireText('pnpm audit:desktop:trust', 'trust-audit-missing');
    requireText('repository-input-SHA256SUMS.txt', 'input-checksum-missing');
    requireText('SHA256SUMS.txt', 'candidate-checksum-missing');
    expect(
        provenance.includes(`id: provenance\n        uses: ${githubAttestActionReference} # v4.2.2`)
            && provenance.includes('subject-path: |')
            && provenance.includes('repository/pool/main/s/screen-hello/*.deb')
            && provenance.includes('client-trust/screenhello-archive-keyring.asc')
            && provenance.includes('show-summary: false')
            && record.includes('node scripts/desktop-artifact-provenance.mjs')
            && record.includes('--target linux-deb-repository')
            && record.includes('provenance.outputs.bundle-path')
            && checksum.includes('provenance-attestation.bundle.json')
            && checksum.includes('provenance-attestation.json'),
        'provenance-record-invalid',
    );
    requireText('Upload signed Linux DEB repository candidate evidence', 'artifact-upload-missing');
    expect(uploadCandidate.includes('if: always()')
        && uploadCandidate.includes('retention-days: 14')
        && uploadCandidate.includes('artifacts/linux-deb-repository-signed-candidate/'), 'artifact-policy-invalid');
    expect((source.match(/retention-days: 14/gu) || []).length === 2, 'retention-invalid');

    return failures;
};

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const [matrix, workflow] = await Promise.all([
        readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8').then(JSON.parse),
        readFile(new URL('../.github/workflows/linux-deb-repository-signed-candidate.yml', import.meta.url), 'utf8'),
    ]);
    const failures = auditLinuxDebRepositorySignedCandidateWorkflow(workflow, matrix);
    console.log(JSON.stringify({ status: failures.length ? 'failed' : 'passed', failures }, null, 2));
    if (failures.length) process.exitCode = 1;
}
