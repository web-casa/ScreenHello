import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const localPnpmSetupActionReference = './.github/actions/setup-pnpm';

export const expectedGitHubActionsSupplyChain = Object.freeze({
    status: 'github-owned-sha-pinned-actions-and-local-corepack-pnpm-bootstrap-required',
    packageManager: 'pnpm@10.12.1+sha512.f0dda8580f0ee9481c5c79a1d927b9164f2c478e90992ad268bbb2465a736984391d6333d2c327913578b2804af33474ca554ba29c04a8b13060a717675ae3ac',
    externalActionOwner: 'actions',
    localPnpmSetupAction: localPnpmSetupActionReference,
    workflowPnpmBootstrapCounts: Object.freeze({
        'ci.yml': 1,
        'desktop-release-gate.yml': 1,
        'linux-deb-repository-signed-candidate.yml': 3,
        'macos-arm64-dmg.yml': 1,
        'macos-intel-signed-candidate.yml': 2,
        'macos-mas-universal-candidate.yml': 2,
        'macos-signed-candidate.yml': 2,
        'screencapturekit-adapter.yml': 0,
        'screencapturekit-probe.yml': 0,
        'web-release-browser-matrix.yml': 3,
        'windows-arm64-signed-candidate.yml': 2,
        'windows-signed-candidate.yml': 2,
    }),
});

const pinnedGitHubActionReference = /^actions\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/u;
const actionUseLine = /^\s*(?:-\s+)?uses:\s*([^\s#]+)(?:\s+#.*)?\s*$/u;
const actionUseKeyLine = /^\s*(?:-\s+)?(?:['"]?uses['"]?)\s*:/u;
const workflowCorepackEnvironment = /\bCOREPACK_[A-Z0-9_]+\b/u;
const expectedLocalPnpmSetupAction = `name: Set up project-pinned pnpm
description: Activates the package.json-pinned pnpm version through the selected Node runtime with Corepack.

runs:
  using: composite
  steps:
    - name: Activate the package.json-pinned pnpm on Linux and macOS
      if: runner.os != 'Windows'
      shell: bash
      run: |
        set -euo pipefail
        corepack_root="$(mktemp -d "$RUNNER_TEMP/screenhello-corepack.XXXXXX")"
        install_directory="$corepack_root/bin"
        corepack_home="$corepack_root/home"
        mkdir -p "$install_directory" "$corepack_home"
        export COREPACK_HOME="$corepack_home"
        export COREPACK_ENV_FILE=0
        export COREPACK_DEFAULT_TO_LATEST=0
        export COREPACK_ENABLE_PROJECT_SPEC=1
        unset COREPACK_INTEGRITY_KEYS
        corepack enable pnpm --install-directory "$install_directory"
        corepack install
        installed_pnpm="$("$install_directory/pnpm" --version)"
        test "$installed_pnpm" = "10.12.1"
        printf '%s\\n' "$install_directory" >> "$GITHUB_PATH"
        printf 'COREPACK_HOME=%s\\n' "$corepack_home" >> "$GITHUB_ENV"
        printf 'COREPACK_ENV_FILE=0\\n' >> "$GITHUB_ENV"
        printf 'COREPACK_DEFAULT_TO_LATEST=0\\n' >> "$GITHUB_ENV"
        printf 'COREPACK_ENABLE_PROJECT_SPEC=1\\n' >> "$GITHUB_ENV"

    - name: Activate the package.json-pinned pnpm on Windows
      if: runner.os == 'Windows'
      shell: pwsh
      run: |
        $ErrorActionPreference = 'Stop'
        Set-StrictMode -Version Latest
        $corepackRoot = Join-Path $env:RUNNER_TEMP ("screenhello-corepack-{0}" -f [Guid]::NewGuid().ToString('N'))
        $installDirectory = Join-Path $corepackRoot 'bin'
        $corepackHome = Join-Path $corepackRoot 'home'
        New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
        New-Item -ItemType Directory -Path $corepackHome -Force | Out-Null
        $env:COREPACK_HOME = $corepackHome
        $env:COREPACK_ENV_FILE = '0'
        $env:COREPACK_DEFAULT_TO_LATEST = '0'
        $env:COREPACK_ENABLE_PROJECT_SPEC = '1'
        Remove-Item -LiteralPath 'Env:COREPACK_INTEGRITY_KEYS' -ErrorAction SilentlyContinue
        corepack enable pnpm --install-directory $installDirectory
        corepack install
        $installedPnpm = (& (Join-Path $installDirectory 'pnpm.cmd') --version).Trim()
        if ($installedPnpm -ne '10.12.1') { throw "Unexpected pnpm version: $installedPnpm" }
        "COREPACK_HOME=$corepackHome" >> $env:GITHUB_ENV
        'COREPACK_ENV_FILE=0' >> $env:GITHUB_ENV
        'COREPACK_DEFAULT_TO_LATEST=0' >> $env:GITHUB_ENV
        'COREPACK_ENABLE_PROJECT_SPEC=1' >> $env:GITHUB_ENV
        $installDirectory >> $env:GITHUB_PATH`;
const sameValues = (left, right) => (
    left.length === right.length && [...left].sort().join(',') === [...right].sort().join(',')
);
const normalizedSource = (value) => String(value ?? '').replace(/\r\n?/gu, '\n');

const actionReferencesFor = (source) => {
    const lines = normalizedSource(source).split('\n').filter((line) => actionUseKeyLine.test(line));
    const references = [];
    const invalidLines = [];
    for (const line of lines) {
        const reference = line.match(actionUseLine)?.[1];
        if (!reference) invalidLines.push(line);
        else references.push(reference);
    }
    return { references, invalidLines };
};

const localBootstrapFollowsNodeSetup = (source) => {
    let insideJobs = false;
    let nodeSetupSeen = false;
    for (const line of normalizedSource(source).split('\n')) {
        if (line === 'jobs:') {
            insideJobs = true;
            nodeSetupSeen = false;
            continue;
        }
        if (!insideJobs) continue;
        if (/^ {2}[A-Za-z][A-Za-z0-9_-]*:\s*$/u.test(line)) nodeSetupSeen = false;
        if (line.includes('uses: actions/setup-node@')) nodeSetupSeen = true;
        if (line.includes(`uses: ${localPnpmSetupActionReference}`) && !nodeSetupSeen) return false;
    }
    return true;
};

const auditLocalPnpmSetupAction = (source, packageJson) => {
    const failures = [];
    const action = normalizedSource(source).trimEnd();
    const expect = (condition, id) => {
        if (!condition) failures.push(id);
    };

    expect(packageJson?.packageManager === expectedGitHubActionsSupplyChain.packageManager,
        'github-actions-supply-chain-package-manager-invalid');
    expect(action === expectedLocalPnpmSetupAction,
        'github-actions-supply-chain-local-pnpm-content-invalid');
    expect(action.includes('name: Set up project-pinned pnpm\n'),
        'github-actions-supply-chain-local-pnpm-name-invalid');
    expect(action.includes('runs:\n  using: composite\n'),
        'github-actions-supply-chain-local-pnpm-runtime-invalid');
    expect(action.includes("if: runner.os != 'Windows'") && action.includes("if: runner.os == 'Windows'"),
        'github-actions-supply-chain-local-pnpm-platform-branch-invalid');
    expect(action.includes('set -euo pipefail'),
        'github-actions-supply-chain-local-pnpm-shell-safety-missing');
    expect(action.includes('corepack_root="$(mktemp -d "$RUNNER_TEMP/screenhello-corepack.XXXXXX")"')
        && action.includes('install_directory="$corepack_root/bin"')
        && action.includes('corepack_home="$corepack_root/home"'),
    'github-actions-supply-chain-local-pnpm-directory-invalid');
    expect(action.includes('mkdir -p "$install_directory" "$corepack_home"'),
        'github-actions-supply-chain-local-pnpm-directory-create-missing');
    expect(action.includes('export COREPACK_HOME="$corepack_home"')
        && action.includes('export COREPACK_ENV_FILE=0')
        && action.includes('export COREPACK_DEFAULT_TO_LATEST=0')
        && action.includes('export COREPACK_ENABLE_PROJECT_SPEC=1')
        && action.includes('unset COREPACK_INTEGRITY_KEYS'),
    'github-actions-supply-chain-local-pnpm-corepack-environment-invalid');
    expect(action.includes('corepack enable pnpm --install-directory "$install_directory"'),
        'github-actions-supply-chain-local-pnpm-enable-missing');
    expect(action.includes('corepack install'),
        'github-actions-supply-chain-local-pnpm-install-missing');
    expect(action.includes('installed_pnpm="$("$install_directory/pnpm" --version)"'),
        'github-actions-supply-chain-local-pnpm-version-read-missing');
    expect(action.includes('test "$installed_pnpm" = "10.12.1"'),
        'github-actions-supply-chain-local-pnpm-version-invalid');
    expect(action.includes('printf \'%s\\n\' "$install_directory" >> "$GITHUB_PATH"'),
        'github-actions-supply-chain-local-pnpm-path-missing');
    expect(action.includes('printf \'COREPACK_HOME=%s\\n\' "$corepack_home" >> "$GITHUB_ENV"')
        && action.includes('printf \'COREPACK_ENV_FILE=0\\n\' >> "$GITHUB_ENV"')
        && action.includes('printf \'COREPACK_DEFAULT_TO_LATEST=0\\n\' >> "$GITHUB_ENV"')
        && action.includes('printf \'COREPACK_ENABLE_PROJECT_SPEC=1\\n\' >> "$GITHUB_ENV"'),
    'github-actions-supply-chain-local-pnpm-corepack-environment-not-persisted');
    expect(action.includes('$corepackRoot = Join-Path $env:RUNNER_TEMP ("screenhello-corepack-{0}" -f [Guid]::NewGuid().ToString(\'N\'))')
        && action.includes("$installDirectory = Join-Path $corepackRoot 'bin'")
        && action.includes("$corepackHome = Join-Path $corepackRoot 'home'")
        && action.includes('New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null')
        && action.includes('New-Item -ItemType Directory -Path $corepackHome -Force | Out-Null')
        && action.includes('$env:COREPACK_HOME = $corepackHome')
        && action.includes("$env:COREPACK_ENV_FILE = '0'")
        && action.includes("$env:COREPACK_DEFAULT_TO_LATEST = '0'")
        && action.includes("$env:COREPACK_ENABLE_PROJECT_SPEC = '1'")
        && action.includes("Remove-Item -LiteralPath 'Env:COREPACK_INTEGRITY_KEYS' -ErrorAction SilentlyContinue")
        && action.includes('corepack enable pnpm --install-directory $installDirectory')
        && action.includes("$installedPnpm = (& (Join-Path $installDirectory 'pnpm.cmd') --version).Trim()")
        && action.includes("if ($installedPnpm -ne '10.12.1')")
        && action.includes('"COREPACK_HOME=$corepackHome" >> $env:GITHUB_ENV')
        && action.includes("'COREPACK_ENV_FILE=0' >> $env:GITHUB_ENV")
        && action.includes("'COREPACK_DEFAULT_TO_LATEST=0' >> $env:GITHUB_ENV")
        && action.includes("'COREPACK_ENABLE_PROJECT_SPEC=1' >> $env:GITHUB_ENV")
        && action.includes('$installDirectory >> $env:GITHUB_PATH'),
    'github-actions-supply-chain-local-pnpm-windows-bootstrap-invalid');
    expect(actionReferencesFor(action).references.length === 0,
        'github-actions-supply-chain-local-pnpm-external-action-configured');
    expect(!/\$\{\{|\bsecrets\.|\bsudo\b|\b(?:curl|wget)\b|\b(?:npm|pnpm)\s+install\b/iu.test(action),
        'github-actions-supply-chain-local-pnpm-unsafe-operation-configured');

    return failures;
};

export const auditGitHubActionsSupplyChain = ({ workflows, setupAction, packageJson } = {}) => {
    const failures = [];
    const sourceByFile = workflows && typeof workflows === 'object' && !Array.isArray(workflows)
        ? workflows
        : {};
    const expectedCounts = expectedGitHubActionsSupplyChain.workflowPnpmBootstrapCounts;
    const expectedFiles = Object.keys(expectedCounts);
    const actualFiles = Object.keys(sourceByFile);

    if (!sameValues(actualFiles, expectedFiles)) {
        failures.push('github-actions-supply-chain-workflow-set-invalid');
    }
    failures.push(...auditLocalPnpmSetupAction(setupAction, packageJson));

    for (const file of expectedFiles) {
        const source = normalizedSource(sourceByFile[file]);
        const { references, invalidLines } = actionReferencesFor(source);
        if (!source || invalidLines.length || !references.length) {
            failures.push(`github-actions-supply-chain-action-syntax-invalid:${file}`);
            continue;
        }
        if (source.includes('pnpm/action-setup@')) {
            failures.push(`github-actions-supply-chain-third-party-pnpm-action-configured:${file}`);
        }
        if (source.includes('cache: pnpm')) {
            failures.push(`github-actions-supply-chain-setup-node-cache-before-bootstrap:${file}`);
        }
        if (workflowCorepackEnvironment.test(source)) {
            failures.push('github-actions-supply-chain-workflow-corepack-environment-configured:' + file);
        }
        if (references.some((reference) => (
            reference !== localPnpmSetupActionReference && !pinnedGitHubActionReference.test(reference)
        ))) {
            failures.push(`github-actions-supply-chain-action-origin-or-pin-invalid:${file}`);
        }
        if (references.filter((reference) => reference === localPnpmSetupActionReference).length !== expectedCounts[file]) {
            failures.push(`github-actions-supply-chain-pnpm-bootstrap-count-invalid:${file}`);
        }
        if (!localBootstrapFollowsNodeSetup(source)) {
            failures.push(`github-actions-supply-chain-node-bootstrap-order-invalid:${file}`);
        }
    }

    return failures;
};

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const workflowDirectory = new URL('../.github/workflows/', import.meta.url);
    const workflowFiles = (await readdir(workflowDirectory))
        .filter((file) => /\.(?:yml|yaml)$/u.test(file))
        .sort();
    const [workflowSources, setupAction, packageJson] = await Promise.all([
        Promise.all(workflowFiles.map(async (file) => [
            file,
            await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8'),
        ])),
        readFile(new URL('../.github/actions/setup-pnpm/action.yml', import.meta.url), 'utf8'),
        readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
    ]);
    const failures = auditGitHubActionsSupplyChain({
        workflows: Object.fromEntries(workflowSources),
        setupAction,
        packageJson,
    });
    console.log(JSON.stringify({ status: failures.length ? 'failed' : 'passed', failures }, null, 2));
    if (failures.length) process.exitCode = 1;
}
