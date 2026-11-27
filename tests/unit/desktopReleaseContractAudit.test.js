import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { auditDesktopReleaseContract } from '../../scripts/audit-desktop-release-contract.mjs';

const [matrix, packageJson, tauriConfig, candidateConfig, windowsSigningCandidateConfig, windowsArm64SigningCandidateConfig, cargoToml, cargoLock] = await Promise.all([
    readFile(new URL('../../config/desktop-release-matrix.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../package.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../src-tauri/tauri.phase9.conf.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../src-tauri/tauri.windows-signed-candidate.conf.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../src-tauri/tauri.windows-arm64-signed-candidate.conf.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../src-tauri/Cargo.toml', import.meta.url), 'utf8'),
    readFile(new URL('../../src-tauri/Cargo.lock', import.meta.url), 'utf8'),
]);

const baseline = () => ({
    matrix: structuredClone(matrix),
    packageJson: structuredClone(packageJson),
    tauriConfig: structuredClone(tauriConfig),
    candidateConfig: structuredClone(candidateConfig),
    windowsSigningCandidateConfig: structuredClone(windowsSigningCandidateConfig),
    windowsArm64SigningCandidateConfig: structuredClone(windowsArm64SigningCandidateConfig),
    cargoToml,
    cargoLock,
});

describe('desktop release contract audit', () => {
    it('accepts the declared six-target support contract', () => {
        expect(auditDesktopReleaseContract(baseline())).toEqual([]);
    });

    it('rejects a leading-zero numeric prerelease identifier even when every version source agrees', () => {
        const value = baseline();
        // 版本号随每次发版变化，这里必须从当前 package.json 派生，写死字面量会在下次发版时失效。
        const declared = value.packageJson.version;
        const invalidVersion = `${declared}-01`;
        value.packageJson.version = invalidVersion;
        value.tauriConfig.version = invalidVersion;
        value.cargoToml = value.cargoToml.replace(`version = "${declared}"`, `version = "${invalidVersion}"`);
        value.cargoLock = value.cargoLock.replace(`version = "${declared}"`, `version = "${invalidVersion}"`);

        expect(auditDesktopReleaseContract(value)).toContain('desktop-release-contract-package-version-invalid');
    });

    it.each([
        ['a divergent Tauri version', (value) => { value.tauriConfig.version = '9.9.9'; }],
        ['a divergent Cargo version', (value) => {
            value.cargoToml = value.cargoToml.replace(
                `version = "${value.packageJson.version}"`,
                'version = "9.9.9"',
            );
        }],
        ['a missing ARM target', (value) => { value.matrix.targets = value.matrix.targets.filter(({ id }) => id !== 'windows-arm64'); }],
        ['an unknown evidence state', (value) => { value.matrix.targets[0].evidenceStatus = 'passed'; }],
        ['a Wayland claim without native validation', (value) => { value.matrix.supportPolicy.linux.wayland = 'supported'; }],
        ['a destructive native uninstallation policy', (value) => { value.matrix.lifecyclePolicy.nativeUninstallPolicy = 'delete-app-data'; }],
        ['a release trust policy that claims configuration', (value) => { value.matrix.releaseTrustPolicy.status = 'configured'; }],
        ['a macOS signed candidate that changes architecture', (value) => { value.matrix.macosSigningCandidate.target = 'macos-x64'; }],
        ['a macOS Intel signed candidate that changes architecture', (value) => { value.matrix.macosIntelSigningCandidate.target = 'macos-arm64'; }],
        ['a Windows signed candidate that changes architecture', (value) => { value.matrix.windowsSigningCandidate.target = 'windows-arm64'; }],
        ['a Windows signed candidate with a legacy timestamp protocol', (value) => { value.windowsSigningCandidateConfig.bundle.windows.tsp = false; }],
        ['a Windows ARM64 signed candidate that changes architecture', (value) => { value.matrix.windowsArm64SigningCandidate.target = 'windows-x64'; }],
        ['a Windows ARM64 signed candidate with a legacy timestamp protocol', (value) => { value.windowsArm64SigningCandidateConfig.bundle.windows.tsp = false; }],
        ['a Linux client trust lifecycle policy with a shorter overlap', (value) => { value.matrix.linuxDebRepositoryKeyLifecycleCandidate.rotation.minimumOverlapDays = 1; }],
        ['an artifact provenance candidate that claims public release', (value) => { value.matrix.desktopArtifactProvenanceCandidate.publicRelease = true; }],
        ['a local release review that claims release readiness', (value) => { value.matrix.desktopReleaseReview.decision.releaseReady = true; }],
        ['a payload manifest that claims release readiness', (value) => { value.matrix.desktopReleasePayloadManifest.decision.releaseReady = true; }],
        ['a publication plan that permits APT sidecars as GitHub Release assets', (value) => { value.matrix.desktopReleasePublicationPlan.linuxRepository.githubReleaseAssets = 'allowed'; }],
        ['a handoff that makes a beta release latest', (value) => { value.matrix.desktopReleasePublicationHandoff.directDownload.release.makeLatest = true; }],
    ])('fails closed for %s', (_name, mutate) => {
        const value = baseline();
        mutate(value);
        expect(auditDesktopReleaseContract(value)).not.toEqual([]);
    });
});
