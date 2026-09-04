import process from 'node:process';

const defaultDelay = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

const isMissingProcess = (error) => error?.code === 'ESRCH';
const hasExited = (processHandle) => (
    processHandle.exitCode !== null || processHandle.signalCode !== null
);

export const stopDesktopAutomation = async (processHandle, options = {}) => {
    const processGroupId = processHandle.pid;
    if (!processGroupId) return;

    const platform = options.platform || process.platform;
    const useProcessGroup = options.useProcessGroup ?? platform !== 'win32';
    const sendSignal = options.sendSignal || process.kill.bind(process);
    const wait = options.wait || defaultDelay;
    const now = options.now || Date.now;
    const shutdownGraceMs = options.shutdownGraceMs ?? 5_000;
    const forceShutdownGraceMs = options.forceShutdownGraceMs ?? 1_000;

    const signalDirectProcess = (signal) => {
        try {
            return processHandle.kill(signal);
        } catch (error) {
            if (isMissingProcess(error)) return false;
            throw error;
        }
    };

    const signalProcessGroup = (signal) => {
        try {
            sendSignal(-processGroupId, signal);
            return true;
        } catch (error) {
            if (isMissingProcess(error)) return false;
            throw error;
        }
    };

    const processGroupIsRunning = () => {
        try {
            sendSignal(-processGroupId, 0);
            return true;
        } catch (error) {
            if (isMissingProcess(error)) return false;
            throw error;
        }
    };

    const waitUntilStopped = async (isRunning, graceMs) => {
        const deadline = now() + graceMs;
        while (isRunning() && now() < deadline) await wait(50);
        return !isRunning();
    };

    try {
        if (!useProcessGroup) {
            if (hasExited(processHandle)) return;
            const termSent = signalDirectProcess('SIGTERM');
            if (!termSent && !hasExited(processHandle)) {
                throw new Error('desktop-automation-term-signal-failed');
            }
            if (await waitUntilStopped(() => !hasExited(processHandle), shutdownGraceMs)) return;

            const killSent = signalDirectProcess('SIGKILL');
            if (!killSent && !hasExited(processHandle)) {
                throw new Error('desktop-automation-kill-signal-failed');
            }
            if (!await waitUntilStopped(() => !hasExited(processHandle), forceShutdownGraceMs)) {
                throw new Error('desktop-automation-cleanup-timeout');
            }
            return;
        }

        if (hasExited(processHandle)) {
            throw new Error('desktop-automation-process-group-owner-exited');
        }
        const termSent = signalProcessGroup('SIGTERM');
        if (!termSent && processGroupIsRunning()) {
            throw new Error('desktop-automation-term-signal-failed');
        }
        if (await waitUntilStopped(processGroupIsRunning, shutdownGraceMs)) return;

        // The original child is the ownership anchor for this dedicated group.
        // Once it has exited, its numeric PGID can be reused, so never signal it again.
        if (hasExited(processHandle)) {
            throw new Error('desktop-automation-process-group-descendants-remain');
        }
        const killSent = signalProcessGroup('SIGKILL');
        if (!killSent && processGroupIsRunning()) {
            throw new Error('desktop-automation-kill-signal-failed');
        }
        if (!await waitUntilStopped(processGroupIsRunning, forceShutdownGraceMs)) {
            throw new Error('desktop-automation-cleanup-timeout');
        }
    } finally {
        processHandle.stdout?.destroy();
        processHandle.stderr?.destroy();
    }
};
