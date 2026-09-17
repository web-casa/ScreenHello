import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
    linuxDebRepositoryPackageTargets,
    linuxDebRepositoryWorkflowMatrix,
} from '../../scripts/linux-deb-repository-matrix.mjs';

const matrix = JSON.parse(await readFile(new URL('../../config/desktop-release-matrix.json', import.meta.url), 'utf8'));

describe('Linux DEB repository candidate matrix', () => {
    it('selects the two native DEB targets in their declared order', () => {
        expect(linuxDebRepositoryPackageTargets(matrix).map(({ id }) => id)).toEqual([
            'linux-x64',
            'linux-arm64',
        ]);
        expect(linuxDebRepositoryWorkflowMatrix(matrix)).toEqual({
            include: [
                {
                    target: 'linux-x64',
                    runner: 'ubuntu-24.04',
                    'rust-target': 'x86_64-unknown-linux-gnu',
                    'package-architecture': 'amd64',
                },
                {
                    target: 'linux-arm64',
                    runner: 'ubuntu-24.04-arm',
                    'rust-target': 'aarch64-unknown-linux-gnu',
                    'package-architecture': 'arm64',
                },
            ],
        });
    });

    it('fails closed when the candidate target order changes', () => {
        const invalid = structuredClone(matrix);
        invalid.linuxDebRepositorySigningCandidate.targets.reverse();
        expect(() => linuxDebRepositoryPackageTargets(invalid))
            .toThrowError('linux-deb-repository-targets-invalid');
    });
});
