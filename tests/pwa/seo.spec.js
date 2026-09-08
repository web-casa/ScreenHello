import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SITE_LANGUAGES, SITE_TOPICS, loadSiteContent } from '../../site/site.mjs';

const catalog = loadSiteContent();

test('production SEO: all 42 pages have readable HTML, self canonicals and language alternatives', async ({ request, baseURL }) => {
    const base = new URL(baseURL).pathname;
    for (const slug of SITE_LANGUAGES) for (const topic of SITE_TOPICS) {
        const route = `${slug}/${topic ? `${topic}/` : ''}`;
        const response = await request.get(new URL(route, baseURL).href);
        expect(response.status(), route).toBe(200);
        const html = await response.text();
        expect(html).toContain(`<html lang="${catalog[slug].lang}">`);
        expect(html).toContain(`rel="canonical" href="https://screenhello.com${base}${route}"`);
        expect(html.match(/rel="alternate"/g)).toHaveLength(8);
        expect(html).not.toMatch(/<script[^>]+src=|\/src\/main|googletagmanager/);
    }
    const sitemap = await request.get(new URL('sitemap.xml', baseURL).href);
    expect(sitemap.headers()['content-type']).toContain('xml');
    expect((await sitemap.text()).match(/<loc>/g)).toHaveLength(43);
    const missing = await request.get(new URL('does-not-exist/', baseURL).href);
    expect(missing.status()).toBe(404);
    expect(await missing.text()).toContain('Page not found');
    const redirect = await request.get(new URL('en/guide', baseURL).href, { maxRedirects: 0 });
    expect(redirect.status()).toBe(301);
    expect(redirect.headers().location).toBe(`${base}en/guide/`);
    for (const unknown of ['missing.html', 'site/missing.png', 'assets/missing.js']) {
        expect((await request.get(new URL(unknown, baseURL).href)).status()).toBe(404);
    }
});

test.describe('content without JavaScript', () => {
    test.use({ javaScriptEnabled: false });
    for (const slug of SITE_LANGUAGES) {
        test(`production SEO: ${slug} content and language navigation work without JavaScript`, async ({ page, baseURL }) => {
            const scripts = [];
            page.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
            await page.goto(`${slug}/`);
            await expect(page.getByRole('heading', { level: 1 })).toHaveText(catalog[slug].pages[0].title);
            await expect(page.locator('main')).toContainText(catalog[slug].pages[0].sections[0][1]);
            const english = page.getByRole('navigation', { name: catalog[slug].languages }).getByRole('link', { name: 'English', exact: true });
            await english.click();
            await expect(page).toHaveURL(new URL('en/', baseURL).href);
            expect(scripts).toEqual([]);
        });
    }
});

for (const colorScheme of ['light', 'dark']) for (const width of [390, 1280]) {
    test(`production SEO: accessible layout ${width} ${colorScheme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme });
        await page.goto('zh-cn/');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        expect(result.violations).toEqual([]);
        await page.screenshot({ path: test.info().outputPath(`seo-${width}-${colorScheme}.png`), fullPage: true });
    });
}

test('production SEO: an installed worker does not turn help or a 404 into the editor', async ({ page, context }) => {
    await page.goto('./');
    await expect(page.getByText('离线已就绪', { exact: true })).toBeVisible();
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await page.goto('en/guide/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(catalog.en.pages[4].title);
    await expect(page.locator('.shoteasy-app')).toHaveCount(0);
    const missing = await page.goto('missing-product-page/');
    expect(missing.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
    await context.setOffline(true);
    try {
        await page.goto('./');
        await expect(page.getByRole('button', { name: '选择图片', exact: true })).toBeVisible();
    } finally { await context.setOffline(false); }
});
