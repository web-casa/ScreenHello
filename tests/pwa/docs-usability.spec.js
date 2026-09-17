import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { loadSiteContent, SITE_LANGUAGES } from '../../site/site.mjs';
const catalog = loadSiteContent();

for (const locale of SITE_LANGUAGES) {
    test(`docs ${locale}: static search, empty feedback, keyboard navigation and editor language`, async ({ page, baseURL }) => {
        const content = catalog[locale];
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const searchRequests = [];
        page.on('request', request => { if (request.url().includes('/api/search')) searchRequests.push(request.url()); });
        await page.goto(new URL(`docs/${locale}/guide/`, baseURL).href);
        await expect(page.locator('.sh-reviewed time')).toHaveAttribute('datetime', content.reviewed);
        const relatedHeading = page.locator('article').getByRole('heading', { name: content.related, exact: true });
        await expect(relatedHeading).toBeVisible();
        await expect(page.locator('article a[href="../beautify/"]')).toHaveCount(1);
        await expect(page.locator('article').getByRole('link', { name: content.open, exact: true }))
            .toHaveAttribute('href', `${new URL(baseURL).pathname}?lang=${content.lang}`);
        await page.locator('[data-search-full]').click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText(content.docsUi.searchHint)).toBeVisible();
        const input = dialog.getByRole('textbox');
        await input.fill('no-such-term-930147');
        await expect(dialog.getByText(content.docsUi['No results found'])).toBeVisible();
        await input.fill('PNG');
        await expect(dialog.getByRole('button', { name: new RegExp(content.pages[3].title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeVisible();
        await input.fill(content.pages[3].title);
        await input.press('Enter');
        await expect(dialog).not.toBeVisible();
        await expect(page).toHaveURL(new URL(`docs/${locale}/compression/`, baseURL).href);
        expect(searchRequests).toEqual([]);
        expect(errors).toEqual([]);
    });
}

for (const width of [390, 1440]) for (const colorScheme of ['light', 'dark']) {
    test(`docs navigation and typography ${width} ${colorScheme}`, async ({ page, baseURL, request }) => {
        await page.setViewportSize({ width, height: 960 });
        await page.emulateMedia({ colorScheme });
        await page.goto(new URL('docs/zh-cn/guide/', baseURL).href);
        await expect(page.locator('.sh-guide-image')).toHaveCount(2);
        for (const img of await page.locator('.sh-guide-image img').all()) {
            const imageUrl = new URL(await img.getAttribute('src'), baseURL).href;
            expect((await request.get(imageUrl)).status()).toBe(200);
            await img.scrollIntoViewIfNeeded();
            await expect.poll(() => img.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
        }
        const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
            h2: parseFloat(getComputedStyle(document.querySelector('article h2')).fontSize),
            p: parseFloat(getComputedStyle(document.querySelector('article p')).fontSize) }));
        expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
        expect(dimensions.h2).toBeGreaterThan(dimensions.p);
        await expect(page.locator('article').getByRole('link', { name: '截图美化 下一篇', exact: true })).toHaveCount(1);
        await page.evaluate(() => scrollTo(0, 0));
        if (width === 390) await page.getByRole('button', { name: /本页目录/ }).click();
        const toc = page.locator(width === 390 ? '[data-toc-popover]' : '#nd-toc');
        await toc.getByRole('link', { name: '3. 检查尺寸并下载 PNG', exact: true }).click();
        await expect(page).toHaveURL(/#3-/);
        const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
        expect(violations).toEqual([]);
        await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
        await page.screenshot({ path: test.info().outputPath(`docs-${width}-${colorScheme}.png`), fullPage: true });
    });
}

test('docs search works under the generated production CSP without network access', async ({ page, baseURL }) => {
    const base = new URL(baseURL).pathname;
    const headers = readFileSync(`${process.env.SCREENHELLO_PWA_OUT_DIR || 'dist'}/_headers`, 'utf8');
    const rule = headers.split('\n\n').find(block => block.startsWith(`${base}docs/*`));
    const csp = rule.split('\n').find(line => line.trim().startsWith('Content-Security-Policy:')).trim().slice('Content-Security-Policy:'.length).trim();
    await page.route('**/docs/zh-cn/guide/', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } });
    });
    await page.goto(new URL('docs/zh-cn/guide/', baseURL).href);
    await page.locator('[data-search-full]').click();
    await page.context().setOffline(true);
    await page.getByRole('textbox').fill('压缩');
    await expect(page.getByRole('dialog').getByRole('button', { name: /^先看压缩效果/ })).toBeVisible();
});
