import { describe, expect, it, vi } from 'vitest';
import { createSessionWithRetry } from '../../scripts/webdriver-session-retry.mjs';

describe('WebDriver session retry', () => {
    it('retries transient failures without replacing the session factory', async () => {
        const expectedSession = { id: 'safari-session' };
        const createSession = vi.fn()
            .mockRejectedValueOnce(new Error('Safari session timed out'))
            .mockRejectedValueOnce(new Error('Safari session timed out'))
            .mockResolvedValueOnce(expectedSession);
        const failures = [];

        const result = await createSessionWithRetry({
            createSession,
            maxAttempts: 10,
            shouldRetry: (error) => error.message.includes('timed out'),
            onAttemptFailed: ({ attempt, willRetry }) => failures.push({ attempt, willRetry }),
        });

        expect(result).toEqual({ attempts: 3, session: expectedSession });
        expect(createSession).toHaveBeenCalledTimes(3);
        expect(failures).toEqual([
            { attempt: 1, willRetry: true },
            { attempt: 2, willRetry: true },
        ]);
    });

    it('does not retry non-transient failures', async () => {
        const failure = new Error('invalid capabilities');
        const createSession = vi.fn().mockRejectedValue(failure);

        await expect(createSessionWithRetry({
            createSession,
            maxAttempts: 10,
            shouldRetry: () => false,
        })).rejects.toBe(failure);
        expect(createSession).toHaveBeenCalledOnce();
    });

    it('validates retry bounds', async () => {
        await expect(createSessionWithRetry({
            createSession: vi.fn(),
            maxAttempts: 0,
        })).rejects.toThrow('maxAttempts must be a positive integer');
    });
});
