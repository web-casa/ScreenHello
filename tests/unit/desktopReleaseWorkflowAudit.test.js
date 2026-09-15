import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { auditDesktopReleaseWorkflow } from '../../scripts/audit-desktop-release-workflow.mjs';

const workflow = await readFile(new URL('../../.github/workflows/desktop-release-gate.yml', import.meta.url), 'utf8');
const matrix = JSON.parse(await readFile(new URL('../../config/desktop-release-matrix.json', import.meta.url), 'utf8'));
const workflowLf = workflow.replace(/\r\n?/gu, '\n');

describe('desktop release workflow audit', () => {
    it('accepts the read-only current-candidate gate', () => {
        expect(auditDesktopReleaseWorkflow(workflow, matrix)).toEqual([]);
    });

    it('accepts the same workflow after a Windows CRLF checkout', () => {
        expect(auditDesktopReleaseWorkflow(workflowLf.replaceAll('\n', '\r\n'), matrix)).toEqual([]);
    });

    it.each([
        ['a write permission', (source) => source.replace('contents: read', 'contents: write')],
        ['an attestation permission', (source) => source.replace('contents: read', 'contents: read\n  attestations: write')],
        ['an artifact metadata permission', (source) => source.replace('contents: read', 'contents: read\n  artifact-metadata: write')],
        ['a job-level permission', (source) => source.replace('needs: prepare', 'permissions:\n      contents: write\n    needs: prepare')],
        ['a floating runner', (source) => source.replace('runs-on: ubuntu-24.04', 'runs-on: ubuntu-latest')],
        ['a hard-coded target matrix', (source) => source.replace(
            'matrix: ${{ fromJSON(needs.prepare.outputs.matrix) }}',
            'matrix:\n        include:\n          - target: linux-x64',
        )],
        ['an untrusted pull-request matrix source', (source) => source.replace(
            'ref: ${{ env.SCREENHELLO_MATRIX_SOURCE }}',
            'ref: ${{ env.SCREENHELLO_RELEASE_CANDIDATE }}',
        )],
        ['a missing scope propagation', (source) => source.replace(
            'SCREENHELLO_DESKTOP_GATE_SCOPE: ${{ needs.prepare.outputs.scope }}',
            'SCREENHELLO_DESKTOP_GATE_SCOPE: full',
        )],
        ['a release operation', (source) => source.replace('pnpm desktop:sbom', 'gh release create desktop')],
        ['a missing trust audit', (source) => source.replace('pnpm audit:desktop:trust', 'echo skip-trust-audit')],
        ['a missing artifact provenance audit', (source) => source.replace('pnpm audit:desktop:artifact-provenance', 'echo skip-provenance-audit')],
        ['an omitted artifact provenance workflow audit path', (source) => source.replace(
            '      - scripts/audit-desktop-artifact-provenance-candidate-workflows.mjs\n',
            '',
        )],
        ['an omitted release payload manifest workflow trigger', (source) => source.replace(
            '      - scripts/desktop-release-payload-manifest.mjs\n',
            '',
        )],
        ['an omitted publication handoff workflow trigger', (source) => source.replace(
            '      - scripts/desktop-release-publication-handoff.mjs\n',
            '',
        )],
        ['an omitted public export manifest workflow trigger', (source) => source.replace(
            '      - config/public-export-manifest.json\n',
            '',
        )],
        ['an omitted public export snapshot implementation trigger', (source) => source.replace(
            '      - scripts/public-repository.mjs\n',
            '',
        )],
        ['an omitted GitHub readiness workflow trigger', (source) => source.replace(
            '      - scripts/desktop-release-github-readiness.mjs\n',
            '',
        )],
        ['an omitted supply-chain workflow trigger', (source) => source.replace(
            '      - scripts/audit-github-actions-supply-chain.mjs\n',
            '',
        )],
        ['an omitted local pnpm bootstrap trigger', (source) => source.replace(
            '      - .github/actions/setup-pnpm/action.yml\n',
            '',
        )],
        ['an omitted macOS signing workflow path', (source) => source.replace(
            '      - .github/workflows/macos-signed-candidate.yml\n',
            '',
        )],
        ['an omitted macOS Intel signing workflow path', (source) => source.replace(
            '      - .github/workflows/macos-intel-signed-candidate.yml\n',
            '',
        )],
        ['an omitted Windows signing workflow path', (source) => source.replace(
            '      - .github/workflows/windows-signed-candidate.yml\n',
            '',
        )],
        ['an omitted Windows ARM64 signing workflow path', (source) => source.replace(
            '      - .github/workflows/windows-arm64-signed-candidate.yml\n',
            '',
        )],
        ['a missing Windows ARM64 signing workflow audit test trigger', (source) => source.replace(
            'tests/unit/windowsArm64SignedCandidateWorkflowAudit.test.js',
            'tests/unit/windows-arm64-signing.test.js',
        )],
        ['a missing GitHub readiness audit test trigger', (source) => source.replace(
            'tests/unit/desktopReleaseGitHubReadiness.test.js',
            'tests/unit/desktop-release-github-readiness.test.js',
        )],
        ['a missing supply-chain audit test trigger', (source) => source.replace(
            'tests/unit/githubActionsSupplyChain.test.js',
            'tests/unit/github-actions-supply-chain.test.js',
        )],
        ['a missing Linux key lifecycle audit test trigger', (source) => source.replace(
            'tests/unit/linuxDebRepositoryKeyLifecycleCandidateWorkflowAudit.test.js',
            'tests/unit/linux-deb-key-lifecycle.test.js',
        )],
        ['a feature binary upload', (source) => source.replace(
            'path: artifacts/release/desktop-matrix/',
            'path: src-tauri/target/release/desktop-test-driver',
        )],
        ['a skipped clean rebuild', (source) => source.replace(
            'cargo clean --manifest-path src-tauri/Cargo.toml',
            'echo skip-clean',
        )],
        ['a skipped production codec audit', (source) => source.replace(
            'pnpm audit:desktop:codecs',
            'echo skip-codec-audit',
        )],
        ['a missing codec URL policy test trigger', (source) => source.replace(
            'tests/unit/trustedCodecResourceUrl.test.js',
            'tests/unit/codec-url-policy.test.js',
        )],
    ])('fails closed for %s', (_name, mutate) => {
        expect(auditDesktopReleaseWorkflow(mutate(workflow), matrix)).not.toEqual([]);
    });
});
