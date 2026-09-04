import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createPngFixture } from '../fixtures/createPngFixture.js';

async function openOffline(page) {
    await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (['127.0.0.1', 'localhost'].includes(url.hostname) || ['blob:', 'data:'].includes(url.protocol)) {
            await route.continue();
        } else {
            await route.abort('blockedbyclient');
        }
    });
    await page.goto('/');
}

async function importFixture(page) {
    await page.locator('.shoteasy-upload-card input[type="file"]').setInputFiles({
        name: 'phase852.png',
        mimeType: 'image/png',
        buffer: createPngFixture(64, 48),
    });
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.imageStore.list.length)).toBe(1);
}

test('[Phase 8.5.2] desktop menubar supports pointer, arrows, Escape, and focus restoration', async ({ page }) => {
    await openOffline(page);
    const menubar = page.getByRole('menubar', { name: '应用菜单' });
    await expect(menubar).toBeVisible();
    const file = menubar.getByRole('menuitem', { name: '文件' });
    const edit = menubar.getByRole('menuitem', { name: '编辑' });

    await file.click();
    await expect(page.getByRole('menuitem', { name: /新建项目/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(file).toBeFocused();

    await page.keyboard.press('Space');
    await expect(page.getByRole('menuitem', { name: /新建项目/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(file).toBeFocused();

    await page.keyboard.press('ArrowRight');
    await expect(edit).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: /撤销/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(edit).toBeFocused();

    await page.keyboard.press('ArrowLeft');
    await expect(file).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.evaluate(() => {
        const active = document.activeElement;
        return active?.getAttribute('role') === 'menuitem'
            && active.textContent?.includes('新建项目')
            && Boolean(active.closest('.shoteasy-command-menu--file'));
    })).toBe(true);
    await page.keyboard.press('ArrowRight');
    await expect(edit).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => edit.evaluate((trigger) => (
        trigger === document.activeElement
        || Boolean(document.activeElement?.closest('.shoteasy-command-menu--edit'))
    ))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(edit).toBeFocused();
});

test('[Phase 8.5.2] view and help commands change only local presentation state', async ({ page }) => {
    await openOffline(page);
    await importFixture(page);
    const dirty = await page.evaluate(() => window.__shoteasyStores.workspace.isDirty);

    await page.getByRole('menuitem', { name: '视图' }).click();
    const frameToggle = page.getByRole('menuitemcheckbox', { name: /隐藏尺寸与外框/ });
    await expect(frameToggle).toHaveAttribute('aria-checked', 'true');
    await frameToggle.click();
    await expect(page.locator('.shoteasy-left-rail')).toHaveCount(0);
    expect(await page.evaluate(() => window.__shoteasyStores.workspace.isDirty)).toBe(dirty);

    await page.getByRole('menuitem', { name: '视图' }).click();
    await page.getByRole('menuitemcheckbox', { name: /亮色主题/ }).click();
    await expect(page.locator('.shoteasy-app')).toHaveAttribute('data-mode', 'light');
    expect(await page.evaluate(() => window.__shoteasyStores.workspace.isDirty)).toBe(dirty);

    const help = page.getByRole('menuitem', { name: '帮助' });
    await help.click();
    await page.getByRole('menuitem', { name: /快速入门/ }).click();
    const dialog = page.getByRole('dialog', { name: '快速入门' });
    await expect(dialog).toContainText('添加图片');
    await page.getByTestId('help-close').click();
    await expect(help).toBeFocused();

    await page.evaluate(() => {
        globalThis.__screenhelloExternalLink = null;
        HTMLAnchorElement.prototype.click = function recordExternalLink() {
            globalThis.__screenhelloExternalLink = { href: this.href, target: this.target, rel: this.rel };
        };
    });
    await help.click();
    await page.getByRole('menuitem', { name: /GitHub 仓库/ }).click();
    expect(await page.evaluate(() => globalThis.__screenhelloExternalLink)).toEqual({
        href: 'https://github.com/web-casa/ScreenHello',
        target: '_blank',
        rel: 'noopener noreferrer',
    });

    await page.evaluate(async () => {
        const stores = window.__shoteasyStores;
        stores.imageStore.select([stores.imageStore.list[0].id], { expandGroup: false });
        await stores.commands.execute('edit.toggleSelectionLock');
        stores.history.reset();
    });
    await expect.poll(() => page.evaluate(() => (
        window.__shoteasyStores.imageStore.selectedList.length === 1
        && window.__shoteasyStores.imageStore.selectedList.every((layer) => layer.locked)
    ))).toBe(true);
    await page.getByRole('menuitem', { name: '编辑' }).click();
    await expect(page.getByRole('menuitemcheckbox', { name: /^解锁/ })).toBeFocused();
});

test('[Phase 8.5.2] touch can switch top-level menus on tablet', async ({ browser, baseURL }) => {
    const context = await browser.newContext({
        viewport: { width: 768, height: 1024 },
        hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto(baseURL);
    const menubar = page.getByRole('menubar', { name: '应用菜单' });
    await menubar.getByRole('menuitem', { name: '文件' }).tap();
    await expect(page.getByRole('menuitem', { name: /新建项目/ })).toBeVisible();
    await menubar.getByRole('menuitem', { name: '视图' }).tap();
    await expect(page.getByRole('menuitem', { name: /适应画布/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.shoteasy-left-rail')).toHaveCount(0);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('.shoteasy-left-rail')).toBeVisible();
    await expect(page.locator('.shoteasy-right-inspector')).toBeVisible();
    await context.close();
});

test('[Phase 8.5.2] local library has four focused sections without project actions or suggestions', async ({ page }) => {
    await openOffline(page);
    await page.getByRole('menuitem', { name: '文件' }).click();
    await page.getByRole('menuitem', { name: /本地资料库/ }).click();
    const drawer = page.getByRole('dialog', { name: '本地资料库' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('tab')).toHaveCount(4);
    await expect(drawer.getByRole('tab', { name: '最近项目' })).toBeVisible();
    await expect(drawer.getByRole('tab', { name: '恢复草稿' })).toBeVisible();
    await expect(drawer.getByRole('tab', { name: '风格预设' })).toBeVisible();
    await expect(drawer.getByRole('tab', { name: '存储' })).toBeVisible();
    await expect(drawer.getByText('当前项目')).toHaveCount(0);
    await expect(drawer.getByText('智能建议')).toHaveCount(0);
});

test('[Phase 8.5.2] export panel keeps draft settings local until one confirmed download', async ({ page }) => {
    await openOffline(page);
    await importFixture(page);
    const exportButton = page.getByRole('button', { name: '导出图片' });
    await exportButton.click();
    const drawer = page.locator('.shoteasy-export-drawer');
    await expect(page.getByRole('dialog', { name: '导出图片' })).toBeVisible();
    await drawer.locator('.ant-segmented-item').filter({ hasText: 'webp' }).click();
    await drawer.locator('.ant-segmented-item').filter({ hasText: '2x' }).click();
    expect(await page.evaluate(() => window.__shoteasyStores.workspace.exportSettings)).toEqual({ format: 'png', ratio: 1 });
    await page.getByTestId('export-cancel').click();
    expect(await page.evaluate(() => window.__shoteasyStores.workspace.exportSettings)).toEqual({ format: 'png', ratio: 1 });

    await exportButton.click();
    await drawer.locator('.ant-segmented-item').filter({ hasText: 'webp' }).click();
    await drawer.locator('.ant-segmented-item').filter({ hasText: '2x' }).click();
    const downloads = [];
    page.on('download', (download) => downloads.push(download));
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-download').dblclick();
    const download = await downloadPromise;
    await expect.poll(() => downloads.length).toBe(1);
    expect(download.suggestedFilename()).toBe('ScreenHello@2.webp');
    expect(await page.evaluate(() => window.__shoteasyStores.workspace.exportSettings)).toEqual({ format: 'webp', ratio: 2 });
});

test('[Phase 8.5.2] menus and open panels add no axe A/AA violations', async ({ page }) => {
    await openOffline(page);
    await importFixture(page);
    const help = page.getByRole('menuitem', { name: '帮助' });
    const quickStart = page.getByRole('menuitem', { name: /快速入门/ });
    await help.click();
    const menuResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(menuResults.violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(help).toHaveAttribute('aria-expanded', 'false');
    await expect(quickStart).toBeHidden();
    await page.getByRole('button', { name: '导出图片' }).click();
    const drawerResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(drawerResults.violations).toEqual([]);
});
