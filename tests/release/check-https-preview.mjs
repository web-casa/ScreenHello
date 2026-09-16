import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { hashPaths, writeImmutableJson } from '../compression-product/memory-evidence.mjs';
import { fetchVerifiedHttps } from './https-entrypoints.mjs';
import { checkedPreviewOrigin, previewInventory, checkPreviewResponse } from './https-preview-contract.mjs';

assert.equal(process.argv.length, 6, 'usage: check-https-preview BUILD ORIGIN OUTPUT_JSON EXPECTED_UPLOAD_SHA256');
const build = await realpath(process.argv[2]), origin = checkedPreviewOrigin(process.argv[3]);
const output = path.join(await realpath(path.dirname(path.resolve(process.argv[4]))), path.basename(process.argv[4]));
assert.ok(output !== build && !output.startsWith(`${build}${path.sep}`), 'output must not mutate candidate');
assert.match(process.argv[5], /^[a-f0-9]{64}$/);
assert.equal(hashPaths(build, ['./']), process.argv[5], 'upload changed');
const inventory = previewInventory(build), responses = [];
const pending = inventory.filter(row => !['_headers', '_redirects'].includes(row.file));
// Four bounded connections; no redirects or retries, no server mutation.
await Promise.all(Array.from({ length: 4 }, async () => {
    while (pending.length) {
        const row = pending.shift();
        let observed;
        try {
            observed = await fetchVerifiedHttps(origin + row.requestPath, { maxBytes: 4 * 1024 * 1024, expectedStatus: row.file === '404.html' ? 404 : 200 });
            checkPreviewResponse(row, observed); responses.push({ file: row.file, observed });
        } catch (error) { responses.push({ file: row.file, observed, error: error.message }); }
    }
}));
assert.equal(hashPaths(build, ['./']), process.argv[5], 'upload changed during check');
responses.sort((a, b) => a.file.localeCompare(b.file));
const failures = responses.filter(row => row.error);
const report = { scope: 'https-preview-static-closure/v1', recordedAt: new Date().toISOString(), origin,
    uploadSha256: process.argv[5], inventory, responses, failures, status: failures.length ? 'HOLD' : 'STATIC-PASS',
    pwaAcceptance: false, productionDeploymentAuthorized: false };
await writeImmutableJson(output, report);
console.log(JSON.stringify({ files: responses.length, status: report.status, failures }, null, 2));
if (failures.length) process.exitCode = 1;
