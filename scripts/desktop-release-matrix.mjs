import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { candidateTargets } from './audit-desktop-release-contract.mjs';

// Unsigned test evidence is allowed in the source and public export repositories.
// Signed candidate/attestation trust remains private-repository-only elsewhere.
export const desktopGateRepositoryIds = Object.freeze([1353846102, 1353846676]);

const workflowFields = Object.freeze([
    ['target', 'id'],
    ['runner', 'runner'],
    ['platform', 'platform'],
    ['rust-target', 'rustTarget'],
    ['bundle', 'bundleKind'],
]);

export const desktopWorkflowMatrix = (matrix, scope = 'full') => ({
    include: candidateTargets(matrix, scope).map((target) => Object.fromEntries(
        workflowFields.map(([workflowField, targetField]) => [workflowField, target[targetField]]),
    )),
});

const parseScope = (args) => {
    if (args.length !== 2 || args[0] !== '--scope' || !['pr', 'full'].includes(args[1])) {
        throw new Error('desktop-release-matrix-scope-invalid');
    }
    return args[1];
};

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const scope = parseScope(process.argv.slice(2));
    const matrix = JSON.parse(await readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8'));
    console.log(JSON.stringify(desktopWorkflowMatrix(matrix, scope)));
}
