import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
    auditDesktopReleaseTrust,
    desktopReleaseTrustBlockers,
    desktopReleaseTrustReport,
} from '../../scripts/audit-desktop-release-trust.mjs';

const [
    matrix,
    packageJson,
    tauriConfig,
    candidateConfig,
    windowsSigningCandidateConfig,
    windowsArm64SigningCandidateConfig,
    cargoToml,
    workflow,
    macosSignedCandidateWorkflow,
    macosIntelSignedCandidateWorkflow,
    windowsSignedCandidateWorkflow,
    windowsArm64SignedCandidateWorkflow,
    linuxDebRepositorySignedCandidateWorkflow,
] = await Promise.all([
    readFile(new URL('../../config/desktop-release-matrix.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../package.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../src-tauri/tauri.phase9.conf.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../src-tauri/tauri.windows-signed-candidate.conf.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../src-tauri/tauri.windows-arm64-signed-candidate.conf.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../src-tauri/Cargo.toml', import.meta.url), 'utf8'),
    readFile(new URL('../../.github/workflows/desktop-release-gate.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../.github/workflows/macos-signed-candidate.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../.github/workflows/macos-intel-signed-candidate.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../.github/workflows/windows-signed-candidate.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../.github/workflows/windows-arm64-signed-candidate.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../.github/workflows/linux-deb-repository-signed-candidate.yml', import.meta.url), 'utf8'),
]);

const baseline = () => ({
    matrix: structuredClone(matrix),
    packageJson: structuredClone(packageJson),
    tauriConfig: structuredClone(tauriConfig),
    candidateConfig: structuredClone(candidateConfig),
    windowsSigningCandidateConfig: structuredClone(windowsSigningCandidateConfig),
    windowsArm64SigningCandidateConfig: structuredClone(windowsArm64SigningCandidateConfig),
    cargoToml,
    workflow,
    macosSignedCandidateWorkflow,
    macosIntelSignedCandidateWorkflow,
    windowsSignedCandidateWorkflow,
    windowsArm64SignedCandidateWorkflow,
    linuxDebRepositorySignedCandidateWorkflow,
});

describe('desktop release trust audit', () => {
    it('accepts the intentionally unsigned candidate and reports release blockers', () => {
        const value = baseline();
        expect(auditDesktopReleaseTrust(value)).toEqual([]);
        expect(desktopReleaseTrustReport(value)).toEqual({
            status: 'passed',
            phase: 'signing-readiness',
            releaseReady: false,
            blockers: desktopReleaseTrustBlockers,
            failures: [],
        });
    });

    it.each([
        ['a configured public release policy', (value) => { value.matrix.releaseTrustPolicy.status = 'configured'; }],
        ['an altered macOS signing candidate policy', (value) => { value.matrix.macosSigningCandidate.target = 'macos-x64'; }],
        ['an altered macOS Intel signing candidate policy', (value) => { value.matrix.macosIntelSigningCandidate.target = 'macos-arm64'; }],
        ['an altered Windows signing candidate policy', (value) => { value.matrix.windowsSigningCandidate.target = 'windows-arm64'; }],
        ['a Windows signing candidate without RFC 3161', (value) => { value.windowsSigningCandidateConfig.bundle.windows.tsp = false; }],
        ['an altered Windows ARM64 signing candidate policy', (value) => { value.matrix.windowsArm64SigningCandidate.target = 'windows-x64'; }],
        ['a Windows ARM64 signing candidate without RFC 3161', (value) => { value.windowsArm64SigningCandidateConfig.bundle.windows.tsp = false; }],
        ['an altered Linux DEB repository signing candidate policy', (value) => { value.matrix.linuxDebRepositorySigningCandidate.targets = ['linux-x64']; }],
        ['an altered Linux DEB client trust lifecycle policy', (value) => { value.matrix.linuxDebRepositoryKeyLifecycleCandidate.revocation.candidateArtifact = 'revocation-certificate'; }],
        ['an altered artifact provenance policy', (value) => { value.matrix.desktopArtifactProvenanceCandidate.action.predicate = 'custom'; }],
        ['an altered local release review policy', (value) => { value.matrix.desktopReleaseReview.review.filename = 'release.json'; }],
        ['an altered candidate payload manifest policy', (value) => { value.matrix.desktopReleasePayloadManifest.payload.subjectCount = 10; }],
        ['an altered direct-download publication policy', (value) => { value.matrix.desktopReleasePublicationPlan.directDownload.assets.pop(); }],
        ['an altered public-export handoff policy', (value) => { value.matrix.desktopReleasePublicationHandoff.publicTarget.branch = 'release'; }],
        ['a JavaScript updater plugin', (value) => { value.packageJson.devDependencies['@tauri-apps/plugin-updater'] = '2.11.1'; }],
        ['a Rust updater plugin', (value) => { value.cargoToml += '\ntauri-plugin-updater = "2.0.0"\n'; }],
        ['updater artifacts in the base config', (value) => { value.tauriConfig.bundle.createUpdaterArtifacts = true; }],
        ['a macOS signing identity', (value) => { value.tauriConfig.bundle.macOS.signingIdentity = 'Developer ID Application'; }],
        ['a Windows signing command', (value) => { value.tauriConfig.bundle.windows.signCommand = 'sign-tool'; }],
        ['a candidate without the no-sign flag', (value) => { value.workflow = value.workflow.replace('--no-sign', ''); }],
        ['a candidate attestation permission', (value) => { value.workflow = value.workflow.replace('contents: read', 'contents: read\n  attestations: write'); }],
        ['a candidate artifact metadata permission', (value) => { value.workflow = value.workflow.replace('contents: read', 'contents: read\n  artifact-metadata: write'); }],
        ['a candidate job permission', (value) => { value.workflow = value.workflow.replace('needs: prepare', 'permissions:\n      contents: write\n    needs: prepare'); }],
        ['a candidate signing secret reference', (value) => { value.workflow += '\n# ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}\n'; }],
        ['a signed candidate release operation', (value) => { value.macosSignedCandidateWorkflow = value.macosSignedCandidateWorkflow.replace('pnpm desktop:sbom', 'gh release create ScreenHello'); }],
        ['an Intel signed candidate release operation', (value) => { value.macosIntelSignedCandidateWorkflow = value.macosIntelSignedCandidateWorkflow.replace('pnpm desktop:sbom', 'gh release create ScreenHello'); }],
        ['a Windows signed candidate release operation', (value) => { value.windowsSignedCandidateWorkflow = value.windowsSignedCandidateWorkflow.replace('pnpm desktop:sbom', 'gh release create ScreenHello'); }],
        ['a Windows ARM64 signed candidate release operation', (value) => { value.windowsArm64SignedCandidateWorkflow = value.windowsArm64SignedCandidateWorkflow.replace('pnpm desktop:sbom', 'gh release create ScreenHello'); }],
        ['a Linux DEB signed candidate release operation', (value) => { value.linuxDebRepositorySignedCandidateWorkflow = value.linuxDebRepositorySignedCandidateWorkflow.replace('apt-ftparchive --version', 'gh release create ScreenHello'); }],
        ['a Linux DEB trust bundle without a minimal export', (value) => { value.linuxDebRepositorySignedCandidateWorkflow = value.linuxDebRepositorySignedCandidateWorkflow.replaceAll('--export-options export-minimal', ''); }],
        ['a signed candidate without provenance recording', (value) => { value.macosSignedCandidateWorkflow = value.macosSignedCandidateWorkflow.replace('node scripts/desktop-artifact-provenance.mjs', 'node scripts/record-missing.mjs'); }],
    ])('fails closed for %s', (_name, mutate) => {
        const value = baseline();
        mutate(value);
        expect(auditDesktopReleaseTrust(value)).not.toEqual([]);
    });
});
