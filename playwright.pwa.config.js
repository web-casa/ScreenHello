import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.SCREENHELLO_PWA_PORT || 4195);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
    testDir: './tests/pwa',
    outputDir: './artifacts/pwa-playwright',
    fullyParallel: false,
    workers: 1,
    expect: { timeout: 20_000 },
    reporter: 'list',
    use: {
        ...devices['Desktop Chrome'],
        baseURL,
        locale: 'zh-CN',
        timezoneId: 'UTC',
        colorScheme: 'dark',
        contextOptions: { reducedMotion: 'reduce' },
        serviceWorkers: 'allow',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },
    webServer: {
        command: `pnpm preview --host 127.0.0.1 --port ${port} --strictPort`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
    },
});
