import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
    assessDesktopReleaseGitHubReadiness,
    expectedDesktopReleaseGitHubReadiness,
    parseDesktopReleaseGitHubReadinessArguments,
    requestGitHubApiJson,
} from '../../scripts/desktop-release-github-readiness.mjs';

const matrix = await readFile(new URL('../../config/desktop-release-matrix.json', import.meta.url), 'utf8').then(JSON.parse);
const repository = 'web-casa/signed-candidate';
const owner = repository.split('/')[0];

const responseMap = () => {
    const secrets = expectedDesktopReleaseGitHubReadiness.environments
        .flatMap(({ organizationSecrets }) => organizationSecrets)
        .map((name) => ({ name, visibility: 'private' }));
    return new Map([
        [`repos/${repository}`, {
            id: expectedDesktopReleaseGitHubReadiness.repositoryId,
            full_name: repository,
            private: true,
            default_branch: 'main',
        }],
        [`orgs/${owner}`, {
            plan: { name: 'enterprise' },
        }],
        [`repos/${repository}/actions/permissions/workflow`, {
            default_workflow_permissions: 'read',
        }],
        [`repos/${repository}/actions/permissions`, {
            enabled: true,
            allowed_actions: 'selected',
            sha_pinning_required: true,
        }],
        [`repos/${repository}/actions/permissions/selected-actions`, {
            github_owned_allowed: true,
            verified_allowed: false,
            patterns_allowed: [],
        }],
        [`repos/${repository}/branches/main`, { name: 'main', protected: true }],
        [`repos/${repository}/environments?per_page=100`, {
            environments: expectedDesktopReleaseGitHubReadiness.environments.map(({ name }) => ({
                name,
                protection_rules: [{
                    type: 'required_reviewers',
                    prevent_self_review: true,
                    reviewers: [{ type: 'User', reviewer: { login: 'reviewer' } }],
                }],
                deployment_branch_policy: {
                    protected_branches: true,
                    custom_branch_policies: false,
                },
            })),
        }],
        [`orgs/${owner}/actions/secrets?per_page=100`, { secrets }],
    ]);
};

const assess = async (mutate) => {
    const responses = responseMap();
    mutate?.(responses);
    const calls = [];
    const report = await assessDesktopReleaseGitHubReadiness({
        matrix: structuredClone(matrix),
        repository,
        requestJson: async (endpoint) => {
            calls.push(endpoint);
            if (!responses.has(endpoint)) throw new Error('response-not-found');
            return structuredClone(responses.get(endpoint));
        },
    });
    return { report, calls };
};

describe('desktop GitHub candidate readiness', () => {
    it('accepts a protected private candidate repository while keeping release disabled', async () => {
        const { report, calls } = await assess();
        expect(report).toMatchObject({
            status: 'configuration-verified',
            repository,
            branch: 'main',
            releaseReady: false,
            publicRelease: false,
            blockers: [],
        });
        expect(report.checks).toHaveLength(12);
        expect(calls.every((endpoint) => !endpoint.includes('dispatches'))).toBe(true);
    });

    it.each([
        ['a public candidate repository', (responses) => {
            responses.get(`repos/${repository}`).private = false;
        }, 'candidate-repository'],
        ['a non-Enterprise Cloud organization', (responses) => {
            responses.get(`orgs/${owner}`).plan.name = 'free';
        }, 'enterprise-cloud-private-candidate-entitlement'],
        ['write-default workflow permissions', (responses) => {
            responses.get(`repos/${repository}/actions/permissions/workflow`).default_workflow_permissions = 'write';
        }, 'workflow-default-permissions'],
        ['an unrestricted actions policy', (responses) => {
            responses.get(`repos/${repository}/actions/permissions`).allowed_actions = 'all';
        }, 'action-policy'],
        ['a selected policy allowing verified third-party actions', (responses) => {
            responses.get(`repos/${repository}/actions/permissions/selected-actions`).verified_allowed = true;
        }, 'selected-action-supply-chain'],
        ['an unprotected main branch', (responses) => {
            responses.get(`repos/${repository}/branches/main`).protected = false;
        }, 'main-branch-protection'],
        ['a missing signing environment', (responses) => {
            responses.get(`repos/${repository}/environments?per_page=100`).environments = [];
        }, 'environment:macos-signing'],
        ['a missing organization signing secret', (responses) => {
            responses.get(`orgs/${owner}/actions/secrets?per_page=100`).secrets = [];
        }, 'organization-secret-scope:macos-signing'],
    ])('blocks %s', async (_name, mutate, blocker) => {
        const { report } = await assess(mutate);
        expect(report.status).toBe('blocked');
        expect(report.releaseReady).toBe(false);
        expect(report.blockers).toContain(blocker);
    });

    it('accepts a selected organization secret only when the private candidate repository is selected', async () => {
        const { report, calls } = await assess((responses) => {
            const inventory = responses.get(`orgs/${owner}/actions/secrets?per_page=100`);
            const secret = inventory.secrets.find(({ name }) => name === 'APPLE_ID');
            secret.visibility = 'selected';
            responses.set(
                `orgs/${owner}/actions/secrets/APPLE_ID/repositories?per_page=100`,
                { repositories: [{ id: expectedDesktopReleaseGitHubReadiness.repositoryId }] },
            );
        });
        expect(report.blockers).toEqual([]);
        expect(calls).toContain(`orgs/${owner}/actions/secrets/APPLE_ID/repositories?per_page=100`);
    });

    it('marks unavailable organization-secret metadata as unverified', async () => {
        const { report } = await assess((responses) => {
            responses.delete(`orgs/${owner}/actions/secrets?per_page=100`);
        });
        expect(report.status).toBe('blocked');
        expect(report.checks).toContainEqual({
            id: 'organization-secret-scope:macos-signing',
            status: 'unverified',
        });
    });

    it('marks unavailable selected-action configuration as unverified after the base policy passes', async () => {
        const { report } = await assess((responses) => {
            responses.delete(`repos/${repository}/actions/permissions/selected-actions`);
        });
        expect(report.status).toBe('blocked');
        expect(report.checks).toContainEqual({
            id: 'selected-action-supply-chain',
            status: 'unverified',
        });
    });

    it('does not treat secret scope as verified when candidate identity is unavailable', async () => {
        const { report } = await assess((responses) => {
            responses.get(`repos/${repository}`).id = 1;
        });
        expect(report.blockers).toContain('candidate-repository');
        expect(report.checks).toContainEqual({
            id: 'organization-secret-scope:macos-signing',
            status: 'unverified',
        });
    });

    it('keeps every repository-derived check unverified when the current token cannot access the candidate', async () => {
        const { report } = await assess((responses) => {
            for (const endpoint of [
                `repos/${repository}`,
                `repos/${repository}/actions/permissions/workflow`,
                `repos/${repository}/actions/permissions`,
                `repos/${repository}/actions/permissions/selected-actions`,
                `repos/${repository}/branches/main`,
                `repos/${repository}/environments?per_page=100`,
            ]) responses.delete(endpoint);
        });
        expect(report.status).toBe('blocked');
        expect(report.checks).toContainEqual({ id: 'candidate-repository', status: 'unverified' });
        expect(report.checks).toContainEqual({ id: 'workflow-default-permissions', status: 'unverified' });
        expect(report.checks).toContainEqual({ id: 'selected-action-supply-chain', status: 'unverified' });
        expect(report.checks).toContainEqual({ id: 'environment:macos-signing', status: 'unverified' });
        expect(report.checks).toContainEqual({ id: 'organization-secret-scope:macos-signing', status: 'unverified' });
    });

    it('requests all pages for environment and organization-secret inventories', async () => {
        const responses = responseMap();
        const calls = [];
        const report = await assessDesktopReleaseGitHubReadiness({
            matrix: structuredClone(matrix),
            repository,
            requestJson: async (endpoint, options) => {
                calls.push({ endpoint, options });
                if (!responses.has(endpoint)) throw new Error('response-not-found');
                return structuredClone(responses.get(endpoint));
            },
        });
        expect(report.blockers).toEqual([]);
        expect(calls).toContainEqual({
            endpoint: `orgs/${owner}`,
            options: undefined,
        });
        expect(calls).toContainEqual({
            endpoint: `repos/${repository}/environments?per_page=100`,
            options: { paginate: true, collection: 'environments' },
        });
        expect(calls).toContainEqual({
            endpoint: `repos/${repository}/actions/permissions/selected-actions`,
            options: undefined,
        });
        expect(calls).toContainEqual({
            endpoint: `orgs/${owner}/actions/secrets?per_page=100`,
            options: { paginate: true, collection: 'secrets' },
        });
    });

    it('uses an argument vector and read-only GitHub API request', async () => {
        const calls = [];
        await expect(requestGitHubApiJson(`repos/${repository}`, {
            executeFile: async (command, args, options) => {
                calls.push({ command, args, options });
                return { stdout: '{"ok":true}' };
            },
        })).resolves.toEqual({ ok: true });
        expect(calls).toEqual([{
            command: 'gh',
            args: [
                'api',
                '--method', 'GET',
                '-H', 'Accept: application/vnd.github+json',
                '-H', 'X-GitHub-Api-Version: 2026-03-10',
                `repos/${repository}`,
            ],
            options: { maxBuffer: 2 * 1024 * 1024 },
        }]);
    });

    it('allows only the documented read-only organization metadata route', async () => {
        await expect(requestGitHubApiJson(`orgs/${owner}`, {
            executeFile: async () => ({ stdout: '{"plan":{"name":"enterprise"}}' }),
        })).resolves.toEqual({ plan: { name: 'enterprise' } });
        await expect(requestGitHubApiJson(`orgs/${owner}/hooks`, {
            executeFile: async () => ({ stdout: '{}' }),
        })).rejects.toThrow('desktop-release-github-readiness-api-endpoint-invalid');
    });

    it('merges every page without writing GitHub state', async () => {
        const calls = [];
        await expect(requestGitHubApiJson(`orgs/${owner}/actions/secrets?per_page=100`, {
            executeFile: async (command, args, options) => {
                calls.push({ command, args, options });
                return { stdout: '[{"secrets":[{"name":"FIRST"}]},{"secrets":[{"name":"SECOND"}]}]' };
            },
            paginate: true,
            collection: 'secrets',
        })).resolves.toEqual({
            secrets: [{ name: 'FIRST' }, { name: 'SECOND' }],
        });
        expect(calls).toEqual([{
            command: 'gh',
            args: [
                'api',
                '--method', 'GET',
                '-H', 'Accept: application/vnd.github+json',
                '-H', 'X-GitHub-Api-Version: 2026-03-10',
                '--paginate', '--slurp',
                `orgs/${owner}/actions/secrets?per_page=100`,
            ],
            options: { maxBuffer: 2 * 1024 * 1024 },
        }]);
    });

    it.each([
        [['--', '--verify-github', '--repository', repository], undefined],
        [[], 'desktop-release-github-readiness-mode-required'],
        [['--verify-github', '--verify-github'], 'desktop-release-github-readiness-option-duplicate:--verify-github'],
        [['--verify-github'], 'desktop-release-github-readiness-repository-required'],
        [['--dispatch'], 'desktop-release-github-readiness-option-invalid:--dispatch'],
    ])('parses or rejects CLI arguments', (argumentsList, error) => {
        if (error === undefined) {
            expect(parseDesktopReleaseGitHubReadinessArguments(argumentsList)).toEqual({
                verifyGitHub: true,
                repository,
            });
        } else {
            expect(() => parseDesktopReleaseGitHubReadinessArguments(argumentsList)).toThrow(error);
        }
    });
});
