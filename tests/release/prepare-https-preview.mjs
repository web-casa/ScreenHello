import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile, realpath, readdir } from 'node:fs/promises';
import path from 'node:path';
import { hashPaths, writeImmutableJson } from '../compression-product/memory-evidence.mjs';
import { previewHeaders, previewInventory } from './https-preview-contract.mjs';

assert.equal(process.argv.length, 5, 'usage: prepare-https-preview PUBLIC_ROOT OUTPUT_DIR EXPECTED_WEB_SHA256');
const source = await realpath(process.argv[2]);
const output = path.join(await realpath(path.dirname(path.resolve(process.argv[3]))), path.basename(process.argv[3]));
assert.ok(output !== source && !output.startsWith(`${source}${path.sep}`), 'output must not mutate source');
assert.match(process.argv[4], /^[a-f0-9]{64}$/);
const sourceWebSha256 = hashPaths(path.join(source, 'dist'), ['./']);
assert.equal(sourceWebSha256, process.argv[4], 'wrong source candidate');
await mkdir(output);
for (const name of await readdir(path.join(source, 'dist'))) {
    await cp(path.join(source, 'dist', name), path.join(output, name), { recursive: true, force: false, errorOnExist: true });
}
await writeFile(path.join(output, '_headers'), previewHeaders(await readFile(path.join(output, '_headers'), 'utf8')));
for (const [from, to] of [['LICENSE', 'LICENSE.txt'], ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.txt']]) {
    await writeFile(path.join(output, to), await readFile(path.join(source, from)), { flag: 'wx' });
}
const inventory = previewInventory(output);
for (const entry of inventory.filter(row => !['_headers', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.txt'].includes(row.file))) {
    assert.deepEqual(await readFile(path.join(output, entry.file)), await readFile(path.join(source, 'dist', entry.file)), 'application bytes changed');
}
assert.equal(hashPaths(path.join(source, 'dist'), ['./']), sourceWebSha256);
const record = { scope: 'https-preview-upload/v1', sourceWebSha256, uploadSha256: hashPaths(output, ['./']),
    changes: ['_headers', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.txt'], inventory, productionDeploymentAuthorized: false };
await writeImmutableJson(`${output}.json`, record);
console.log(JSON.stringify({ sourceWebSha256, uploadSha256: record.uploadSha256, files: inventory.length }));
