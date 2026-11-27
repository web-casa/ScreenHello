import { defineConfig, devices } from '@playwright/test';
import { e2eTestGroups } from './tests/e2e/testGroups.js';

const port = Number(process.env.SCREENHELLO_E2E_PORT || 4173);
const baseURL = `http://127.0.0.1:${port}`;
const browserTargets = [
    ['chromium', devices['Desktop Chrome']],
    ['firefox', devices['Desktop Firefox']],
    ['webkit', devices['Desktop Safari']],
];
const projects = browserTargets.flatMap(([browser, use]) => e2eTestGroups.map((group) => ({
    // Preserve the historical Chromium project name because its reviewed visual
    // snapshots resolve from that name. Other groups deliberately use a distinct
    // project hash, which gives each one a fresh browser worker while workers=1.
    name: group.id === 'editor' ? browser : `${browser}-${group.id}`,
    use: { ...use },
    testMatch: group.files.map((file) => `**/${file}`),
})));

export default defineConfig({
    testDir: './tests/e2e',
    outputDir: './artifacts/playwright',
    fullyParallel: true,
    expect: {
        timeout: 15_000,
    },
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    // Keep network execution serial. File groups create a fresh browser worker at
    // each project boundary, so resource-heavy editor cases cannot accumulate in
    // one long-lived browser process.
    workers: 1,
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
    projects,
    webServer: {
        command: `pnpm dev --host 127.0.0.1 --port ${port} --strictPort`,
        // Keep this portable across Linux, macOS, and Windows runners instead
        // of encoding an inline shell assignment in `command`.
        env: { ...process.env, SCREENHELLO_E2E: '1' },
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
    },
});
