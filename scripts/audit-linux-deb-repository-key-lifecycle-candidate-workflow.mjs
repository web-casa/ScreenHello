import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { auditLinuxDebRepositorySignedCandidateWorkflow } from './audit-linux-deb-repository-signed-candidate-workflow.mjs';
import { expectedLinuxDebRepositoryKeyLifecycleCandidate } from './linux-deb-key-lifecycle.mjs';

const gitHubExpression = '$' + '{{';
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
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

export const auditLinuxDebRepositoryKeyLifecycleCandidateWorkflow = (workflow, matrix) => {
    const source = String(workflow || '').replace(/\r\n?/gu, '\n');
    const failures = [];
    const expect = (condition, suffix) => {
        if (!condition) failures.push(`linux-deb-key-lifecycle-candidate-${suffix}`);
    };
    const forbid = (pattern, suffix) => expect(!pattern.test(source), suffix);
    const signing = stepBlock(source, 'Build, sign, and verify APT repository metadata');
    const checksum = stepBlock(source, 'Write signed Linux DEB repository candidate checksums');
    const sourceWithoutSigning = source.replace(signing, '');
    const variableReferences = [...source.matchAll(/\$\{\{\s*vars\.([A-Z0-9_]+)\s*\}\}/gu)]
        .map((match) => match[1])
        .filter((name) => name.startsWith('LINUX_REPOSITORY_SIGNING_'));
    const baselineFailures = auditLinuxDebRepositorySignedCandidateWorkflow(source, matrix);

    expect(baselineFailures.length === 0, 'repository-signing-baseline-invalid');
    expect(
        sameJson(
            matrix?.linuxDebRepositoryKeyLifecycleCandidate,
            expectedLinuxDebRepositoryKeyLifecycleCandidate,
        ),
        'policy-invalid',
    );
    expect(
        sameValues(variableReferences, [
            'LINUX_REPOSITORY_SIGNING_FINGERPRINT',
            'LINUX_REPOSITORY_SIGNING_NEXT_FINGERPRINT',
            'LINUX_REPOSITORY_SIGNING_NEXT_PUBLIC_KEY',
        ]),
        'environment-variable-set-invalid',
    );
    expect(
        signing.includes('LINUX_REPOSITORY_SIGNING_NEXT_PUBLIC_KEY: ' + gitHubExpression + ' vars.LINUX_REPOSITORY_SIGNING_NEXT_PUBLIC_KEY }}')
            && signing.includes('LINUX_REPOSITORY_SIGNING_NEXT_FINGERPRINT: ' + gitHubExpression + ' vars.LINUX_REPOSITORY_SIGNING_NEXT_FINGERPRINT }}')
            && !/\$\{\{\s*secrets\.LINUX_REPOSITORY_SIGNING_NEXT_(?:PUBLIC_KEY|FINGERPRINT)\s*\}\}/u.test(signing)
            && !/\bLINUX_REPOSITORY_SIGNING_NEXT_(?:PUBLIC_KEY|FINGERPRINT)\b/u.test(sourceWithoutSigning),
        'next-key-scope-invalid',
    );
    expect(
        signing.includes('LINUX_REPOSITORY_SIGNING_NEXT_PUBLIC_KEY and LINUX_REPOSITORY_SIGNING_NEXT_FINGERPRINT must be set together.')
            && signing.includes('LINUX_REPOSITORY_SIGNING_NEXT_FINGERPRINT must differ from LINUX_REPOSITORY_SIGNING_FINGERPRINT.')
            && signing.includes('has_next_public_key=true')
            && signing.includes('expected_next_fingerprint'),
        'next-key-pairing-invalid',
    );
    expect(
        signing.includes('trust_home="$(mktemp -d')
            && signing.includes('armor_validation_home="$(mktemp -d')
            && signing.includes('--homedir "$trust_home" --export-options export-minimal --output "$keyring"')
            && signing.includes('--homedir "$trust_home" --armor --export-options export-minimal --output "$armored_keyring"')
            && signing.includes('screenhello-archive-keyring.gpg')
            && signing.includes('screenhello-archive-keyring.asc')
            && signing.includes('--dearmor --output "$decoded_keyring" "$armored_keyring"')
            && signing.includes('cmp "$keyring" "$decoded_keyring"'),
        'minimal-binary-and-armored-keyring-invalid',
    );
    expect(
        signing.includes('--with-colons --list-secret-keys | grep -q')
            && signing.includes('must not contain any secret key material')
            && signing.includes('trust_primary_fingerprints')
            && signing.includes('trust_expected_fingerprints')
            && signing.includes('must contain exactly the active and optional next primary public keys'),
        'isolated-public-key-validation-invalid',
    );
    expect(
        signing.includes('minimum_remaining_seconds="$((30 * 24 * 60 * 60))"')
            && signing.includes('minimum_expiration="$(( $(date +%s) + minimum_remaining_seconds ))"')
            && signing.includes('Every expiring client trust key must have at least 30 days remaining.')
            && signing.includes('key_expiration_for_fingerprint'),
        'expiration-guard-invalid',
    );
    expect(
        signing.includes('key_validity_for_fingerprint()')
            && signing.includes('validity="$(key_validity_for_fingerprint "$fingerprint")"')
            && signing.includes('r|e|d|i)')
            && signing.includes('Client trust keys must not be revoked, expired, disabled, or invalid.')
            && signing.includes('"clientTrustKeyState": "non-revoked-not-expired-not-disabled-not-invalid"'),
        'key-state-guard-invalid',
    );
    expect(
        signing.includes('node scripts/linux-deb-key-lifecycle.mjs')
            && signing.includes('client-trust/client-trust-manifest.json')
            && signing.includes('ROTATION.md')
            && signing.includes('REVOCATION_RESPONSE.md')
            && checksum.includes('find repository input-evidence client-trust -type f -print0'),
        'client-trust-artifact-invalid',
    );
    expect(source.includes('pnpm audit:desktop:linux-deb-key-lifecycle'), 'self-audit-missing');
    forbid(/\bapt-key\b/iu, 'deprecated-apt-key-configured');
    forbid(/--export-secret-keys|--export-secret-subkeys/iu, 'secret-key-export-configured');
    forbid(/\$\{\{\s*secrets\.LINUX_REPOSITORY_SIGNING_NEXT_/u, 'next-key-secret-configured');
    forbid(/(?:tauri-apps\/tauri-action|softprops\/action-gh-release|actions\/attest-build-provenance|gh\s+release|git\s+tag|npm\s+publish|pnpm\s+publish)/iu, 'release-operation-configured');
    forbid(/https?:\/\//iu, 'public-endpoint-configured');

    return failures;
};

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const [matrix, workflow] = await Promise.all([
        readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8').then(JSON.parse),
        readFile(new URL('../.github/workflows/linux-deb-repository-signed-candidate.yml', import.meta.url), 'utf8'),
    ]);
    const failures = auditLinuxDebRepositoryKeyLifecycleCandidateWorkflow(workflow, matrix);
    console.log(JSON.stringify({ status: failures.length ? 'failed' : 'passed', failures }, null, 2));
    if (failures.length) process.exitCode = 1;
}
