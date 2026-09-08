import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { environmentFingerprint, hashPaths, writeImmutableJson } from '../compression-product/memory-evidence.mjs';

const environment = environmentFingerprint();
assert.equal(existsSync('local-device-assets'), false, 'Public browser candidate must exclude the optional device pack');
assert.ok((environment.platform === 'linux' && environment.arch === 'x64')
    || (environment.platform === 'darwin' && /^23\./.test(environment.kernel)),
'Browser matrix requires native Linux x64 or macOS 14; emulation is not target evidence');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.match(commit, /^[a-f0-9]{40}$/);
assert.equal(commit, process.env.GITHUB_SHA, 'workflow candidate mismatch');
await mkdir('artifacts/release/browser-matrix', { recursive: true });
await writeImmutableJson('artifacts/release/browser-matrix/candidate.json', {
    schema: 'screenhello-browser-candidate/v1', commit, recordedAt: new Date().toISOString(), environment,
    webBuildSha256: hashPaths('dist', ['./']),
    sourceSha256: hashPaths('.', ['src/', 'public/', 'config/', 'scripts/', 'index.html', 'package.json', 'pnpm-lock.yaml', 'vite.config.js']),
    runnerSha256: hashPaths('.', ['tests/release/', '.github/workflows/web-release-browser-matrix.yml']),
    scope: 'standard-format-minimum-browser-smoke', optionalDevicePackIncluded: false,
    deploymentAuthorized: false,
});
