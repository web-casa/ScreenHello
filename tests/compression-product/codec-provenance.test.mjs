import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchBytes, runProvenance, sha256, verifyProvenance } from './codec-provenance.mjs';

function fixture() {
    const bytes = Buffer.from('fixed fixture');
    const lock = { package: '@jsquash/avif', version: '2.1.1', gitHead: 'fixed', repository: 'test/fixture',
        tarball: 'https://example.test/package.tgz', integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
        archives: { 'https://example.test/source.tgz': sha256(bytes) },
        dependencyCommits: { 'https://example.test/commit': { commit: 'fixed', tree: 'fixed-tree' } },
        dependencySourceGate: { status: 'HOLD' },
        artifacts: { 'codec/test.wasm': sha256(bytes) }, recipe: { Makefile: sha256(bytes) } };
    const metadata = { name: lock.package, version: lock.version, gitHead: lock.gitHead,
        dist: { integrity: lock.integrity, tarball: lock.tarball } };
    return { lock, metadata, bytes, readInstalled: async path => path === 'package.json'
        ? JSON.stringify({ name: lock.package, version: lock.version }) : bytes,
    download: async url => url.includes('registry.npmjs.org') ? JSON.stringify(metadata)
        : url.endsWith('/commit') ? ")]}'\n" + JSON.stringify({ commit: 'fixed', tree: 'fixed-tree' }) : bytes };
}

test('fixed binaries and recipes match without claiming a rebuild or allocator coverage', async () => {
    const result = await verifyProvenance(fixture());
    assert.equal(result.status, 'source-artifact-match');
    assert.equal(result.checked.length, 2);
    assert.equal(result.rebuilt, false);
    assert.equal(result.internalAllocationsMeasured, false);
    assert.equal(result.releaseReady, false);
    assert.equal(result.archives.length, 1);
    assert.equal(result.packageTarballIntegrityVerified, true);
    assert.equal(result.dependencySourceGate.status, 'HOLD');
    assert.equal(result.rebuildReady, false);
});
test('rejects local drift before any network request', async () => {
    const f = fixture();
    await assert.rejects(verifyProvenance({ ...f, readInstalled: async path => path === 'package.json'
        ? f.readInstalled(path) : Buffer.from('changed'), download() { assert.fail('must not download'); } }), /Installed artifact drift/);
});
test('rejects installed version and package identity drift', async () => {
    for (const change of [{ version: 'next' }, { name: 'other' }]) {
        const f = fixture();
        await assert.rejects(verifyProvenance({ ...f, readInstalled: async () => JSON.stringify({
            name: f.lock.package, version: f.lock.version, ...change,
        }) }), /Installed package .* drift/);
    }
});
test('rejects registry version, commit and integrity drift', async () => {
    for (const key of ['name', 'version', 'gitHead', 'dist']) {
        const f = fixture(); f.metadata[key] = key === 'dist' ? {} : 'changed';
        await assert.rejects(verifyProvenance(f), /Registry .* drift/);
    }
});
test('rejects upstream binary and recipe drift separately', async () => {
    for (const target of ['test.wasm', 'Makefile']) {
        const f = fixture();
        await assert.rejects(verifyProvenance({ ...f, download: url => url.endsWith(target)
            ? Buffer.from('changed') : f.download(url) }), /Upstream artifact\/recipe drift/);
    }
});
test('rejects changed tarball URL, package bytes and dependency archives', async () => {
    const f = fixture();
    f.metadata.dist.tarball = 'https://other.test/untrusted';
    await assert.rejects(verifyProvenance(f), /Registry tarball URL drift/);
    for (const [target, error] of [['package.tgz', /Package tarball integrity mismatch/], ['source.tgz', /Dependency archive drift/]]) {
        const valid = fixture();
        await assert.rejects(verifyProvenance({ ...valid, download: url => url.endsWith(target)
            ? Buffer.from('changed') : valid.download(url) }), error);
    }
});
test('rejects dependency commit/tree drift and unexpected Gitiles response', async () => {
    for (const data of [JSON.stringify({ commit: 'fixed', tree: 'fixed-tree' }),
        ")]}'\n" + JSON.stringify({ commit: 'wrong', tree: 'fixed-tree' }),
        ")]}'\n" + JSON.stringify({ commit: 'fixed', tree: 'wrong' })]) {
        const f = fixture();
        await assert.rejects(verifyProvenance({ ...f, download: url => url.endsWith('/commit') ? data : f.download(url) }),
            /Gitiles JSON prefix|Dependency (commit|tree) drift/);
    }
});
test('network reads enforce status, timeout, redirect policy and streaming byte limit', async () => {
    const url = 'https://example.test/fixed';
    assert.equal((await fetchBytes(url, { fetchImpl: async (_url, options) => {
        assert.ok(options.signal instanceof AbortSignal); assert.equal(options.redirect, 'error'); return new Response('ok');
    } })).toString(), 'ok');
    await assert.rejects(fetchBytes(url, { fetchImpl: async () => new Response('missing', { status: 404 }) }), /HTTP 404/);
    await assert.rejects(fetchBytes(url, { fetchImpl: async () => new Response(null) }), /Missing response body/);
    await assert.rejects(fetchBytes(url, { fetchImpl: async () => new Response('large'), maxBytes: 2 }), /too large/);
    await assert.rejects(fetchBytes(url, { fetchImpl: async () => { throw new Error('timeout'); } }), /example.test\/fixed.*timeout/);
});
test('CLI evidence rejects unsafe and duplicate labels before verification; keeps failures', async t => {
    const path = await mkdtemp(join(tmpdir(), 'screenhello-codec-provenance-test-'));
    t.after(() => rm(path, { recursive: true, force: true }));
    const directory = pathToFileURL(`${path}/`);
    let calls = 0;
    const verify = async () => { calls++; return { status: 'source-artifact-match' }; };
    for (const label of ['../outside', '', 'A', 'a'.repeat(41)]) {
        await assert.rejects(runProvenance(label, { directory, verify }), /Invalid codec label/);
    }
    assert.equal(calls, 0);
    await runProvenance('same', { directory, verify });
    await assert.rejects(runProvenance('same', { directory, verify }), /EEXIST/);
    assert.equal(calls, 1);
    await assert.rejects(runProvenance('failure', { directory, verify: async () => { throw new Error('offline'); } }), /offline/);
    const report = JSON.parse(await readFile(new URL('codec-provenance-failure.json', directory), 'utf8'));
    assert.equal(report.status, 'failed'); assert.equal(report.releaseReady, false);
    const race = await Promise.allSettled([runProvenance('race', { directory, verify }), runProvenance('race', { directory, verify })]);
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(calls, 2);
});
