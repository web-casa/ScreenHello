import { afterEach, describe, expect, it, vi } from 'vitest';
import process from 'node:process';
import path from 'node:path';

const mocks = vi.hoisted(() => ({ execFile: vi.fn(), writeFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));
vi.mock('node:fs/promises', () => ({
    mkdir: vi.fn(),
    readFile: vi.fn(async () => JSON.stringify({ version: '1.0.4' })),
    writeFile: mocks.writeFile,
}));

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetAllMocks();
    vi.resetModules();
});

describe('desktop SBOM subprocesses', () => {
    it('runs the CLI as one Node argument even when its path contains spaces', async () => {
        const cli = path.resolve('package manager', 'pnpm.cjs');
        vi.stubEnv('npm_execpath', cli);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        mocks.execFile.mockImplementation((command, args, options, callback) => {
            const output = command === process.execPath
                ? { MIT: [{ name: '@example/library', versions: ['1.2.3'], license: 'MIT' }] }
                : { packages: [{ id: 'app', name: 'screenhello-desktop', version: '0.1.0', license: 'MIT' }], resolve: { root: 'app' } };
            // The real execFile has a custom promisifier returning this object.
            callback(null, { stdout: JSON.stringify(output), stderr: '' });
        });
        await import('../../scripts/generate-desktop-sbom.mjs');
        expect(mocks.execFile.mock.calls[0].slice(0, 2)).toEqual([
            process.execPath, [cli, 'licenses', 'list', '--json', '--long'],
        ]);
        expect(mocks.execFile.mock.calls[0][2].shell).toBeUndefined();
        expect(mocks.writeFile).toHaveBeenCalledTimes(2);
        const bom = JSON.parse(mocks.writeFile.mock.calls[0][1]);
        expect(bom.components[0].purl).toBe('pkg:npm/%40example/library@1.2.3');
    });

    it('does not create evidence when the package manager fails', async () => {
        vi.stubEnv('npm_execpath', path.resolve('pnpm.cjs'));
        mocks.execFile.mockImplementation((command, args, options, callback) => {
            callback(new Error('license-command-failed'));
        });
        await expect(import('../../scripts/generate-desktop-sbom.mjs')).rejects.toThrow('license-command-failed');
        expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    it('explains the required package-script entrypoint when no CLI is supplied', async () => {
        vi.stubEnv('npm_execpath', '');
        await expect(import('../../scripts/generate-desktop-sbom.mjs')).rejects.toThrow('desktop-sbom-run-via-pnpm-desktop-sbom');
        expect(mocks.execFile).not.toHaveBeenCalled();
    });
});
