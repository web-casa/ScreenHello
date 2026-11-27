import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { auditWindowsArm64SignedCandidateWorkflow } from '../../scripts/audit-windows-signed-candidate-workflow.mjs';

const [workflow, matrix, candidateConfig] = await Promise.all([
    readFile(new URL('../../.github/workflows/windows-arm64-signed-candidate.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../config/desktop-release-matrix.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../src-tauri/tauri.windows-arm64-signed-candidate.conf.json', import.meta.url), 'utf8').then(JSON.parse),
]);

const baseline = () => ({
    workflow,
    matrix: structuredClone(matrix),
    candidateConfig: structuredClone(candidateConfig),
});

describe('Windows ARM64 signed candidate workflow audit', () => {
    it('accepts the manually confirmed, protected ARM64 signing candidate', () => {
        const value = baseline();
        expect(auditWindowsArm64SignedCandidateWorkflow(
            value.workflow,
            value.matrix,
            value.candidateConfig,
        )).toEqual([]);
    });

    it.each([
        ['an automatic trigger', (value) => { value.workflow = value.workflow.replace('  workflow_dispatch:', '  push:'); }],
        ['a non-private signing condition', (value) => { value.workflow = value.workflow.replace("github.event.repository.private", 'true'); }],
        ['a different candidate repository ID', (value) => { value.workflow = value.workflow.replace("github.repository_id == '1353846102'", "github.repository_id == '0'"); }],
        ['an altered target policy', (value) => { value.matrix.windowsArm64SigningCandidate.target = 'windows-x64'; }],
        ['an x64 runner', (value) => { value.workflow = value.workflow.replaceAll('windows-11-arm', 'windows-2025'); }],
        ['a static certificate thumbprint', (value) => { value.candidateConfig.bundle.windows.certificateThumbprint = '0'.repeat(40); }],
        ['a legacy timestamp protocol', (value) => { value.candidateConfig.bundle.windows.tsp = false; }],
        ['a different static signing config', (value) => { value.workflow = value.workflow.replaceAll('tauri.windows-arm64-signed-candidate.conf.json', 'tauri.windows-signed-candidate.conf.json'); }],
        ['a missing ARM64 target installation', (value) => { value.workflow = value.workflow.replaceAll('rustup target add aarch64-pc-windows-msvc', 'rustup target add x86_64-pc-windows-msvc'); }],
        ['an ARM64 build without a target triple', (value) => { value.workflow = value.workflow.replaceAll(' --target aarch64-pc-windows-msvc', ''); }],
        ['an x64-first SignTool selector', (value) => { value.workflow = value.workflow.replace("$signToolArchitectures = @('arm64', 'x64')", "$signToolArchitectures = @('x64')"); }],
        ['a certificate secret outside the import step', (value) => { value.workflow = value.workflow.replace('Build signed and timestamped Windows candidate', 'Build signed and timestamped Windows candidate\n        env:\n          CERTIFICATE: ${{ secrets.WINDOWS_CERTIFICATE }}'); }],
        ['an unsigned build flag', (value) => { value.workflow = value.workflow.replace('--bundles nsis', '--bundles nsis --no-sign'); }],
        ['missing timestamp verification', (value) => { value.workflow = value.workflow.replace('/pa /all /tw /v', '/pa /all /v'); }],
        ['missing certificate cleanup', (value) => { value.workflow = value.workflow.replace('Cert:\\CurrentUser\\My\\$thumbprint', 'Cert:\\CurrentUser\\My\\removed'); }],
        ['cleanup that does not run after failure', (value) => { value.workflow = value.workflow.replace(
            '      - name: Remove temporary Windows signing material\n        if: always()',
            '      - name: Remove temporary Windows signing material\n        if: success()',
        ); }],
        ['cleanup that suppresses certificate deletion failure', (value) => { value.workflow = value.workflow.replace(
            "$ErrorActionPreference = 'Stop'\n          $thumbprints",
            "$ErrorActionPreference = 'Continue'\n          $thumbprints",
        ); }],
        ['a release operation', (value) => { value.workflow = value.workflow.replace('pnpm desktop:sbom', 'gh release create ScreenHello'); }],
    ])('fails closed for %s', (_name, mutate) => {
        const value = baseline();
        mutate(value);
        expect(auditWindowsArm64SignedCandidateWorkflow(
            value.workflow,
            value.matrix,
            value.candidateConfig,
        )).not.toEqual([]);
    });
});
