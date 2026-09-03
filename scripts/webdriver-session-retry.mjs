const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const createSessionWithRetry = async ({
    createSession,
    maxAttempts = 1,
    retryDelayMs = 0,
    shouldRetry = () => true,
    onAttemptFailed = () => {},
}) => {
    if (typeof createSession !== 'function') throw new TypeError('createSession must be a function');
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
        throw new RangeError('maxAttempts must be a positive integer');
    }
    if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
        throw new RangeError('retryDelayMs must be a non-negative number');
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return {
                attempts: attempt,
                session: await createSession(attempt),
            };
        } catch (error) {
            const willRetry = attempt < maxAttempts && shouldRetry(error);
            await onAttemptFailed({ attempt, error, willRetry });
            if (!willRetry) throw error;
            if (retryDelayMs > 0) await wait(retryDelayMs);
        }
    }

    throw new Error('Session retry loop ended without a result');
};
