import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { error as webdriverError } from 'selenium-webdriver';
import { testDriverBuildEnvironment, resolveTestDriverCli } from '../../scripts/build-desktop-test-driver.mjs';
import { createDesktopSession } from '../../scripts/desktop-process-tree.mjs';
import { existsSync } from 'node:fs';

describe('runner-only desktop build', () => {
    it('waits through embedded window startup before using the one successful session', async () => {
        const session = {};
        const createSession = vi.fn()
            .mockRejectedValueOnce(new webdriverError.NoSuchWindowError())
            .mockRejectedValueOnce(new webdriverError.NoSuchWindowError())
            .mockResolvedValue(session);
        await expect(createDesktopSession({ createSession, processHandle: { exitCode: null, signalCode: null }, embedded: true })).resolves.toBe(session);
        expect(createSession).toHaveBeenCalledTimes(3);
    });
    it.each([false, true])('keeps startup attempts bounded (embedded=%s)', async (embedded) => {
        const failure = new webdriverError.NoSuchWindowError();
        const createSession = vi.fn().mockRejectedValue(failure);
        await expect(createDesktopSession({ createSession, processHandle: { exitCode: null, signalCode: null }, embedded })).rejects.toBe(failure);
        expect(createSession).toHaveBeenCalledTimes(embedded ? 3 : 1);
    });
    it('does not retry a different session failure', async () => {
        const failure = new webdriverError.SessionNotCreatedError('invalid capabilities');
        const createSession = vi.fn().mockRejectedValue(failure);
        await expect(createDesktopSession({ createSession, processHandle: { exitCode: null, signalCode: null }, embedded: true })).rejects.toBe(failure);
        expect(createSession).toHaveBeenCalledTimes(1);
    });
    it.each([{ exitCode: 1, signalCode: null }, { exitCode: null, signalCode: 'SIGTERM' }])('stops when the application exits during startup: %j', async (exited) => {
        const processHandle = { exitCode: null, signalCode: null };
        const createSession = vi.fn(async () => {
            Object.assign(processHandle, exited);
            throw new webdriverError.NoSuchWindowError();
        });
        await expect(createDesktopSession({ createSession, processHandle, embedded: true })).rejects.toThrow('exited-before-session');
        expect(createSession).toHaveBeenCalledTimes(1);
    });
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
