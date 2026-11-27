import { afterEach, describe, expect, it, vi } from 'vitest';

const originalE2eMode = process.env.SCREENHELLO_E2E;

afterEach(() => {
    vi.resetModules();
    if (originalE2eMode === undefined) delete process.env.SCREENHELLO_E2E;
    else process.env.SCREENHELLO_E2E = originalE2eMode;
});

describe('E2E Vite server boundary', () => {
    it('starts Playwright with filesystem watching disabled without changing ordinary dev watching', async () => {
        process.env.SCREENHELLO_E2E = '1';
        const e2eConfig = (await import('../../vite.config.js')).default;
        expect(e2eConfig.server.watch).toBeNull();

        vi.resetModules();
        delete process.env.SCREENHELLO_E2E;
        const devConfig = (await import('../../vite.config.js')).default;
        expect(devConfig.server.watch).toEqual(expect.objectContaining({ ignored: expect.any(Array) }));

        const playwrightConfig = (await import('../../playwright.config.js')).default;
        expect(playwrightConfig.webServer.env.SCREENHELLO_E2E).toBe('1');
        expect(playwrightConfig.workers).toBe(1);
    });
});
