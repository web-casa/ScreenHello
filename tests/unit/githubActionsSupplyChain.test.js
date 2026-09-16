import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { auditGitHubActionsSupplyChain } from '../../scripts/audit-github-actions-supply-chain.mjs';

const workflowDirectory = new URL('../../.github/workflows/', import.meta.url);
const workflowFiles = (await readdir(workflowDirectory))
    .filter((file) => /\.(?:yml|yaml)$/u.test(file))
    .sort();
const [workflowEntries, setupAction, packageJson] = await Promise.all([
    Promise.all(workflowFiles.map(async (file) => [
        file,
        await readFile(new URL(`../../.github/workflows/${file}`, import.meta.url), 'utf8'),
    ])),
    readFile(new URL('../../.github/actions/setup-pnpm/action.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../package.json', import.meta.url), 'utf8').then(JSON.parse),
]);

const baseline = () => ({
    workflows: Object.fromEntries(workflowEntries.map(([file, source]) => [file, source])),
    setupAction,
    packageJson: structuredClone(packageJson),
});

describe('GitHub Actions supply-chain audit', () => {
    it('accepts only SHA-pinned GitHub-owned actions and the local Corepack bootstrap', () => {
        expect(auditGitHubActionsSupplyChain(baseline())).toEqual([]);
    });

    it.each([
        ['a third-party package-manager action', (value) => {
            value.workflows['ci.yml'] = value.workflows['ci.yml'].replace(
                './.github/actions/setup-pnpm',
                'pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86',
            );
        }],
        ['an unpinned GitHub action', (value) => {
            value.workflows['ci.yml'] = value.workflows['ci.yml'].replace(
                'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
                'actions/checkout@v7',
            );
        }],
        ['a setup-node pnpm cache before Corepack activation', (value) => {
            value.workflows['ci.yml'] = value.workflows['ci.yml'].replace(
                '          node-version-file: .node-version',
                '          node-version-file: .node-version\n          cache: pnpm',
            );
        }],
        ['a workflow Corepack integrity environment override', (value) => {
            value.workflows['ci.yml'] = value.workflows['ci.yml'].replace(
                'permissions:\n  contents: read',
                'env:\n  COREPACK_INTEGRITY_KEYS: 0\n\npermissions:\n  contents: read',
            );
        }],
        ['a workflow Corepack unsafe custom URL override', (value) => {
            value.workflows['ci.yml'] = value.workflows['ci.yml'].replace(
                'permissions:\n  contents: read',
                'env:\n  COREPACK_ENABLE_UNSAFE_CUSTOM_URLS: 1\n\npermissions:\n  contents: read',
            );
        }],
        ['a bootstrap placed before Node setup', (value) => {
            value.workflows['ci.yml'] = value.workflows['ci.yml'].replace(
                '      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7\n        with:\n          node-version-file: .node-version\n\n      - name: Set up project-pinned pnpm\n        uses: ./.github/actions/setup-pnpm',
                '      - name: Set up project-pinned pnpm\n        uses: ./.github/actions/setup-pnpm\n\n      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7\n        with:\n          node-version-file: .node-version',
            );
        }],
        ['an alternate YAML action key spelling', (value) => {
            value.workflows['ci.yml'] = value.workflows['ci.yml'].replace(
                'uses: ./.github/actions/setup-pnpm',
                'uses : evil/action@0123456789abcdef0123456789abcdef01234567',
            );
        }],
        ['a missing Corepack bootstrap directory creation', (value) => {
            value.setupAction = value.setupAction.replace('mkdir -p "$install_directory" "$corepack_home"', 'echo skip-directory-create');
        }],
        ['a Corepack home shared outside the job temporary directory', (value) => {
            value.setupAction = value.setupAction.replace(
                'corepack_home="$corepack_root/home"',
                'corepack_home="$HOME/.cache/node/corepack"',
            );
        }],
        ['a project-controlled Corepack environment file', (value) => {
            value.setupAction = value.setupAction.replace('export COREPACK_ENV_FILE=0\n', '');
        }],
        ['a Corepack default-to-latest lookup', (value) => {
            value.setupAction = value.setupAction.replace('export COREPACK_DEFAULT_TO_LATEST=0\n', '');
        }],
        ['a Corepack integrity-key override', (value) => {
            value.setupAction = value.setupAction.replace(
                'unset COREPACK_INTEGRITY_KEYS',
                'export COREPACK_INTEGRITY_KEYS=0',
            );
        }],
        ['an isolated Corepack home not persisted to later steps', (value) => {
            value.setupAction = value.setupAction.replace(
                'printf \'COREPACK_HOME=%s\\n\' "$corepack_home" >> "$GITHUB_ENV"\n',
                '',
            );
        }],
        ['a Windows bootstrap without a pnpm.cmd version check', (value) => {
            value.setupAction = value.setupAction.replace(
                "$installedPnpm = (& (Join-Path $installDirectory 'pnpm.cmd') --version).Trim()",
                '$installedPnpm = "unchecked"',
            );
        }],
        ['an unexpected command in the local bootstrap', (value) => {
            value.setupAction = value.setupAction.replace(
                'corepack install',
                'corepack install\n        Invoke-WebRequest https://example.invalid',
            );
        }],
        ['a secret reference in the local bootstrap', (value) => {
            value.setupAction = value.setupAction.replace('corepack install', 'corepack install\n        echo "${{ secrets.UNSAFE }}"');
        }],
        ['a different package-manager version', (value) => {
            value.packageJson.packageManager = 'pnpm@10.13.0';
        }],
        ['a package-manager pin without its integrity hash', (value) => {
            value.packageJson.packageManager = 'pnpm@10.12.1';
        }],
        ['a different package-manager integrity hash', (value) => {
            value.packageJson.packageManager = value.packageJson.packageManager.replace(/.$/u, '0');
        }],
        ['an unexpected YAML workflow omitted from the declared policy', (value) => {
            value.workflows['unexpected.yaml'] = value.workflows['ci.yml'];
        }],
    ])('fails closed for %s', (_name, mutate) => {
        const value = baseline();
        mutate(value);
        expect(auditGitHubActionsSupplyChain(value)).not.toEqual([]);
    });
});
