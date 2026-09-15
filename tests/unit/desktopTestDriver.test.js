import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { testDriverBuildEnvironment, resolveTestDriverCli } from '../../scripts/build-desktop-test-driver.mjs';
import { existsSync } from 'node:fs';

describe('runner-only desktop build', () => {
    it('resolves the installed CLI without treating node_modules as a source asset', () => {
        expect(path.basename(resolveTestDriverCli())).toBe('tauri.js');
        expect(existsSync(resolveTestDriverCli())).toBe(true);
    });
    it('overrides inherited target and permission without mutating the caller', () => {
        const source = { PATH: 'tools', CARGO_TARGET_DIR: '/production', SCREENHELLO_TEST_DRIVER_BUILD: 'wrong' };
        const result = testDriverBuildEnvironment('/project', source);
        expect(result).toEqual({
            PATH: 'tools',
            CARGO_TARGET_DIR: path.resolve('/project', 'src-tauri/target-test-driver'),
            SCREENHELLO_TEST_DRIVER_BUILD: 'runner-only',
        });
        expect(source.CARGO_TARGET_DIR).toBe('/production');
        expect(result.SCREENHELLO_TEST_DRIVER_RUN).toBeUndefined();
    });
});
