import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const logo = readFileSync(new URL('../../src/assets/logo.png', import.meta.url));

for (const theme of ['light', 'dark']) {
    test(`new identity loads in the header, welcome view and favicon in ${theme}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto('/');
        await page.waitForFunction(() => Boolean(window.__shoteasyStores));
        await page.evaluate(theme => window.__shoteasyStores.editor.setTheme(theme), theme);
        const images = page.locator('.shoteasy-logo__image, .shoteasy-init-brand img');
        await expect(images).toHaveCount(2);
        for (const image of await images.all()) {
            await expect(image).toBeVisible();
            await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth)).toBe(512);
            const response = await page.request.get(await image.getAttribute('src'));
            expect(response.ok()).toBe(true);
            expect(await response.body()).toEqual(logo);
        }
        await expect(page.locator('link[rel="icon"]')).toHaveCount(2);
        await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'ScreenHello');
        for (const [selector, filename, type] of [
            ['link[rel="icon"][type="image/png"]', 'favicon-96x96.png', 'image/png'],
            ['link[rel="icon"][type="image/svg+xml"]', 'favicon.svg', 'image/svg+xml'],
            ['link[rel="shortcut icon"]', 'favicon.ico', 'image/'],
            ['link[rel="apple-touch-icon"]', 'apple-touch-icon.png', 'image/png'],
        ]) {
            const bytes = readFileSync(new URL(`../../public/${filename}`, import.meta.url));
            const iconURL = await page.locator(selector).getAttribute('href');
            expect(new URL(iconURL, page.url()).searchParams.get('v')).toBe(createHash('sha256').update(bytes).digest('hex').slice(0, 12));
            const response = await page.request.get(iconURL);
            expect(response.headers()['content-type']).toContain(type);
            expect(await response.body()).toEqual(bytes);
        }
        await page.screenshot({ path: testInfo.outputPath(`identity-${theme}.png`) });
        await page.reload();
        await expect(page.locator('link[rel="icon"]')).toHaveCount(2);
    });
}
