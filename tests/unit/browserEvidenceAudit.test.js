import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const candidate = 'a'.repeat(40);
const auditScript = resolve('scripts/audit-release-browser-evidence.mjs');
const matrix = JSON.parse(await readFile(resolve('config/browser-release-matrix.json'), 'utf8'));

const createEvidence = (target) => ({
    schemaVersion: 2,
    target: target.id,
    testedAt: '2026-09-04T00:00:00.000Z',
    source: target.requiresTrustedSafari ? 'GitHub hosted macos-14 Safari' : target.dockerImage,
    releaseCandidate: candidate,
    executionEnvironment: target.requiresTrustedSafari ? 'github-hosted-macos' : 'native-amd64',
    runner: target.requiresTrustedSafari ? 'macos-14' : 'ubuntu-24.04',
    observed: {
        browserName: target.acceptedBrowserNames[0],
        browserVersion: target.requiresTrustedSafari ? '26.5' : `${target.version.major}.0.0`,
        platformName: target.requiresTrustedSafari ? 'macOS 14' : 'Linux',
    },
    status: 'passed',
    trustedSafari: target.requiresTrustedSafari || undefined,
    safariEnvironment: target.requiresTrustedSafari ? 'GitHub hosted macOS 14' : undefined,
    checks: {
        coreEditUndoRedo: true,
        imageExports: [
            { name: 'image.png', type: 'image/png', size: 100 },
            { name: 'image.jpg', type: 'image/jpeg', size: 100 },
            { name: 'image.webp', type: 'image/webp', size: 100 },
            { name: 'image.avif', type: 'image/avif', size: 100 },
        ],
        localResourceRequests: true,
        mobileWeb: {
            viewport: { width: 430, height: 780 },
            topbarActions: ['menu', 'project-status', 'export'],
            menuSections: ['file', 'edit', 'view', 'help'],
            annotationSheet: true,
            zoomMenu: true,
            minimumTargetSize: 44,
            noHorizontalOverflow: true,
        },
    },
});

const withEvidence = async (mutate, run) => {
    const evidenceDirectory = await mkdtemp(join(tmpdir(), 'screenhello-browser-evidence-'));
    try {
        for (const target of matrix.targets) {
            const evidence = createEvidence(target);
            mutate?.(evidence, target);
            await writeFile(join(evidenceDirectory, `${target.id}.json`), `${JSON.stringify(evidence)}\n`, 'utf8');
        }
        return await run(evidenceDirectory);
    } finally {
        await rm(evidenceDirectory, { recursive: true, force: true });
    }
};

const audit = (evidenceDirectory) => execFileAsync(process.execPath, [auditScript], {
    cwd: process.cwd(),
    env: {
        ...process.env,
        SCREENHELLO_BROWSER_EVIDENCE_DIR: evidenceDirectory,
        SCREENHELLO_RELEASE_CANDIDATE: candidate,
    },
});

describe('browser release evidence audit', () => {
    it('accepts one candidate with complete desktop, export, privacy, and mobile Web evidence', async () => {
        const { stdout } = await withEvidence(undefined, audit);
        expect(JSON.parse(stdout)).toMatchObject({ failures: [] });
    });

    it('fails closed when the Phase 8.5 mobile Web evidence is absent', async () => {
        await expect(withEvidence((evidence) => {
            delete evidence.checks.mobileWeb;
        }, audit)).rejects.toMatchObject({ code: 1 });
    });

    it.each([
        ['an oversized viewport', (evidence) => { evidence.checks.mobileWeb.viewport.width = 641; }],
        ['an incomplete topbar', (evidence) => { evidence.checks.mobileWeb.topbarActions.pop(); }],
        ['an incomplete application menu', (evidence) => { evidence.checks.mobileWeb.menuSections.pop(); }],
        ['an undersized target', (evidence) => { evidence.checks.mobileWeb.minimumTargetSize = 43; }],
        ['horizontal overflow', (evidence) => { evidence.checks.mobileWeb.noHorizontalOverflow = false; }],
    ])('rejects %s instead of trusting a passed status', async (_name, mutate) => {
        await expect(withEvidence(mutate, audit)).rejects.toMatchObject({ code: 1 });
    });
});
