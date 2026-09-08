import { expect, test } from '@playwright/test';

test('public help opens in a separate tab without replacing the editor', async ({ page }) => {
    await page.goto('/');
    const help = page.locator('.shoteasy-init-footer a');
    await expect(help).toHaveAttribute('href', '/zh-cn/guide/');
    await expect(help).toHaveAttribute('target', '_blank');
    const newPage = page.waitForEvent('popup');
    await help.click();
    const guide = await newPage;
    await expect(guide.getByRole('heading', { level: 1 })).toContainText('ScreenHello');
    await expect(page.getByRole('button', { name: '选择图片', exact: true })).toBeVisible();
    await guide.close();
});

test('explicit language entry is respected without forcing language redirects', async ({ page }) => {
    await page.goto('/de/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await page.locator('.masthead').getByRole('link', { name: 'Editor öffnen' }).click();
    await expect(page.locator('.shoteasy-app')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de-DE');
    await expect(page.locator('.shoteasy-init-footer a')).toHaveAttribute('href', '/de/guide/');
});
