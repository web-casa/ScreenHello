import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { PNG } from 'pngjs';

const createValidLogoPng = () => {
    const png = new PNG({ width: 16, height: 16 });
    for (let i = 0; i < png.data.length; i += 4) {
        png.data[i] = 37;
        png.data[i + 1] = 99;
        png.data[i + 2] = 235;
        png.data[i + 3] = 255;
    }
    return PNG.sync.write(png);
};
const TINY_LOGO_PNG = createValidLogoPng();

const readDownload = async (download) => {
    const filePath = await download.path();
    return new Uint8Array(await readFile(filePath));
};

test('supports image logo watermark, layer visibility toggle, undo/redo, and .screenhello archive round-trip', async ({ page }) => {
    await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
    await page.goto('/?workspace=true');

    // Load demo image.
    await page.getByRole('button', { name: '试用示例', exact: true }).click();
    await expect(page.locator('.shoteasy-editor-canvas canvas').first()).toBeVisible();

    const layerId = await page.evaluate(() => window.__shoteasyStores.imageStore.list[0].id);

    // Toggle layer visibility off and verify Leafer node hides and undo restores it.
    const eyeBtn = page.getByTestId(`layer-visibility-${layerId}`);
    await expect(eyeBtn).toBeVisible();
    await eyeBtn.click();
    await expect(eyeBtn).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate((id) => ({
        visible: window.__shoteasyStores.imageStore.layers.get(id)?.visible,
        nodeVisible: window.__shoteasyStores.imageStore.nodes.get(id)?.visible,
    }), layerId)).toEqual({ visible: false, nodeVisible: false });

    // Undo restores visibility to true.
    await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
    await page.getByRole('menuitem', { name: /^撤销/ }).click();
    await expect.poll(() => page.evaluate((id) => window.__shoteasyStores.imageStore.layers.get(id)?.visible, layerId))
        .toBe(true);

    // Open Watermark · HDR section in right inspector and enable image logo watermark.
    await page.getByRole('button', { name: /水印\s*·\s*HDR/ }).click();
    await page.getByTestId('watermark-enable-switch').click();
    await page.getByText('图片 Logo', { exact: true }).click();
    await page.getByTestId('watermark-image-input').setInputFiles({
        name: 'brand-logo.png',
        mimeType: 'image/png',
        buffer: TINY_LOGO_PNG,
    });

    await expect.poll(() => page.evaluate(() => ({
        enabled: window.__shoteasyStores.option.watermark.enabled,
        mode: window.__shoteasyStores.option.watermark.mode,
        hasLogo: Boolean(window.__shoteasyStores.option.watermark.imageDataUrl),
        hasActive: window.__shoteasyStores.option.hasActiveWatermark,
    }))).toEqual({ enabled: true, mode: 'image', hasLogo: true, hasActive: true });

    // Save .screenhello project archive and verify watermark + layer visibility persist.
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: '文件', exact: true }).click();
    await page.getByRole('menuitem', { name: /^保存项目/ }).click();
    const archiveBytes = await readDownload(await downloadPromise);
    const entries = unzipSync(archiveBytes);
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    expect(manifest.document.option.watermark.mode).toBe('image');
    expect(manifest.document.option.watermark.imageDataUrl).toMatch(/^data:image\/(?:png|jpeg|webp);base64,/);
    expect(manifest.document.images[0].visible).toBe(true);
});
