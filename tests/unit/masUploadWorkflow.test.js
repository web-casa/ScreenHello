import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    altoolProductErrors,
    assertReviewedCandidate,
    credentialValues,
    redactCredentials,
    scanForCredentials,
    uploadEvidence,
} from '../../scripts/mas-app-store-upload.mjs';

const workflow = readFileSync(new URL('../../.github/workflows/macos-mas-app-store-upload.yml', import.meta.url), 'utf8');
const expression = '$' + '{{';
const directories = [];

const temporaryDirectory = async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mas-upload-'));
    directories.push(directory);
    return directory;
};

const reviewedCandidate = async (overrides = {}, contents = 'reviewed-pkg-bytes') => {
    const directory = await temporaryDirectory();
    await writeFile(path.join(directory, 'ScreenHello-mas-universal.pkg'), contents);
    const sha256 = createHash('sha256').update(contents).digest('hex');
    const evidence = {
        schemaVersion: 1,
        channel: 'mas',
        arch: 'universal',
        commit: 'bf7d72c35ae863dc21e6efbb66e6c12fe7833c34',
        dirty: false,
        identity: 'com.webcasa.screenhello.mas',
        version: '1',
        file: 'ScreenHello-mas-universal.pkg',
        sha256,
        packaging: 'passed',
        installation: 'not-run',
        gui: 'not-run',
        upgrade: 'not-run',
        storeUpload: 'not-run',
        storeReview: 'not-run',
        releaseReady: false,
        ...overrides,
    };
    await writeFile(path.join(directory, 'package-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    return { directory, sha256 };
};

afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('MAS App Store Connect upload workflow', () => {
    it('is a manual upload gate that repository events cannot trigger', () => {
        expect(workflow).toContain('workflow_dispatch:');
        expect(workflow).toContain("inputs.confirm == 'upload-mas-candidate-to-app-store-connect'");
        expect(workflow).toContain('default: do-not-upload');
        expect(workflow).toContain("github.repository_id == '1353846676'");
        expect(workflow).not.toMatch(/^\s{2}(?:push|pull_request|pull_request_target|schedule|workflow_run):/mu);
    });

    it('uploads only the reviewed candidate and never rebuilds one', () => {
        expect(workflow).toContain('actions/download-artifact@');
        expect(workflow).toContain('run-id: ' + expression + ' inputs.source_run_id }}');
        expect(workflow).toContain('Refuse any bytes other than the reviewed candidate');
        expect(workflow).toContain('mas-app-store-upload.mjs verify');
        expect(workflow).not.toContain('pnpm desktop:store:package');
        expect(workflow).not.toContain('rustup target add');
        expect(workflow).not.toContain('productbuild');
        expect(workflow).not.toContain('security import');
    });

    it('verifies the reviewed bytes before any credential reaches a step', () => {
        const guard = workflow.indexOf('mas-app-store-upload.mjs verify');
        const firstSecret = workflow.indexOf(expression + ' secrets.APPLE_ID }}');
        expect(guard).toBeGreaterThan(-1);
        expect(firstSecret).toBeGreaterThan(guard);
    });

    it('validates with altool before uploading and scopes credentials to those steps', () => {
        expect(workflow).toContain('xcrun --find altool');
        expect(workflow).toContain('--validate-app -f "$output/ScreenHello-mas-universal.pkg" -t macos');
        expect(workflow).toContain('--upload-app -f "$output/ScreenHello-mas-universal.pkg" -t macos');
        expect(workflow.match(/--output-format json/gu)).toHaveLength(2);
        expect(workflow.match(/--phase (?:validate|upload)/gu)).toEqual(['--phase validate', '--phase upload']);
        expect(workflow).toContain('--asc-provider "$ASC_PROVIDER"');
        expect(workflow.indexOf('--validate-app')).toBeLessThan(workflow.indexOf('--upload-app'));
        const secretLines = workflow.split('\n').filter((line) => line.includes(expression + ' secrets.'));
        expect(secretLines).toHaveLength(7);
        for (const line of secretLines) {
            expect(line).toMatch(/secrets\.(?:APPLE_ID|APPLE_APP_SPECIFIC_PASSWORD|GITHUB_TOKEN) \}\}/u);
        }
        expect(workflow).not.toContain('APPLE_TEAM_ID:');
        expect(workflow).not.toContain('APPLE_PASSWORD:');
        expect(workflow).not.toContain('MAS_APP_CERTIFICATE_P12');
    });

    it('records honest evidence, scans for leaked credentials and never submits for review', () => {
        expect(workflow).toContain('mas-app-store-upload.mjs record');
        expect(workflow).toContain('mas-app-store-upload.mjs redact');
        expect(workflow).toContain('mas-app-store-upload.mjs scan');
        expect(workflow).not.toMatch(/reviewSubmission|submit-for-review|app-store-version/iu);
        expect(workflow).toContain('actions/upload-artifact@');
        expect(workflow).toContain('if-no-files-found: error');
    });
});

describe('App Store Connect upload evidence helpers', () => {
    it('accepts only the exact reviewed bytes', async () => {
        const { directory, sha256 } = await reviewedCandidate();
        const { actual } = await assertReviewedCandidate({
            output: directory,
            expectedSha256: sha256,
            expectedBundleId: 'com.webcasa.screenhello.mas',
        });
        expect(actual).toBe(sha256);
    });

    it('refuses other bytes, a dirty tree, recorded acceptance and release readiness', async () => {
        const { directory, sha256 } = await reviewedCandidate();
        await expect(assertReviewedCandidate({ output: directory, expectedSha256: 'a'.repeat(64) }))
            .rejects.toThrow(/reviewed-candidate-sha256-mismatch/u);
        await expect(assertReviewedCandidate({ output: directory, expectedSha256: 'not-a-hash' }))
            .rejects.toThrow(/expected-sha256-invalid/u);
        await expect(assertReviewedCandidate({ output: directory, expectedSha256: sha256, expectedBundleId: 'com.example.other' }))
            .rejects.toThrow(/bundle-id-mismatch/u);
        for (const [overrides, message] of [
            [{ dirty: true }, /dirty-tree/u],
            [{ packaging: 'failed' }, /packaging-not-passed/u],
            [{ storeUpload: 'passed' }, /storeUpload-already-recorded/u],
            [{ gui: 'passed' }, /gui-already-recorded/u],
            [{ releaseReady: true }, /release-ready-must-stay-false/u],
            [{ sha256: 'b'.repeat(64) }, /evidence-hash-mismatch/u],
        ]) {
            const candidate = await reviewedCandidate(overrides);
            await expect(assertReviewedCandidate({ output: candidate.directory, expectedSha256: candidate.sha256 }))
                .rejects.toThrow(message);
        }
        await rm(path.join(directory, 'ScreenHello-mas-universal.pkg'));
        await expect(assertReviewedCandidate({ output: directory, expectedSha256: sha256 })).rejects.toThrow();
    });

    it('treats product-errors as failure under both key spellings', () => {
        expect(altoolProductErrors({ 'success-message': 'No errors uploading' })).toEqual([]);
        expect(altoolProductErrors({ productErrors: [] })).toEqual([]);
        expect(altoolProductErrors({
            'product-errors': [{ code: 90189, message: 'Redundant binary upload' }],
        })).toEqual([{ code: 90189, message: 'Redundant binary upload' }]);
        expect(altoolProductErrors({ productErrors: [{ message: 'no code' }] }))
            .toEqual([{ code: 'unknown', message: 'no code' }]);
    });

    it('records the upload without claiming processing, review or release', () => {
        const evidence = uploadEvidence({
            source: {
                commit: 'bf7d72c35ae863dc21e6efbb66e6c12fe7833c34',
                file: 'ScreenHello-mas-universal.pkg',
                sha256: 'c'.repeat(64),
                identity: 'com.webcasa.screenhello.mas',
                version: '1',
            },
            sourceRunId: 35331499660,
            uploadRunId: 35331500000,
            artifactName: 'ScreenHello-mas-universal-bf7d72c-build-1',
            repository: 'web-casa/ScreenHello',
        });
        expect(evidence.sourceCommit).toBe('bf7d72c35ae863dc21e6efbb66e6c12fe7833c34');
        expect(evidence.sourceRunUrl).toBe('https://github.com/web-casa/ScreenHello/actions/runs/35331499660');
        expect(evidence.storeUpload).toBe('passed');
        expect(evidence.validation).toBe('passed');
        expect(evidence.storeProcessing).toBe('not-run');
        expect(evidence.storeReview).toBe('not-run');
        expect(evidence.releaseReady).toBe(false);
        expect(JSON.stringify(evidence)).not.toContain('password');
    });

    it('detects and redacts credential material without touching binary payloads', async () => {
        const directory = await temporaryDirectory();
        const credentials = ['developer@example.com', 'abcd-efgh-ijkl-mnop'];
        await writeFile(path.join(directory, 'altool-upload.stderr.txt'), `user ${credentials[0]} password ${credentials[1]}\n`);
        await writeFile(path.join(directory, 'ScreenHello-mas-universal.pkg'), Buffer.from([0, 1, 2, 3]));
        expect(await scanForCredentials({ output: directory, values: credentials }))
            .toEqual(['altool-upload.stderr.txt']);
        expect(await redactCredentials({ output: directory, values: credentials }))
            .toEqual(['altool-upload.stderr.txt']);
        expect(await readFile(path.join(directory, 'altool-upload.stderr.txt'), 'utf8'))
            .toBe('user [redacted] password [redacted]\n');
        expect(await scanForCredentials({ output: directory, values: credentials })).toEqual([]);
        expect([...await readFile(path.join(directory, 'ScreenHello-mas-universal.pkg'))]).toEqual([0, 1, 2, 3]);
    });

    it('ignores empty credential values so absent secrets cannot match everything', () => {
        expect(credentialValues({})).toEqual([]);
        expect(credentialValues({ APPLE_ID: '', APPLE_APP_SPECIFIC_PASSWORD: undefined })).toEqual([]);
        expect(credentialValues({ APPLE_ID: 'developer@example.com' })).toEqual(['developer@example.com']);
    });
});
