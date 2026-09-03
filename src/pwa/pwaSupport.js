const isIosDevice = ({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) => (
    /iPad|iPhone|iPod/i.test(userAgent)
    || (platform === 'MacIntel' && Number(maxTouchPoints) > 1)
);

export const getInstallMode = ({
    standalone = false,
    hasPrompt = false,
    userAgent = '',
    platform = '',
    maxTouchPoints = 0,
} = {}) => {
    if (standalone) return 'installed';
    if (hasPrompt) return 'prompt';
    if (isIosDevice({ userAgent, platform, maxTouchPoints })) return 'ios-manual';
    return 'none';
};

export const getUpdateBlockReason = (stores) => {
    if (stores?.workspace?.busy
        || stores?.batch?.isRunning
        || stores?.exportService?.isBusy
        || Number(stores?.renderTaskTracker?.size) > 0) {
        return 'busy';
    }
    return stores?.workspace?.isDirty ? 'dirty' : null;
};

export const isStandaloneDisplay = ({ matchMedia, navigator } = globalThis) => (
    Boolean(matchMedia?.('(display-mode: standalone)')?.matches)
    || navigator?.standalone === true
);

export const waitForActiveServiceWorker = async (registration) => {
    const worker = registration?.active;
    if (!worker) return false;
    if (worker.state === 'activated') return true;
    return new Promise((resolve) => {
        const handleState = () => {
            if (worker.state === 'activated') {
                worker.removeEventListener?.('statechange', handleState);
                resolve(true);
            } else if (worker.state === 'redundant') {
                worker.removeEventListener?.('statechange', handleState);
                resolve(false);
            }
        };
        worker.addEventListener?.('statechange', handleState);
        handleState();
    });
};
