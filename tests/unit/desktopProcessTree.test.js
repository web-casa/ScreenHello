import { describe, expect, it, vi } from 'vitest';
import { stopDesktopAutomation } from '../../scripts/desktop-process-tree.mjs';

const processError = (code) => Object.assign(new Error(code), { code });

const createProcessHandle = () => ({
    pid: 4_242,
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => true),
    stdout: { destroy: vi.fn() },
    stderr: { destroy: vi.fn() },
});

const createClock = (onWait = () => {}) => {
    let time = 0;
    return {
        now: () => time,
        wait: vi.fn(async (duration) => {
            time += duration;
            onWait(time);
        }),
    };
};

describe('desktop runtime process cleanup', () => {
    it.each(['darwin', 'win32'])('waits for a directly owned %s child to exit', async (platform) => {
        const processHandle = createProcessHandle();
        const clock = createClock(() => { processHandle.signalCode = 'SIGTERM'; });

        await stopDesktopAutomation(processHandle, {
            platform,
            useProcessGroup: false,
            ...clock,
        });

        expect(processHandle.kill).toHaveBeenCalledTimes(1);
        expect(processHandle.kill).toHaveBeenCalledWith('SIGTERM');
        expect(processHandle.stdout.destroy).toHaveBeenCalledOnce();
        expect(processHandle.stderr.destroy).toHaveBeenCalledOnce();
    });

    it('escalates a directly owned child and verifies the forced exit', async () => {
        const processHandle = createProcessHandle();
        const clock = createClock((time) => {
            if (time > 100) processHandle.signalCode = 'SIGKILL';
        });

        await stopDesktopAutomation(processHandle, {
            platform: 'darwin',
            useProcessGroup: false,
            shutdownGraceMs: 100,
            forceShutdownGraceMs: 100,
            ...clock,
        });

        expect(processHandle.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    });

    it('fails when a direct termination signal is not delivered', async () => {
        const processHandle = createProcessHandle();
        processHandle.kill.mockReturnValue(false);

        await expect(stopDesktopAutomation(processHandle, {
            platform: 'win32',
            useProcessGroup: false,
        })).rejects.toThrow('desktop-automation-term-signal-failed');
    });

    it('fails when a directly owned child survives forced termination', async () => {
        const processHandle = createProcessHandle();
        const clock = createClock();

        await expect(stopDesktopAutomation(processHandle, {
            platform: 'darwin',
            useProcessGroup: false,
            shutdownGraceMs: 50,
            forceShutdownGraceMs: 50,
            ...clock,
        })).rejects.toThrow('desktop-automation-cleanup-timeout');
        expect(processHandle.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    });

    it('cleans a Linux process group while its owner remains identifiable', async () => {
        const processHandle = createProcessHandle();
        let groupRunning = true;
        const sendSignal = vi.fn((_pid, signal) => {
            if (signal === 'SIGTERM') return;
            if (signal === 0 && groupRunning) return;
            throw processError('ESRCH');
        });
        const clock = createClock(() => { groupRunning = false; });

        await stopDesktopAutomation(processHandle, {
            platform: 'linux',
            useProcessGroup: true,
            sendSignal,
            ...clock,
        });

        expect(sendSignal).toHaveBeenCalledWith(-processHandle.pid, 'SIGTERM');
        expect(sendSignal).not.toHaveBeenCalledWith(-processHandle.pid, 'SIGKILL');
    });

    it('escalates a live Linux process group and verifies it disappears', async () => {
        const processHandle = createProcessHandle();
        let groupRunning = true;
        let killSent = false;
        const sendSignal = vi.fn((_pid, signal) => {
            if (signal === 'SIGTERM') return;
            if (signal === 'SIGKILL') {
                killSent = true;
                return;
            }
            if (signal === 0 && groupRunning) return;
            throw processError('ESRCH');
        });
        const clock = createClock((time) => {
            if (killSent && time > 100) groupRunning = false;
        });

        await stopDesktopAutomation(processHandle, {
            platform: 'linux',
            useProcessGroup: true,
            sendSignal,
            shutdownGraceMs: 100,
            forceShutdownGraceMs: 100,
            ...clock,
        });

        expect(sendSignal).toHaveBeenCalledWith(-processHandle.pid, 'SIGTERM');
        expect(sendSignal).toHaveBeenCalledWith(-processHandle.pid, 'SIGKILL');
        expect(processHandle.stdout.destroy).toHaveBeenCalledOnce();
        expect(processHandle.stderr.destroy).toHaveBeenCalledOnce();
    });

    it('never treats a process-group permission error as successful cleanup', async () => {
        const processHandle = createProcessHandle();
        const sendSignal = vi.fn((_pid, signal) => {
            if (signal === 'SIGTERM') return;
            throw processError('EPERM');
        });

        await expect(stopDesktopAutomation(processHandle, {
            platform: 'linux',
            useProcessGroup: true,
            sendSignal,
        })).rejects.toThrow('EPERM');
    });

    it('does not signal a process group after its ownership anchor has exited', async () => {
        const processHandle = createProcessHandle();
        processHandle.signalCode = 'SIGTERM';
        const sendSignal = vi.fn();

        await expect(stopDesktopAutomation(processHandle, {
            platform: 'linux',
            useProcessGroup: true,
            sendSignal,
        })).rejects.toThrow('desktop-automation-process-group-owner-exited');
        expect(sendSignal).not.toHaveBeenCalled();
    });
});
