import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { prepareDeviceHandoff, deviceChecks } from './device-handoff.mjs';
import { digest, hashPaths, MEMORY_POLICY, REQUIRED_DEVICES, REQUIRED_GATES, requiredMemoryScenarios, sha256 } from './memory-evidence.mjs';

async function setup(t, scope = 'release') {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'screenhello-device-contract-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const webDirectory = path.join(directory, 'web');
    await mkdir(webDirectory);
    await writeFile(path.join(webDirectory, 'index.html'), '<!doctype html><title>synthetic fixture only</title>');
    const hash = 'a'.repeat(64);
    const manifest = { schema: MEMORY_POLICY, scope, registeredAt: '2026-09-08T00:00:00Z',
        candidate: { buildSha256: hash, webBuildSha256: hashPaths(webDirectory, ['./']), sourceSha256: hash, runnerSha256: hash },
        environment: { platform: 'linux', arch: 'arm64', ramBytes: 8 * 1024 ** 3 },
        scenarios: requiredMemoryScenarios(), requiredDevices: [...REQUIRED_DEVICES], requiredGates: [...REQUIRED_GATES] };
    const manifestFile = path.join(directory, 'manifest.json');
    await writeFile(manifestFile, JSON.stringify(manifest));
    return { directory, manifest, manifestFile, webDirectory, outputDirectory: path.join(directory, 'handoff') };
}

test('handoff binds exact candidate but creates only pending device worksheets, not passes', async t => {
    const fixture = await setup(t), before = hashPaths(fixture.webDirectory, ['./']);
    const result = await prepareDeviceHandoff(fixture);
    assert.equal(result.status, 'EVIDENCE-HOLD'); assert.equal(result.deviceTestsExecuted, false);
    assert.equal(result.deploymentAuthorized, false); assert.equal(result.targets, 5);
    const handoff = JSON.parse(await readFile(path.join(fixture.outputDirectory, 'handoff.json')));
    const worksheet = JSON.parse(await readFile(path.join(fixture.outputDirectory, 'device-worksheet.json')));
    assert.deepEqual(handoff.candidate, fixture.manifest.candidate);
    assert.equal(handoff.manifestSha256, sha256(await readFile(fixture.manifestFile)));
    assert.equal(worksheet.handoffContentSha256, digest(handoff)); assert.equal(worksheet.registration, null);
    assert.match(handoff.handoffToolSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(handoff.targets.slice(0, 4).map(target => target.id), ['chrome-111', 'edge-111', 'firefox-128', 'safari-macos-14']);
    for (const target of worksheet.targets) {
        assert.equal(target.model, null); assert.equal(target.ram.bytes, null);
        assert.ok(target.checks.every(check => check.status === 'pending' && check.observations.length === 0));
    }
    assert.equal(hashPaths(fixture.webDirectory, ['./']), before);
    assert.deepEqual((await readdir(fixture.outputDirectory)).sort(), ['device-worksheet.json', 'handoff.json']);
});
test('checklist keeps standard AVIF and exactly six continuous operations; no pressure retries', () => {
    const checks = deviceChecks();
    assert.equal(new Set(checks.map(check => check.id)).size, checks.length);
    assert.equal(checks.find(check => check.id === 'avif-standard-continuous').continuousExports, 6);
    assert.ok(checks.every(check => check.attemptLimit === 1));
    assert.ok(checks.filter(check => check.id !== 'avif-standard-continuous').every(check => check.continuousExports === null));
    for (const id of ['png-lossless', 'png-lossy', 'webp-lossless', 'webp-lossy', 'jpg-lossy', 'avif-lossy-small', 'avif-standard-4mp', 'cancel-and-recover', 'offline-codec-recovery']) {
        assert.ok(checks.some(check => check.id === id));
    }
});
test('instrumentation manifest is not promoted to device release preparation', async t => {
    const fixture = await setup(t, 'instrumentation');
    await assert.rejects(prepareDeviceHandoff(fixture), /release manifest/);
    await assert.rejects(readFile(path.join(fixture.outputDirectory, 'handoff.json')), { code: 'ENOENT' });
});
test('stale candidate bytes are rejected without reserving an output', async t => {
    const fixture = await setup(t);
    await writeFile(path.join(fixture.webDirectory, 'new.js'), 'changed');
    await assert.rejects(prepareDeviceHandoff(fixture), /digest mismatch/);
    await assert.rejects(readdir(fixture.outputDirectory), { code: 'ENOENT' });
});
test('existing handoff is never overwritten, including edited worksheet', async t => {
    const fixture = await setup(t); await prepareDeviceHandoff(fixture);
    const worksheet = path.join(fixture.outputDirectory, 'device-worksheet.json');
    await writeFile(worksheet, 'operator work');
    await assert.rejects(prepareDeviceHandoff(fixture), { code: 'EEXIST' });
    assert.equal(await readFile(worksheet, 'utf8'), 'operator work');
});
test('output inside frozen Web is rejected even through a parent symlink', async t => {
    const fixture = await setup(t), before = hashPaths(fixture.webDirectory, ['./']);
    await assert.rejects(prepareDeviceHandoff({ ...fixture, outputDirectory: path.join(fixture.webDirectory, 'handoff') }), /outside/);
    const alias = path.join(fixture.directory, 'alias');
    await symlink(fixture.webDirectory, alias, 'dir');
    await assert.rejects(prepareDeviceHandoff({ ...fixture, outputDirectory: path.join(alias, 'handoff') }), /outside/);
    assert.equal(hashPaths(fixture.webDirectory, ['./']), before);
});
test('Web symlinks are not silently included in the candidate closure', async t => {
    const fixture = await setup(t), alias = path.join(fixture.directory, 'alias');
    await symlink(fixture.webDirectory, alias, 'dir');
    await assert.rejects(prepareDeviceHandoff({ ...fixture, webDirectory: alias }), /symlink/);
    await symlink(fixture.manifestFile, path.join(fixture.webDirectory, 'outside.json'));
    await assert.rejects(prepareDeviceHandoff(fixture), /symlink/);
});
test('CLI rejects missing/extra arguments before writing', () => {
    for (const args of [[], ['a', 'b', 'c', 'd']]) {
        const result = spawnSync(process.execPath, ['tests/compression-product/prepare-device-check.mjs', ...args], { encoding: 'utf8' });
        assert.notEqual(result.status, 0); assert.match(result.stderr, /usage:/);
    }
});
