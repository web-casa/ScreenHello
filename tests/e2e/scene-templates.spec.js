import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createPngFixture } from '../fixtures/createPngFixture.js';

test('opens lazy scene template library, filters, applies atomically, undoes in one step, and passes axe checks', async ({ page }) => {
    const requests = [];
    page.on('request', (req) => requests.push(req.url()));

    await page.goto('/?workspace=true');
    expect(requests.some((url) => /SceneTemplateModal|sceneTemplates/.test(url))).toBe(false);

    await page.locator('.shoteasy-upload-card input[type="file"]').setInputFiles({
        name: 'hero.png',
        mimeType: 'image/png',
        buffer: createPngFixture(320, 200),
    });
    await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();

    // Open template gallery from File menu.
    await page.getByRole('menuitem', { name: '文件', exact: true }).click();
    await page.getByRole('menuitem', { name: /^场景模板库/ }).click();

    const dialog = page.getByRole('dialog', { name: '场景模板库' });
    await expect(dialog).toBeVisible();
    await expect.poll(() => requests.some((url) => /SceneTemplateModal/.test(url))).toBe(true);

    // WCAG axe check on modal surface.
    const axe = await new AxeBuilder({ page }).include('.shoteasy-template-modal').analyze();
    expect(axe.violations).toEqual([]);

    // Filter by 3D category and apply 'tilt-left-hero'.
    await dialog.getByRole('tab', { name: '3D 电影感' }).click();
    const card = dialog.locator('[data-template-id="tilt-left-hero"]');
    await expect(card).toBeVisible();
    await card.click();
    await expect(dialog).toBeHidden();

    // User image is preserved while frame, background, and 3D perspective all updated atomically.
    await expect.poll(() => page.evaluate(() => ({
        count: window.__shoteasyStores.imageStore.list.length,
        frame: window.__shoteasyStores.option.frame,
        bg: window.__shoteasyStores.option.background,
        preset: window.__shoteasyStores.option.perspective3d.preset,
    }))).toEqual({
        count: 1,
        frame: 'arc',
        bg: 'gradient_18',
        preset: 'tilt-left',
    });

    // Single Undo restores original flat state.
    await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
    await page.getByRole('menuitem', { name: /^撤销/ }).click();
    await expect.poll(() => page.evaluate(() => ({
        frame: window.__shoteasyStores.option.frame,
        preset: window.__shoteasyStores.option.perspective3d.preset,
    }))).toEqual({
        frame: 'none',
        preset: 'flat',
    });
});
