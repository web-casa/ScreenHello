import { expect, test } from '@playwright/test';
import { createPngFixture } from '../fixtures/createPngFixture.js';

const readDownload = async (download) => {
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const part of stream) chunks.push(part);
    return Buffer.concat(chunks);
};

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

    const idsAreUnique = await page.evaluate(() => {
        const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
        return ids.length === new Set(ids).size;
    });
    expect(idsAreUnique).toBe(true);

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
