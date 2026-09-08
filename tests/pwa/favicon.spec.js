import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { normalizeWebBase } from '../../config/pwaConfig.js';

const base = normalizeWebBase(process.env.SCREENHELLO_BASE_PATH || '/');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('one manifest and versioned Web icons survive a cold offline reload inside the deployment scope', async ({ page, context }) => {
    await page.goto('./');
    await expect(page.getByText('离线已就绪', { exact: true })).toBeVisible();
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', `${base}manifest.webmanifest`);
    await expect(page.locator('link[rel="icon"]')).toHaveCount(2);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'ScreenHello');
    const manifest = await (await page.request.get(`${base}manifest.webmanifest`)).json();
    expect(manifest).toMatchObject({ id: base, start_url: base, scope: base });
    expect(manifest.icons.map(icon => icon.purpose)).toEqual(['any', 'any', 'maskable', 'maskable']);
    const htmlIcons = await page.locator('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').evaluateAll(links => links.map(link => link.getAttribute('href')));
    expect(htmlIcons).toHaveLength(4);
    const urls = [...htmlIcons, ...manifest.icons.map(icon => icon.src)];
    const expected = [];
    for (const url of urls) {
        const resolved = new URL(url, page.url());
        expect(resolved.pathname.startsWith(base)).toBe(true);
        const filename = resolved.pathname.slice(base.length);
        const bytes = readFileSync(new URL(`../../public/${filename}`, import.meta.url));
        if (!filename.startsWith('pwa-maskable-')) expect(resolved.searchParams.get('v')).toBe(digest(bytes).slice(0, 12));
        const response = await page.request.get(url);
        expect(response.ok()).toBe(true);
        expect(await response.body()).toEqual(bytes);
        expected.push({ url, hash: digest(bytes) });
    }
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    const session = await context.newCDPSession(page);
    await session.send('Network.clearBrowserCache');
    await session.detach();
    await context.setOffline(true);
    try {
        await page.reload();
        await expect(page.getByRole('button', { name: '选择图片', exact: true })).toBeVisible();
        const actual = await page.evaluate(async urls => Promise.all(urls.map(async url => {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`offline-icon:${response.status}:${url}`);
            const bytes = await response.arrayBuffer();
            const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
            return { url, hash };
        })), urls);
        expect(actual).toEqual(expected);
        expect(await page.evaluate(async url => (await (await fetch(url)).json()).id, `${base}manifest.webmanifest`)).toBe(base);
    } finally { await context.setOffline(false); }
});
