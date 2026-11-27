import { defineConfig, devices } from '@playwright/test';
import { normalizeWebBase } from './config/pwaConfig.js';

const port = Number(process.env.SCREENHELLO_PWA_PORT || 4195);
const base = normalizeWebBase(process.env.SCREENHELLO_BASE_PATH || '/');
const baseURL = `http://127.0.0.1:${port}${base}`;
const outDir = process.env.SCREENHELLO_PWA_OUT_DIR || 'dist';

export default defineConfig({
    testDir: './tests/pwa',
    outputDir: base === '/' ? './artifacts/pwa-playwright' : './artifacts/pwa-subpath-playwright',
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
        command: `pnpm preview --outDir ${JSON.stringify(outDir)} --base ${JSON.stringify(base)} --host 127.0.0.1 --port ${port} --strictPort`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
    },
});
