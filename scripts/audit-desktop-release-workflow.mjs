import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const exactActionSha = /^[ \t]*uses:\s+[^\s@]+@[0-9a-f]{40}(?:\s+#.*)?$/u;

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

    requireText('name: Desktop Release Gate', 'desktop-workflow-name-missing');
    requireText('  workflow_dispatch:', 'desktop-workflow-manual-trigger-missing');
    requireText('  pull_request:', 'desktop-workflow-pr-trigger-missing');
    requireText('permissions:\n  contents: read', 'desktop-workflow-permissions-not-read-only');
    forbid(/^\s{2}(?:pull_request_target|push|release|schedule|workflow_run):/mu, 'desktop-workflow-extra-trigger-forbidden');
    forbid(/contents:\s*write|packages:\s*write|id-token:\s*write/iu, 'desktop-workflow-write-permission-forbidden');
    forbid(/\$\{\{\s*secrets\./iu, 'desktop-workflow-secret-context-forbidden');
    forbid(/(?:tauri-apps\/tauri-action|softprops\/action-gh-release|gh\s+release|git\s+tag|npm\s+publish|pnpm\s+publish|TAURI_SIGNING|APPLE_(?:CERTIFICATE|SIGNING)|GITHUB_TOKEN)/iu, 'desktop-workflow-release-operation-forbidden');
    forbid(/runs-on:\s*[^\n]*-latest/iu, 'desktop-workflow-floating-runner-forbidden');

    const actionLines = source.split('\n').filter((line) => /^\s*-?\s*uses:/u.test(line));
    if (!actionLines.length || actionLines.some((line) => !exactActionSha.test(line.replace(/^\s*-\s*/u, '      ')))) {
        failures.push('desktop-workflow-action-not-sha-pinned');
    }

    for (const target of matrix.targets) {
        for (const [value, id] of [
            [`target: ${target.id}`, 'target'],
            [`runner: ${target.runner}`, 'runner'],
            [`platform: ${target.platform}`, 'platform'],
            [`rust-target: ${target.rustTarget}`, 'rust-target'],
            [`bundle: ${target.bundleKind}`, 'bundle'],
        ]) {
            if (count(source, value) !== 1) failures.push(`desktop-workflow-${target.id}-${id}-mismatch`);
        }
    }

    for (const required of [
        'pnpm install --frozen-lockfile --strict-peer-dependencies',
        'pnpm audit --audit-level=low',
        'pnpm audit:licenses',
        'pnpm audit:desktop:workflow',
        'cargo test --manifest-path src-tauri/Cargo.toml --locked',
        'cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings',
        'cargo audit --file src-tauri/Cargo.lock --ignore RUSTSEC-2024-0429',
        'pnpm desktop:build:test-driver',
        'SCREENHELLO_DESKTOP_DRIVER_PROVIDER: embedded',
        'cargo clean --manifest-path src-tauri/Cargo.toml',
        'pnpm exec tauri build --ci --bundles "${{ matrix.bundle }}" --no-sign --config src-tauri/tauri.phase9.conf.json',
        "grep -q 'tauri-plugin-wdio-webdriver'",
        'pnpm desktop:sbom',
        'pnpm desktop:inspect',
        'pnpm desktop:evidence',
        'node scripts/audit-desktop-release-evidence.mjs',
        'merge-multiple: true',
    ]) requireText(required, `desktop-workflow-required-step-missing:${required}`);
    if (count(source, 'retention-days: 14') !== 2) failures.push('desktop-workflow-retention-invalid');

    const orderedSteps = [
        'pnpm desktop:build:test-driver',
        'node scripts/test-desktop-runtime.mjs',
        'cargo clean --manifest-path src-tauri/Cargo.toml',
        'pnpm exec tauri build --ci --bundles',
        "grep -q 'tauri-plugin-wdio-webdriver'",
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
        ['actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 2],
        ['pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86', 1],
        ['actions/setup-node@820762786026740c76f36085b0efc47a31fe5020', 1],
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
