import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
    auditDesktopArtifactProvenanceCandidateWorkflow,
    auditDesktopArtifactProvenanceCandidateWorkflows,
} from '../../scripts/audit-desktop-artifact-provenance-candidate-workflows.mjs';
import { desktopArtifactProvenanceProfiles } from '../../scripts/desktop-artifact-provenance.mjs';

const [matrix, macosArm64Workflow, macosX64Workflow, windowsX64Workflow, windowsArm64Workflow, linuxDebRepositoryWorkflow] = await Promise.all([
    readFile(new URL('../../config/desktop-release-matrix.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../.github/workflows/macos-signed-candidate.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../.github/workflows/macos-intel-signed-candidate.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../.github/workflows/windows-signed-candidate.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../.github/workflows/windows-arm64-signed-candidate.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../.github/workflows/linux-deb-repository-signed-candidate.yml', import.meta.url), 'utf8'),
]);

const profiles = Object.fromEntries(desktopArtifactProvenanceProfiles.map((profile) => [profile.target, profile]));
const baseline = () => ({
    matrix: structuredClone(matrix),
    macosArm64Workflow,
    macosX64Workflow,
    windowsX64Workflow,
    windowsArm64Workflow,
    linuxDebRepositoryWorkflow,
});

describe('desktop signed-candidate artifact provenance workflow audit', () => {
    it('accepts all five protected signed-candidate workflows', () => {
        expect(auditDesktopArtifactProvenanceCandidateWorkflows(baseline())).toEqual([]);
    });

    it('accepts CRLF workflow text', () => {
        const value = baseline();
        expect(
            auditDesktopArtifactProvenanceCandidateWorkflow(
                value.macosArm64Workflow.replaceAll('\n', '\r\n'),
                value.matrix,
                profiles['macos-arm64'],
            ),
        ).toEqual([]);
    });

    it.each([
        ['missing OIDC permission', (value) => {
            value.macosArm64Workflow = value.macosArm64Workflow.replace('id-token: write', 'id-token: read');
        }],
        ['a different candidate repository ID', (value) => {
            value.macosArm64Workflow = value.macosArm64Workflow.replaceAll(
                "github.repository_id == '1353846102'",
                "github.repository_id == '0'",
            );
        }],
        ['an unpinned attestation action', (value) => {
            value.macosX64Workflow = value.macosX64Workflow.replace(
                'actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6',
                'actions/attest@v4',
            );
        }],
        ['a second attestation action', (value) => {
            value.macosX64Workflow = value.macosX64Workflow.replace(
                '      - name: Upload signed macOS Intel candidate evidence',
                '      - name: Unexpected attestation\n        uses: actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4.2.2\n\n      - name: Upload signed macOS Intel candidate evidence',
            );
        }],
        ['a custom predicate input', (value) => {
            value.windowsX64Workflow = value.windowsX64Workflow.replace(
                'show-summary: false',
                'predicate: {}\n          show-summary: false',
            );
        }],
        ['a record that omits the exact signed subject', (value) => {
            value.windowsArm64Workflow = value.windowsArm64Workflow.replace(
                '--subject "$env:SCREENHELLO_WINDOWS_ARM64_SIGNED_INSTALLER"',
                '--subject "$env:SCREENHELLO_DESKTOP_BINARY"',
            );
        }],
        ['a record that ignores the attestation bundle output', (value) => {
            value.macosArm64Workflow = value.macosArm64Workflow.replace(
                '--bundle "$SCREENHELLO_PROVENANCE_BUNDLE"',
                '--bundle "$RUNNER_TEMP/untrusted-bundle.json"',
            );
        }],
        ['a keychain cleanup that suppresses deletion failure', (value) => {
            value.macosX64Workflow = value.macosX64Workflow.replace(
                'security delete-keychain "$SCREENHELLO_SIGNING_KEYCHAIN"\n            if [ -e "$SCREENHELLO_SIGNING_KEYCHAIN" ]; then',
                'security delete-keychain "$SCREENHELLO_SIGNING_KEYCHAIN" || true\n            if [ -e "$SCREENHELLO_SIGNING_KEYCHAIN" ]; then',
            );
        }],
        ['a keychain cleanup that skips failed signing runs', (value) => {
            value.macosArm64Workflow = value.macosArm64Workflow.replace(
                '      - name: Remove the temporary signing keychain\n        if: always()',
                '      - name: Remove the temporary signing keychain\n        if: success()',
            );
        }],
        ['a Windows cleanup that suppresses certificate deletion failure', (value) => {
            value.windowsX64Workflow = value.windowsX64Workflow.replace(
                "$ErrorActionPreference = 'Stop'\n          $thumbprints",
                "$ErrorActionPreference = 'Continue'\n          $thumbprints",
            );
        }],
        ['a Linux cleanup without residue verification', (value) => {
            value.linuxDebRepositoryWorkflow = value.linuxDebRepositoryWorkflow.replace(
                'if [ -e "$temporary_directory" ]; then',
                'if false; then',
            );
        }],
        ['a provenance bundle excluded from checksums', (value) => {
            value.linuxDebRepositoryWorkflow = value.linuxDebRepositoryWorkflow.replace(
                'provenance-attestation.bundle.json',
                'provenance-attestation.bundle.missing',
            );
        }],
        ['a verification plan excluded from checksums', (value) => {
            value.windowsX64Workflow = value.windowsX64Workflow.replace(
                "(Join-Path $candidateDir 'provenance-verification-plan.json')",
                "(Join-Path $candidateDir 'provenance-verification-plan.missing')",
            );
        }],
        ['a missing provenance verification plan step', (value) => {
            value.macosArm64Workflow = value.macosArm64Workflow.replace(
                /\n {6}- name: Write signed candidate provenance verification plan[\s\S]*?(?=\n {6}- name: Write signed candidate checksums)/u,
                '',
            );
        }],
        ['a candidate workflow that executes GH verification', (value) => {
            value.macosX64Workflow = value.macosX64Workflow.replace(
                '--write-plan',
                '--write-plan\n          gh attestation verify candidate.dmg --repo web-casa/signed-candidate',
            );
        }],
        ['a release operation after provenance', (value) => {
            value.macosArm64Workflow = value.macosArm64Workflow.replace(
                'show-summary: false',
                'show-summary: false\n          # gh release create ScreenHello',
            );
        }],
        ['an altered matrix provenance policy', (value) => {
            value.matrix.desktopArtifactProvenanceCandidate.action.predicate = 'custom';
        }],
        ['an altered matrix verification policy', (value) => {
            value.matrix.desktopArtifactProvenanceVerification.ghCli.noPublicGood = false;
        }],
    ])('fails closed for %s', (_name, mutate) => {
        const value = baseline();
        mutate(value);
        expect(auditDesktopArtifactProvenanceCandidateWorkflows(value)).not.toEqual([]);
    });
});
