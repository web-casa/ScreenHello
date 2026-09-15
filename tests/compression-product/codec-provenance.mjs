// Read-only upstream audit. Never builds, extracts archives, or changes codecs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const sourceLock = JSON.parse(await readFile(new URL('./codec-source-lock.json', import.meta.url), 'utf8'));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function fetchBytes(url, { fetchImpl = fetch, maxBytes = 16 * 1024 * 1024 } = {}) {
    try {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(45_000), redirect: 'error' });
        assert.ok(response.ok, `Upstream HTTP ${response.status}: ${url}`);
        assert.ok(response.body, `Missing response body: ${url}`);
        const chunks = [];
        let length = 0;
        // Streaming limit also covers missing or dishonest Content-Length.
        for await (const chunk of response.body) {
            length += chunk.byteLength;
            assert.ok(length <= maxBytes, `Upstream response too large: ${url}`);
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    } catch (error) {
        throw new Error(`Upstream read failed (${url}): ${String(error)}`, { cause: error });
    }
}

export async function verifyProvenance({ lock = sourceLock, download = fetchBytes,
    readInstalled = path => readFile(new URL(import.meta.resolve(`@jsquash/avif/${path}`))) } = {}) {
    const installed = JSON.parse(await readInstalled('package.json'));
    assert.equal(installed.name, lock.package, 'Installed package name drift');
    assert.equal(installed.version, lock.version, 'Installed package version drift');
    // Verify local bytes before contacting upstream. No imports execute the codec.
    for (const [path, expected] of Object.entries(lock.artifacts)) {
        assert.equal(sha256(await readInstalled(path)), expected, `Installed artifact drift: ${path}`);
    }
    const metadata = JSON.parse(await download(`https://registry.npmjs.org/@jsquash%2favif/${lock.version}`));
    assert.equal(metadata.name, lock.package, 'Registry package name drift');
    assert.equal(metadata.version, lock.version, 'Registry version drift');
    assert.equal(metadata.gitHead, lock.gitHead, 'Registry gitHead drift');
    assert.equal(metadata.dist?.integrity, lock.integrity, 'Registry integrity drift');
    assert.equal(metadata.dist?.tarball, lock.tarball, 'Registry tarball URL drift');
    const tarball = await download(lock.tarball);
    assert.equal(`sha512-${createHash('sha512').update(tarball).digest('base64')}`, lock.integrity, 'Package tarball integrity mismatch');
    const checked = [];
    for (const [path, expected] of Object.entries({
        ...Object.fromEntries(Object.entries(lock.artifacts).map(([path, hash]) => [`packages/avif/${path}`, hash])),
        ...lock.recipe,
    })) {
        const url = `https://raw.githubusercontent.com/${lock.repository}/${lock.gitHead}/${path}`;
        const bytes = await download(url);
        assert.equal(sha256(bytes), expected, `Upstream artifact/recipe drift: ${path}`);
        checked.push({ path, sha256: expected, bytes: bytes.byteLength });
    }
    const archives = [];
    for (const [url, expected] of Object.entries(lock.archives)) {
        const bytes = await download(url);
        assert.equal(sha256(bytes), expected, `Dependency archive drift: ${url}`);
        archives.push({ url, sha256: expected, bytes: bytes.byteLength });
    }
    const dependencyCommits = [];
    for (const [url, expected] of Object.entries(lock.dependencyCommits)) {
        const text = (await download(url)).toString();
        assert.ok(text.startsWith(")]}'\n"), 'Unrecognized Gitiles JSON prefix');
        const commit = JSON.parse(text.slice(5));
        assert.equal(commit.commit, expected.commit, 'Dependency commit drift');
        assert.equal(commit.tree, expected.tree, 'Dependency tree drift');
        dependencyCommits.push({ url, ...expected });
    }
    return { diagnosticOnly: true, status: 'source-artifact-match', package: lock.package, version: lock.version,
        gitHead: lock.gitHead, checked, archives, packageTarballIntegrityVerified: true,
        dependencyCommits, dependencySourceGate: lock.dependencySourceGate,
        rebuildReady: false, rebuilt: false, internalAllocationsMeasured: false, releaseReady: false,
        limitations: ['Registry metadata is not a signed build attestation',
            'Matching committed binaries is not source-build reproducibility',
            'Dependency commit metadata does not verify complete source trees',
            'Toolchain execution, extracted-source inventory and internal allocation probes remain unverified'] };
}

export async function runProvenance(label, { directory = new URL('../../artifacts/compression-product-evidence/', import.meta.url),
    verify = verifyProvenance } = {}) {
    assert.match(label, /^[a-z0-9-]{1,40}$/, 'Invalid codec label');
    await mkdir(directory, { recursive: true });
    // Reserve atomically before any network work; concurrent identical labels cannot race.
    const destination = new URL(`codec-provenance-${label}.json`, directory);
    const handle = await open(destination, 'wx');
    let report;
    try {
        try { report = await verify(); }
        catch (error) { report = { diagnosticOnly: true, status: 'failed', error: String(error), releaseReady: false }; }
        await handle.writeFile(`${JSON.stringify({ ...report, node: process.version, architecture: process.arch }, null, 2)}\n`);
    } finally { await handle.close(); }
    if (report.status !== 'source-artifact-match') throw new Error(report.error || 'Codec provenance failed');
    return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { console.log(JSON.stringify(await runProvenance(process.env.SCREENHELLO_CODEC_LABEL || 'current'), null, 2)); }
    catch (error) { console.error(String(error)); process.exitCode = 1; }
}
