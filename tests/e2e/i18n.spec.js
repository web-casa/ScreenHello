import { expect, test } from '@playwright/test';
import { createPngFixture } from '../fixtures/createPngFixture.js';
import AxeBuilder from '@axe-core/playwright';

const languages = [
    ['en-US', 'English', 'Choose image'],
    ['zh-CN', '简体中文', '选择图片'],
    ['zh-TW', '繁體中文', '選擇圖片'],
    ['de-DE', 'Deutsch', 'Bild wählen'],
    ['ko-KR', '한국어', '이미지 선택'],
    ['es-ES', 'Español', 'Elegir imagen'],
    ['pt-PT', 'Português', 'Escolher imagem'],
];

test('language menu is operable entirely by keyboard and announces the selection', async ({ page }) => {
    await page.goto('/');
    const trigger = page.locator('.shoteasy-language-trigger');
    await trigger.press('Enter');
    await expect(page.getByRole('menuitemradio', { name: '简体中文', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => page.evaluate(() => Boolean(document.activeElement.closest('[role="menu"]')))).toBe(true);
    await page.keyboard.press('Home');
    await expect(page.getByRole('menuitemradio', { name: 'English', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitemradio', { name: 'Deutsch', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de-DE');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAccessibleName(/Deutsch/);
    const theme = page.locator('.shoteasy-theme-trigger');
    await expect(theme).toHaveAccessibleName(/Light/);
    await theme.press('Enter');
    await expect(theme).toHaveAccessibleName(/Dark/);
    await trigger.press('ArrowDown');
    await expect.poll(() => page.evaluate(() => Boolean(document.activeElement.closest('[role="menu"]')))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.press('Space');
    await expect.poll(() => page.evaluate(() => Boolean(document.activeElement.closest('[role="menu"]')))).toBe(true);
    await page.keyboard.press('Tab');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

for (const width of [320, 390, 1280]) {
    test(`top-right appearance controls support seven languages and fit at ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');
        for (const [locale, name, choose] of languages) {
            await page.locator('.shoteasy-language-trigger').click();
            await page.getByRole('menuitemradio', { name, exact: true }).click();
            await expect(page.locator('html')).toHaveAttribute('lang', locale);
            await expect(page.getByRole('button', { name: choose, exact: true })).toBeVisible();
            expect(await page.locator('.shoteasy-init-actions .ant-btn').evaluateAll((buttons) => (
                buttons.every((button) => button.scrollWidth <= button.clientWidth + 1)
            ))).toBe(true);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            for (const selector of ['.shoteasy-theme-trigger', '.shoteasy-language-trigger']) {
                const box = await page.locator(selector).boundingBox();
                expect(box.x).toBeGreaterThanOrEqual(0);
                expect(box.x + box.width).toBeLessThanOrEqual(width);
                if (width <= 390) expect(box.height).toBeGreaterThanOrEqual(44);
            }
            await page.screenshot({ path: testInfo.outputPath(`appearance-${locale}-${width}.png`), fullPage: true });
        }
        await page.locator('.shoteasy-language-trigger').focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('menuitemradio', { name: 'Português', exact: true })).toHaveAttribute('aria-checked', 'true');
        const results = await new AxeBuilder({ page }).include('.shoteasy-topbar').include('.ant-dropdown').analyze();
        expect(results.violations).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(page.locator('.shoteasy-language-trigger')).toHaveAttribute('aria-expanded', 'false');
        await page.locator('.shoteasy-theme-trigger').click();
        await expect(page.locator('.shoteasy-app')).toHaveAttribute('data-mode', 'light');
        await page.locator('.shoteasy-language-trigger').click();
        const lightResults = await new AxeBuilder({ page }).include('.shoteasy-topbar').include('.ant-dropdown').analyze();
        expect(lightResults.violations).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath(`appearance-light-menu-${width}.png`), fullPage: true });
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('lang', 'pt-PT');
    });
}

test('top-right switching preserves project state and remembers the theme', async ({ page }) => {
    await page.goto('/');
    await page.locator('.shoteasy-upload-card input[type="file"]').setInputFiles({
        name: 'user-local.png', mimeType: 'image/png', buffer: createPngFixture(),
    });
    await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();
    await page.evaluate(() => window.__shoteasyStores.workspace.setProjectName('我的原名'));
    const before = await page.evaluate(() => JSON.stringify(window.__shoteasyStores.editor.serializeProject()));
    const wasDark = await page.evaluate(() => window.__shoteasyStores.editor.isDark);
    await page.locator('.shoteasy-theme-trigger').click();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.editor.isDark)).toBe(!wasDark);
    for (const [locale, name] of languages) {
        await page.locator('.shoteasy-language-trigger').click();
        await page.getByRole('menuitemradio', { name, exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        expect(await page.evaluate(() => JSON.stringify(window.__shoteasyStores.editor.serializeProject()))).toBe(before);
        expect(await page.evaluate(() => window.__shoteasyStores.workspace.projectName)).toBe('我的原名');
    }
    await page.reload();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores?.editor.isDark)).toBe(!wasDark);
});

test('English mobile export and library preserve local editing and readable labels', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => localStorage.setItem('SCREENHELLO_LOCALE', 'en-US'));
    await page.goto('/');
    await page.locator('.shoteasy-upload-card input[type="file"]').setInputFiles({
        name: 'local.png', mimeType: 'image/png', buffer: createPngFixture(),
    });
    await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();
    const before = await page.evaluate(() => JSON.stringify(window.__shoteasyStores.editor.serializeProject()));
    for (const command of ['file.openExport', 'file.openLibrary']) {
        await page.evaluate((id) => window.__shoteasyStores.commands.execute(id), command);
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        expect((await dialog.innerText()).split('\n').filter((line) => /\p{Script=Han}/u.test(line))).toEqual([]);
        expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
    }
    expect(await page.evaluate(() => JSON.stringify(window.__shoteasyStores.editor.serializeProject()))).toBe(before);
});

test('library locales are isolated and changing props does not remount or change host language', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
        const { mountI18nHarness } = await import('/tests/fixtures/i18n-harness.jsx');
        const container = document.createElement('div');
        container.id = 'locale-fixture';
        document.body.append(container);
        window.__localeFixture = mountI18nHarness(container);
    });
    const first = page.getByTestId('locale-first');
    const second = page.getByTestId('locale-second');
    await expect(first.getByRole('menuitem', { name: 'File', exact: true })).toBeVisible();
    await expect(second.getByRole('menuitem', { name: '文件', exact: true })).toBeVisible();
    const runtimeId = await first.getByTestId('locale-runtime-first').innerText();
    const hostLanguage = await page.locator('html').getAttribute('lang');
    await page.getByRole('button', { name: 'Change first locale' }).click();
    await expect(first.getByRole('menuitem', { name: '文件', exact: true })).toBeVisible();
    await expect(second.getByRole('menuitem', { name: '文件', exact: true })).toBeVisible();
    await expect(first.getByTestId('locale-runtime-first')).toHaveText(runtimeId);
    await expect(page.locator('html')).toHaveAttribute('lang', hostLanguage);
    await first.evaluate((element) => { element.style.width = '640px'; });
    const firstApp = first.locator('.shoteasy-app');
    const appBox = await firstApp.boundingBox();
    const controlBox = await first.locator('.shoteasy-language-trigger').boundingBox();
    expect(controlBox.x + controlBox.width).toBeLessThanOrEqual(appBox.x + appBox.width);
    await first.locator('.shoteasy-language-trigger').click();
    await page.getByRole('menuitemradio', { name: '한국어', exact: true }).click();
    await expect(firstApp).toHaveAttribute('lang', 'ko-KR');
    await first.locator('.shoteasy-mobile-menu-trigger').click();
    await expect(page.getByRole('tab', { name: '파일', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(second.getByRole('menuitem', { name: '文件', exact: true })).toBeVisible();
    await expect(first.getByTestId('locale-runtime-first')).toHaveText(runtimeId);
    await expect(page.locator('html')).toHaveAttribute('lang', hostLanguage);
    await page.evaluate(() => window.__localeFixture.unmount());
});

test('English application menu remains localized and fits on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => localStorage.setItem('SCREENHELLO_LOCALE', 'en-US'));
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
    await page.getByRole('button', { name: 'Open application menu', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'File', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /New project/ })).toBeVisible();
    const visibleChinese = await page.locator('body').evaluate((body) => body.innerText.split('\n').filter((line) => /\p{Script=Han}/u.test(line)));
    expect(visibleChinese).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('standalone language selection persists without translating user project names', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__shoteasyStores));
    await page.evaluate(() => {
        window.__shoteasyStores.workspace.setProjectName('用户自己的名字');
        return window.__shoteasyStores.commands.execute('help.about');
    });
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: '语言', exact: true }).click();
    await dialog.getByRole('combobox', { name: '语言', exact: true }).press('ArrowUp');
    await dialog.getByRole('combobox', { name: '语言', exact: true }).press('Enter');
    await expect(dialog.getByText('About ScreenHello', { exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
    expect(await page.evaluate(() => window.__shoteasyStores.workspace.projectName)).toBe('用户自己的名字');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
    await expect(page.getByRole('menuitem', { name: 'File', exact: true })).toBeVisible();
});
