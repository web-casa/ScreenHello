import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.SCREENHELLO_CONSUMER_PORT || 4174);
const baseURL = `http://127.0.0.1:${port}`;
const isPreview = process.env.SCREENHELLO_CONSUMER_MODE === 'preview';

export default defineConfig({
    testDir: '.',
    testMatch: 'consumer.spec.js',
    outputDir: '../../artifacts/consumer-playwright',
    reporter: 'list',
    use: {
        ...devices['Desktop Chrome'],
        baseURL,
        locale: 'zh-CN',
        timezoneId: 'UTC',
    },
    webServer: {
        // tests/consumer 现在是独立 package；Playwright webServer 以该目录为 cwd。
        command: `pnpm exec vite ${isPreview ? 'preview ' : ''}--config vite.config.js --host 127.0.0.1 --port ${port} --strictPort`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
    },
});
