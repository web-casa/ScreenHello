import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { loadSiteContent, SITE_LANGUAGES } from '../../site/site.mjs';
const catalog = loadSiteContent();

// Vite preview does not apply Cloudflare _headers. Exercise every docs interaction
// with the generated production policy, not only the HTML from that build.
test.beforeEach(async ({ page, baseURL }) => {
    const base = new URL(baseURL).pathname;
    const headers = readFileSync(`${process.env.SCREENHELLO_PWA_OUT_DIR || 'dist'}/_headers`, 'utf8');
    const rule = headers.split('\n\n').find(block => block.startsWith(`${base}docs/*`));
    const csp = rule.split('\n').find(line => line.trim().startsWith('Content-Security-Policy:'))
        .trim().slice('Content-Security-Policy:'.length).trim();
    await page.route('**/docs/**', async route => {
        if (!route.request().isNavigationRequest()) return route.continue();
        const response = await route.fetch();
        await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } });
    });
});

for (const width of [390, 1440]) {
    test(`privacy layout remains readable under production CSP at ${width}px`, async ({ page, baseURL }) => {
        const errors = [];
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        page.on('pageerror', error => errors.push(error.message));
        await page.setViewportSize({ width, height: 960 });
        await page.goto(new URL('docs/zh-cn/privacy/', baseURL).href);
        await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
        const heading = page.getByRole('heading', { level: 1 });
        await expect(heading).toBeInViewport();
        // Visibility alone also passes when the misplaced sidebar covers the article.
        await heading.click({ trial: true });
        if (width === 1440) {
            const sidebar = await page.locator('#nd-sidebar').boundingBox();
            const article = await page.locator('article').boundingBox();
            expect(sidebar.x + sidebar.width).toBeLessThanOrEqual(article.x + 1);
            await page.locator('[data-search-full]').click();
        } else {
            await page.locator('#nd-subnav [data-search]').click();
        }
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.getByRole('combobox').fill('PNG');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).not.toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        expect(errors).toEqual([]);
        await page.screenshot({ path: test.info().outputPath(`privacy-${width}.png`), fullPage: true });
    });
}

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
        const input = dialog.getByRole('combobox');
        await input.fill('no-such-term-930147');
        await expect(dialog.getByText(content.docsUi['No results found'])).toBeVisible();
        await input.fill('PNG');
        await expect(dialog.getByRole('option', { name: new RegExp(content.pages[3].title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeVisible();
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
        await toc.getByRole('link', { name: '3. 检查尺寸并下载静态图或动图', exact: true }).click();
        await expect(page).toHaveURL(/#3-/);
        const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
        expect(violations).toEqual([]);
        await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
        await page.screenshot({ path: test.info().outputPath(`docs-${width}-${colorScheme}.png`), fullPage: true });
    });
}

test('docs search works under the generated production CSP without network access', async ({ page, baseURL }) => {
    await page.goto(new URL('docs/zh-cn/guide/', baseURL).href);
    await page.locator('[data-search-full]').click();
    await page.context().setOffline(true);
    await page.getByRole('combobox').fill('压缩');
    await expect(page.getByRole('dialog').getByRole('option', { name: /^先看压缩效果/ })).toBeVisible();
});


test('production docs CSP still rejects unapproved inline scripts', async ({ page, baseURL }) => {
    await page.goto(new URL('docs/en/privacy/', baseURL).href);
    const violation = await page.evaluate(() => new Promise(resolve => {
        document.addEventListener('securitypolicyviolation', event => {
            if (event.effectiveDirective.startsWith('script-src')) resolve(event.blockedURI);
        });
        const script = document.createElement('script');
        script.textContent = "document.documentElement.dataset.unapprovedScript = 'executed'";
        document.head.append(script);
    }));
    expect(violation).toBe('inline');
    await expect(page.locator('html')).not.toHaveAttribute('data-unapproved-script');
});
