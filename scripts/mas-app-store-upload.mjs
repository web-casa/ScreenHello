#!/usr/bin/env node
// Helpers for the manual App Store Connect upload workflow.
//
// The upload workflow only ever forwards one already-reviewed PKG. These
// helpers keep the reviewed-bytes guard, the altool result parsing, the
// credential redaction and the recorded evidence out of inline shell, so the
// same code can be unit tested and can never print credential values.
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const uploadDirectoryVariable = 'SCREENHELLO_MAS_UPLOAD_DIR';
export const packageFileName = 'ScreenHello-mas-universal.pkg';
export const sourceEvidenceFileName = 'package-evidence.json';
export const uploadEvidenceFileName = 'upload-evidence.json';
export const notRunKeys = Object.freeze(['installation', 'gui', 'upgrade', 'storeUpload', 'storeReview']);

export const sha256 = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');

export const assertReviewedCandidate = async ({ output, expectedSha256, expectedBundleId }) => {
    if (!/^[0-9a-f]{64}$/u.test(expectedSha256 ?? '')) throw new Error('expected-sha256-invalid');
    const packageFile = path.join(output, packageFileName);
    const evidenceFile = path.join(output, sourceEvidenceFileName);
    const actual = await sha256(packageFile);
    if (actual !== expectedSha256) throw new Error(`reviewed-candidate-sha256-mismatch:${actual}`);
    const evidence = JSON.parse(await readFile(evidenceFile, 'utf8'));
    if (evidence.channel !== 'mas' || evidence.arch !== 'universal') throw new Error('reviewed-candidate-channel-invalid');
    if (evidence.packaging !== 'passed') throw new Error('reviewed-candidate-packaging-not-passed');
    if (evidence.dirty !== false) throw new Error('reviewed-candidate-built-from-dirty-tree');
    if (evidence.sha256 !== actual) throw new Error('reviewed-candidate-evidence-hash-mismatch');
    if (expectedBundleId && evidence.identity !== expectedBundleId) throw new Error('reviewed-candidate-bundle-id-mismatch');
    for (const key of notRunKeys) {
        if (evidence[key] !== 'not-run') throw new Error(`reviewed-candidate-${key}-already-recorded`);
    }
    if (evidence.releaseReady !== false) throw new Error('reviewed-candidate-release-ready-must-stay-false');
    return { evidence, actual };
};

export const altoolProductErrors = (document) => {
    const errors = Array.isArray(document?.productErrors)
        ? document.productErrors
        : Array.isArray(document?.['product-errors']) ? document['product-errors'] : [];
    return errors.map((error) => ({ code: error?.code ?? 'unknown', message: error?.message ?? 'unspecified' }));
};

export const uploadEvidence = ({ source, sourceRunId, uploadRunId, artifactName, repository }) => {
    const base = `https://github.com/${repository}/actions/runs/`;
    return {
        schemaVersion: 1,
        channel: 'mas',
        arch: 'universal',
        sourceCommit: source.commit,
        sourceRunId: String(sourceRunId),
        sourceRunUrl: `${base}${sourceRunId}`,
        uploadRunUrl: `${base}${uploadRunId}`,
        artifactName,
        file: source.file,
        sha256: source.sha256,
        identity: source.identity,
        buildNumber: String(source.version),
        method: 'xcrun altool',
        validation: 'passed',
        storeUpload: 'passed',
        storeProcessing: 'not-run',
        storeReview: 'not-run',
        releaseReady: false,
    };
};

const listFiles = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true, recursive: true });
    return entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
};

// Credentials are ASCII, so a raw byte search is both exact and safe for binaries.
export const credentialValues = (environment = process.env) => [
    environment.APPLE_ID,
    environment.APPLE_APP_SPECIFIC_PASSWORD,
].filter((value) => typeof value === 'string' && value.length > 0);

export const scanForCredentials = async ({ output, values }) => {
    const offenders = [];
    for (const file of await listFiles(output)) {
        const contents = await readFile(file);
        if (values.some((value) => contents.includes(Buffer.from(value, 'utf8')))) offenders.push(path.basename(file));
    }
    return offenders;
};

export const redactCredentials = async ({ output, values }) => {
    const redacted = [];
    for (const file of await listFiles(output)) {
        const contents = await readFile(file);
        if (contents.includes(0)) continue; // never rewrite binary payloads
        let text = contents.toString('utf8');
        const original = text;
        for (const value of values) text = text.split(value).join('[redacted]');
        if (text !== original) {
            await writeFile(file, text);
            redacted.push(path.basename(file));
        }
    }
    return redacted;
};

const requiredOption = (values, name) => {
    const value = values[name];
    if (!value) throw new Error(`missing-option:${name}`);
    return value;
};

const run = async (command, values) => {
    const output = values.output ? path.resolve(values.output) : process.cwd();
    if (command === 'verify') {
        const { evidence, actual } = await assertReviewedCandidate({
            output,
            expectedSha256: requiredOption(values, 'expected-sha256'),
            expectedBundleId: values['expected-bundle-id'],
        });
        process.stdout.write(`reviewed candidate ${evidence.file} sha256=${actual} build=${evidence.version}\n`);
        return;
    }
    if (command === 'altool-result') {
        const phase = requiredOption(values, 'phase');
        const document = JSON.parse(await readFile(requiredOption(values, 'file'), 'utf8'));
        const errors = altoolProductErrors(document);
        for (const error of errors) process.stdout.write(`::error::altool ${phase} ${error.code}: ${error.message}\n`);
        if (errors.length) throw new Error(`altool-${phase}-rejected`);
        process.stdout.write(`altool ${phase}: ${document['success-message'] ?? 'no product errors reported'}\n`);
        return;
    }
    if (command === 'redact' || command === 'scan') {
        const credentials = credentialValues();
        if (command === 'redact') {
            for (const file of await redactCredentials({ output, values: credentials })) {
                process.stdout.write(`redacted credential material from ${file}\n`);
            }
            return;
        }
        const offenders = await scanForCredentials({ output, values: credentials });
        if (offenders.length) throw new Error(`credential-material-present:${offenders.join(',')}`);
        process.stdout.write('credential scan: no credential material in evidence\n');
        return;
    }
    if (command === 'record') {
        const source = JSON.parse(await readFile(path.join(output, sourceEvidenceFileName), 'utf8'));
        const document = uploadEvidence({
            source,
            sourceRunId: requiredOption(values, 'source-run-id'),
            uploadRunId: requiredOption(values, 'upload-run-id'),
            artifactName: requiredOption(values, 'artifact-name'),
            repository: requiredOption(values, 'repository'),
        });
        await writeFile(path.join(output, uploadEvidenceFileName), `${JSON.stringify(document, null, 2)}\n`);
        process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
        return;
    }
    throw new Error(`unknown-command:${command}`);
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    try {
        const { values, positionals } = parseArgs({
            args: process.argv.slice(2),
            options: {
                output: { type: 'string' },
                'expected-sha256': { type: 'string' },
                'expected-bundle-id': { type: 'string' },
                'source-run-id': { type: 'string' },
                'upload-run-id': { type: 'string' },
                'artifact-name': { type: 'string' },
                repository: { type: 'string' },
                file: { type: 'string' },
                phase: { type: 'string' },
            },
            allowPositionals: true,
            strict: true,
        });
        const command = positionals[0];
        if (!command) throw new Error('missing-command');
        if (!values.output) values.output = process.env[uploadDirectoryVariable] ?? process.cwd();
        await run(command, values);
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}
