import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sha256, writeImmutableJson, hashPaths, root } from './memory-evidence.mjs';
import { evaluateMemory } from './memory-policy.mjs';

// INPUT.json: { manifest: path, reports: [path], supplements?: [path] }.
// Resolve paths relative to the input document, not the current directory.
const [inputFile, outputFile, ...extra] = process.argv.slice(2);
assert.ok(inputFile && outputFile && !extra.length, 'usage: node tests/compression-product/evaluate-memory.mjs INPUT.json OUTPUT.json');
const base = path.dirname(path.resolve(inputFile));
const read = file => { const bytes = readFileSync(path.resolve(base, file)); return { data: JSON.parse(bytes), sha256: sha256(bytes) }; };
const input = JSON.parse(readFileSync(inputFile, 'utf8'));
assert.ok(Array.isArray(input.reports), 'reports must be an explicit array');
const readErrors = [];
const safeRead = file => {
    try { return read(file); }
    catch (error) { readErrors.push(`${file}: ${error.message}`); return { data: null, sha256: null }; }
};
const manifest = safeRead(input.manifest);
const supplements = (input.supplements || []).map(file => {
    const record = safeRead(file).data;
    try {
        const evidence = readFileSync(path.resolve(base, path.dirname(file), record.evidenceFile));
        return { ...record, attachmentVerified: sha256(evidence) === record.evidenceSha256 };
    } catch (error) { readErrors.push(`${file}: ${error.message}`); return { ...record, attachmentVerified: false }; }
});
const result = evaluateMemory(manifest.data, manifest.sha256, input.reports.map(safeRead), supplements);
result.evaluatorSha256 = hashPaths(root, ['tests/compression-product/evaluate-memory.mjs', 'tests/compression-product/memory-policy.mjs', 'tests/compression-product/memory-evidence.mjs']);
if (readErrors.length) {
    result.readErrors = readErrors;
    if (result.status !== 'FAIL-HOLD') result.status = 'EVIDENCE-HOLD';
}
await writeImmutableJson(outputFile, result);
console.log(JSON.stringify({ status: result.status, outputFile, deploymentAuthorized: false }));
process.exitCode = { GO: 0, 'REVIEW-HOLD': 2, 'FAIL-HOLD': 3, 'EVIDENCE-HOLD': 4 }[result.status];
