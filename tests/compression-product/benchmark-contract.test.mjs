import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('SCREENHELLO_COMPRESSION_')));
const run = (values, script = 'benchmark.mjs') => spawnSync(process.execPath, [`tests/compression-product/${script}`], {
    cwd: root, env: { ...cleanEnv, ...values }, encoding: 'utf8', timeout: 10_000,
});

for (const [name, values, message] of [
    ['profile', { SCREENHELLO_COMPRESSION_PROFILE: 'production-maybe' }, 'unknown harness profile'],
    ['memory policy', { SCREENHELLO_COMPRESSION_MEMORY_POLICY: 'v3' }, 'unknown memory policy'],
    ['implicit V2', { SCREENHELLO_COMPRESSION_MANIFEST: 'some-file.json' }, 'V2 requires explicit policy'],
    ['V2 manifest', { SCREENHELLO_COMPRESSION_MEMORY_POLICY: 'screenhello-export-memory/v2' }, 'V2 requires explicit policy'],
    ['mode', { SCREENHELLO_COMPRESSION_MODE: 'avif-standard' }, 'unknown mode'],
    ['repeat', { SCREENHELLO_COMPRESSION_REPEAT: '5' }, 'invalid repeat count'],
    ['dimensions', { SCREENHELLO_COMPRESSION_DIRECT: '1', SCREENHELLO_COMPRESSION_WIDTH: '2049', SCREENHELLO_COMPRESSION_HEIGHT: '2048' }, 'invalid probe dimensions'],
    ['label', { SCREENHELLO_COMPRESSION_LABEL: '../replace' }, 'invalid report label'],
]) {
    test(`benchmark rejects invalid ${name} before browser launch`, () => {
        const result = run(values);
        assert.equal(result.error, undefined);
        assert.notEqual(result.status, 0);
        assert.ok(result.stderr.includes(message), result.stderr);
    });
}

test('local PWA probe rejects a path-like report label', () => {
    const result = run({ SCREENHELLO_COMPRESSION_LABEL: '../replace' }, 'verify-deployment.mjs');
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid report label/);
});

test('PWA server and SW mutation fixture select the same explicit output directory', async () => {
    const fixture = await readFile(new URL('../pwa/pwa.spec.js', import.meta.url), 'utf8');
    assert.match(fixture, /path\.resolve\(root, process\.env\.SCREENHELLO_PWA_OUT_DIR \|\| 'dist'\)/);
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
        'const { default: config } = await import(process.argv[1]); console.log(JSON.stringify(config.webServer));',
        new URL('../../playwright.pwa.config.js', import.meta.url).href], {
        cwd: root, env: { ...cleanEnv, SCREENHELLO_PWA_OUT_DIR: 'artifacts/frozen-web-test', SCREENHELLO_BASE_PATH: '/screenhello/' }, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    const server = JSON.parse(result.stdout);
    assert.match(server.command, /--outDir "artifacts\/frozen-web-test"/);
    assert.match(server.url, /\/screenhello\/$/);
});

for (const [script, reportPrefix] of [['benchmark.mjs', 'benchmark-1024x1024-'], ['verify-deployment.mjs', 'deployment-']]) {
    test(`${script} preserves existing evidence and refuses duplicate labels`, async () => {
        const label = `test-${randomUUID().replaceAll('-', '').slice(0, 20)}`;
        const directory = new URL('../../artifacts/compression-product-evidence/', import.meta.url);
        await mkdir(directory, { recursive: true });
        const report = new URL(`${reportPrefix}${label}.json`, directory);
        const original = '[{"failedEvidence":true}]\n';
        await writeFile(report, original, { flag: 'wx' });
        try {
            const result = run({ SCREENHELLO_COMPRESSION_LABEL: label }, script);
            assert.equal(result.error, undefined);
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /EEXIST/);
            assert.equal(await readFile(report, 'utf8'), original);
        } finally {
            // Remove only the exact synthetic file this test created, never a
            // benchmark or user report selected via a glob.
            await unlink(report);
        }
    });
}
