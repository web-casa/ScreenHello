import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { auditLinuxDebRepositorySignedCandidateWorkflow } from '../../scripts/audit-linux-deb-repository-signed-candidate-workflow.mjs';

const [workflow, matrix] = await Promise.all([
    readFile(new URL('../../.github/workflows/linux-deb-repository-signed-candidate.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../config/desktop-release-matrix.json', import.meta.url), 'utf8').then(JSON.parse),
]);

const baseline = () => ({
    workflow,
    matrix: structuredClone(matrix),
});

describe('Linux DEB repository signed candidate workflow audit', () => {
    it('accepts the manually confirmed, protected two-architecture repository candidate', () => {
        const value = baseline();
        expect(auditLinuxDebRepositorySignedCandidateWorkflow(value.workflow, value.matrix)).toEqual([]);
    });

    it.each([
        ['an automatic trigger', (value) => { value.workflow = value.workflow.replace('  workflow_dispatch:', '  push:'); }],
        ['a non-private signing condition', (value) => { value.workflow = value.workflow.replace('github.event.repository.private', 'true'); }],
        ['a different candidate repository ID', (value) => { value.workflow = value.workflow.replace("github.repository_id == '1353846102'", "github.repository_id == '0'"); }],
        ['an altered native package policy', (value) => { value.matrix.linuxDebRepositorySigningCandidate.targets = ['linux-x64']; }],
        ['an unprotected signing job', (value) => { value.workflow = value.workflow.replace('environment: linux-repository-signing', 'environment: linux-unprotected'); }],
        ['a Linux signing secret outside its signing step', (value) => {
            value.workflow = value.workflow.replace(
                'Build the unsigned native DEB input',
                'Build the unsigned native DEB input\n        env:\n          KEY: ${{ secrets.LINUX_REPOSITORY_SIGNING_PRIVATE_KEY }}',
            );
        }],
        ['an interactive GPG invocation', (value) => { value.workflow = value.workflow.replaceAll('--pinentry-mode loopback', ''); }],
        ['a deprecated APT keyring path', (value) => { value.workflow = value.workflow.replace('apt-ftparchive --version', 'apt-key list'); }],
        ['an unsigned package build without the explicit flag', (value) => { value.workflow = value.workflow.replace('--bundles deb --no-sign', '--bundles deb'); }],
        ['an unfiltered AMD64 Packages index', (value) => { value.workflow = value.workflow.replace('apt-ftparchive --arch amd64 packages pool/main', 'apt-ftparchive packages pool/main'); }],
        ['an unfiltered ARM64 Packages index', (value) => { value.workflow = value.workflow.replace('apt-ftparchive --arch arm64 packages pool/main', 'apt-ftparchive packages pool/main'); }],
        ['a repository without an expiry', (value) => { value.workflow = value.workflow.replace('APT::FTPArchive::Release::Valid-Until=$valid_until', 'APT::FTPArchive::Release::Valid-Until='); }],
        ['missing detached Release verification', (value) => { value.workflow = value.workflow.replace('"$release_directory/Release.gpg" "$release_directory/Release"', '"$release_directory/Release.gpg"'); }],
        ['a source list without signed-by', (value) => { value.workflow = value.workflow.replace('[signed-by=%s] ', ''); }],
        ['an isolated APT root without a source list', (value) => { value.workflow = value.workflow.replace("Dir::Etc::sourcelist='sources.list'", "Dir::Etc::sourcelist='missing.list'"); }],
        ['a repository inaccessible to the APT sandbox', (value) => { value.workflow = value.workflow.replace('find "$repository_root" -type f -exec chmod 644 {} +', 'find "$repository_root" -type f -exec chmod 600 {} +'); }],
        ['missing private-key cleanup', (value) => { value.workflow = value.workflow.replace('gpgconf --homedir "$signing_home" --kill all', 'gpgconf --homedir "$signing_home" --version'); }],
        ['private-key cleanup without residue verification', (value) => { value.workflow = value.workflow.replace('if [ -e "$temporary_directory" ]; then', 'if false; then'); }],
        ['unchecked input artifact hashes', (value) => { value.workflow = value.workflow.replace('sha256sum --strict --check SHA256SUMS.txt', 'sha256sum SHA256SUMS.txt'); }],
        ['an unchecked downloaded inspection record', (value) => { value.workflow = value.workflow.replace('inspection.candidateSha', 'inspection.uncheckedCandidate'); }],
        ['a release operation', (value) => { value.workflow = value.workflow.replace('pnpm audit:desktop:trust', 'gh release create ScreenHello'); }],
    ])('fails closed for %s', (_name, mutate) => {
        const value = baseline();
        mutate(value);
        expect(auditLinuxDebRepositorySignedCandidateWorkflow(value.workflow, value.matrix)).not.toEqual([]);
    });
});
