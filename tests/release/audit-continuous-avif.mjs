import assert from 'node:assert/strict';
import { readFile, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateContinuousAvifEvidence, inspectContinuousAvif, CONTINUOUS_AVIF_MAX_BYTES } from './continuous-avif-contract.mjs';

// Audit original files, not just a reporter's passed label or copied dimensions.
export async function auditContinuousAvifReports(files) {
    assert.equal(files.length, 3, 'all three current engines required');
    const reports = [];
    for (const file of files) {
        const metadata = await lstat(file);
        assert.ok(metadata.isFile() && metadata.size > 0 && metadata.size <= 131_072, 'invalid evidence file');
        const evidence = JSON.parse(await readFile(file, 'utf8'));
        validateContinuousAvifEvidence(evidence);
        for (const result of evidence.results) {
            const artifact = join(dirname(file), result.file); // validated exact fixed name
            const stat = await lstat(artifact);
            assert.ok(stat.isFile() && stat.size > 0 && stat.size <= CONTINUOUS_AVIF_MAX_BYTES, 'invalid AVIF artifact');
            const actual = await inspectContinuousAvif(await readFile(artifact));
            assert.deepEqual(actual, { size: result.size, sha256: result.sha256, decoded: result.decoded }, 'artifact differs from report');
        }
        reports.push(evidence);
    }
    assert.deepEqual(reports.map(e => e.environment.engine).sort(), ['chromium', 'firefox', 'webkit']);
    for (const report of reports.slice(1)) {
        assert.deepEqual(report.finalFingerprints, reports[0].finalFingerprints, 'mixed candidates');
        assert.equal(report.registration.pcSha256, reports[0].registration.pcSha256, 'mixed PC fixtures');
    }
    return { scope: 'continuous-avif-original-files-audit/v1', status: 'passed',
        engines: reports.map(e => e.environment), files: 18, candidate: reports[0].finalFingerprints,
        memoryMeasurement: false, targetBrowserAcceptance: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try { console.log(JSON.stringify(await auditContinuousAvifReports(process.argv.slice(2)), null, 2)); }
    catch (error) { console.error(error); process.exitCode = 1; }
}
