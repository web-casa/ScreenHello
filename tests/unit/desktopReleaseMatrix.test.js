import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { candidateTargets } from '../../scripts/audit-desktop-release-contract.mjs';
import { desktopWorkflowMatrix } from '../../scripts/desktop-release-matrix.mjs';

const matrix = JSON.parse(await readFile(new URL('../../config/desktop-release-matrix.json', import.meta.url), 'utf8'));

describe('desktop release workflow matrix', () => {
    it('uses all six native candidates for an explicit full gate', () => {
        expect(desktopWorkflowMatrix(matrix)).toEqual({
            include: [
                { target: 'linux-x64', runner: 'ubuntu-22.04', platform: 'linux', 'rust-target': 'x86_64-unknown-linux-gnu', bundle: 'deb' },
                { target: 'linux-arm64', runner: 'ubuntu-22.04-arm', platform: 'linux', 'rust-target': 'aarch64-unknown-linux-gnu', bundle: 'deb' },
                { target: 'macos-x64', runner: 'macos-15-intel', platform: 'macos', 'rust-target': 'x86_64-apple-darwin', bundle: 'dmg' },
                { target: 'macos-arm64', runner: 'macos-14', platform: 'macos', 'rust-target': 'aarch64-apple-darwin', bundle: 'dmg' },
                { target: 'windows-x64', runner: 'windows-2025', platform: 'windows', 'rust-target': 'x86_64-pc-windows-msvc', bundle: 'nsis' },
                { target: 'windows-arm64', runner: 'windows-11-arm', platform: 'windows', 'rust-target': 'aarch64-pc-windows-msvc', bundle: 'nsis' },
            ],
        });
    });

    it('keeps pull requests on the bounded three-target gate', () => {
        const prTargets = candidateTargets(matrix, 'pr').map(({ id }) => id);
        expect(prTargets).toEqual(['linux-x64', 'macos-arm64', 'windows-x64']);
        expect(desktopWorkflowMatrix(matrix, 'pr').include.map(({ target }) => target)).toEqual(prTargets);
    });

    it('fails closed for an unknown matrix scope', () => {
        expect(() => candidateTargets(matrix, 'release')).toThrowError('desktop-release-candidate-targets-invalid:release');
    });
});
