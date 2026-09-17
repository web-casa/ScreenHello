import { expect, test } from '@playwright/test';

test('built documentation keeps assets and language navigation inside the deployment base', async ({ page, baseURL, request }) => {
    const base = new URL(baseURL).pathname;
    const errors = [];
    const failedResources = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
        if (response.status() >= 400) failedResources.push(response.url());
    });
    await page.goto(new URL('docs/en/beautify/', baseURL).href);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.locator('.sh-figure').scrollIntoViewIfNeeded();
    for (const image of await page.locator('.sh-figure img').all()) {
        await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
        expect(await image.getAttribute('src')).toMatch(new RegExp(`^${base}site/`));
    }
    await page.getByRole('button', { name: 'Choose a language', exact: true }).click();
    await page.getByRole('button', { name: 'Deutsch', exact: true }).click();
    await expect(page).toHaveURL(new URL('docs/de/beautify/', baseURL).href);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.locator('article').getByRole('link', { name: /Nächste Seite/ }).click();
    await expect(page).toHaveURL(new URL('docs/de/frames/', baseURL).href);
    expect(errors).toEqual([]);
    expect(failedResources).toEqual([]);
    const redirect = await request.get(new URL('de/guide/', baseURL).href, { maxRedirects: 0 });
    expect(redirect.status()).toBe(301);
    expect(redirect.headers().location).toBe(`${base}docs/de/guide/`);
});
