import { defineConfig } from '@playwright/test';
import release from './playwright.config.js';

// Deliberately opt-in: do not add six PC encodes to the default release smoke.
export default defineConfig(release, {
    testMatch: 'continuous-avif.spec.js',
    timeout: 900_000,
    retries: 0,
    repeatEach: 1,
    workers: 1,
    maxFailures: 1,
});
