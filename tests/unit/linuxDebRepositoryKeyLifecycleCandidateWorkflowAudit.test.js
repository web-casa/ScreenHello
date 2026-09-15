import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { auditLinuxDebRepositoryKeyLifecycleCandidateWorkflow } from '../../scripts/audit-linux-deb-repository-key-lifecycle-candidate-workflow.mjs';

const [workflow, matrix] = await Promise.all([
    readFile(new URL('../../.github/workflows/linux-deb-repository-signed-candidate.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../config/desktop-release-matrix.json', import.meta.url), 'utf8').then(JSON.parse),
]);

const baseline = () => ({
    workflow,
    matrix: structuredClone(matrix),
});

describe('Linux DEB client trust lifecycle candidate workflow audit', () => {
    it('accepts the internal binary-and-armored trust bundle candidate', () => {
        const value = baseline();
        expect(auditLinuxDebRepositoryKeyLifecycleCandidateWorkflow(value.workflow, value.matrix)).toEqual([]);
    });

    it('accepts the same workflow after a Windows CRLF checkout', () => {
        const value = baseline();
        value.workflow = value.workflow.replaceAll('\n', '\r\n');
        expect(auditLinuxDebRepositoryKeyLifecycleCandidateWorkflow(value.workflow, value.matrix)).toEqual([]);
    });

    it.each([
        ['an altered lifecycle policy', (value) => { value.matrix.linuxDebRepositoryKeyLifecycleCandidate.rotation.minimumOverlapDays = 1; }],
        ['a next public key sourced from a secret', (value) => { value.workflow = value.workflow.replace('vars.LINUX_REPOSITORY_SIGNING_NEXT_PUBLIC_KEY', 'secrets.LINUX_REPOSITORY_SIGNING_NEXT_PUBLIC_KEY'); }],
        ['an incomplete next-key pairing guard', (value) => { value.workflow = value.workflow.replace('must be set together.', 'is optional.'); }],
        ['a nonminimal public key export', (value) => { value.workflow = value.workflow.replaceAll('--export-options export-minimal', ''); }],
        ['a missing armored public key export', (value) => { value.workflow = value.workflow.replace('--armor --export-options export-minimal --output "$armored_keyring"', '--output "$armored_keyring"'); }],
        ['an unverified armored keyring', (value) => { value.workflow = value.workflow.replace('cmp "$keyring" "$decoded_keyring"', 'true'); }],
        ['a trust home without secret-key rejection', (value) => { value.workflow = value.workflow.replace('--list-secret-keys | grep -q', '--list-public-keys | grep -q'); }],
        ['an expiry guard shorter than the declared policy', (value) => { value.workflow = value.workflow.replace('30 * 24 * 60 * 60', '1 * 24 * 60 * 60'); }],
        ['a revoked-key state check removed from the client trust bundle', (value) => { value.workflow = value.workflow.replace('key_validity_for_fingerprint()', 'key_state_for_fingerprint()'); }],
        ['a missing trust manifest generator', (value) => { value.workflow = value.workflow.replace('node scripts/linux-deb-key-lifecycle.mjs', 'node scripts/unknown.mjs'); }],
        ['a checksum that omits client trust files', (value) => { value.workflow = value.workflow.replace('find repository input-evidence client-trust -type f -print0', 'find repository input-evidence -type f -print0'); }],
        ['a release operation', (value) => { value.workflow = value.workflow.replace('apt-ftparchive --version', 'gh release create ScreenHello'); }],
    ])('fails closed for %s', (_name, mutate) => {
        const value = baseline();
        mutate(value);
        expect(auditLinuxDebRepositoryKeyLifecycleCandidateWorkflow(value.workflow, value.matrix)).not.toEqual([]);
    });
});
