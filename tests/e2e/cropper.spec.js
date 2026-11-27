import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PNG } from 'pngjs';

const createQuadrantPng = (width = 160, height = 120) => {
    const png = new PNG({ width, height });
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const idx = (y * width + x) * 4;
            const left = x < width / 2;
            const top = y < height / 2;
            if (left && top) {
                png.data[idx] = 220; png.data[idx + 1] = 38; png.data[idx + 2] = 38; png.data[idx + 3] = 255;
            } else if (!left && top) {
                // Transparent upper-right quadrant to verify alpha preservation.
                png.data[idx] = 0; png.data[idx + 1] = 0; png.data[idx + 2] = 0; png.data[idx + 3] = 0;
            } else if (left && !top) {
                png.data[idx] = 37; png.data[idx + 1] = 99; png.data[idx + 2] = 235; png.data[idx + 3] = 255;
            } else {
                png.data[idx] = 22; png.data[idx + 1] = 163; png.data[idx + 2] = 74; png.data[idx + 3] = 255;
            }
        }
    }
    return PNG.sync.write(png);
};

test('crops transparent PNG via pointer drag, supports presets/reset/undo/redo, and passes axe WCAG checks', async ({ page }) => {
    await page.goto('/?workspace=true');
    await page.locator('.shoteasy-upload-card input[type="file"]').setInputFiles({
        name: 'quadrant.png',
        mimeType: 'image/png',
        buffer: createQuadrantPng(160, 120),
    });
    await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();
    await expect.poll(() => page.evaluate(() => ({
        w: window.__shoteasyStores.editor.img?.width,
        h: window.__shoteasyStores.editor.img?.height,
    }))).toEqual({ w: 160, h: 120 });

    const originalSrc = await page.evaluate(() => window.__shoteasyStores.editor.img.src);

    // Open cropper dialog, verify accessibility, cancel is a no-op.
    await page.getByRole('button', { name: '裁剪图片' }).click();
    const dialog = page.getByRole('dialog', { name: '裁剪' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('cropper-dimensions')).toHaveText('160 × 120 px');

    const axeResults = await new AxeBuilder({ page })
        .include('.shoteasy-cropper-modal')
        .analyze();
    expect(axeResults.violations).toEqual([]);

    await dialog.getByRole('button', { name: /取\s*消/ }).click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => window.__shoteasyStores.editor.img.src)).toBe(originalSrc);

    // Re-open, test aspect preset 1:1 -> reset -> real pointer drag on SE handle -> confirm.
    await page.getByRole('button', { name: '裁剪图片' }).click();
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-crop-preset="1:1"]').click();
    await expect(dialog.getByTestId('cropper-dimensions')).toHaveText('120 × 120 px');
    await dialog.getByTestId('cropper-reset').click();
    await expect(dialog.getByTestId('cropper-dimensions')).toHaveText('160 × 120 px');

    const seHandle = dialog.locator('[data-crop-handle="se"]');
    const selectionBox = await dialog.getByTestId('cropper-selection').boundingBox();
    const handleBox = await seHandle.boundingBox();
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - selectionBox.width * 0.25, startY - selectionBox.height * 0.5, { steps: 6 });
    await page.mouse.up();

    const dimensionsText = await dialog.getByTestId('cropper-dimensions').textContent();
    const [, croppedW, croppedH] = dimensionsText.match(/(\d+)\s*×\s*(\d+)/);
    expect(Number(croppedW)).toBeGreaterThanOrEqual(100);
    expect(Number(croppedW)).toBeLessThanOrEqual(135);
    expect(Number(croppedH)).toBeGreaterThanOrEqual(50);
    expect(Number(croppedH)).toBeLessThanOrEqual(75);

    await dialog.getByRole('button', { name: /确\s*定/ }).click();
    await expect(dialog).toBeHidden();

    // Verify cropped resource dimensions & preserved transparency on right side.
    const croppedInfo = await page.evaluate(async () => {
        const img = window.__shoteasyStores.editor.img;
        const response = await fetch(img.src);
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        const leftAlpha = ctx.getImageData(4, 4, 1, 1).data[3];
        const rightAlpha = ctx.getImageData(bitmap.width - 4, 4, 1, 1).data[3];
        bitmap.close();
        canvas.width = canvas.height = 0;
        return { width: img.width, height: img.height, src: img.src, leftAlpha, rightAlpha };
    });
    expect(croppedInfo.width).toBe(Number(croppedW));
    expect(croppedInfo.height).toBe(Number(croppedH));
    expect(croppedInfo.src).not.toBe(originalSrc);
    expect(croppedInfo.leftAlpha).toBe(255);
    expect(croppedInfo.rightAlpha).toBe(0);

    // Undo restores original dimensions and source cleanly; Redo restores crop.
    await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
    await page.getByRole('menuitem', { name: /^撤销/ }).click();
    await expect.poll(() => page.evaluate(() => ({
        w: window.__shoteasyStores.editor.img.width,
        h: window.__shoteasyStores.editor.img.height,
        src: window.__shoteasyStores.editor.img.src,
    }))).toEqual({ w: 160, h: 120, src: originalSrc });

    await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
    await page.getByRole('menuitem', { name: /^重做/ }).click();
    await expect.poll(() => page.evaluate(() => ({
        w: window.__shoteasyStores.editor.img.width,
        h: window.__shoteasyStores.editor.img.height,
    }))).toEqual({ w: Number(croppedW), h: Number(croppedH) });
});
