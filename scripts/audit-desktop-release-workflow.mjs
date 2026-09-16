import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { candidateTargets } from './audit-desktop-release-contract.mjs';
import { desktopWorkflowMatrix } from './desktop-release-matrix.mjs';

const exactActionSha = /^[ \t]*uses:\s+[^\s@]+@[0-9a-f]{40}(?:\s+#.*)?$/u;
const localPnpmActionReference = './.github/actions/setup-pnpm';
const actionLineIsPinnedOrLocal = (line) => {
    const normalized = line.replace(/^\s*-\s*/u, '      ');
    return exactActionSha.test(normalized) || normalized.trim() === `uses: ${localPnpmActionReference}`;
};

const count = (source, value) => source.split(value).length - 1;

export const auditDesktopReleaseWorkflow = (source, matrix) => {
    source = source.replace(/\r\n?/gu, '\n');
    const failures = [];
    const requireText = (value, id) => {
        if (!source.includes(value)) failures.push(id);
    };
    const forbid = (pattern, id) => {
        if (pattern.test(source)) failures.push(id);
    };
    const globalPermissions = source.match(/^permissions:\n(?<body>(?: {2}[^\n]*(?:\n|$))*)/mu)?.groups?.body;

    requireText('name: Desktop Release Gate', 'desktop-workflow-name-missing');
    requireText('  workflow_dispatch:', 'desktop-workflow-manual-trigger-missing');
    requireText('  pull_request:', 'desktop-workflow-pr-trigger-missing');
    if (globalPermissions?.trim() !== 'contents: read') failures.push('desktop-workflow-permissions-not-read-only');
    forbid(/^\s{2}(?:pull_request_target|push|release|schedule|workflow_run):/mu, 'desktop-workflow-extra-trigger-forbidden');
    forbid(/contents:\s*write|packages:\s*write|(?:id-token|attestations|artifact-metadata):\s*write/iu, 'desktop-workflow-write-permission-forbidden');
    forbid(/^\s{4,}permissions:\s*$/mu, 'desktop-workflow-job-permissions-forbidden');
    forbid(/\$\{\{\s*secrets\./iu, 'desktop-workflow-secret-context-forbidden');
    forbid(/(?:tauri-apps\/tauri-action|softprops\/action-gh-release|actions\/attest(?:-build-provenance)?|gh\s+release|git\s+tag|npm\s+publish|pnpm\s+publish|TAURI_SIGNING|APPLE_(?:CERTIFICATE|SIGNING)|WINDOWS_CERTIFICATE|GITHUB_TOKEN)/iu, 'desktop-workflow-release-operation-forbidden');
    forbid(/runs-on:\s*[^\n]*-latest/iu, 'desktop-workflow-floating-runner-forbidden');

    const prepareStart = source.indexOf('jobs:\n  prepare:');
    const desktopStart = source.indexOf('\n  desktop:', prepareStart);
    const prepareBlock = prepareStart >= 0 && desktopStart > prepareStart
        ? source.slice(prepareStart, desktopStart)
        : '';
    if (!prepareBlock.includes('ref: ${{ env.SCREENHELLO_MATRIX_SOURCE }}')
        || prepareBlock.includes('ref: ${{ env.SCREENHELLO_RELEASE_CANDIDATE }}')) {
        failures.push('desktop-workflow-pr-matrix-source-untrusted');
    }

    const actionLines = source.split('\n').filter((line) => /^\s*-?\s*uses:/u.test(line));
    if (!actionLines.length || actionLines.some((line) => !actionLineIsPinnedOrLocal(line))) {
        failures.push('desktop-workflow-action-not-sha-pinned');
    }

    let gateTargets = [];
    try {
        const fullTargets = candidateTargets(matrix, 'full');
        const prTargets = candidateTargets(matrix, 'pr');
        const fullMatrix = desktopWorkflowMatrix(matrix, 'full');
        const prMatrix = desktopWorkflowMatrix(matrix, 'pr');
        gateTargets = [...fullTargets, ...prTargets];
        if (fullTargets.length !== 6 || prTargets.length !== 3
            || new Set(fullTargets.map(({ id }) => id)).size !== fullTargets.length
            || !prTargets.every((target) => fullTargets.includes(target))
            || fullMatrix.include.length !== fullTargets.length
            || prMatrix.include.length !== prTargets.length
            || fullMatrix.include.some(({ target }, index) => target !== fullTargets[index].id)
            || prMatrix.include.some(({ target }, index) => target !== prTargets[index].id)) {
            failures.push('desktop-workflow-generated-matrix-invalid');
        }
    } catch (error) {
        failures.push(error.message);
    }
    if (new Set(gateTargets.map(({ id }) => id)).size !== 6) failures.push('desktop-workflow-target-set-invalid');
    forbid(/^\s*-\s+target:\s+/mu, 'desktop-workflow-static-target-matrix-forbidden');
    forbid(/^\s{6,}include:\s*$/mu, 'desktop-workflow-static-include-matrix-forbidden');

    for (const required of [
        'config/public-export-manifest.json',
        'scripts/desktop-release-matrix.mjs',
        'scripts/desktop-artifact-provenance-verification.mjs',
        'scripts/desktop-artifact-provenance.mjs',
        'scripts/desktop-cross-platform-acceptance.mjs',
        'scripts/desktop-platform-acceptance.mjs',
        'scripts/desktop-release-payload-manifest.mjs',
        'scripts/desktop-release-publication-plan.mjs',
        'scripts/desktop-release-publication-handoff.mjs',
        'scripts/desktop-release-github-readiness.mjs',
        'scripts/public-repository.mjs',
        'scripts/audit-github-actions-supply-chain.mjs',
        '.github/actions/setup-pnpm/action.yml',
        'scripts/desktop-release-review.mjs',
        'scripts/audit-desktop-codecs.mjs',
        'scripts/audit-desktop-artifact-provenance-candidate-workflows.mjs',
        'scripts/audit-desktop-release-trust.mjs',
        'scripts/audit-linux-deb-repository-key-lifecycle-candidate-workflow.mjs',
        'scripts/audit-linux-deb-repository-signed-candidate-workflow.mjs',
        'scripts/audit-macos-signed-candidate-workflow.mjs',
        'scripts/audit-windows-arm64-signed-candidate-workflow.mjs',
        'scripts/audit-windows-signed-candidate-workflow.mjs',
        'scripts/linux-deb-key-lifecycle.mjs',
        'scripts/linux-deb-repository-matrix.mjs',
        '.github/workflows/linux-deb-repository-signed-candidate.yml',
        '.github/workflows/macos-intel-signed-candidate.yml',
        '.github/workflows/macos-signed-candidate.yml',
        '.github/workflows/windows-arm64-signed-candidate.yml',
        '.github/workflows/windows-signed-candidate.yml',
        'src/utils/trustedCodecResourceUrl.js',
        'src/workers/avifEncoder.worker.js',
        'src/workers/webpEncoder.worker.js',
        'src/workers/pngEncoder.worker.js',
        'tests/unit/desktop*.test.js',
        'tests/unit/desktopArtifactProvenance.test.js',
        'tests/unit/desktopArtifactProvenanceCandidateWorkflowAudit.test.js',
        'tests/unit/desktopCrossPlatformAcceptance.test.js',
        'tests/unit/desktopReleaseGitHubReadiness.test.js',
        'tests/unit/publicRepository.test.js',
        'tests/unit/githubActionsSupplyChain.test.js',
        'tests/unit/macosSignedCandidateWorkflowAudit.test.js',
        'tests/unit/linuxDebRepositoryMatrix.test.js',
        'tests/unit/linuxDebRepositoryKeyLifecycleCandidateWorkflowAudit.test.js',
        'tests/unit/linuxDebRepositorySignedCandidateWorkflowAudit.test.js',
        'tests/unit/windowsArm64SignedCandidateWorkflowAudit.test.js',
        'tests/unit/windowsSignedCandidateWorkflowAudit.test.js',
        'tests/unit/trustedCodecResourceUrl.test.js',
        'jobs:\n  prepare:',
        'needs: prepare',
        'needs: [prepare, desktop]',
        'matrix: ${{ fromJSON(needs.prepare.outputs.matrix) }}',
        'SCREENHELLO_MATRIX_SOURCE: ${{ github.event.pull_request.base.sha || github.sha }}',
        'node scripts/desktop-release-matrix.mjs --scope "$scope"',
        "scope='pr'",
        "scope='full'",
        'SCREENHELLO_DESKTOP_GATE_SCOPE: ${{ needs.prepare.outputs.scope }}',
        'pnpm install --frozen-lockfile --strict-peer-dependencies',
        'pnpm audit --audit-level=low',
        'pnpm audit:licenses',
        'pnpm audit:desktop:workflow',
        'pnpm audit:desktop:contract',
        'pnpm audit:desktop:trust',
        'pnpm audit:desktop:artifact-provenance',
        'pnpm audit:desktop:linux-deb-key-lifecycle',
        'pnpm audit:github-actions',
        'cargo test --manifest-path src-tauri/Cargo.toml --locked',
        'cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings',
        'cargo audit --file src-tauri/Cargo.lock --ignore RUSTSEC-2024-0429',
        'pnpm desktop:build:test-driver',
        'SCREENHELLO_TEST_DRIVER_BUILD=runner-only CARGO_TARGET_DIR=src-tauri/target-test-driver cargo check',
        'SCREENHELLO_DESKTOP_DRIVER_PROVIDER: embedded',
        'cargo clean --manifest-path src-tauri/Cargo.toml',
        'pnpm exec tauri build --ci --bundles "${{ matrix.bundle }}" --no-sign --config src-tauri/tauri.phase9.conf.json',
        'pnpm audit:desktop:codecs',
        "bundle_count=\"$(printf '%s\\n' \"$bundle\" | awk 'NF { count += 1 } END { print count + 0 }')\"",
        'test "$bundle_count" -eq 1',
        "grep -q 'tauri-plugin-wdio-webdriver'",
        'pnpm desktop:sbom',
        'pnpm desktop:inspect',
        'pnpm desktop:evidence',
        'node scripts/audit-desktop-release-evidence.mjs',
        'merge-multiple: true',
    ]) requireText(required, `desktop-workflow-required-step-missing:${required}`);
    if (count(source, 'SCREENHELLO_DESKTOP_GATE_SCOPE: ${{ needs.prepare.outputs.scope }}') !== 2) {
        failures.push('desktop-workflow-scope-propagation-invalid');
    }
    if (count(source, 'retention-days: 14') !== 2) failures.push('desktop-workflow-retention-invalid');

    const orderedSteps = [
        'pnpm desktop:build:test-driver',
        'node scripts/test-desktop-runtime.mjs',
        'cargo clean --manifest-path src-tauri/Cargo.toml',
        'pnpm exec tauri build --ci --bundles',
        "grep -q 'tauri-plugin-wdio-webdriver'",
        'pnpm audit:desktop:codecs',
        'pnpm desktop:inspect',
        'pnpm desktop:sbom',
        'pnpm desktop:evidence',
    ];
    let previous = -1;
    for (const step of orderedSteps) {
        const position = source.indexOf(step, previous + 1);
        if (position <= previous) failures.push(`desktop-workflow-step-order-invalid:${step}`);
        previous = position;
    }

    const allowedActions = new Map([
        ['actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 3],
        ['actions/setup-node@820762786026740c76f36085b0efc47a31fe5020', 3],
        [localPnpmActionReference, 1],
        ['actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a', 2],
        ['actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c', 1],
    ]);
    const referencedActions = actionLines.map((line) => line.match(/uses:\s*([^\s#]+)/u)?.[1]).filter(Boolean);
    if (referencedActions.length !== [...allowedActions.values()].reduce((total, value) => total + value, 0)
        || [...allowedActions].some(([action, expected]) => referencedActions.filter((value) => value === action).length !== expected)
        || referencedActions.some((action) => !allowedActions.has(action))) {
        failures.push('desktop-workflow-action-allowlist-mismatch');
    }

    const uploadBlocks = [...source.matchAll(/uses:\s+actions\/upload-artifact@[0-9a-f]{40}[\s\S]*?(?=\n\s*- name:|\n\s{2}[a-z][a-z-]*:|$)/gu)]
        .map(([block]) => block);
    if (uploadBlocks.length !== 2
        || uploadBlocks.some((block) => /src-tauri\/target|desktop-test-driver/iu.test(block))) {
        failures.push('desktop-workflow-test-binary-upload-risk');
    }
    if (!uploadBlocks.some((block) => block.includes('path: artifacts/release/desktop-matrix/'))
        || !uploadBlocks.some((block) => block.includes('automatic-gate.json'))) {
        failures.push('desktop-workflow-evidence-upload-missing');
    }

    return failures;
};

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const workflow = await readFile(new URL('../.github/workflows/desktop-release-gate.yml', import.meta.url), 'utf8');
    const matrix = JSON.parse(await readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8'));
    const failures = auditDesktopReleaseWorkflow(workflow, matrix);
    console.log(JSON.stringify({ status: failures.length ? 'failed' : 'passed', failures }, null, 2));
    if (failures.length) process.exitCode = 1;
}
