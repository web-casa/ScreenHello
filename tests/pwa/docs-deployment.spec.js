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
    await page.getByRole('button', { name: /Choose a language/ }).click();
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

test('production _headers enforces single CSP on editor and docs routes with zero runtime violations', async ({ page, baseURL }) => {
    const violations = [];
    await page.addInitScript(() => {
        window.__cspViolations = [];
        window.addEventListener('securitypolicyviolation', (event) => {
            window.__cspViolations.push({
                directive: event.violatedDirective,
                blockedURI: event.blockedURI,
            });
        });
    });

    const rootResponse = await page.goto(baseURL);
    expect(rootResponse?.status()).toBe(200);
    const rootCsp = rootResponse?.headers()['content-security-policy'] || '';
    expect(rootCsp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(rootCsp).toContain("media-src 'self' blob:");
    expect(rootCsp).toContain("frame-ancestors 'none'");

    await expect(page.locator('.shoteasy-app')).toBeVisible();
    await page.getByRole('button', { name: '试用示例', exact: true }).click();
    await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();
    violations.push(...await page.evaluate(() => window.__cspViolations));
    expect(violations).toEqual([]);

    const docsResponse = await page.goto(new URL('docs/en/beautify/', baseURL).href);
    expect(docsResponse?.status()).toBe(200);
    const docsCsp = docsResponse?.headers()['content-security-policy'] || '';
    expect(docsCsp).toContain("default-src 'none'");
    expect(docsCsp).toContain("script-src 'self' 'sha256-");
    expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
});
