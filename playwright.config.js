import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.SCREENHELLO_E2E_PORT || 4173);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
    testDir: './tests/e2e',
    outputDir: './artifacts/playwright',
    fullyParallel: true,
    expect: {
        timeout: 15_000,
    },
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 1 : 3,
    reporter: [
        ['list'],
        ['html', { outputFolder: 'artifacts/playwright-report', open: 'never' }],
    ],
    use: {
        baseURL,
        locale: 'zh-CN',
        timezoneId: 'UTC',
        colorScheme: 'dark',
        contextOptions: { reducedMotion: 'reduce' },
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ],
    webServer: {
        command: `pnpm dev --host 127.0.0.1 --port ${port} --strictPort`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
    },
});
