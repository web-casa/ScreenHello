import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.SCREENHELLO_RELEASE_PORT || 4196);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
    testDir: '.',
    testMatch: 'web-release.spec.js',
    outputDir: '../../artifacts/release/playwright',
    fullyParallel: false,
    timeout: 90_000,
    expect: { timeout: 20_000 },
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: [
        ['list'],
        ['html', { outputFolder: '../../artifacts/release/playwright-report', open: 'never' }],
    ],
    use: {
        baseURL,
        locale: 'zh-CN',
        timezoneId: 'UTC',
        colorScheme: 'dark',
        contextOptions: { reducedMotion: 'reduce' },
        serviceWorkers: 'block',
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
        command: `pnpm preview --host 127.0.0.1 --port ${port} --strictPort`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
    },
});
