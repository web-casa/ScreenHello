import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const expectedTargetIds = Object.freeze(['linux-x64', 'linux-arm64']);

const hasExactValues = (actual, expected) => (
    Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index])
);

export const linuxDebRepositoryPackageTargets = (matrix) => {
    const targetIds = matrix?.linuxDebRepositorySigningCandidate?.targets;
    const targets = matrix?.targets;
    if (!hasExactValues(targetIds, expectedTargetIds) || !Array.isArray(targets)) {
        throw new Error('linux-deb-repository-targets-invalid');
    }

    return targetIds.map((id) => {
        const target = targets.find((candidate) => candidate?.id === id);
        if (!target
            || target.platform !== 'linux'
            || target.bundleKind !== 'deb'
            || !['amd64', 'arm64'].includes(target.packageArchitecture)) {
            throw new Error(`linux-deb-repository-target-invalid:${id}`);
        }
        return target;
    });
};

export const linuxDebRepositoryWorkflowMatrix = (matrix) => ({
    include: linuxDebRepositoryPackageTargets(matrix).map((target) => ({
        target: target.id,
        runner: target.runner,
        'rust-target': target.rustTarget,
        'package-architecture': target.packageArchitecture,
    })),
});

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const matrix = JSON.parse(await readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8'));
    console.log(JSON.stringify(linuxDebRepositoryWorkflowMatrix(matrix)));
}
