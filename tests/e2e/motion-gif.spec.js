import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

test('opens lazy motion export dialog, previews on canvas, passes axe checks, and downloads a valid local GIF89a', async ({ page }) => {
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));

    await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
    await page.goto('/?workspace=true');
    await expect(page.getByRole('button', { name: '选择图片', exact: true })).toBeVisible();

    // Motion export modules must not be fetched before opening the modal.
    expect(requests.some((url) => /MotionExportDialog|animationPresets|animationFrameRenderer|gifEncoder/.test(url))).toBe(false);

    // Load demo image into editor.
    await page.getByRole('button', { name: '试用示例', exact: true }).click();
    await expect(page.locator('.shoteasy-editor-canvas canvas').first()).toBeVisible();

    // Open Motion Export via File menu.
    await page.getByRole('menuitem', { name: '文件', exact: true }).click();
    await page.getByRole('menuitem', { name: /^导出动图/ }).click();

    const dialog = page.getByRole('dialog', { name: '微动画与动图导出' });
    await expect(dialog).toBeVisible();
    await expect.poll(() => requests.some((url) => /MotionExportDialog/.test(url))).toBe(true);

    // Ensure preview uses <canvas> only (no <video> blob URL) and renders non-zero dimensions.
    await expect(dialog.locator('video')).toHaveCount(0);
    const previewCanvas = dialog.getByTestId('motion-preview-canvas');
    await expect(previewCanvas).toBeVisible();
    await expect.poll(() => previewCanvas.evaluate((el) => el.width)).toBeGreaterThan(200);

    // WCAG axe-core check on modal surface.
    const axeResults = await new AxeBuilder({ page })
        .include('.shoteasy-motion-modal')
        .analyze();
    expect(axeResults.violations).toEqual([]);

    // Switch preset to zoom-pulse, pick 2s and 15fps for fast deterministic export, and test pause/step controls.
    await dialog.getByTestId('motion-preset-zoom-pulse').click();
    await dialog.getByText('2s', { exact: true }).click();
    await dialog.getByText('15 fps', { exact: true }).click();
    await dialog.getByTestId('motion-step-frame').click();
    await expect(dialog.getByTestId('motion-toggle-play')).toContainText(/播\s*放/);

    // Export local GIF and inspect GIF89a header + trailer.
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByTestId('motion-export-confirm').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.gif$/);
    const bytes = new Uint8Array(await readFile(await download.path()));
    expect(bytes.byteLength).toBeGreaterThan(256);
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe('GIF89a');
    expect(bytes.at(-1)).toBe(0x3b);
    await expect(dialog).toBeHidden();
});
