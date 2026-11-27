import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { desktopArtifactProvenanceRepositoryId } from './desktop-artifact-provenance.mjs';

const execFileAsync = promisify(execFile);
const maximumApiBytes = 2 * 1024 * 1024;

export const expectedDesktopReleaseGitHubReadiness = Object.freeze({
    status: 'enterprise-cloud-private-candidate-repository-github-readiness-audit-ready-not-run',
    repositoryId: desktopArtifactProvenanceRepositoryId,
    branch: 'main',
    workflowPermissions: 'read',
    enterpriseCloud: {
        organizationPlan: 'enterprise',
        privateCandidateCapabilities: [
            'private-branch-protection',
            'private-environment-required-reviewers',
            'private-artifact-attestations',
        ],
    },
    actionPolicy: {
        allowedActions: 'selected',
        shaPinningRequired: true,
        githubOwnedAllowed: true,
        verifiedAllowed: false,
        patternsAllowed: [],
    },
    environments: [
        {
            name: 'macos-signing',
            organizationSecrets: [
                'APPLE_APP_SPECIFIC_PASSWORD',
                'APPLE_ID',
                'APPLE_TEAM_ID',
                'MACOS_CERTIFICATE_P12_BASE64',
            ],
        },
        {
            name: 'windows-signing',
            organizationSecrets: [
                'WINDOWS_CERTIFICATE',
                'WINDOWS_CERTIFICATE_PASSWORD',
            ],
        },
        {
            name: 'linux-repository-signing',
            organizationSecrets: [
                'LINUX_REPOSITORY_SIGNING_PASSPHRASE',
                'LINUX_REPOSITORY_SIGNING_PRIVATE_KEY',
            ],
        },
    ],
    environmentProtection: {
        requiredReviewers: 'at-least-one',
        preventSelfReview: true,
        deploymentBranchPolicy: 'protected-branches',
    },
    decision: {
        releaseReady: false,
        authorization: 'explicit-user-authorization-required-before-public-release-or-deployment',
        remainingConfiguration: [
            'github-enterprise-cloud-private-candidate-entitlement-not-configured',
            'protected-public-release-workflow-not-configured',
            'updater-trust-root-endpoints-and-key-rotation-not-configured',
            'store-channels-deferred',
        ],
    },
    publicRelease: false,
});

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const check = (id, status) => ({ id, status });
const blocked = (checks) => checks.filter(({ status }) => status !== 'passed').map(({ id }) => id);

const expectedPolicy = (matrix) => {
    if (matrix?.schemaVersion !== 24) {
        throw new Error('desktop-release-github-readiness-schema-invalid');
    }
    if (!sameJson(matrix?.desktopReleaseGitHubReadiness, expectedDesktopReleaseGitHubReadiness)) {
        throw new Error('desktop-release-github-readiness-policy-invalid');
    }
    return matrix.desktopReleaseGitHubReadiness;
};

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

const normalizeRepository = (value) => {
    const repository = String(value ?? '').trim();
    if (!repositoryPattern.test(repository)) {
        throw new Error('desktop-release-github-readiness-repository-invalid');
    }
    return repository;
};

const safeRequest = async (requestJson, endpoint, options) => {
    try {
        return { available: true, value: await requestJson(endpoint, options) };
    } catch {
        return { available: false, value: null };
    }
};

const responseStatus = (response, predicate) => {
    if (!response.available || !isRecord(response.value)) return 'unverified';
    return predicate(response.value) ? 'passed' : 'failed';
};

const enterpriseCloudStatus = (response, policy) => {
    if (!response.available || !isRecord(response.value)) return 'unverified';
    const plan = response.value.plan;
    if (!isRecord(plan) || typeof plan.name !== 'string') return 'unverified';
    return plan.name === policy.enterpriseCloud.organizationPlan ? 'passed' : 'failed';
};

const selectedActionPolicyStatus = (actionPolicyResponse, selectedPolicyResponse, policy) => {
    if (!actionPolicyResponse.available || !isRecord(actionPolicyResponse.value)) return 'unverified';
    const actionPolicy = actionPolicyResponse.value;
    if (actionPolicy.enabled !== true
        || actionPolicy.allowed_actions !== policy.actionPolicy.allowedActions
        || actionPolicy.sha_pinning_required !== policy.actionPolicy.shaPinningRequired) {
        return 'failed';
    }
    return responseStatus(
        selectedPolicyResponse,
        (value) => value.github_owned_allowed === policy.actionPolicy.githubOwnedAllowed
            && value.verified_allowed === policy.actionPolicy.verifiedAllowed
            && Array.isArray(value.patterns_allowed)
            && sameJson(value.patterns_allowed, policy.actionPolicy.patternsAllowed),
    );
};

const environmentStatus = (environment, protection) => {
    if (!isRecord(environment) || !Array.isArray(environment.protection_rules)
        || !isRecord(environment.deployment_branch_policy)) {
        return 'unverified';
    }
    const requiredReviewers = environment.protection_rules.find((rule) => (
        isRecord(rule) && rule.type === 'required_reviewers'
    ));
    const hasReviewer = Array.isArray(requiredReviewers?.reviewers) && requiredReviewers.reviewers.length >= 1;
    const protectedBranches = environment.deployment_branch_policy.protected_branches === true
        && environment.deployment_branch_policy.custom_branch_policies === false;
    return hasReviewer
        && requiredReviewers.prevent_self_review === protection.preventSelfReview
        && protectedBranches
        ? 'passed'
        : 'failed';
};

const selectedSecretStatus = async ({ owner, repositoryId, secret, requestJson }) => {
    if (secret.visibility === 'private') return 'passed';
    if (secret.visibility !== 'selected' || !Number.isSafeInteger(repositoryId)) return 'failed';
    const response = await safeRequest(
        requestJson,
        `orgs/${owner}/actions/secrets/${secret.name}/repositories?per_page=100`,
        { paginate: true, collection: 'repositories' },
    );
    if (!response.available || !Array.isArray(response.value?.repositories)) return 'unverified';
    return response.value.repositories.some((candidate) => (
        isRecord(candidate) && candidate.id === repositoryId
    )) ? 'passed' : 'failed';
};

const secretScopeChecks = async ({ policy, repository, secretsResponse, requestJson }) => {
    const owner = repository.name.split('/')[0];
    if (!repository.identityVerified || !secretsResponse.available || !Array.isArray(secretsResponse.value?.secrets)) {
        return policy.environments.map(({ name }) => check(`organization-secret-scope:${name}`, 'unverified'));
    }
    const secrets = new Map(secretsResponse.value.secrets
        .filter((value) => isRecord(value) && typeof value.name === 'string')
        .map((value) => [value.name, value]));
    return Promise.all(policy.environments.map(async ({ name, organizationSecrets }) => {
        const statuses = await Promise.all(organizationSecrets.map(async (secretName) => {
            const secret = secrets.get(secretName);
            if (!secret) return 'failed';
            return selectedSecretStatus({
                owner,
                repositoryId: repository.id,
                secret,
                requestJson,
            });
        }));
        return check(
            `organization-secret-scope:${name}`,
            statuses.includes('failed') ? 'failed' : statuses.includes('unverified') ? 'unverified' : 'passed',
        );
    }));
};

export const assessDesktopReleaseGitHubReadiness = async ({ matrix, repository: repositoryValue, requestJson } = {}) => {
    const policy = expectedPolicy(matrix);
    if (typeof requestJson !== 'function') {
        throw new Error('desktop-release-github-readiness-request-required');
    }
    const repository = normalizeRepository(repositoryValue);
    const owner = repository.split('/')[0];
    const [
        repositoryResponse,
        organizationResponse,
        workflowPermissionsResponse,
        actionPolicyResponse,
        selectedActionPolicyResponse,
        branchResponse,
        environmentsResponse,
        secretsResponse,
    ] = await Promise.all([
        safeRequest(requestJson, `repos/${repository}`),
        safeRequest(requestJson, `orgs/${owner}`),
        safeRequest(requestJson, `repos/${repository}/actions/permissions/workflow`),
        safeRequest(requestJson, `repos/${repository}/actions/permissions`),
        safeRequest(requestJson, `repos/${repository}/actions/permissions/selected-actions`),
        safeRequest(requestJson, `repos/${repository}/branches/${policy.branch}`),
        safeRequest(
            requestJson,
            `repos/${repository}/environments?per_page=100`,
            { paginate: true, collection: 'environments' },
        ),
        safeRequest(
            requestJson,
            `orgs/${owner}/actions/secrets?per_page=100`,
            { paginate: true, collection: 'secrets' },
        ),
    ]);
    const repositoryMetadata = repositoryResponse.value;
    const checks = [
        check('candidate-repository', responseStatus(
            repositoryResponse,
            (value) => value.full_name === repository && value.private === true
                && value.default_branch === policy.branch && value.id === policy.repositoryId,
        )),
        check('enterprise-cloud-private-candidate-entitlement', enterpriseCloudStatus(
            organizationResponse,
            policy,
        )),
        check('workflow-default-permissions', responseStatus(
            workflowPermissionsResponse,
            (value) => value.default_workflow_permissions === policy.workflowPermissions,
        )),
        check('action-policy', responseStatus(
            actionPolicyResponse,
            (value) => value.enabled === true
                && value.allowed_actions === policy.actionPolicy.allowedActions
                && value.sha_pinning_required === policy.actionPolicy.shaPinningRequired,
        )),
        check('selected-action-supply-chain', selectedActionPolicyStatus(
            actionPolicyResponse,
            selectedActionPolicyResponse,
            policy,
        )),
        check('main-branch-protection', responseStatus(
            branchResponse,
            (value) => value.name === policy.branch && value.protected === true,
        )),
    ];
    if (!environmentsResponse.available || !Array.isArray(environmentsResponse.value?.environments)) {
        checks.push(...policy.environments.map(({ name }) => check(`environment:${name}`, 'unverified')));
    } else {
        for (const environmentPolicy of policy.environments) {
            const environment = environmentsResponse.value.environments
                .find((candidate) => isRecord(candidate) && candidate.name === environmentPolicy.name);
            checks.push(check(
                `environment:${environmentPolicy.name}`,
                environment ? environmentStatus(environment, policy.environmentProtection) : 'failed',
            ));
        }
    }
    checks.push(...await secretScopeChecks({
        policy,
        repository: {
            name: repository,
            id: isRecord(repositoryMetadata) && Number.isSafeInteger(repositoryMetadata.id)
                ? repositoryMetadata.id
                : null,
            identityVerified: responseStatus(
                repositoryResponse,
                (value) => value.full_name === repository && value.private === true
                    && value.default_branch === policy.branch && value.id === policy.repositoryId,
            ) === 'passed',
        },
        secretsResponse,
        requestJson,
    }));
    const blockers = blocked(checks);
    return {
        status: blockers.length ? 'blocked' : 'configuration-verified',
        phase: 'github-candidate-readiness',
        repository,
        repositoryId: policy.repositoryId,
        branch: policy.branch,
        releaseReady: policy.decision.releaseReady,
        publicRelease: policy.publicRelease,
        decision: policy.decision,
        checks,
        blockers,
    };
};

const normalizePaginatedResponse = (value, collection) => {
    if (!Array.isArray(value) || typeof collection !== 'string') {
        throw new Error('desktop-release-github-readiness-api-pagination-invalid');
    }
    const items = [];
    for (const page of value) {
        if (!isRecord(page) || !Array.isArray(page[collection])) {
            throw new Error('desktop-release-github-readiness-api-pagination-invalid');
        }
        items.push(...page[collection]);
    }
    return { [collection]: items };
};

export const requestGitHubApiJson = async (
    endpoint,
    { executeFile = execFileAsync, paginate = false, collection } = {},
) => {
    const segment = '[A-Za-z0-9_.-]+';
    const allowedEndpoints = [
        new RegExp(`^repos/${segment}/${segment}$`, 'u'),
        new RegExp(`^repos/${segment}/${segment}/actions/permissions(?:/(?:workflow|selected-actions))?$`, 'u'),
        new RegExp(`^repos/${segment}/${segment}/branches/${segment}$`, 'u'),
        new RegExp(`^repos/${segment}/${segment}/environments\\?per_page=100$`, 'u'),
        new RegExp(`^orgs/${segment}$`, 'u'),
        new RegExp(`^orgs/${segment}/actions/secrets\\?per_page=100$`, 'u'),
        new RegExp(`^orgs/${segment}/actions/secrets/[A-Z0-9_]+/repositories\\?per_page=100$`, 'u'),
    ];
    if (!allowedEndpoints.some((pattern) => pattern.test(endpoint))) {
        throw new Error('desktop-release-github-readiness-api-endpoint-invalid');
    }
    if (paginate && typeof collection !== 'string') {
        throw new Error('desktop-release-github-readiness-api-pagination-invalid');
    }
    const { stdout } = await executeFile('gh', [
        'api',
        '--method', 'GET',
        '-H', 'Accept: application/vnd.github+json',
        '-H', 'X-GitHub-Api-Version: 2026-03-10',
        ...(paginate ? ['--paginate', '--slurp'] : []),
        endpoint,
    ], { maxBuffer: maximumApiBytes });
    let value;
    try {
        value = JSON.parse(stdout);
    } catch {
        throw new Error('desktop-release-github-readiness-api-json-invalid');
    }
    return paginate ? normalizePaginatedResponse(value, collection) : value;
};

export const parseDesktopReleaseGitHubReadinessArguments = (argumentsList) => {
    const values = Array.isArray(argumentsList) && argumentsList[0] === '--'
        ? argumentsList.slice(1)
        : argumentsList;
    if (!Array.isArray(values) || values.length === 0) {
        throw new Error('desktop-release-github-readiness-mode-required');
    }
    const options = {};
    for (let index = 0; index < values.length; index += 1) {
        const option = values[index];
        if (option === '--verify-github') {
            if (options.verifyGitHub) throw new Error('desktop-release-github-readiness-option-duplicate:--verify-github');
            options.verifyGitHub = true;
            continue;
        }
        if (option === '--repository') {
            if (options.repository) throw new Error('desktop-release-github-readiness-option-duplicate:--repository');
            options.repository = normalizeRepository(values[index + 1]);
            index += 1;
            continue;
        }
        throw new Error(`desktop-release-github-readiness-option-invalid:${option || ''}`);
    }
    if (!options.verifyGitHub) throw new Error('desktop-release-github-readiness-mode-required');
    if (!options.repository) throw new Error('desktop-release-github-readiness-repository-required');
    return options;
};

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const options = parseDesktopReleaseGitHubReadinessArguments(process.argv.slice(2));
    const matrix = JSON.parse(await readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8'));
    const report = await assessDesktopReleaseGitHubReadiness({
        matrix,
        repository: options.repository,
        requestJson: requestGitHubApiJson,
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.blockers.length) process.exitCode = 1;
}
