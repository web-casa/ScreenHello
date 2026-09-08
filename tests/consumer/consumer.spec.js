import { expect, test } from '@playwright/test';
import { createPngFixture } from '../fixtures/createPngFixture.js';
import { readMobileAnnotation } from '../release/mobileAnnotation.mjs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { PNG } from 'pngjs';

test('packaged example imports the desktop screenshot only into its owning editor', async ({ page }) => {
    await page.goto('/?workspace=true');
    const first = page.locator('#consumer-a');
    const second = page.locator('#consumer-b');
    await first.getByRole('button', { name: '试用示例', exact: true }).click();
    await expect(first.locator('.shoteasy-editor-canvas')).toBeVisible();
    await expect(first.getByRole('button', { name: /项目：ScreenHello 示例/ })).toBeVisible();
    await expect(second.getByRole('button', { name: '试用示例', exact: true })).toBeVisible();
    await expect(second.locator('.shoteasy-editor-canvas')).toHaveCount(0);
});

test('packaged artwork upload and drop target only their owning editor', async ({ page }) => {
    await page.goto('/?workspace=true');
    const first = page.locator('#consumer-a');
    const second = page.locator('#consumer-b');
    const firstArtwork = first.getByRole('button', { name: '点击或拖拽图片到这里', exact: true });
    const secondArtwork = second.getByRole('button', { name: '点击或拖拽图片到这里', exact: true });
    expect(await firstArtwork.getAttribute('aria-describedby')).not.toBe(await secondArtwork.getAttribute('aria-describedby'));
    const picker = page.waitForEvent('filechooser');
    await firstArtwork.click();
    await (await picker).setFiles({ name: 'click.png', mimeType: 'image/png', buffer: createPngFixture() });
    await expect(first.locator('.shoteasy-editor-canvas')).toBeVisible();
    await expect(secondArtwork).toBeVisible();
    const data = await page.evaluateHandle(bytes => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(bytes)], 'drop.png', { type: 'image/png' }));
        return transfer;
    }, [...createPngFixture()]);
    await secondArtwork.dispatchEvent('dragenter', { dataTransfer: data });
    await expect(second.locator('.shoteasy-drop-overlay')).toBeVisible();
    await expect(first.locator('.shoteasy-drop-overlay')).toHaveCount(0);
    await secondArtwork.dispatchEvent('drop', { dataTransfer: data });
    await expect(second.locator('.shoteasy-editor-canvas')).toBeVisible();
    await expect(first.locator('.shoteasy-editor-canvas')).toBeVisible();
    await data.dispose();
});

test('packaged initial frame shortcuts are discoverable and isolated across two editors', async ({ page }) => {
    await page.goto('/?workspace=true');
    const first = page.locator('#consumer-a .shoteasy-frame-panel');
    const second = page.locator('#consumer-b .shoteasy-frame-panel');
    for (const panel of [first, second]) {
        await expect(panel.getByRole('button', { name: '更多外框' })).toBeVisible();
        await expect(panel.getByRole('radiogroup', { name: '常用浏览器外框' }).locator('input')).toHaveCount(4);
    }
    const firstDevices = first.getByRole('radiogroup', { name: '常用设备外框' });
    if (await firstDevices.count()) {
        const choice = firstDevices.locator('input').first();
        const secondDevices = second.getByRole('radiogroup', { name: '常用设备外框' });
        const firstThumb = firstDevices.locator('.shoteasy-frame-thumb').first();
        const secondThumb = secondDevices.locator('.shoteasy-frame-thumb').first();
        const siblingMode = await secondThumb.getAttribute('data-mode');
        const originalMode = await firstThumb.getAttribute('data-mode');
        await page.locator('#consumer-a .shoteasy-theme-trigger').click();
        const changedMode = originalMode === 'dark' ? 'light' : 'dark';
        await expect(firstThumb).toHaveAttribute('data-mode', changedMode);
        await expect(secondThumb).toHaveAttribute('data-mode', siblingMode);
        for (const [thumb, mode] of [[firstThumb, changedMode], [secondThumb, siblingMode]]) {
            await expect(thumb).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
            await expect(thumb.locator('img')).toHaveCSS('filter', mode === 'dark' ? /drop-shadow\(rgba?\(255, 255, 255/ : 'none');
        }
        expect(await choice.getAttribute('name')).not.toBe(await secondDevices.locator('input').first().getAttribute('name'));
        await firstDevices.locator('.shoteasy-frame-option').first().click();
        await expect(choice).toBeChecked();
        await expect(second.getByRole('radiogroup', { name: '常用浏览器外框' }).locator('input[value="none"]')).toBeChecked();
        await expect(page.locator('#consumer-a .shoteasy-upload-card')).toBeVisible();
    }
    await first.getByRole('button', { name: '更多外框' }).click();
    await expect(page.locator('#consumer-a .shoteasy-frame-drawer')).toBeVisible();
    await expect(page.locator('#consumer-b .shoteasy-frame-drawer')).toHaveCount(0);
});

for (const [frame, title, variant, mit] of [
    ['surface-pro-8', 'Surface Pro'], ['iphone-bitmap', 'iPhone'],
    ['macbook-air-m2-silver-v1', 'MacBook Air M2', 'macbook-air-m2-starlight-v1'],
    ['imac-24-blue-v1', 'iMac 24″', 'imac-24-purple-v1'],
    ['pixel-9-pro-original-v1', 'Pixel 9 Pro', null, true],
]) {
test(`optional device ${title} survives real library bundling and shows a per-instance download notice`, async ({ page }) => {
    await page.goto('/?workspace=true');
    const first = page.locator('#consumer-a');
    await first.locator('.shoteasy-upload-card input[type=file]').setInputFiles({
        name: 'device.png', mimeType: 'image/png', buffer: createPngFixture(600, 500),
    });
    await first.getByRole('button', { name: '更多外框', exact: true }).click();
    const choice = first.locator('.shoteasy-frame-drawer .shoteasy-frame-option').filter({ has: page.locator(`input[value="${frame}"]`) });
    test.skip(await choice.count() === 0, 'The clean public library does not bundle the optional third-party pack.');
    await choice.click();
    if (variant) {
        const color = first.locator(`.shoteasy-frame-drawer .shoteasy-device-color input[value="${variant}"]`);
        await color.check();
        await expect(color).toBeChecked();
    }
    await first.locator('.shoteasy-frame-drawer-shell .ant-drawer-close').click();
    await first.getByRole('button', { name: '导出图片', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByTestId('export-download').click();
    const dialog = page.getByRole('dialog', { name: '素材许可说明' });
    if (!mit && frame !== 'iphone-bitmap') {
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(title);
        await expect(dialog).not.toContainText('Surface Pro 8');
        if (variant) await expect(dialog).toContainText(variant.includes('starlight') ? '星光色' : '紫色');
        await dialog.getByRole('button', { name: '了解并继续' }).click();
    } else await expect(dialog).toBeHidden();
    const decoded = PNG.sync.read(await readDownload(await download));
    expect(decoded.width).toBeGreaterThan(500);
    expect(decoded.data.some(value => value !== 0)).toBe(true);
    await expect(page.locator('#consumer-b .shoteasy-upload-card')).toBeVisible();
});
}

test('packaged preview displays the downloaded result pixels and keeps sibling settings isolated', async ({ page }) => {
    await page.goto('/?workspace=true');
    const first = page.locator('#consumer-a');
    const second = page.locator('#consumer-b');
    for (const app of [first, second]) await app.locator('.shoteasy-upload-card input[type=file]').setInputFiles({
        name: 'C2.png', mimeType: 'image/png', buffer: createPngFixture(64, 48),
    });
    await first.getByRole('button', { name: '导出图片', exact: true }).click();
    await page.getByTestId('compression-lossy').click();
    await page.getByTestId('palette-64').click();
    await page.getByTestId('export-preview').click();
    await expect(page.getByTestId('preview-viewport').locator('canvas')).toBeVisible({ timeout: 45_000 });
    const displayed = await page.getByTestId('preview-viewport').locator('canvas').evaluate(element => ({
        width: element.width, height: element.height,
        pixels: [...element.getContext('2d').getImageData(0, 0, element.width, element.height).data],
    }));
    const download = page.waitForEvent('download');
    await page.getByTestId('export-download').click();
    const bytes = await readDownload(await download);
    const decoded = PNG.sync.read(bytes);
    expect([decoded.width, decoded.height]).toEqual([displayed.width, displayed.height]);
    // Canvas display premultiplies translucent edges. Compare two independent
    // browser decodes exactly, not straight-alpha PNG bytes to premultiplied UI.
    const downloadedPixels = await page.evaluate(async bytes => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        try {
            const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(bitmap, 0, 0);
            return [...context.getImageData(0, 0, canvas.width, canvas.height).data];
        } finally { bitmap.close(); canvas.width = canvas.height = 0; }
    }, [...bytes]);
    expect(downloadedPixels).toEqual(displayed.pixels);
    await expect(page.locator('.shoteasy-export-drawer')).toHaveCount(0);
    await second.getByRole('button', { name: '导出图片', exact: true }).click();
    await expect(page.getByTestId('compression-standard')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('export-cancel').click();
    await first.getByRole('button', { name: '导出图片', exact: true }).click();
    await expect(page.getByTestId('palette-64')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('export-preview').click();
    await expect(page.getByTestId('preview-viewport').locator('canvas')).toBeVisible();
    await page.evaluate(() => window.__screenhelloConsumer.unmountA());
    await expect(page.getByTestId('compression-result')).toHaveCount(0);
    await expect(first.locator('.shoteasy-app')).toHaveCount(0);
    await expect(second.locator('.shoteasy-editor-canvas')).toBeVisible();
});

test('packaged production PNG workers honor compression settings loaded through the real project UI', async ({ page }) => {
    await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
    await page.goto('/?workspace=true');
    const first = page.locator('#consumer-a');
    await first.locator('.shoteasy-upload-card input[type=file]').setInputFiles({
        name: 'C1.png', mimeType: 'image/png', buffer: createPngFixture(64, 48),
    });
    const save = page.waitForEvent('download');
    await first.getByRole('menuitem', { name: '文件', exact: true }).click();
    await page.getByRole('menuitem', { name: /^保存项目/ }).click();
    const entries = unzipSync(await readDownload(await save));
    for (const settings of [
        { format: 'png', ratio: 1, compression: 'lossless' },
        { format: 'png', ratio: 1, compression: 'lossy', paletteColors: 64 },
    ]) {
        const manifest = JSON.parse(strFromU8(entries['manifest.json']));
        manifest.name = `C1-${settings.compression}`;
        manifest.exportSettings = settings;
        entries['manifest.json'] = strToU8(JSON.stringify(manifest));
        await first.getByTestId('project-file-input').setInputFiles({
            name: 'C1.screenhello', mimeType: 'application/vnd.screenhello.project+zip', buffer: Buffer.from(zipSync(entries)),
        });
        await expect(page.getByText('项目已打开', { exact: true })).toBeVisible();
        await expect(first.getByRole('button', { name: new RegExp(`项目：C1-${settings.compression}`) })).toBeVisible();
        const download = page.waitForEvent('download');
        await first.getByRole('menuitem', { name: '文件', exact: true }).click();
        await page.getByRole('menuitem', { name: /使用当前设置快速导出/ }).click();
        const decoded = PNG.sync.read(await readDownload(await download));
        expect(decoded.width).toBeGreaterThan(0);
        expect(decoded.height).toBeGreaterThan(0);
        await expect(first.getByRole('button', { name: '导出图片', exact: true })).toBeEnabled();
        if (settings.compression === 'lossy') {
            await first.getByRole('menuitem', { name: '文件', exact: true }).click();
            await page.getByRole('menuitem', { name: /^批量处理/ }).click();
            await page.getByTestId('batch-file-input').setInputFiles([
                { name: 'C3.png', mimeType: 'image/png', buffer: createPngFixture(64, 48) },
                { name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('invalid') },
            ]);
            const drawer = page.locator('.shoteasy-batch-drawer');
            await drawer.getByRole('button', { name: '开始批量处理' }).click();
            await expect(drawer.getByRole('status')).toContainText('1 张成功');
            await expect(page.getByTestId('batch-frozen-settings')).toContainText('最多 64 色');
            await expect(page.getByTestId('batch-retry-notice')).toBeVisible();
            const batchDownload = page.waitForEvent('download');
            await drawer.getByRole('button', { name: '下载 ZIP' }).click();
            const batchEntries = unzipSync(await readDownload(await batchDownload));
            expect(Object.keys(batchEntries)).toEqual(['C3-screenhello.png']);
            const output = PNG.sync.read(Buffer.from(batchEntries['C3-screenhello.png']));
            const colors = new Set();
            for (let i = 0; i < output.data.length; i += 4) colors.add(output.data.subarray(i, i + 4).toString('hex'));
            expect(colors.size).toBeLessThanOrEqual(64);
            await drawer.getByRole('button', { name: '重试失败项' }).click();
            await expect(drawer.getByRole('status')).toContainText('0 张成功');
            await expect(drawer.getByRole('button', { name: '下载 ZIP' })).toBeDisabled();
        }
    }
    await expect(page.locator('#consumer-b .shoteasy-upload-card')).toBeVisible();
});

test('packaged library supports seven languages without changing sibling locale', async ({ page }) => {
    await page.goto('/?workspace=true&locales=mixed');
    await expect(page.locator('#consumer-a').getByRole('menuitem', { name: 'File', exact: true })).toBeVisible();
    await expect(page.locator('#consumer-b').getByRole('menuitem', { name: '文件', exact: true })).toBeVisible();
    await expect(page.locator('#consumer-a .shoteasy-app')).toHaveAttribute('lang', 'en-US');
    await expect(page.locator('#consumer-b .shoteasy-app')).toHaveAttribute('lang', 'zh-CN');
    for (const [locale, label] of [
        ['zh-TW', '繁體中文'], ['de-DE', 'Deutsch'], ['ko-KR', '한국어'],
        ['es-ES', 'Español'], ['pt-PT', 'Português'], ['zh-CN', '简体中文'], ['en-US', 'English'],
    ]) {
        await page.locator('#consumer-a .shoteasy-language-trigger').click();
        await page.getByRole('menuitemradio', { name: label, exact: true }).click();
        await expect(page.locator('#consumer-a .shoteasy-app')).toHaveAttribute('lang', locale);
        await expect(page.locator('#consumer-b .shoteasy-app')).toHaveAttribute('lang', 'zh-CN');
    }
});

const readDownload = async (download) => {
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const part of stream) chunks.push(part);
    return Buffer.concat(chunks);
};

test('appearance controls stay reachable inside a narrow host on a wide screen', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const workspace of [false, true]) {
        await page.goto(`/?workspace=${workspace}&locales=mixed`);
        const first = page.locator('#consumer-a');
        await first.evaluate((element) => { element.style.width = '640px'; });
        const app = first.locator('.shoteasy-app');
        await expect(app).toBeVisible();
        const appBox = await app.boundingBox();
        for (const control of ['.shoteasy-theme-trigger', '.shoteasy-language-trigger']) {
            const box = await first.locator(control).boundingBox();
            expect(box.x + box.width).toBeLessThanOrEqual(appBox.x + appBox.width);
        }
        await first.locator('.shoteasy-language-trigger').click();
        await page.getByRole('menuitemradio', { name: 'Deutsch', exact: true }).click();
        await expect(app).toHaveAttribute('lang', 'de-DE');
        const translatedBox = await first.locator('.shoteasy-language-trigger').boundingBox();
        expect(translatedBox.x + translatedBox.width).toBeLessThanOrEqual(appBox.x + appBox.width);
        if (workspace) {
            await first.locator('.shoteasy-mobile-menu-trigger').click();
            await expect(page.getByRole('tab', { name: 'Datei', exact: true })).toBeVisible();
            await page.keyboard.press('Escape');
        }
    }
});

const readDraftKeys = async () => {
    const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    if (!databases.some((database) => database.name === 'shoteasy')) return [];
    return new Promise((resolve, reject) => {
        // Read the application's current schema instead of pinning an older
        // version and turning a harmless test helper into a VersionError.
        const open = indexedDB.open('shoteasy');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const request = db.transaction('projects', 'readonly').objectStore('projects').getAllKeys();
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                db.close();
                resolve(request.result);
            };
        };
    });
};

test('keeps portal labels and mobile section names local to two workspace instances', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto('/?workspace=true');
    for (const key of ['a', 'b']) {
        await page.locator(`#consumer-${key} .shoteasy-upload-card input[type="file"]`).setInputFiles({
            name: `${key}.png`, mimeType: 'image/png', buffer: createPngFixture(),
        });
        await expect(page.locator(`#consumer-${key} .shoteasy-editor-canvas`)).toBeVisible();
    }

    // Deliberately keep both portals mounted. Pointer capture activates their
    // owning runtime; DOM clicks bypass the first modal's mask for this stress case.
    const openBoth = async (selector) => {
        for (const key of ['a', 'b']) {
            await page.locator(`#consumer-${key} ${selector}`).evaluate((button) => {
                button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
                button.click();
            });
        }
    };
    await openBoth('[aria-label="打开批量处理"]');
    const labels = page.locator('.shoteasy-batch-label');
    await expect(labels).toHaveCount(2);
    expect(await labels.evaluateAll((elements) => elements.map((label) => {
        const target = document.getElementById(label.htmlFor);
        return Boolean(target && label.control === target && label.closest('.shoteasy-batch').contains(target)
            && [...document.querySelectorAll('[id]')].filter((element) => element.id === label.htmlFor).length === 1);
    }))).toEqual([true, true]);
    const ids = await labels.evaluateAll((elements) => elements.map((label) => label.htmlFor));
    expect(new Set(ids).size).toBe(2);
    await page.locator('.shoteasy-batch-drawer .ant-drawer-close').evaluateAll((buttons) => buttons.reverse().forEach((button) => button.click()));
    await expect(labels).toHaveCount(0);

    await openBoth('.shoteasy-mobile-annotation-trigger');
    const sections = page.locator('.shoteasy-mobile-annotation-sheet section[aria-labelledby]');
    await expect(sections).toHaveCount(4);
    const annotation = await page.evaluate(readMobileAnnotation);
    expect(annotation.labels).toEqual(['矩形', '实心矩形', '圆形', '直线', '箭头', '画笔']);
    expect(annotation.minimumTargetSize).toBeGreaterThanOrEqual(44);
    expect(annotation.noHorizontalOverflow).toBe(true);
    expect(await sections.evaluateAll((elements) => elements.map((section) => {
        const id = section.getAttribute('aria-labelledby');
        const heading = document.getElementById(id);
        return Boolean(heading && section.contains(heading) && heading.tagName === 'H3'
            && [...document.querySelectorAll('[id]')].filter((element) => element.id === id).length === 1);
    }))).toEqual([true, true, true, true]);
    expect(pageErrors).toEqual([]);
    await page.evaluate(() => window.__screenhelloConsumer.unmount());
    await expect(sections).toHaveCount(0);
});

test('isolates two library instances, drafts, shortcuts, and unmount/remount', async ({ page }) => {
    const pageErrors = [];
    const migrationWarnings = [];
    const externalRequests = [];
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
        if (/Warning: \[antd:|Function components cannot be given refs|Invalid DOM property/.test(message.text())) {
            migrationWarnings.push(message.text());
        }
    });
    await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (['127.0.0.1', 'localhost'].includes(url.hostname) || ['blob:', 'data:'].includes(url.protocol)) {
            await route.continue();
            return;
        }
        externalRequests.push(url.href);
        await route.abort('blockedbyclient');
    });
    await page.goto('/');

    const apps = page.locator('.shoteasy-app');
    const first = page.locator('#consumer-a .shoteasy-app');
    const second = page.locator('#consumer-b .shoteasy-app');
    const firstUndo = page.locator('#consumer-a').getByRole('button', { name: '撤销' });
    const secondUndo = page.locator('#consumer-b').getByRole('button', { name: '撤销' });
    const firstNoBackground = page.locator('#consumer-a .shoteasy-inspector input[value="none"]');

    await expect(apps).toHaveCount(2);
    await expect(page.getByRole('button', { name: '打开批量处理' })).toHaveCount(0);
    await expect(page.getByRole('menubar', { name: '应用菜单' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^项目：/ })).toHaveCount(0);
    await expect(first).toHaveCSS('display', 'flex');
    await expect(second).toHaveCSS('display', 'flex');
    await expect.poll(() => page.evaluate(() => {
        const images = [...document.images].filter((image) => image.src.startsWith(window.location.origin));
        return images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0);
    })).toBe(true);
    expect(externalRequests).toEqual([]);
    expect(requests.some((url) => /avifEncoder|avif_enc/.test(url))).toBe(false);

    const duplicateIds = await page.evaluate(() => {
        const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
        return ids.filter((id, index) => ids.indexOf(id) !== index);
    });
    expect(duplicateIds).toEqual([]);

    await page.locator('#consumer-b .shoteasy-upload-card input[type="file"]').setInputFiles({
        name: 'broken.png',
        mimeType: 'image/png',
        buffer: Buffer.from('not-a-png'),
    });
    await expect(page.getByText('图片加载失败，请选择有效图片')).toBeVisible();
    expect(pageErrors).toEqual([]);
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();

    await page.locator('#consumer-a .shoteasy-upload-card input[type="file"]').setInputFiles({
        name: 'consumer-a.png',
        mimeType: 'image/png',
        buffer: createPngFixture(),
    });
    await expect(page.locator('#consumer-a').getByRole('button', { name: '下载图片' })).toBeEnabled();
    await expect(page.locator('#consumer-b').getByRole('button', { name: '下载图片' })).toBeDisabled();

    await page.locator('#consumer-a .shoteasy-editor-canvas').click({ position: { x: 20, y: 20 } });
    const shortcutDownloadPromise = page.waitForEvent('download');
    await page.keyboard.press('Control+s');
    const shortcutDownload = await shortcutDownloadPromise;
    expect(shortcutDownload.suggestedFilename()).toBe('ScreenHello.png');
    expect((await readDownload(shortcutDownload)).subarray(1, 4).toString('ascii')).toBe('PNG');

    await page.locator('#consumer-a').getByRole('button', { name: /导出格式与倍率/ }).click();
    await page.locator('.shoteasy-export-popover:visible .ant-segmented-item').filter({ hasText: 'avif' }).click();
    const avifDownloadPromise = page.waitForEvent('download');
    await page.locator('#consumer-a').getByRole('button', { name: '下载图片' }).click();
    const avifDownload = await avifDownloadPromise;
    const avifBytes = await readDownload(avifDownload);
    expect(avifDownload.suggestedFilename()).toBe('ScreenHello.avif');
    expect(avifBytes.subarray(4, 8).toString('ascii')).toBe('ftyp');
    expect(avifBytes.subarray(8, 12).toString('ascii')).toBe('avif');
    await expect.poll(() => requests.some((url) => /avifEncoder|avif_enc/.test(url))).toBe(true);
    await expect(page.locator('#consumer-b').getByRole('button', { name: /当前 1x PNG/ })).toBeVisible();

    await page.locator('#consumer-a .shoteasy-inspector [title="无背景"]').click();
    await expect(firstNoBackground).toBeChecked();
    await expect(firstUndo).toBeEnabled();
    await expect(secondUndo).toBeDisabled();

    await page.locator('#consumer-a').getByRole('button', { name: '切换主题' }).click();
    await expect(first).toHaveAttribute('data-mode', 'light');
    await expect(second).toHaveAttribute('data-mode', 'dark');

    await expect.poll(() => page.evaluate(readDraftKeys), { timeout: 10_000 }).toContain('consumer-a');
    expect(await page.evaluate(readDraftKeys)).not.toContain('consumer-b');

    await page.locator('#consumer-b .shoteasy-empty-state').click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('Control+z');
    await expect(firstNoBackground).toBeChecked();
    await page.locator('#consumer-a .shoteasy-editor-canvas').click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('Control+z');
    await expect(firstNoBackground).not.toBeChecked();

    const firstRuntimeId = await first.getAttribute('data-screenhello-instance');
    await page.evaluate(() => window.__screenhelloConsumer.unmountA());
    await expect(first).toHaveCount(0);
    await expect(second).toBeVisible();
    await page.evaluate(() => window.__screenhelloConsumer.mountA());
    await expect(first).toBeVisible();
    await expect(first).not.toHaveAttribute('data-screenhello-instance', firstRuntimeId);

    await page.evaluate(() => window.__screenhelloConsumer.unmount());
    await expect(apps).toHaveCount(0);
    await expect(page.locator('#consumer-a')).toBeEmpty();
    await expect(page.locator('#consumer-b')).toBeEmpty();
    expect(pageErrors).toEqual([]);
    expect(migrationWarnings).toEqual([]);
});
test('packaged image backgrounds load as separate assets and stay isolated across two editors', async ({ page }) => {
    await page.goto('/?workspace=true');
    const first = page.locator('#consumer-a'), second = page.locator('#consumer-b');
    for (const app of [first, second]) await app.locator('.shoteasy-upload-card input[type=file]').setInputFiles({
        name: 'background.png', mimeType: 'image/png', buffer: createPngFixture(64, 48),
    });
    const a = first.getByRole('button', { name: '晨雾山脉', exact: true });
    const b = second.getByRole('button', { name: '晨雾山脉', exact: true });
    await a.click(); await expect(a).toHaveAttribute('aria-pressed', 'true'); await expect(b).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => a.locator('img').evaluate(img => img.complete && img.naturalWidth === 240 && !img.src.startsWith('data:'))).toBe(true);
    const aTitle = first.locator('.se-background-preset-section'), bTitle = second.locator('.se-background-preset-section');
    expect(await aTitle.getAttribute('aria-labelledby')).not.toBe(await bTitle.getAttribute('aria-labelledby'));
    await first.getByRole('button', { name: '导出图片', exact: true }).click();
    const download = page.waitForEvent('download'); await page.getByTestId('export-download').click();
    const pixels = PNG.sync.read(await readDownload(await download));
    expect(pixels.width).toBeGreaterThan(0); expect(pixels.height).toBeGreaterThan(0);
    await page.evaluate(() => window.__screenhelloConsumer.unmountA());
    await b.click(); await expect(b).toHaveAttribute('aria-pressed', 'true');
});
