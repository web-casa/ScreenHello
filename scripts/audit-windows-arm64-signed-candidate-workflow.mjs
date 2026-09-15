import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { auditWindowsArm64SignedCandidateWorkflow } from './audit-windows-signed-candidate-workflow.mjs';

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const [matrix, workflow, candidateConfig] = await Promise.all([
        readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8').then(JSON.parse),
        readFile(new URL('../.github/workflows/windows-arm64-signed-candidate.yml', import.meta.url), 'utf8'),
        readFile(new URL('../src-tauri/tauri.windows-arm64-signed-candidate.conf.json', import.meta.url), 'utf8').then(JSON.parse),
    ]);
    const failures = auditWindowsArm64SignedCandidateWorkflow(workflow, matrix, candidateConfig);
    console.log(JSON.stringify({ status: failures.length ? 'failed' : 'passed', failures }, null, 2));
    if (failures.length) process.exitCode = 1;
}
