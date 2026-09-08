import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { UPNG_SOURCE_SHA256, transformUpngEntry } from './upngCjsPlugin.mjs';

const root = new URL('../../../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pkg = JSON.parse(await read('package.json'));
const lock = await read('pnpm-lock.yaml');
// Resolve through pnpm's real package location before resolving its dependencies.
const upngRequire = createRequire(createRequire(import.meta.url).resolve('upng-js/package.json'));
const pakoPackage = JSON.parse(await readFile(upngRequire.resolve('pako/package.json'), 'utf8'));
assert.equal(pakoPackage.version, '1.0.11');
const packages = [];
for (const [name, version] of Object.entries({ '@jsquash/oxipng': '2.3.0', 'upng-js': '2.1.0', pngjs: '7.0.0' })) {
    assert.equal(pkg.devDependencies[name], version);
    const metadata = JSON.parse(await read(`node_modules/${name}/package.json`));
    assert.equal(metadata.version, version);
    const marker = name.startsWith('@') ? `  '${name}@${version}':` : `  ${name}@${version}:`;
    assert.ok(lock.includes(marker), `missing lock entry for ${name}`);
    const section = lock.slice(lock.indexOf(marker));
    const integrity = section.split('\n')[1]?.match(/integrity: ([^} ]+)/)?.[1];
    assert.ok(integrity?.startsWith('sha512-'), `missing integrity for ${name}`);
    packages.push({ name, version, license: metadata.license, dependencies: metadata.dependencies || {}, integrity });
}
const upng = await read('node_modules/upng-js/UPNG.js');
assert.equal(hash(upng), UPNG_SOURCE_SHA256);
const reports = {};
for (const directory of ['artifacts/compression-spike', 'artifacts/compression-library', 'artifacts/compression-consumer']) {
    const files = await readdir(new URL(`${directory}/assets/`, root));
    const assets = files.filter(file => file.endsWith('.wasm') || file.startsWith('codec.worker-'));
    assert.equal(assets.filter(file => file.endsWith('.wasm')).length, 3);
    assert.equal(assets.filter(file => file.startsWith('codec.worker-')).length, 1);
    assert.ok(!files.some(file => /pkg-parallel|_mt|workerHelpers/.test(file)), 'threaded asset found');
    reports[directory] = [];
    for (const file of assets) {
        const bytes = await readFile(new URL(`${directory}/assets/${file}`, root));
        if (file.startsWith('squoosh_oxipng')) assert.ok(bytes.length <= 180_000, 'Oxi asset budget');
        if (file.startsWith('codec.worker')) assert.ok(bytes.length <= 300_000, 'spike worker budget');
        reports[directory].push({ file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length, sha256: hash(bytes) });
    }
}
for (const directory of ['dist/assets', 'lib/assets']) {
    const productC1 = process.argv.includes('--product-c1');
    assert.ok(!(await readdir(new URL(`${directory}/`, root))).some(file => (productC1 ? /codec\.worker-/ : /squoosh_oxipng|codec\.worker-/).test(file)),
        `C0 experiment leaked into ${directory}`);
}
const result = { packages, upngSourceSha256: UPNG_SOURCE_SHA256,
    transformedSourceSha256: hash(transformUpngEntry(upng)),
    oxipngEmbeddedVersion: { declaredByPackagedReadme: 'v3.0.0', binaryVersionIndependentlyIdentified: false },
    pakoResolvedVersion: pakoPackage.version,
    lockfileSha256: hash(await read('pnpm-lock.yaml')), reports,
    productStage: process.argv.includes('--product-c1') ? 'C1' : 'C0',
    experimentalAssetsAbsentFromProductBuilds: !process.argv.includes('--product-c1'),
    aggregateSpikeWorkersAbsentFromProductBuilds: true };
const directory = new URL('artifacts/compression-evidence/', root);
await mkdir(directory, { recursive: true });
await writeFile(new URL('dependency-assets.json', directory), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
