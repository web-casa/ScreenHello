import { expect, test } from '@playwright/test';
import { createPngFixture } from '../fixtures/createPngFixture.js';

test('upgrades SizeBar with Auto tile, golden ratio, platform badges, and bottom custom inputs', async ({ page }) => {
    await page.goto('/?workspace=true');
    await page.locator('.shoteasy-size-trigger').click();

    const popover = page.locator('.shoteasy-size-popover');
    await expect(popover).toBeVisible();
    await expect(popover.getByRole('button', { name: '使用自动尺寸' }).first()).toBeVisible();

    // Search golden ratio 1.618:1 and select it.
    await popover.getByRole('textbox', { name: '搜索尺寸' }).fill('1.618');
    const goldenBtn = popover.getByRole('button', { name: /黄金比例/ });
    await expect(goldenBtn).toBeVisible();
    await goldenBtn.click();

    await expect.poll(() => page.evaluate(() => ({
        w: window.__shoteasyStores.option.frameConf.width,
        h: window.__shoteasyStores.option.frameConf.height,
    }))).toEqual({ w: 1920, h: 1187 });

    // Search OG share card and select it.
    await page.locator('.shoteasy-size-trigger').click();
    await popover.getByRole('textbox', { name: '搜索尺寸' }).fill('OG');
    await popover.getByRole('button', { name: /分享卡片/ }).click();
    await expect.poll(() => page.evaluate(() => ({
        w: window.__shoteasyStores.option.frameConf.width,
        h: window.__shoteasyStores.option.frameConf.height,
    }))).toEqual({ w: 1200, h: 630 });
});

test('applies 3D perspective presets via left rail, exports crisp PNG, and supports Undo/Redo', async ({ page }) => {
    const requests = [];
    page.on('request', (req) => requests.push(req.url()));

    await page.goto('/?workspace=true');
    // Lazy perspectiveRenderer must not load on initial page.
    expect(requests.some((url) => /perspectiveRenderer/.test(url))).toBe(false);

    await page.locator('.shoteasy-upload-card input[type="file"]').setInputFiles({
        name: 'demo.png',
        mimeType: 'image/png',
        buffer: createPngFixture(320, 200),
    });
    await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();

    // Click 'tilt-left' 3D perspective card in left rail.
    const leftCard = page.locator('[data-perspective-preset="tilt-left"]');
    await expect(leftCard).toBeVisible();
    await leftCard.click();

    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.option.perspective3d.preset)).toBe('tilt-left');
    // Wait for async perspective projection to finish rendering.
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.renderTaskTracker.size)).toBe(0);

    // Export 2x PNG via exportService and confirm valid non-empty PNG dimensions.
    const exportStats = await page.evaluate(async () => {
        const result = await window.__shoteasyStores.exportService.exportImage({ format: 'png', ratio: 2 });
        return {
            mimeType: result.mimeType,
            width: result.width,
            height: result.height,
            bytes: result.blob.size,
        };
    });
    expect(exportStats.mimeType).toBe('image/png');
    expect(exportStats.width).toBeGreaterThan(400);
    expect(exportStats.height).toBeGreaterThan(300);
    expect(exportStats.bytes).toBeGreaterThan(2000);

    // Undo resets perspective back to flat; Redo restores tilt-left.
    await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
    await page.getByRole('menuitem', { name: /^撤销/ }).click();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.option.perspective3d.preset)).toBe('flat');

    await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
    await page.getByRole('menuitem', { name: /^重做/ }).click();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.option.perspective3d.preset)).toBe('tilt-left');
});
