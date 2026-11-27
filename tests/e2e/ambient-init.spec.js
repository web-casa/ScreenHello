import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createPngFixture } from '../fixtures/createPngFixture.js';
import { existsSync } from 'node:fs';

const fixture = { name: 'ambient.png', mimeType: 'image/png', buffer: createPngFixture() };
const quickPack = ['macbook-air-m2-silver-v1', 'imac-24-blue-v1', 'surface-pro-8', 'pixel-9-pro-original-v1'];
const hasQuickPack = quickPack.every(id => existsSync(new URL(`../../local-device-assets/${id}.png`, import.meta.url)));

for (const [width, kind, dimensions] of [[390, 'mobile', [660, 1434]], [767, 'mobile', [660, 1434]],
    [768, 'desktop', [2048, 1168]], [1280, 'desktop', [2048, 1168]]]) {
    test(`example chooses the supplied ${kind} screenshot at ${width}px only on demand`, async ({ page }) => {
        const loaded = [];
        page.on('request', request => {
            if (request.resourceType() === 'fetch' && /demo-(?:mobile|desktop)\.webp$/.test(new URL(request.url()).pathname)) loaded.push(request.url());
        });
        await page.goto('/');
        // Resize after mounting: the click must use current width, not stale state.
        await page.setViewportSize({ width, height: 900 });
        const button = page.getByRole('button', { name: '试用示例', exact: true });
        await expect(button).toBeVisible();
        expect(loaded).toEqual([]);
        await button.focus();
        await button.press('Enter');
        await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();
        const info = await page.evaluate(() => {
            const { editor, imageStore, workspace } = window.__shoteasyStores;
            return { name: editor.img.name, size: [editor.img.width, editor.img.height], count: imageStore.list.length, project: workspace.projectName };
        });
        expect(info).toEqual({ name: `ScreenHello-demo-${kind}.webp`, size: dimensions, count: 1, project: 'ScreenHello 示例' });
        expect(loaded).toHaveLength(1);
        expect(new URL(loaded[0]).pathname).toContain(`demo-${kind}.webp`);
        await page.setViewportSize({ width: kind === 'mobile' ? 1280 : 390, height: 900 });
        expect(await page.evaluate(() => window.__shoteasyStores.editor.img.name)).toBe(info.name);
    });
}

test('a failed example load can be retried without adding a broken image', async ({ page }) => {
    await page.route('**/demo-desktop.webp*', route => route.request().resourceType() === 'fetch' ? route.abort() : route.continue());
    await page.goto('/');
    const button = page.getByRole('button', { name: '试用示例', exact: true });
    await button.click();
    await expect(page.getByText('示例图片加载失败，请选择本地图片')).toBeVisible();
    await expect(button).toHaveAttribute('aria-busy', 'false');
    expect(await page.evaluate(() => window.__shoteasyStores.imageStore.list.length)).toBe(0);
    await page.unroute('**/demo-desktop.webp*');
    await button.click();
    await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();
    expect(await page.evaluate(() => window.__shoteasyStores.imageStore.list.length)).toBe(1);
});

for (const theme of ['light', 'dark']) {
    test(`initial frame rail exposes browsers and real devices before more frames in ${theme}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.goto('/');
        await page.waitForFunction(() => Boolean(window.__shoteasyStores));
        await page.evaluate(theme => window.__shoteasyStores.editor.setTheme(theme), theme);
        const panel = page.locator('.shoteasy-frame-panel');
        const browsers = panel.getByRole('radiogroup', { name: '常用浏览器外框' });
        await expect(browsers.locator('input')).toHaveCount(4);
        await expect(browsers.locator('input[value="none"]')).toBeChecked();
        const more = panel.getByRole('button', { name: '更多外框' });
        await expect(more).toBeInViewport();
        expect((await more.boundingBox()).height).toBeGreaterThanOrEqual(44);
        if (hasQuickPack) {
            const devices = panel.getByRole('radiogroup', { name: '常用设备外框' });
            await expect(devices.locator('input')).toHaveCount(4);
            expect(await devices.locator('input').evaluateAll(inputs => inputs.map(input => input.value))).toEqual(quickPack);
            for (const thumb of await devices.locator('img').all()) {
                await expect(thumb).toBeInViewport();
                await expect.poll(() => thumb.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
            }
            const box = await devices.boundingBox();
            expect((await more.boundingBox()).y).toBeGreaterThanOrEqual(box.y + box.height);
        }
        expect((await new AxeBuilder({ page }).include('.shoteasy-frame-panel').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath(`frame-quick-${theme}.png`) });
        await more.focus(); await page.keyboard.press('Enter');
        await expect(page.locator('.shoteasy-frame-drawer')).toBeVisible();
        await expect(page.locator('.shoteasy-frame-drawer').getByRole('radiogroup', { name: '浏览器', exact: true }).locator('input')).toHaveCount(5);
        await page.locator('.shoteasy-frame-drawer-shell .ant-drawer-close').click();
        await expect(more).toBeFocused();
        await expect(page.getByRole('button', { name: '选择图片', exact: true })).toBeVisible();
    });
}

test('quick device selection before import survives upload, drawer color changes and undo', async ({ page }) => {
    test.skip(!hasQuickPack, 'Optional local device pack is not installed.');
    await page.goto('/');
    const panel = page.locator('.shoteasy-frame-panel');
    await panel.getByRole('radiogroup', { name: '常用设备外框' }).locator('.shoteasy-frame-option').filter({ hasText: 'MacBook Air M2' }).click();
    await expect(page.locator('.shoteasy-init-canvas')).toBeVisible();
    await panel.locator('.shoteasy-device-color').filter({ hasText: '星光色' }).click();
    await page.locator('.shoteasy-upload-card input[type=file]').setInputFiles(fixture);
    await page.waitForFunction(() => window.__shoteasyStores?.editor.app?.tree);
    expect(await page.evaluate(() => window.__shoteasyStores.option.frame)).toBe('macbook-air-m2-starlight-v1');
    await expect(panel.getByRole('radiogroup', { name: '常用设备外框' }).locator('input[value="macbook-air-m2-starlight-v1"]')).toBeChecked();
    await panel.getByRole('button', { name: '更多外框' }).click();
    const drawer = page.locator('.shoteasy-frame-drawer');
    await drawer.getByRole('radiogroup', { name: '设备', exact: true }).locator('.shoteasy-frame-option').filter({ hasText: 'Surface Studio' }).click();
    await page.locator('.shoteasy-frame-drawer-shell .ant-drawer-close').click();
    await expect(panel.getByRole('radiogroup', { name: '常用设备外框' }).locator('input[value="surface-studio"]')).toBeChecked();
    await page.evaluate(() => window.__shoteasyStores.history.undo());
    await expect(panel.getByRole('radiogroup', { name: '常用设备外框' }).locator('input[value="macbook-air-m2-starlight-v1"]')).toBeChecked();
    // Direct device selections still use the real exporter, including transparent
    // PNG, white JPG/WebP and the requested dimensions/ratio.
    const rows = await page.evaluate(async () => {
        const root = window.__shoteasyStores;
        root.option.setSize({ type: 'custom', title: '自定义', width: 600, height: 500 });
        root.option.setBackground('none'); root.option.setPadding(0);
        root.option.setShadowConf({ visible: false }); root.option.setRound(0);
        const rows = [];
        for (const format of ['png', 'jpg', 'webp']) {
            const result = await root.exportService.exportImage({ format, ratio: format === 'png' ? 2 : 1 });
            const bitmap = await createImageBitmap(result.blob);
            const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
            rows.push({ format, width: canvas.width, height: canvas.height, corner: [...ctx.getImageData(0, 0, 1, 1).data] });
            bitmap.close(); canvas.width = canvas.height = 0;
        }
        return rows;
    });
    for (const row of rows) {
        expect([row.width, row.height]).toEqual(row.format === 'png' ? [1200, 1000] : [600, 500]);
        if (row.format === 'png') expect(row.corner).toEqual([0, 0, 0, 0]);
        else { expect(row.corner[3]).toBe(255); expect(Math.min(...row.corner.slice(0, 3))).toBeGreaterThanOrEqual(252); }
    }
});

test('mobile initial frame drawer shows quick devices and localized more action', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: '打开应用菜单' }).click();
    await page.getByRole('tab', { name: '视图', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: '显示尺寸与外框', exact: true }).click();
    const panel = page.locator('.shoteasy-compact-panel-drawer .shoteasy-frame-panel');
    if (hasQuickPack) await expect(panel.getByRole('radiogroup', { name: '常用设备外框' }).locator('input')).toHaveCount(4);
    for (const [locale, label] of [['zh-CN', '更多外框'], ['en-US', 'More frames'], ['zh-TW', '更多外框'], ['de-DE', 'Weitere Rahmen'], ['ko-KR', '더 많은 프레임'], ['es-ES', 'Más marcos'], ['pt-PT', 'Mais molduras']]) {
        await page.evaluate(locale => window.__shoteasyStores.i18n.setOptions(locale), locale);
        const more = panel.getByRole('button', { name: label, exact: true });
        await more.scrollIntoViewIfNeeded(); await expect(more).toBeInViewport();
        expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await panel.getByRole('button', { name: 'Mais molduras', exact: true }).click();
    await expect(page.locator('.shoteasy-frame-drawer')).toBeVisible();
    expect((await new AxeBuilder({ page }).include('.shoteasy-frame-drawer').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

for (const width of [390, 1280]) {
    for (const theme of ['light', 'dark']) {
        test(`Ambient Shelf is readable and keyboard accessible at ${width}px in ${theme}`, async ({ page }, testInfo) => {
            await page.setViewportSize({ width, height: 900 });
            await page.goto('/');
            await page.waitForFunction(() => Boolean(window.__shoteasyStores));
            await page.evaluate((mode) => window.__shoteasyStores.editor.setTheme(mode), theme);
            const welcome = page.locator('.shoteasy-init-canvas');
            await expect(page.locator('.shoteasy-app')).toHaveAttribute('data-mode', theme);
            await expect(welcome.getByRole('heading')).toHaveCSS('color', theme === 'light' ? 'rgb(23, 32, 51)' : 'rgb(255, 255, 255)');
            await expect(welcome.getByRole('heading', { name: '为好图片，留一个位置' })).toBeVisible();
            await expect(welcome.locator('.shoteasy-init-art')).toHaveJSProperty('complete', true);
            expect(await welcome.locator('.shoteasy-init-art').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
            const choose = welcome.getByRole('button', { name: '选择图片', exact: true });
            const demo = welcome.getByRole('button', { name: '试用示例', exact: true });
            await expect(demo).toHaveCSS('background-color', theme === 'light' ? 'rgb(204, 251, 241)' : 'rgb(19, 78, 74)');
            const artwork = welcome.getByRole('button', { name: '点击或拖拽图片到这里', exact: true });
            await artwork.focus();
            await expect(artwork).toBeFocused();
            await expect(artwork).toHaveCSS('outline-style', 'solid');
            expect((await artwork.boundingBox()).height).toBeGreaterThanOrEqual(44);
            await choose.focus();
            await expect(choose).toBeFocused();
            const box = await choose.boundingBox();
            expect(box.height).toBeGreaterThanOrEqual(44);
            expect(await welcome.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
            const results = await new AxeBuilder({ page }).include('.shoteasy-init-canvas').analyze();
            expect(results.violations).toEqual([]);
            await page.screenshot({ path: testInfo.outputPath(`ambient-${theme}-${width}.png`), fullPage: true });
        });
    }
}

test('select image opens one file chooser and imports through the existing editor', async ({ page }) => {
    await page.goto('/');
    const choose = page.getByRole('button', { name: '选择图片', exact: true });
    await choose.focus();
    const chooserPromise = page.waitForEvent('filechooser');
    await choose.press('Enter');
    const chooser = await chooserPromise;
    await chooser.setFiles(fixture);
    await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.editor.img?.name)).toBe('ambient.png');
    expect(await page.evaluate(() => window.__shoteasyStores.option.background)).toBe('gh_img_50');
});

for (const [activation, width] of [['click', 1280], ['Enter', 1280], ['Space', 1280], ['click', 390]]) {
    test(`artwork opens one file chooser via ${activation} at ${width}px and preserves frame choice`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');
        await page.waitForFunction(() => Boolean(window.__shoteasyStores));
        await page.evaluate(() => window.__shoteasyStores.option.setFrame('macosBarLight'));
        const artwork = page.getByRole('button', { name: '点击或拖拽图片到这里', exact: true });
        let pickerCount = 0;
        page.on('filechooser', () => pickerCount++);
        const pickerPromise = page.waitForEvent('filechooser');
        if (activation === 'click') {
            // Hit the actual center of the illustration, not only a DOM handler.
            const box = await artwork.locator('img').boundingBox();
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        } else {
            await artwork.focus();
            await artwork.press(activation);
        }
        const picker = await pickerPromise;
        await picker.setFiles(fixture);
        await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();
        expect(pickerCount).toBe(1);
        expect(await page.evaluate(() => ({
            name: window.__shoteasyStores.editor.img?.name,
            count: window.__shoteasyStores.imageStore.list.length,
            frame: window.__shoteasyStores.option.frame,
        }))).toEqual({ name: 'ambient.png', count: 1, frame: 'macosBarLight' });
    });
}

test('artwork picker cancellation and an invalid image leave upload available', async ({ page }) => {
    await page.goto('/');
    const artwork = page.getByRole('button', { name: '点击或拖拽图片到这里', exact: true });
    const emptyPicker = page.waitForEvent('filechooser');
    await artwork.click();
    await (await emptyPicker).setFiles([]);
    await expect(artwork).toBeVisible();
    const badPicker = page.waitForEvent('filechooser');
    await artwork.click();
    await (await badPicker).setFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a PNG') });
    await expect(page.getByText('图片加载失败，请选择有效图片')).toBeVisible();
    await expect(artwork).toBeVisible();
    await expect(page.locator('.shoteasy-upload-card input[type=file]')).toHaveValue('');
    const goodPicker = page.waitForEvent('filechooser');
    await artwork.click();
    await (await goodPicker).setFiles(fixture);
    await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();
    expect(await page.evaluate(() => window.__shoteasyStores.imageStore.list.length)).toBe(1);
});

for (const target of ['.shoteasy-upload-card button', '.shoteasy-init-art-button', '.shoteasy-init-canvas']) {
test(`invalid drag clears the overlay and dropping on ${target} imports once`, async ({ page }) => {
    await page.goto('/');
    const invalid = await page.evaluateHandle(() => {
        const data = new DataTransfer();
        data.items.add(new File(['bad'], 'bad.txt', { type: 'text/plain' }));
        return data;
    });
    const surface = page.locator('.shoteasy-empty-state');
    await surface.dispatchEvent('dragenter', { dataTransfer: invalid });
    await expect(page.locator('.shoteasy-drop-overlay')).toBeVisible();
    await surface.dispatchEvent('drop', { dataTransfer: invalid });
    await expect(page.locator('.shoteasy-drop-overlay')).toHaveCount(0);
    await expect(page.getByText('图片加载失败，请选择有效图片')).toBeVisible();
    await invalid.dispose();
    const valid = await page.evaluateHandle((bytes) => {
        const data = new DataTransfer();
        data.items.add(new File([new Uint8Array(bytes)], 'ambient.png', { type: 'image/png' }));
        return data;
    }, [...fixture.buffer]);
    const destination = page.locator(target);
    await destination.dispatchEvent('dragenter', { dataTransfer: valid });
    await expect(page.locator('.shoteasy-drop-overlay')).toBeVisible();
    expect(await destination.evaluate((element, dataTransfer) => {
        const event = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer });
        element.dispatchEvent(event);
        return event.defaultPrevented;
    }, valid)).toBe(true);
    await destination.dispatchEvent('dragleave', { dataTransfer: valid, relatedTarget: null });
    await expect(page.locator('.shoteasy-drop-overlay')).toHaveCount(0);
    await destination.dispatchEvent('dragenter', { dataTransfer: valid });
    await destination.dispatchEvent('drop', { dataTransfer: valid });
    await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();
    expect(await page.evaluate(() => window.__shoteasyStores.imageStore.list.length)).toBe(1);
    await valid.dispose();
});
}
