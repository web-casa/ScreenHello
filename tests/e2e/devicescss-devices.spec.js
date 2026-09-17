import { expect, test } from '@playwright/test';
import { createPngFixture } from '../fixtures/createPngFixture';

/**
 * Devices.css 机型（MIT，提交进仓库的位图素材）：验证它们真的进了设备列表、配色可切、
 * 走现有位图管线导出（透明 PNG / JPG 白底 / 倍率），并且因为许可是 MIT 而不弹素材许可说明。
 * 生成脚本见 scripts/generate-devicescss-assets.mjs。
 */
const fixture = { name: 'devicescss.png', mimeType: 'image/png', buffer: createPngFixture(200, 100) };
const frame = (page) => page.evaluate(() => window.__shoteasyStores.option.frame);
const licenseDialog = (page) => page.getByRole('dialog', { name: '素材许可说明' });

const prepare = async (page, frameId) => {
    await page.goto('/');
    await page.locator('.shoteasy-upload-card input[type=file]').setInputFiles(fixture);
    await page.waitForFunction(() => window.__shoteasyStores?.editor.app?.tree);
    await page.evaluate((id) => {
        const root = window.__shoteasyStores;
        root.option.setSize({ type: 'custom', title: '自定义', width: 600, height: 500 });
        root.option.setPadding(0);
        root.option.setRound(0);
        root.option.setBackground('none');
        root.option.setShadowConf({ visible: false });
        root.option.setFrame(id);
    }, frameId);
};

test('devices.css models appear in the drawer with real names and palette swatches', async ({ page }) => {
    await prepare(page, 'none');
    await page.locator('.shoteasy-frame-panel').getByRole('button', { name: '更多外框' }).click();
    const drawer = page.locator('.shoteasy-frame-drawer');
    await expect(drawer).toBeVisible();
    const devices = drawer.locator('.shoteasy-frame-section').filter({ hasText: '设备' }).first();
    for (const title of ['iPhone 14 Pro', 'MacBook Pro (2018)', 'Pro Display XDR', 'Apple Watch Ultra']) {
        await expect(devices.locator('.shoteasy-frame-option').filter({ hasText: title }).first()).toHaveCount(1);
    }
    // 缩略图是真实机身位图（不是矢量预览）
    await expect(devices.locator('img.shoteasy-raster-device-thumb').first()).toBeVisible();

    await devices.locator('.shoteasy-frame-option').filter({ hasText: 'iPhone 14 Pro' }).first().click();
    expect(await frame(page)).toBe('devicescss-iphone-14-pro-black-v1');
    const colors = drawer.locator('.shoteasy-device-colors');
    await expect(colors).toBeVisible();
    await expect(colors.locator('input[type=radio]')).toHaveCount(3);
    await colors.locator('input[value="devicescss-iphone-14-pro-gold-v1"]').check();
    expect(await frame(page)).toBe('devicescss-iphone-14-pro-gold-v1');
});

test('devices.css shells export through the bitmap pipeline without a licence prompt', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = [];
    const notificationRenderWarnings = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (entry) => {
        if (entry.type() === 'error' && /Cannot update a component \(`Notification`\) while rendering/u.test(entry.text())) {
            notificationRenderWarnings.push(entry.text());
        }
    });
    await prepare(page, 'devicescss-macbook-pro-2018-spacegray-v1');

    const sample = async () => page.evaluate(async () => {
        const root = window.__shoteasyStores;
        const read = async (format, ratio) => {
            const result = await root.exportService.exportImage({ format, ratio });
            const url = URL.createObjectURL(result.blob);
            const img = new Image();
            img.src = url;
            await img.decode();
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let opaque = 0;
            for (let y = 0; y < canvas.height; y += 16) {
                for (let x = 0; x < canvas.width; x += 16) {
                    if (data[(y * canvas.width + x) * 4 + 3] > 0) opaque += 1;
                }
            }
            const row = { width: canvas.width, height: canvas.height, size: result.blob.size, corner: [...data.slice(0, 4)], opaque };
            img.src = '';
            URL.revokeObjectURL(url);
            canvas.width = canvas.height = 0;
            return row;
        };
        return { png: await read('png', 2), jpg: await read('jpg', 1), pending: root.renderTaskTracker.size };
    });

    const first = await sample();
    expect([first.png.width, first.png.height]).toEqual([1200, 1000]);
    expect([first.jpg.width, first.jpg.height]).toEqual([600, 500]);
    expect(first.png.corner).toEqual([0, 0, 0, 0]);
    expect(first.jpg.corner[3]).toBe(255);
    for (const channel of first.jpg.corner.slice(0, 3)) expect(channel).toBeGreaterThanOrEqual(252);
    expect(first.png.opaque).toBeGreaterThan(0);
    expect(first.pending).toBe(0);
    // MIT 素材不弹许可说明（Surface/Monkr 才弹）
    await expect(licenseDialog(page)).toHaveCount(0);
    // The undo notice is opened on the next browser task. Let its host settle so
    // the assertion also catches a React render-time notification update.
    await page.waitForTimeout(100);
    expect(errors).toEqual([]);
    expect(notificationRenderWarnings).toEqual([]);
});
