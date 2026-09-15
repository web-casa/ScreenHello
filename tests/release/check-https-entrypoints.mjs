import assert from 'node:assert/strict';
import { realpath, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { ENTRYPOINTS, MAX_ENTRYPOINT_BYTES, fetchEntrypoint, compareEntrypoint, summarizeEntrypoints } from './https-entrypoints.mjs';
import { hashPaths, writeImmutableJson } from '../compression-product/memory-evidence.mjs';
import { checkExpectedWebBuild } from './candidate-identity.mjs';

assert.equal(process.argv.length, 5, 'usage: node tests/release/check-https-entrypoints.mjs BUILD OUTPUT_JSON EXPECTED_WEB_SHA256');
const build = await realpath(process.argv[2]);
const output = path.join(await realpath(path.dirname(path.resolve(process.argv[3]))), path.basename(process.argv[3]));
const relative = path.relative(build, output);
assert.ok(relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'output must not mutate candidate');
const webBuildSha256 = hashPaths(build, ['./']);
assert.ok(process.argv[4], 'expected build identity is required');
checkExpectedWebBuild(webBuildSha256, process.argv[4]);
// Validate every local input before performing any external request.
const expected = await Promise.all(ENTRYPOINTS.map(async entry => {
    const file = await realpath(path.join(build, entry.file));
    assert.equal(path.dirname(file), build, 'entrypoint escaped build');
    const metadata = await stat(file);
    assert.ok(metadata.isFile() && metadata.size > 0 && metadata.size <= MAX_ENTRYPOINT_BYTES, 'invalid local entrypoint');
    return readFile(file);
}));
const rows = [];
for (const [index, entry] of ENTRYPOINTS.entries()) {
    try { rows.push(compareEntrypoint(entry, expected[index], await fetchEntrypoint(`https://screenhello.com${entry.path}`))); }
    catch (error) { rows.push({ path: entry.path, error: error.code || error.message }); }
}
assert.equal(hashPaths(build, ['./']), webBuildSha256, 'candidate changed during preflight');
const report = { schema: 'screenhello-https-entrypoints/v1', recordedAt: new Date().toISOString(),
    origin: 'https://screenhello.com', webBuildSha256, ...summarizeEntrypoints(rows), rows };
await writeImmutableJson(output, report);
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'ENTRYPOINTS-MATCH') process.exitCode = 1;
