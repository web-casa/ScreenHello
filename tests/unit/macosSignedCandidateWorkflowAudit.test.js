import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
    auditMacosSignedCandidateWorkflow,
    macosSigningCandidateProfiles,
} from '../../scripts/audit-macos-signed-candidate-workflow.mjs';

const [arm64Workflow, x64Workflow, matrix] = await Promise.all([
    readFile(new URL('../../.github/workflows/macos-signed-candidate.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../.github/workflows/macos-intel-signed-candidate.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../config/desktop-release-matrix.json', import.meta.url), 'utf8').then(JSON.parse),
]);
const workflowByProfile = Object.freeze({ arm64: arm64Workflow, x64: x64Workflow });
const keychainPathTrim = "sed -E 's/^[[:space:]]*\"//; s/\"[[:space:]]*$//'";
const authorityExtraction = "sed -n 's/^Authority=\\(Developer ID Application:.*\\)$/\\1/p'";
const malformedAuthorityExtraction = "sed -n 's/^Authority=\\\\(Developer ID Application:.*\\\\)$/\\\\1/p'";
const gitHubExpression = '$' + '{{';

describe.each(Object.entries(macosSigningCandidateProfiles))('macOS %s signed candidate workflow audit', (name, profile) => {
    const workflow = workflowByProfile[name];

    it('accepts the manually confirmed, protected signing candidate', () => {
        expect(auditMacosSignedCandidateWorkflow(workflow, matrix, profile)).toEqual([]);
    });

    it.each([
        ['an automatic trigger', (source) => source.replace('  workflow_dispatch:', '  push:\n  workflow_dispatch:')],
        ['a public repository condition', (source) => source.replace('github.event.repository.private', '!github.event.repository.private')],
        ['a different candidate repository ID', (source) => source.replace("github.repository_id == '1353846102'", "github.repository_id == '0'" )],
        ['an unpinned checkout', (source) => source.replace('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 'actions/checkout@v7')],
        ['a secret outside the signing steps', (source) => source.replace('RUST_TOOLCHAIN: 1.96.0', 'RUST_TOOLCHAIN: 1.96.0\n  LEAK: ' + gitHubExpression + ' secrets.APPLE_ID }}')],
        ['a non-empty P12 secret mapping', (source) => source.replace('APPLE_CERTIFICATE_PASSWORD: ""', 'APPLE_CERTIFICATE_PASSWORD: ' + gitHubExpression + ' secrets.P12_PASSWORD }}')],
        ['untrimmed keychain paths', (source) => source.replaceAll(keychainPathTrim, "tr -d '\"'")],
        ['an identity that can inject a GITHUB_ENV line', (source) => source.replace("*$'\\n'*|*$'\\r'*)", 'identity-without-control-character-rejection')],
        ['an unsigned build flag', (source) => source.replace('--bundles dmg', '--bundles dmg --no-sign')],
        ['skipped stapling', (source) => source.replace('--config src-tauri/tauri.phase9.conf.json', '--skip-stapling --config src-tauri/tauri.phase9.conf.json')],
        ['a malformed Developer ID authority extraction', (source) => source.replace(authorityExtraction, malformedAuthorityExtraction)],
        ['a missing keychain cleanup', (source) => source.replace('security delete-keychain', 'security remove-keychain')],
        ['a keychain cleanup that suppresses deletion failure', (source) => source.replace(
            'security delete-keychain "$SCREENHELLO_SIGNING_KEYCHAIN"\n            if [ -e "$SCREENHELLO_SIGNING_KEYCHAIN" ]; then',
            'security delete-keychain "$SCREENHELLO_SIGNING_KEYCHAIN" || true\n            if [ -e "$SCREENHELLO_SIGNING_KEYCHAIN" ]; then',
        )],
        ['a keychain cleanup that does not run after failure', (source) => source.replace(
            '      - name: Remove the temporary signing keychain\n        if: always()',
            '      - name: Remove the temporary signing keychain\n        if: success()',
        )],
        ['a release operation', (source) => source.replace('pnpm desktop:sbom', 'gh release create ScreenHello')],
    ])('fails closed for %s', (_name, mutate) => {
        expect(auditMacosSignedCandidateWorkflow(mutate(workflow), matrix, profile)).not.toEqual([]);
    });
});
