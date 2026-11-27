import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
    desktopArtifactProvenanceRepositoryId,
    desktopArtifactProvenanceProfiles,
    expectedDesktopArtifactProvenanceCandidate,
    githubAttestActionReference,
} from './desktop-artifact-provenance.mjs';
import {
    desktopArtifactProvenanceVerificationPlanFilename,
    expectedDesktopArtifactProvenanceVerification,
} from './desktop-artifact-provenance-verification.mjs';

const exactActionSha = /^[ \t]*uses:\s+[^\s@]+@[0-9a-f]{40}(?:\s+#.*)?$/u;
const expectedSignPermissions = Object.freeze([
    'contents: read',
    'id-token: write',
    'attestations: write',
    'artifact-metadata: write',
]);

const recordProfiles = Object.freeze({
    'macos-arm64': Object.freeze({
        candidateDirectory: '$SCREENHELLO_MACOS_SIGNED_CANDIDATE_DIR',
        runnerTemp: '$RUNNER_TEMP',
        subjects: ['$SCREENHELLO_MACOS_SIGNED_DMG'],
        verificationPlanStep: 'Write signed candidate provenance verification plan',
        checksumStep: 'Write signed candidate checksums',
        cleanupStep: 'Remove the temporary signing keychain',
        uploadStep: 'Upload signed macOS candidate evidence',
    }),
    'macos-x64': Object.freeze({
        candidateDirectory: '$SCREENHELLO_MACOS_SIGNED_CANDIDATE_DIR',
        runnerTemp: '$RUNNER_TEMP',
        subjects: ['$SCREENHELLO_MACOS_SIGNED_DMG'],
        verificationPlanStep: 'Write signed candidate provenance verification plan',
        checksumStep: 'Write signed candidate checksums',
        cleanupStep: 'Remove the temporary signing keychain',
        uploadStep: 'Upload signed macOS Intel candidate evidence',
    }),
    'windows-x64': Object.freeze({
        candidateDirectory: '$env:SCREENHELLO_WINDOWS_SIGNED_CANDIDATE_DIR',
        runnerTemp: '$env:RUNNER_TEMP',
        subjects: ['$env:SCREENHELLO_WINDOWS_SIGNED_INSTALLER'],
        verificationPlanStep: 'Write signed candidate provenance verification plan',
        checksumStep: 'Write signed candidate checksums',
        cleanupStep: 'Remove temporary Windows signing material',
        uploadStep: 'Upload signed Windows candidate evidence',
    }),
    'windows-arm64': Object.freeze({
        candidateDirectory: '$env:SCREENHELLO_WINDOWS_ARM64_SIGNED_CANDIDATE_DIR',
        runnerTemp: '$env:RUNNER_TEMP',
        subjects: ['$env:SCREENHELLO_WINDOWS_ARM64_SIGNED_INSTALLER'],
        verificationPlanStep: 'Write signed candidate provenance verification plan',
        checksumStep: 'Write signed candidate checksums',
        cleanupStep: 'Remove temporary Windows signing material',
        uploadStep: 'Upload signed Windows ARM64 candidate evidence',
    }),
    'linux-deb-repository': Object.freeze({
        candidateDirectory: '$SCREENHELLO_LINUX_DEB_REPOSITORY_SIGNED_CANDIDATE_DIR',
        runnerTemp: '$RUNNER_TEMP',
        subjects: [
            '$candidate_dir/repository/pool/main/s/screen-hello/$(basename "$SCREENHELLO_LINUX_DEB_INPUT_AMD64")',
            '$candidate_dir/repository/pool/main/s/screen-hello/$(basename "$SCREENHELLO_LINUX_DEB_INPUT_ARM64")',
            '$candidate_dir/repository/dists/screenhello-beta/Release',
            '$candidate_dir/repository/dists/screenhello-beta/InRelease',
            '$candidate_dir/repository/dists/screenhello-beta/Release.gpg',
            '$candidate_dir/client-trust/screenhello-archive-keyring.gpg',
            '$candidate_dir/client-trust/screenhello-archive-keyring.asc',
        ],
        verificationPlanStep: 'Write signed candidate provenance verification plan',
        checksumStep: 'Write signed Linux DEB repository candidate checksums',
        cleanupStep: 'Build, sign, and verify APT repository metadata',
        uploadStep: 'Upload signed Linux DEB repository candidate evidence',
    }),
});

const stepBlock = (source, name) => {
    const marker = `      - name: ${name}\n`;
    const start = source.indexOf(marker);
    if (start < 0) return '';
    const end = source.indexOf('\n      - name:', start + marker.length);
    return source.slice(start, end < 0 ? source.length : end);
};

const jobBlock = (source, name) => {
    const marker = `  ${name}:\n`;
    const start = source.indexOf(marker);
    if (start < 0) return '';
    const remainder = source.slice(start + marker.length);
    const nextMatch = remainder.match(/\n {2}[A-Za-z][A-Za-z0-9_-]*:\n/u);
    const end = nextMatch ? start + marker.length + nextMatch.index : -1;
    return source.slice(start, end < 0 ? source.length : end);
};

const stepStart = (source, name) => source.indexOf(`      - name: ${name}\n`);

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const normalizedPermissionBlock = (value) => value
    ?.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');

const expectedOutputEnvironment = Object.freeze([
    'SCREENHELLO_PROVENANCE_ATTESTATION_ID: ${{ steps.provenance.outputs.attestation-id }}',
    'SCREENHELLO_PROVENANCE_ATTESTATION_URL: ${{ steps.provenance.outputs.attestation-url }}',
    'SCREENHELLO_PROVENANCE_BUNDLE: ${{ steps.provenance.outputs.bundle-path }}',
]);

const credentialCleanupIsFailClosed = (target, cleanup) => {
    if (target === 'macos-arm64' || target === 'macos-x64') {
        return cleanup.includes('if: always()')
            && cleanup.includes('security delete-keychain "$SCREENHELLO_SIGNING_KEYCHAIN"')
            && cleanup.includes('if [ -e "$SCREENHELLO_SIGNING_KEYCHAIN" ]; then')
            && !cleanup.includes('security delete-keychain "$SCREENHELLO_SIGNING_KEYCHAIN" || true');
    }
    if (target === 'windows-x64' || target === 'windows-arm64') {
        return cleanup.includes('if: always()')
            && cleanup.includes("$ErrorActionPreference = 'Stop'")
            && cleanup.includes('$certificateStorePath = "Cert:\\CurrentUser\\My\\$thumbprint"')
            && cleanup.includes('Remove-Item -LiteralPath $certificateStorePath -Force')
            && cleanup.includes('if (Test-Path -LiteralPath $certificateStorePath)')
            && cleanup.includes('Temporary code-signing certificate $thumbprint remains')
            && cleanup.includes('Temporary Windows signing runtime configuration remains after cleanup.')
            && !cleanup.includes('SilentlyContinue');
    }
    if (target === 'linux-deb-repository') {
        return cleanup.includes('trap cleanup EXIT')
            && cleanup.includes('cleanup_failed=false')
            && cleanup.includes('if ! rm -rf "$signing_home" "$trust_home" "$armor_validation_home" "$verification_home" "$apt_root" "$repository_root"; then')
            && cleanup.includes('for temporary_directory in "$signing_home" "$trust_home" "$armor_validation_home" "$verification_home" "$apt_root" "$repository_root"; do')
            && cleanup.includes('if [ -e "$temporary_directory" ]; then')
            && cleanup.includes('return 1');
    }
    return false;
};

const recordVariable = (target, name) => `${target.startsWith('windows-') ? '$env:' : '$'}${name}`;

const hasProtectedCandidateCondition = (sign) => {
    const condition = sign.match(/^\s{4}if:\s*>-\n(?<body>(?:\s{6}[^\n]*(?:\n|$))*)/mu)?.groups?.body;
    const normalized = condition?.replace(/\s+/gu, ' ').trim();
    return normalized?.includes(`github.repository_id == '${desktopArtifactProvenanceRepositoryId}'`)
        && normalized.includes('github.event.repository.private')
        && normalized.includes("github.ref == 'refs/heads/main'")
        && normalized.includes('inputs.confirm ==');
};

export const auditDesktopArtifactProvenanceCandidateWorkflow = (workflow, matrix, profile) => {
    const source = String(workflow || '').replace(/\r\n?/gu, '\n');
    const failures = [];
    const auditPrefix = `desktop-artifact-provenance-${profile?.target || 'unknown'}`;
    const expect = (condition, suffix) => {
        if (!condition) failures.push(`${auditPrefix}-${suffix}`);
    };
    const forbid = (pattern, suffix, value = source) => expect(!pattern.test(value), suffix);
    const recordProfile = recordProfiles[profile?.target];
    const sign = jobBlock(source, 'sign');
    const sourceWithoutSign = sign ? source.replace(sign, '') : source;
    const globalPermissions = source.match(/^permissions:\n(?<body>(?: {2}[^\n]*(?:\n|$))*)/mu)?.groups?.body;
    const signPermissions = sign.match(/^ {4}permissions:\n(?<body>(?: {6}[^\n]*(?:\n|$))*)/mu)?.groups?.body;
    const provenance = stepBlock(sign, 'Generate signed candidate provenance attestation');
    const record = stepBlock(sign, 'Record signed candidate provenance attestation');
    const verificationPlan = stepBlock(sign, recordProfile?.verificationPlanStep);
    const checksum = stepBlock(sign, recordProfile?.checksumStep);
    const cleanup = stepBlock(sign, recordProfile?.cleanupStep);
    const upload = stepBlock(sign, recordProfile?.uploadStep);
    const actionReferences = source.split('\n')
        .filter((line) => /^\s*-?\s*uses:/u.test(line))
        .map((line) => line.match(/uses:\s*([^\s#]+)/u)?.[1])
        .filter(Boolean);
    const attestationActions = actionReferences.filter((action) => action.startsWith('actions/attest@'));

    expect(Boolean(recordProfile), 'profile-invalid');
    expect(
        sameJson(matrix?.desktopArtifactProvenanceCandidate, expectedDesktopArtifactProvenanceCandidate),
        'policy-invalid',
    );
    expect(
        sameJson(matrix?.desktopArtifactProvenanceVerification, expectedDesktopArtifactProvenanceVerification),
        'verification-policy-invalid',
    );
    expect(globalPermissions?.trim() === 'contents: read', 'global-permissions-invalid');
    expect(
        normalizedPermissionBlock(signPermissions) === expectedSignPermissions.join('\n'),
        'sign-permissions-invalid',
    );
    forbid(/^\s{4}permissions:\s*$/mu, 'unexpected-job-permissions-outside-sign', sourceWithoutSign);
    forbid(/\b(?:contents|packages|id-token|attestations|artifact-metadata)\s*:\s*write\b/iu, 'write-permission-outside-sign', sourceWithoutSign);
    expect(sign.includes(`environment: ${profile?.environment}`), 'environment-invalid');
    expect(hasProtectedCandidateCondition(sign), 'candidate-repository-condition-invalid');
    expect(Boolean(provenance) && Boolean(record) && Boolean(verificationPlan) && Boolean(checksum) && Boolean(cleanup) && Boolean(upload), 'required-step-missing');
    expect(credentialCleanupIsFailClosed(profile?.target, cleanup), 'credential-cleanup-not-fail-closed');

    expect(
        attestationActions.length === 1 && attestationActions[0] === githubAttestActionReference,
        'attestation-action-count-invalid',
    );
    expect(
        provenance.includes(`id: provenance\n        uses: ${githubAttestActionReference} # v4.2.2`),
        'attestation-action-reference-invalid',
    );
    expect(
        profile?.subjectPaths?.length === 1
            ? provenance.includes(`subject-path: ${profile.subjectPaths[0]}`)
            : provenance.includes('subject-path: |')
                && profile?.subjectPaths?.every((subjectPath) => provenance.includes(`          ${subjectPath}`)),
        'attestation-subject-path-invalid',
    );
    expect(provenance.includes('show-summary: false'), 'attestation-summary-policy-invalid');
    forbid(/\b(?:sbom-path|predicate(?:-type|-path)?|subject-(?:digest|checksums|name)|github-token|push-to-registry|create-storage-record):/iu, 'attestation-input-invalid', provenance);
    forbid(/\$\{\{\s*secrets\./iu, 'attestation-secret-context-configured', provenance);
    expect(
        provenance.includes('id-token: write') === false
            && provenance.includes('attestations: write') === false,
        'attestation-step-permission-inline-invalid',
    );

    expect(
        expectedOutputEnvironment.every((line) => record.includes(line)),
        'record-output-environment-invalid',
    );
    expect(record.includes('node scripts/desktop-artifact-provenance.mjs'), 'record-helper-missing');
    expect(
        record.includes(`--candidate-sha "${recordVariable(profile?.target || '', 'SCREENHELLO_RELEASE_CANDIDATE')}"`),
        'record-candidate-sha-missing',
    );
    expect(record.includes(`--target ${profile?.target}`), 'record-target-invalid');
    expect(record.includes(`--candidate-dir "${recordProfile?.candidateDirectory}"`), 'record-candidate-directory-invalid');
    expect(record.includes(`--runner-temp "${recordProfile?.runnerTemp}"`), 'record-runner-temp-invalid');
    expect(
        [
            ['--attestation-id', 'SCREENHELLO_PROVENANCE_ATTESTATION_ID'],
            ['--attestation-url', 'SCREENHELLO_PROVENANCE_ATTESTATION_URL'],
            ['--bundle', 'SCREENHELLO_PROVENANCE_BUNDLE'],
        ].every(([option, name]) => record.includes(`${option} "${recordVariable(profile?.target || '', name)}"`)),
        'record-attestation-output-binding-invalid',
    );
    expect(
        recordProfile?.subjects?.every((subject) => record.includes(`--subject "${subject}"`))
            && (record.match(/--subject\s+/gu) || []).length === profile?.subjectCount,
        'record-subject-set-invalid',
    );
    forbid(/\$\{\{\s*secrets\./iu, 'record-secret-context-configured', record);
    expect(verificationPlan.includes('node scripts/desktop-artifact-provenance-verification.mjs'), 'verification-plan-helper-missing');
    expect(verificationPlan.includes('--write-plan'), 'verification-plan-write-mode-missing');
    expect(
        verificationPlan.includes(`--candidate-dir "${recordProfile?.candidateDirectory}"`),
        'verification-plan-candidate-directory-invalid',
    );
    forbid(/\bgh(?:\.exe)?\b/iu, 'verification-plan-gh-execution-configured', verificationPlan);
    forbid(/--(?:execute-gh|offline-trusted-root|receipt)\b/iu, 'verification-plan-execution-option-configured', verificationPlan);
    forbid(/\$\{\{\s*secrets\./iu, 'verification-plan-secret-context-configured', verificationPlan);
    expect(
        checksum.includes('provenance-attestation.bundle.json')
            && checksum.includes('provenance-attestation.json')
            && checksum.includes(desktopArtifactProvenanceVerificationPlanFilename),
        'checksum-provenance-evidence-missing',
    );
    expect(upload.includes('retention-days: 14'), 'artifact-retention-invalid');
    expect(
        stepStart(sign, recordProfile?.cleanupStep) < stepStart(sign, 'Generate signed candidate provenance attestation')
            && stepStart(sign, 'Generate signed candidate provenance attestation') < stepStart(sign, 'Record signed candidate provenance attestation')
            && stepStart(sign, 'Record signed candidate provenance attestation') < stepStart(sign, recordProfile?.verificationPlanStep)
            && stepStart(sign, recordProfile?.verificationPlanStep) < stepStart(sign, recordProfile?.checksumStep)
            && stepStart(sign, recordProfile?.checksumStep) < stepStart(sign, recordProfile?.uploadStep),
        'credential-cleanup-and-evidence-order-invalid',
    );
    forbid(/actions\/attest-build-provenance@/iu, 'legacy-attestation-action-configured');
    forbid(/(?:tauri-apps\/tauri-action|softprops\/action-gh-release|gh\s+release|git\s+tag|npm\s+publish|pnpm\s+publish)/iu, 'release-operation-configured');
    expect(
        source.split('\n').filter((line) => /actions\/attest@/iu.test(line)).every((line) => exactActionSha.test(line.replace(/^\s*-\s*/u, '      '))),
        'attestation-action-pin-invalid',
    );

    return failures;
};

export const auditDesktopArtifactProvenanceCandidateWorkflows = ({
    matrix,
    macosArm64Workflow,
    macosX64Workflow,
    windowsX64Workflow,
    windowsArm64Workflow,
    linuxDebRepositoryWorkflow,
} = {}) => {
    const workflowByPath = new Map([
        ['.github/workflows/macos-signed-candidate.yml', macosArm64Workflow],
        ['.github/workflows/macos-intel-signed-candidate.yml', macosX64Workflow],
        ['.github/workflows/windows-signed-candidate.yml', windowsX64Workflow],
        ['.github/workflows/windows-arm64-signed-candidate.yml', windowsArm64Workflow],
        ['.github/workflows/linux-deb-repository-signed-candidate.yml', linuxDebRepositoryWorkflow],
    ]);
    return desktopArtifactProvenanceProfiles.flatMap((profile) => (
        auditDesktopArtifactProvenanceCandidateWorkflow(workflowByPath.get(profile.workflow), matrix, profile)
    ));
};

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const [matrix, ...workflows] = await Promise.all([
        readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8').then(JSON.parse),
        ...desktopArtifactProvenanceProfiles.map((profile) => (
            readFile(new URL(`../${profile.workflow}`, import.meta.url), 'utf8')
        )),
    ]);
    const failures = auditDesktopArtifactProvenanceCandidateWorkflows({
        matrix,
        macosArm64Workflow: workflows[0],
        macosX64Workflow: workflows[1],
        windowsX64Workflow: workflows[2],
        windowsArm64Workflow: workflows[3],
        linuxDebRepositoryWorkflow: workflows[4],
    });
    console.log(JSON.stringify({ status: failures.length ? 'failed' : 'passed', failures }, null, 2));
    if (failures.length) process.exitCode = 1;
}
