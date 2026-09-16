import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const { app: { security: { csp } } } = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url)));

// Model Tauri 2.11's HTML style nonce transformation, not just the configured
// CSP. A plain Vite preview misses the extra nonce added to style-src at runtime.
async function withPackagedCsp(page) {
    await page.addInitScript(() => {
        window.__styleViolations = [];
        document.addEventListener('securitypolicyviolation', event => {
            if (event.effectiveDirective.startsWith('style-src')) {
                window.__styleViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
            }
        });
    });
    await page.route('**/*', async route => {
        if (!route.request().isNavigationRequest()) return route.continue();
        const response = await route.fetch();
        let html = await response.text();
        let policy = csp;
        if (/<style(?:\s|>)/i.test(html)) {
            html = html.replace(/<style(?=[\s>])/gi, '<style nonce="desktop-ui-regression"');
            policy = policy.replace(/style-src([^;]*)/, "$& 'nonce-desktop-ui-regression'");
        }
        await route.fulfill({ response, body: html, headers: { ...response.headers(), 'content-security-policy': policy } });
    });
}

async function opaqueSurface(locator) {
    await expect(locator).toBeVisible();
    await expect.poll(() => locator.evaluate(node => {
        const css = getComputedStyle(node);
        return css.backgroundColor !== 'rgba(0, 0, 0, 0)' && css.backgroundColor !== 'transparent';
    })).toBe(true);
    await expect.poll(() => locator.evaluate(node => getComputedStyle(node).getPropertyValue('--ant-color-text').trim())).not.toBe('');
}

for (const mode of ['dark', 'light']) {
    test(`${mode}: production desktop CSP preserves themes, stacking and overlays`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: mode });
        await withPackagedCsp(page);
        await page.goto('/');
        if (mode === 'light') await page.getByRole('button', { name: /切换主题/ }).click();
        await expect(page.locator('.shoteasy-app')).toHaveAttribute('data-mode', mode);
        for (const name of ['文件', '编辑', '视图', '帮助']) {
            await page.getByRole('menubar').getByRole('menuitem', { name, exact: true }).click();
            await opaqueSurface(page.locator('.ant-dropdown-menu:visible'));
            const menu = page.locator('.ant-dropdown:visible');
            await expect.poll(() => menu.evaluate(node => Number(getComputedStyle(node).zIndex))).toBeGreaterThan(100);
            if (name === '帮助') await page.screenshot({ path: test.info().outputPath(`${mode}-help.png`) });
            await page.keyboard.press('Escape');
            await expect(page.locator('.ant-dropdown:visible')).toHaveCount(0);
        }
        await page.getByRole('button', { name: '选择画布尺寸' }).click();
        await opaqueSurface(page.locator('.shoteasy-size-overlay .ant-popover-container'));
        // A visible DOM rectangle alone misses thumbnails painting over a popup.
        await expect.poll(() => page.locator('.shoteasy-size-overlay').evaluate(node => {
            const r = node.getBoundingClientRect();
            return [0.25, 0.5, 0.75].every(f => node.contains(document.elementFromPoint(r.left + r.width * f, r.top + Math.min(220, r.height / 2))));
        })).toBe(true);
        await page.screenshot({ path: test.info().outputPath(`${mode}-size.png`) });
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: '试用示例', exact: true }).click();
        await expect(page.getByRole('button', { name: '裁剪图片' })).toBeEnabled();
        await page.getByRole('button', { name: '裁剪图片' }).click();
        await opaqueSurface(page.locator('.shoteasy-cropper-modal .ant-modal-container'));
        await page.getByRole('dialog', { name: '裁剪' }).getByRole('button', { name: /取\s*消/ }).click();
        await page.getByRole('button', { name: '导出图片' }).click();
        await opaqueSurface(page.locator('.shoteasy-export-overlay .ant-drawer-section'));
        await expect(page.getByTestId('export-cancel')).toBeInViewport();
        await expect(page.getByTestId('export-download')).toBeInViewport();
        await page.screenshot({ path: test.info().outputPath(`${mode}-export.png`) });
        await page.setViewportSize({ width: 960, height: 640 });
        await expect(page.getByTestId('export-cancel')).toBeInViewport();
        await expect(page.getByTestId('export-download')).toBeInViewport();
        await page.getByTestId('export-cancel').click();
        expect(await page.evaluate(() => window.__styleViolations)).toEqual([]);
    });
}
