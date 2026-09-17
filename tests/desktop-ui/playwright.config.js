import { defineConfig } from '@playwright/test';

const port = Number(process.env.SCREENHELLO_DESKTOP_UI_PORT || 1432);
export default defineConfig({
    testDir: '.',
    testMatch: '*.spec.js',
    outputDir: '../../artifacts/desktop-ui',
    timeout: 60_000,
    workers: 1,
    use: {
        baseURL: `http://127.0.0.1:${port}`,
        locale: 'zh-CN',
        viewport: { width: 1280, height: 800 },
        reducedMotion: 'reduce',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    projects: ['chromium', 'firefox', 'webkit'].map(browserName => ({ name: browserName, use: { browserName } })),
    webServer: {
        command: `pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
        cwd: '../..',
        env: { ...process.env, SCREENHELLO_TARGET: 'desktop' },
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: false,
    },
});
