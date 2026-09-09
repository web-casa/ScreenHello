import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { candidateFingerprint, environmentFingerprint, writeImmutableJson, sha256, MEMORY_POLICY } from './memory-evidence.mjs';
import { readSystemPressure } from './system-pressure.mjs';
import { NATIVE_MEMORY_SCOPE, NATIVE_MEMORY_REPORT, validateNativeMemoryHost, createNativeMemoryManifest,
    evaluateNativeMemorySupplement } from './native-firefox-memory.mjs';

const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
const environment = environmentFingerprint();
const github = { repository: process.env.GITHUB_REPOSITORY, private: event.repository?.private,
    event: process.env.GITHUB_EVENT_NAME, commit: process.env.GITHUB_SHA, runner: process.env.SCREENHELLO_MEMORY_RUNNER,
    runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT };
validateNativeMemoryHost(environment, github);
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), github.commit);
const output = 'artifacts/native-firefox-memory';
await mkdir(output); // Existing run evidence is never overwritten.
const candidate = candidateFingerprint();
const workflowPath = '.github/workflows/web-release-browser-matrix.yml';
const workflowSha256 = sha256(await readFile(workflowPath));
const manifest = createNativeMemoryManifest(candidate, environment);
const manifestPath = join(output, 'manifest.json');
await writeImmutableJson(manifestPath, manifest);
const manifestBytes = await readFile(manifestPath);
const registration = { scope: NATIVE_MEMORY_SCOPE, attempts: 1, registeredAt: new Date().toISOString(),
    github, environment, candidate, workflowSha256, manifestSha256: sha256(manifestBytes), before: readSystemPressure() };
await writeImmutableJson(join(output, 'registration.json'), registration);
// Ignore inherited scenario selectors. The only allowed workload is the fixed
// registered six-operation supplement, with no CLI mode/dimension override.
const childEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('SCREENHELLO_COMPRESSION_')));
Object.assign(childEnvironment, {
    SCREENHELLO_COMPRESSION_MEMORY_POLICY: MEMORY_POLICY, SCREENHELLO_COMPRESSION_MANIFEST: manifestPath,
    SCREENHELLO_COMPRESSION_PROFILE: 'web', SCREENHELLO_COMPRESSION_DIRECT: '1', SCREENHELLO_COMPRESSION_PAIR: '0',
    SCREENHELLO_COMPRESSION_ENGINE: 'firefox', SCREENHELLO_COMPRESSION_KIND: 'noise', SCREENHELLO_COMPRESSION_MODE: 'avif-lossy',
    SCREENHELLO_COMPRESSION_WIDTH: '1024', SCREENHELLO_COMPRESSION_HEIGHT: '1024', SCREENHELLO_COMPRESSION_REPEAT: '6',
    SCREENHELLO_COMPRESSION_LABEL: 'mg3-native-firefox',
});
let after;
try {
    const code = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['tests/compression-product/benchmark.mjs'], { env: childEnvironment, stdio: 'inherit' });
        child.once('error', reject);
        child.once('exit', (code, signal) => signal ? reject(new Error(`benchmark terminated: ${signal}`)) : resolve(code));
    });
    assert.equal(code, 0, 'benchmark collection failed; inspect preserved failure.json');
    after = readSystemPressure();
    const reportBytes = await readFile(join('artifacts/compression-product-evidence', NATIVE_MEMORY_REPORT, 'complete.json'));
    const finalCandidate = candidateFingerprint();
    const result = evaluateNativeMemorySupplement({ registration, manifestBytes, reportBytes, after, finalCandidate,
        workflowSha256: sha256(await readFile(workflowPath)) });
    await writeImmutableJson(join(output, 'result.json'), { ...result, after, finalCandidate });
    console.log(JSON.stringify({ status: result.status, collectionValid: result.collectionValid, deploymentAuthorized: false }));
    if (!result.collectionValid) process.exitCode = 1;
} catch (error) {
    await writeImmutableJson(join(output, 'failure.json'), { error: String(error.stack || error), after: after || readSystemPressure(), deploymentAuthorized: false });
    throw error;
}
