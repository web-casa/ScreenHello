import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { createPngFixture } from '../fixtures/createPngFixture.js';

const isDemoRequest = (url) => /(?:^|\/)demo(?:-[^/]+)?\.jpg$/.test(new URL(url).pathname);

async function openOffline(page) {
    await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (
            url.hostname === '127.0.0.1'
            || url.hostname === 'localhost'
            || url.protocol === 'blob:'
            || url.protocol === 'data:'
        ) {
            await route.continue();
        } else {
            await route.abort('blockedbyclient');
        }
    });
    await page.goto('/');
}

async function importFixture(page, { width = 64, height = 48 } = {}) {
    const fileInput = page.locator('.shoteasy-upload-card input[type="file"]');
    await fileInput.setInputFiles({
        name: 'screenhello-phase1.png',
        mimeType: 'image/png',
        buffer: createPngFixture(width, height),
    });
    await expect.poll(
        () => page.evaluate(() => window.__shoteasyStores?.editor?.img?.width),
        { timeout: 15_000 }
    ).toBe(width);
    await expect(page.getByRole('button', { name: '下载图片' })).toBeEnabled();
}

async function appendFixtures(page, names = ['screenhello-layer-2.png']) {
    await page.getByTestId('add-image-input').setInputFiles(names.map((name) => ({
        name,
        mimeType: 'image/png',
        buffer: createPngFixture(),
    })));
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.imageStore.list.length)).toBe(names.length + 1);
}

async function waitForLocalImages(page) {
    await expect.poll(() => page.evaluate(() => {
        const localImages = [...document.images].filter((image) => image.src.startsWith(window.location.origin));
        return localImages.length > 0 && localImages.every((image) => image.complete && image.naturalWidth > 0);
    }), { timeout: 15_000 }).toBe(true);
}

async function disableFileSystemAccess(page) {
    await page.addInitScript(() => {
        Object.defineProperty(globalThis, 'showOpenFilePicker', { configurable: true, value: undefined });
        Object.defineProperty(globalThis, 'showSaveFilePicker', { configurable: true, value: undefined });
    });
}

async function trackObjectUrls(page) {
    await page.addInitScript(() => {
        const active = new Set();
        const create = URL.createObjectURL.bind(URL);
        const revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = (blob) => {
            const url = create(blob);
            active.add(url);
            return url;
        };
        URL.revokeObjectURL = (url) => {
            active.delete(url);
            revoke(url);
        };
        globalThis.__screenhelloObjectUrls = active;
    });
}

async function readDownload(download) {
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const part of stream) chunks.push(part);
    return Buffer.concat(chunks);
}

test('loads without external services, imports, edits, undoes, and redoes', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await openOffline(page);
    await expect(page.getByText('点击或拖拽图片到这里')).toBeVisible();
    await importFixture(page);

    await page.locator('.shoteasy-inspector [title="无背景"]').click();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.option.background)).toBe('none');

    const undo = page.getByRole('button', { name: '撤销' });
    const redo = page.getByRole('button', { name: '重做' });
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.option.background)).toBe('gh_img_50');
    await expect(redo).toBeEnabled();
    await redo.click();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.option.background)).toBe('none');

    expect(pageErrors).toEqual([]);
});

test('uses code-native backgrounds and defers low-frequency modules', async ({ page }) => {
    const requests = [];
    page.on('request', (request) => requests.push({
        url: request.url(),
        resourceType: request.resourceType(),
    }));

    await openOffline(page);
    await expect(page.getByText('点击或拖拽图片到这里')).toBeVisible();
    await waitForLocalImages(page);

    const externalRequests = requests.filter(({ url }) => {
        const parsed = new URL(url);
        return !['127.0.0.1', 'localhost'].includes(parsed.hostname)
            && !['blob:', 'data:'].includes(parsed.protocol);
    });
    expect(externalRequests).toEqual([]);

    expect(requests.some(({ url }) => new URL(url).pathname.includes('/gradients/'))).toBe(false);
    await expect(page.getByText('精选渐变', { exact: true })).toBeVisible();
    expect(requests.some(({ url, resourceType }) =>
        ['image', 'fetch'].includes(resourceType) && isDemoRequest(url))).toBe(false);

    for (const deferredModule of ['DrawerBar.jsx', 'CropperDialog.jsx', 'EmojiPicker.jsx', 'BatchExportPanel.jsx', 'batchExportService.js', 'BatchRenderSession.jsx', 'avifEncoder.js', 'avifEncoder.worker.js', 'avif_enc.wasm']) {
        expect(requests.some(({ url }) => new URL(url).pathname.endsWith(deferredModule))).toBe(false);
    }

    await page.getByRole('button', { name: '打开批量处理' }).click();
    await expect.poll(() => requests.some(({ url }) => new URL(url).pathname.endsWith('/BatchExportPanel.jsx'))).toBe(true);
    expect(requests.some(({ url }) => new URL(url).pathname.endsWith('/batchExportService.js'))).toBe(false);
    expect(requests.some(({ url }) => new URL(url).pathname.endsWith('/BatchRenderSession.jsx'))).toBe(false);
    const batchDrawer = page.locator('.shoteasy-batch-drawer');
    await batchDrawer.locator('.ant-drawer-close').click();
    await expect(batchDrawer).toBeHidden();

    await page.locator('.shoteasy-right-inspector').getByRole('button', { name: /更多/ }).first().click();
    await expect.poll(() => requests.some(({ url }) => new URL(url).pathname.endsWith('/DrawerBar.jsx'))).toBe(true);
    const backgroundDrawer = page.locator('.shoteasy-background-drawer');
    await expect(backgroundDrawer).toBeVisible();
    await backgroundDrawer.getByRole('button', { name: '返回' }).click();
    await expect(backgroundDrawer).toBeHidden();

    await page.evaluate(() => window.__shoteasyStores.option.applyBackground('gh_img_65'));
    await expect.poll(() => page.evaluate(() => ({
        key: window.__shoteasyStores.option.background,
        type: window.__shoteasyStores.option.frameConf.background?.type,
        url: window.__shoteasyStores.option.frameConf.background?.url,
    }))).toMatchObject({ key: 'gh_img_65', type: 'linear', url: undefined });
    expect(requests.some(({ url }) => new URL(url).pathname.includes('/gradients/'))).toBe(false);

    await importFixture(page);
    await page.getByRole('button', { name: '裁剪图片' }).click();
    await expect.poll(() => requests.some(({ url }) => new URL(url).pathname.endsWith('/CropperDialog.jsx'))).toBe(true);
    const cropDialog = page.getByRole('dialog', { name: '裁剪' });
    await expect(cropDialog).toBeVisible();
    await cropDialog.getByRole('button', { name: /取\s*消/ }).click();
    await expect(cropDialog).toBeHidden();

    await page.getByRole('button', { name: '选择表情' }).click();
    await expect.poll(() => requests.some(({ url }) => new URL(url).pathname.endsWith('/EmojiPicker.jsx'))).toBe(true);
    await expect(page.locator('em-emoji-picker')).toBeVisible();
});

test('loads the bundled example only after the user asks for it', async ({ page }) => {
    const requests = [];
    page.on('request', (request) => requests.push({ url: request.url(), resourceType: request.resourceType() }));
    await openOffline(page);
    await expect(page.getByRole('button', { name: /第一次使用/ })).toBeVisible();
    expect(requests.some(({ url }) => isDemoRequest(url))).toBe(false);

    await page.getByRole('button', { name: /第一次使用/ }).click();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.editor.img?.name)).toBe('ScreenHello-demo.jpg');
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.workspace.projectName)).toBe('ScreenHello 示例');
    expect(requests.some(({ url, resourceType }) =>
        resourceType === 'fetch' && isDemoRequest(url))).toBe(true);
});

test('adds, selects, groups, locks, lays out, and restores multiple image layers', async ({ page }) => {
    await openOffline(page);
    await importFixture(page);
    const initialFrameSize = await page.evaluate(() => ({
        width: window.__shoteasyStores.option.frameConf.width,
        height: window.__shoteasyStores.option.frameConf.height,
    }));
    await page.getByTestId('add-image-input').setInputFiles([
        { name: 'valid-before-error.png', mimeType: 'image/png', buffer: createPngFixture() },
        { name: 'broken.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') },
    ]);
    await expect(page.getByText('无法添加图片“broken.txt”')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.imageStore.list.length)).toBe(1);

    await appendFixtures(page, ['layer-two.png', 'layer-three.png']);
    expect(await page.evaluate(() => ({
        width: window.__shoteasyStores.option.frameConf.width,
        height: window.__shoteasyStores.option.frameConf.height,
    }))).toEqual(initialFrameSize);

    const layerList = page.locator('.shoteasy-layer-list');
    await expect(layerList.getByText('layer-two.png')).toBeVisible();
    await layerList.getByRole('button', { name: /screenhello-phase1\.png/ }).click();
    await layerList.getByRole('button', { name: /layer-two\.png/ }).click({ modifiers: ['Control'] });
    await layerList.getByRole('button', { name: /layer-three\.png/ }).click({ modifiers: ['Control'] });
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.imageStore.selectedIds.length)).toBe(3);

    await page.getByRole('button', { name: '编组', exact: true }).click();
    await expect.poll(() => page.evaluate(() => new Set(window.__shoteasyStores.imageStore.selectedList.map((layer) => layer.groupId)).size)).toBe(1);
    await page.getByRole('button', { name: '扇形布局' }).click();
    await expect.poll(() => page.evaluate(() => new Set(window.__shoteasyStores.imageStore.selectedList.map((layer) => layer.transform.rotation)).size)).toBe(3);

    await page.getByRole('button', { name: '撤销' }).click();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.imageStore.list.every((layer) => layer.transform.rotation === 0))).toBe(true);
    await page.getByRole('button', { name: '重做' }).click();
    await page.getByRole('button', { name: '锁定图层' }).click();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.imageStore.selectedList.every((layer) => layer.locked))).toBe(true);
});

test('opens Ant Design semantic popovers and responsive drawers without deprecations', async ({ page }) => {
    const antdWarnings = [];
    page.on('console', (message) => {
        if (message.text().includes('Warning: [antd:')) antdWarnings.push(message.text());
    });

    await openOffline(page);
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('style')]
        .some((style) => style.textContent?.includes('@layer antd')))).toBe(true);
    const sizeTrigger = page.getByRole('button', { name: '选择画布尺寸' });
    await sizeTrigger.click();

    const sizeOverlay = page.locator('.shoteasy-size-overlay');
    await expect(sizeOverlay).toBeVisible();
    await expect(sizeOverlay.locator('.ant-popover-container')).toHaveCSS('padding', '0px');
    await expect(sizeOverlay.locator('.shoteasy-size-popover')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sizeOverlay).toBeHidden();

    await page.setViewportSize({ width: 800, height: 800 });
    await page.getByRole('button', { name: '打开尺寸与外框' }).click();
    await expect(page.locator('.ant-drawer-title:text-is("尺寸与外框")')).toBeVisible();
    await page.locator('.ant-drawer:has(.ant-drawer-title:text-is("尺寸与外框")) .ant-drawer-close').click();

    await page.getByRole('button', { name: '打开检查器' }).click();
    await expect(page.locator('.ant-drawer-title:text-is("检查器")')).toBeVisible();
    await page.locator('.ant-drawer:has(.ant-drawer-title:text-is("检查器")) .ant-drawer-close').click();

    expect(antdWarnings).toEqual([]);
});

test('keeps projects, presets, and suggestions local with the download fallback', async ({ page }) => {
    await disableFileSystemAccess(page);
    await openOffline(page);
    await importFixture(page);
    await appendFixtures(page);
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.workspace.suggestions.status)).toBe('ready');

    await page.getByRole('button', { name: '打开项目中心' }).click();
    await expect(page.getByText('只在本机采样图片边缘，不上传图片')).toBeVisible();
    await page.getByRole('button', { name: /^内描边 #[0-9a-f]+$/i }).click();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.option.innerBorder.visible)).toBe(true);

    await page.getByLabel('项目名称').fill('Phase 5 本地项目');
    await page.evaluate(() => window.__shoteasyStores.option.setPadding(32));
    await page.getByLabel('新预设名称').fill('本地蓝卡');
    await page.getByRole('button', { name: '保存当前风格' }).click();
    await expect(page.getByText('本地蓝卡', { exact: true })).toBeVisible();

    const presetDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出预设 本地蓝卡' }).click();
    const presetDownload = await presetDownloadPromise;
    const presetBytes = await readDownload(presetDownload);
    expect(presetDownload.suggestedFilename()).toBe('本地蓝卡.screenhello-preset');
    expect(presetBytes.subarray(0, 2).toString()).toBe('PK');
    await page.getByTestId('preset-file-input').setInputFiles({
        name: presetDownload.suggestedFilename(),
        mimeType: 'application/vnd.screenhello.preset+zip',
        buffer: presetBytes,
    });
    await expect(page.getByText('本地蓝卡', { exact: true })).toHaveCount(2);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const download = await downloadPromise;
    const projectBytes = await readDownload(download);
    expect(download.suggestedFilename()).toBe('Phase 5 本地项目.screenhello');
    expect(projectBytes.subarray(0, 2).toString()).toBe('PK');
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.workspace.busy)).toBeNull();

    const sourceBeforeCorruptOpen = await page.evaluate(() => window.__shoteasyStores.editor.img.src);
    await page.getByTestId('project-file-input').setInputFiles({
        name: 'broken.screenhello',
        mimeType: 'application/vnd.screenhello.project+zip',
        buffer: Buffer.from('not-a-project'),
    });
    await expect(page.getByText('文件已损坏、格式不正确或版本不受支持')).toBeVisible();
    expect(await page.evaluate(() => window.__shoteasyStores.editor.img.src)).toBe(sourceBeforeCorruptOpen);

    await page.evaluate(() => window.__shoteasyStores.option.setPadding(0));
    await page.getByTestId('project-file-input').setInputFiles({
        name: download.suggestedFilename(),
        mimeType: 'application/vnd.screenhello.project+zip',
        buffer: projectBytes,
    });
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.option.padding)).toBe(32);
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.imageStore.list.length)).toBe(2);
    await expect(page.getByText('Phase 5 本地项目', { exact: true }).first()).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: '打开项目中心' }).click();
    await expect(page.getByText('本地蓝卡', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Phase 5 本地项目', { exact: true }).first()).toBeVisible();

    await page.evaluate(() => window.__shoteasyStores.option.setPadding(5));
    await page.locator('.shoteasy-workspace-item > button').filter({ hasText: 'Phase 5 本地项目' }).first().click();
    await page.getByRole('button', { name: '继续打开' }).click();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.option.padding)).toBe(32);

    await page.evaluate(() => window.__shoteasyStores.option.setPadding(0));
    await page.locator('.shoteasy-workspace-item > button').filter({ hasText: '本地蓝卡' }).first().click();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.option.padding)).toBe(32);
});

test('uses the Chromium file-system picker before generating and writing a project', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'The File System Access enhancement is Chromium-only.');
    await page.addInitScript(() => {
        const events = [];
        let savedProject = null;
        const handle = {
            async createWritable() {
                return {
                    async write(blob) { events.push('write'); savedProject = blob; },
                    async close() { events.push('close'); },
                    async abort() { events.push('abort'); },
                };
            },
            async getFile() {
                events.push('open-file');
                return new File([savedProject], 'picker.screenhello', { type: 'application/vnd.screenhello.project+zip' });
            },
        };
        globalThis.__workspacePickerEvents = events;
        globalThis.showSaveFilePicker = async () => { events.push('picker'); return handle; };
        globalThis.showOpenFilePicker = async () => { events.push('open-picker'); return [handle]; };
    });
    await openOffline(page);
    await importFixture(page);
    await page.getByRole('button', { name: '打开项目中心' }).click();
    await page.getByLabel('项目名称').fill('Picker 项目');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__workspacePickerEvents)).toEqual(['picker', 'write', 'close']);

    await page.evaluate(() => window.__shoteasyStores.option.setPadding(88));
    await page.getByRole('button', { name: '打开项目', exact: true }).click();
    await page.getByRole('button', { name: '继续打开' }).click();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.option.padding)).toBe(0);
    expect(await page.evaluate(() => window.__workspacePickerEvents)).toContain('open-picker');
    expect(await page.evaluate(() => window.__workspacePickerEvents)).toContain('open-file');
});

test('matches the reviewed initial-page visual baseline', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'The Phase 1 visual golden is reviewed on pinned Chromium.');
    await openOffline(page);
    await expect(page.getByText('点击或拖拽图片到这里')).toBeVisible();
    await waitForLocalImages(page);

    await expect(page).toHaveScreenshot('initial-page.png', {
        animations: 'disabled',
        caret: 'hide',
        fullPage: true,
        mask: [page.locator('img[src^="https://"]')],
        maskColor: '#111111',
        maxDiffPixelRatio: 0.02,
    });
});

test('matches the reviewed workspace-center visual baseline', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'The workspace visual golden is reviewed on pinned Chromium.');
    await disableFileSystemAccess(page);
    await openOffline(page);
    await importFixture(page);
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.workspace.suggestions.status)).toBe('ready');
    await page.getByRole('button', { name: '打开项目中心' }).click();
    const workspaceDrawer = page.locator('.shoteasy-workspace-drawer');
    await expect(workspaceDrawer).toBeVisible();
    await expect(workspaceDrawer).toHaveScreenshot('workspace-center.png', {
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixelRatio: 0.02,
    });
});

test('matches the reviewed PNG export golden', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'The Phase 1 export golden is reviewed on pinned Chromium.');
    await openOffline(page);
    await importFixture(page);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载图片' }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const part of stream) chunks.push(part);
    const png = Buffer.concat(chunks);

    expect(download.suggestedFilename()).toBe('ScreenHello.png');
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png).toMatchSnapshot('export.png', { maxDiffPixelRatio: 0.01 });
});

test('exports PNG, JPG, WebP, AVIF, and a releasable native canvas through one service', async ({ page }, testInfo) => {
    await openOffline(page);
    await importFixture(page);
    await page.getByRole('button', { name: /导出格式与倍率/ }).click();
    const avifOption = page.locator('.shoteasy-export-popover .ant-segmented-item').filter({ hasText: 'avif' });
    await expect(avifOption).toBeVisible();
    await avifOption.click();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.workspace.exportSettings.format)).toBe('avif');
    await page.keyboard.press('Escape');

    const result = await page.evaluate(async () => {
        const stores = window.__shoteasyStores;
        stores.option.setBackground('none');
        stores.option.setPadding(24);
        stores.option.setPaddingBg('rgba(0,0,0,0)');
        stores.option.setShadowConf({ visible: false });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        const inspectBlob = async (blob) => {
            const bitmap = await createImageBitmap(blob);
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            context.drawImage(bitmap, 0, 0);
            const corner = [...context.getImageData(0, 0, 1, 1).data];
            bitmap.close?.();
            return { width: canvas.width, height: canvas.height, corner };
        };

        const requests = [
            { format: 'png', ratio: 1 },
            { format: 'jpg', ratio: 2 },
            { format: 'webp', ratio: 3 },
            { format: 'avif', ratio: 1 },
        ];
        const images = [];
        for (const request of requests) {
            const exported = await stores.exportService.exportImage(request);
            images.push({
                format: exported.format,
                mimeType: exported.mimeType,
                durationMs: exported.durationMs,
                ...(await inspectBlob(exported.blob)),
            });
        }

        const canvasExport = await stores.exportService.exportCanvas({ ratio: 1 });
        try {
            return {
                images,
                canvas: {
                    width: canvasExport.width,
                    height: canvasExport.height,
                    nativeWidth: canvasExport.canvas.width,
                    nativeHeight: canvasExport.canvas.height,
                    has2dContext: Boolean(canvasExport.canvas.getContext('2d')),
                },
            };
        } finally {
            canvasExport.release();
        }
    });

    const [png, jpg, webp, avif] = result.images;
    expect(result.images.map(({ format, mimeType }) => ({ format, mimeType }))).toEqual([
        { format: 'png', mimeType: 'image/png' },
        { format: 'jpg', mimeType: 'image/jpeg' },
        { format: 'webp', mimeType: 'image/webp' },
        { format: 'avif', mimeType: 'image/avif' },
    ]);
    expect(jpg.width).toBe(png.width * 2);
    expect(jpg.height).toBe(png.height * 2);
    expect(webp.width).toBe(png.width * 3);
    expect(webp.height).toBe(png.height * 3);
    expect(avif.width).toBe(png.width);
    expect(avif.height).toBe(png.height);
    expect(png.corner[3]).toBe(0);
    expect(jpg.corner).toEqual([255, 255, 255, 255]);
    expect(webp.corner).toEqual([255, 255, 255, 255]);
    expect(avif.corner[3]).toBe(0);
    expect(result.canvas).toEqual({
        width: png.width,
        height: png.height,
        nativeWidth: png.width,
        nativeHeight: png.height,
        has2dContext: true,
    });
    testInfo.annotations.push({
        type: 'export-metrics',
        description: JSON.stringify(result.images.map(({ format, durationMs, width, height }) => ({ format, durationMs, width, height }))),
    });
});

test('renders generic devices through canonical fill modes and every local export format', async ({ page }) => {
    test.setTimeout(120_000);
    await openOffline(page);
    await importFixture(page, { width: 640, height: 480 });

    await page.getByRole('button', { name: /查看全部/ }).click();
    const frameDrawer = page.locator('.shoteasy-frame-drawer');
    await expect(frameDrawer.locator('.shoteasy-frame-thumb[data-kind="vector-device"]')).toHaveCount(4);
    for (const title of ['通用笔记本', '通用显示器', '通用平板', '通用手机']) {
        await expect(frameDrawer.getByText(title, { exact: true })).toBeVisible();
    }
    await frameDrawer.locator('.shoteasy-frame-option').filter({ hasText: '通用笔记本' }).click();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.option.frame)).toBe('genericLaptop');
    await frameDrawer.getByLabel('设备图片适配方式').getByText('拉伸', { exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.option.frameMode)).toBe('stretch');

    const result = await page.evaluate(async () => {
        const stores = window.__shoteasyStores;
        const frames = ['genericLaptop', 'genericDesktop', 'genericTablet', 'genericPhone'];
        const modes = ['cover', 'fit', 'stretch'];
        const formats = ['png', 'jpg', 'webp', 'avif'];
        const ratios = [1, 2, 3];
        const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const inspectBlob = async (blob) => {
            const bitmap = await createImageBitmap(blob);
            const size = { width: bitmap.width, height: bitmap.height };
            bitmap.close?.();
            return size;
        };

        stores.option.setBackground('none');
        stores.option.setFrameSize(360, 270);
        stores.option.setPadding(0);
        stores.option.setShadowConf({ visible: true, x: 0, y: 10, blur: 18, spread: 0, color: '#00000045' });

        const frameResults = [];
        for (const frame of frames) {
            for (const mode of modes) {
                stores.option.setFrame(frame);
                stores.option.setFrameMode(mode);
                await settle();
                const layer = stores.imageStore.activeLayer;
                const container = stores.imageStore.nodes.get(layer.id);
                const screen = container.children.find((child) =>
                    child.children?.length === 1 && child.children[0].fill?.type === 'image');
                const image = screen?.children?.[0];
                const exported = await stores.exportService.exportImage({ format: 'png', ratio: 1 });
                frameResults.push({
                    frame,
                    mode,
                    container: { width: container.width, height: container.height },
                    screen: screen ? {
                        x: screen.x,
                        y: screen.y,
                        width: screen.width,
                        height: screen.height,
                        cornerRadius: screen.cornerRadius,
                        overflow: screen.overflow,
                    } : null,
                    imageMode: image?.fill?.mode,
                    output: await inspectBlob(exported.blob),
                });
            }
        }

        stores.option.setFrame('genericPhone');
        stores.option.setFrameMode('stretch');
        await settle();
        const exportResults = [];
        for (const format of formats) {
            for (const ratio of ratios) {
                const exported = await stores.exportService.exportImage({ format, ratio });
                exportResults.push({ format, ratio, mimeType: exported.mimeType, ...(await inspectBlob(exported.blob)) });
            }
        }
        return { frameResults, exportResults };
    });

    expect(result.frameResults).toHaveLength(12);
    for (const frame of ['genericLaptop', 'genericDesktop', 'genericTablet', 'genericPhone']) {
        const states = result.frameResults.filter((item) => item.frame === frame);
        expect(states.map(({ mode }) => mode)).toEqual(['cover', 'fit', 'stretch']);
        expect(states.map(({ imageMode }) => imageMode)).toEqual(['cover', 'fit', 'stretch']);
        expect(states.map(({ screen }) => screen)).toEqual([states[0].screen, states[0].screen, states[0].screen]);
        for (const state of states) {
            expect(state.screen).not.toBeNull();
            expect(state.screen.overflow).toBe('hide');
            expect(state.screen.cornerRadius).toBeGreaterThan(0);
            expect(state.screen.x).toBeGreaterThanOrEqual(0);
            expect(state.screen.y).toBeGreaterThanOrEqual(0);
            expect(state.screen.x + state.screen.width).toBeLessThanOrEqual(state.container.width);
            expect(state.screen.y + state.screen.height).toBeLessThanOrEqual(state.container.height);
            expect(state.output).toEqual({ width: 360, height: 270 });
        }
    }

    expect(result.exportResults).toHaveLength(12);
    for (const item of result.exportResults) {
        expect(item.mimeType).toBe(item.format === 'jpg' ? 'image/jpeg' : `image/${item.format}`);
        expect(item.width).toBe(360 * item.ratio);
        expect(item.height).toBe(270 * item.ratio);
    }
});

test('matches the reviewed generic device frame export baseline', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'The vector device visual golden is reviewed on pinned Chromium.');
    await openOffline(page);
    await importFixture(page, { width: 640, height: 480 });

    const montage = await page.evaluate(async () => {
        const stores = window.__shoteasyStores;
        const frames = ['genericLaptop', 'genericDesktop', 'genericTablet', 'genericPhone'];
        const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        stores.option.setBackground('none');
        stores.option.setFrameSize(360, 270);
        stores.option.setPadding(0);
        stores.option.setShadowConf({ visible: true, x: 0, y: 10, blur: 18, spread: 0, color: '#00000045' });

        const canvas = document.createElement('canvas');
        canvas.width = 736;
        canvas.height = 556;
        const context = canvas.getContext('2d');
        context.fillStyle = '#dfe4ea';
        context.fillRect(0, 0, canvas.width, canvas.height);
        for (let index = 0; index < frames.length; index += 1) {
            stores.option.setFrame(frames[index]);
            stores.option.setFrameMode('cover');
            await settle();
            const exported = await stores.exportService.exportImage({ format: 'png', ratio: 1 });
            const bitmap = await createImageBitmap(exported.blob);
            const x = 8 + (index % 2) * 368;
            const y = 8 + Math.floor(index / 2) * 278;
            context.drawImage(bitmap, x, y);
            bitmap.close?.();
        }
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        return [...new Uint8Array(await blob.arrayBuffer())];
    });

    expect(Buffer.from(montage)).toMatchSnapshot('generic-device-frames.png', { maxDiffPixelRatio: 0.01 });
});

test('batch exports isolated mixed jobs into one safe partial-success ZIP', async ({ page }) => {
    await trackObjectUrls(page);
    await disableFileSystemAccess(page);
    await openOffline(page);
    await importFixture(page);
    await page.evaluate(() => {
        const stores = window.__shoteasyStores;
        stores.option.setBackground('none');
        stores.option.setPadding(18);
        stores.option.setFrame('genericLaptop');
        stores.option.setFrameMode('fit');
        stores.workspace.setExportSettings({ format: 'png', ratio: 2 });
    });
    const before = await page.evaluate(async () => {
        const stores = window.__shoteasyStores;
        await stores.draftService.flush();
        await stores.workspace.refreshLibrary();
        return {
            document: stores.editor.serializeProject(),
            historyCount: stores.history.manager.count,
            dirty: stores.workspace.isDirty,
            draftDocument: await stores.draftStore.loadProject('shoteasy-default'),
            drafts: stores.workspace.drafts.map(({ key }) => key),
            recent: stores.workspace.recentProjects.map(({ id }) => id),
            objectUrls: window.__screenhelloObjectUrls.size,
            canvases: document.querySelectorAll('canvas').length,
        };
    });

    await page.getByRole('button', { name: '打开批量处理' }).click();
    await page.getByTestId('batch-file-input').setInputFiles([
        { name: 'same.png', mimeType: 'image/png', buffer: createPngFixture(64, 48) },
        { name: 'same.png', mimeType: 'image/png', buffer: createPngFixture(48, 64) },
        { name: '<broken>.png', mimeType: 'image/png', buffer: Buffer.from('not-a-png') },
    ]);
    const batchDrawer = page.locator('.shoteasy-batch-drawer');
    await expect(batchDrawer.getByText('0/3 已结束 · 0 成功')).toBeVisible();
    await batchDrawer.getByRole('button', { name: '开始批量处理' }).click();
    await expect(batchDrawer.getByRole('status')).toContainText('2 张成功', { timeout: 30_000 });
    await expect(batchDrawer.getByText('图片无效或无法解码')).toBeVisible();

    const after = await page.evaluate(async () => {
        const stores = window.__shoteasyStores;
        return {
            document: stores.editor.serializeProject(),
            historyCount: stores.history.manager.count,
            dirty: stores.workspace.isDirty,
            draftDocument: await stores.draftStore.loadProject('shoteasy-default'),
            drafts: stores.workspace.drafts.map(({ key }) => key),
            recent: stores.workspace.recentProjects.map(({ id }) => id),
            objectUrls: window.__screenhelloObjectUrls.size,
            canvases: document.querySelectorAll('canvas').length,
        };
    });
    expect(after).toEqual(before);

    const downloadPromise = page.waitForEvent('download');
    await batchDrawer.getByRole('button', { name: '下载 ZIP' }).click();
    const download = await downloadPromise;
    const bytes = await readDownload(download);
    const entries = unzipSync(bytes);
    expect(download.suggestedFilename()).toMatch(/^ScreenHello-batch-\d{8}T\d{4}\.zip$/);
    expect(Object.keys(entries)).toEqual(['same-screenhello@2.png', 'same-2-screenhello@2.png']);
    expect(Object.keys(entries).every((name) => !name.includes('/') && !name.includes('\\'))).toBe(true);
    expect([
        [entries['same-screenhello@2.png'].slice(16, 20), entries['same-screenhello@2.png'].slice(20, 24)],
        [entries['same-2-screenhello@2.png'].slice(16, 20), entries['same-2-screenhello@2.png'].slice(20, 24)],
    ].map(([width, height]) => [Buffer.from(width).readUInt32BE(), Buffer.from(height).readUInt32BE()]))
        .toEqual([[146, 110], [190, 142]]);
});

test('batch renders a saved local gradient preset with async HDR and background effects without applying it', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'The async style lifecycle has one real-browser regression; the core batch path runs in all engines.');
    await trackObjectUrls(page);
    await openOffline(page);
    await importFixture(page);
    await page.evaluate(async () => {
        const stores = window.__shoteasyStores;
        await stores.option.applyBackground('gh_img_65');
        stores.option.setBackgroundBlur(4);
        stores.option.setHdrEnabled(true);
        stores.workspace.setExportSettings({ format: 'png', ratio: 2 });
        await stores.workspace.savePreset('异步本地预设');
        stores.option.setBackground('none');
        stores.option.setBackgroundBlur(0);
        stores.option.setHdrEnabled(false);
        stores.workspace.setExportSettings({ format: 'png', ratio: 1 });
    });
    const before = await page.evaluate(() => ({
        document: window.__shoteasyStores.editor.serializeProject(),
        historyCount: window.__shoteasyStores.history.manager.count,
        dirty: window.__shoteasyStores.workspace.isDirty,
        objectUrls: window.__screenhelloObjectUrls.size,
    }));

    await page.getByRole('button', { name: '打开批量处理' }).click();
    const batchDrawer = page.locator('.shoteasy-batch-drawer');
    const styleSelect = batchDrawer.getByLabel('批量风格来源');
    await styleSelect.click();
    await styleSelect.press('ArrowDown');
    await styleSelect.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.batch.presetId)).not.toBeNull();
    await page.getByTestId('batch-file-input').setInputFiles({
        name: 'async-preset.png',
        mimeType: 'image/png',
        buffer: createPngFixture(48, 64),
    });
    await batchDrawer.getByRole('button', { name: '开始批量处理' }).click();
    await expect(batchDrawer.getByRole('status')).toContainText('1 张成功', { timeout: 30_000 });

    const after = await page.evaluate(() => ({
        document: window.__shoteasyStores.editor.serializeProject(),
        historyCount: window.__shoteasyStores.history.manager.count,
        dirty: window.__shoteasyStores.workspace.isDirty,
        objectUrls: window.__screenhelloObjectUrls.size,
        filename: window.__shoteasyStores.batch.jobs[0].filename,
        isolatedCanvases: document.querySelectorAll('[aria-hidden="true"] canvas').length,
    }));
    const { filename, isolatedCanvases, ...activeAfter } = after;
    expect(filename).toBe('async-preset-screenhello@2.png');
    expect(isolatedCanvases).toBe(0);
    expect(activeAfter).toEqual(before);
});

test('batch renders twelve WebP jobs serially and releases its isolated resources', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'The full twelve-job browser budget runs once; mixed jobs run in all engines.');
    await trackObjectUrls(page);
    await disableFileSystemAccess(page);
    await openOffline(page);
    await importFixture(page);
    await page.evaluate(() => {
        const stores = window.__shoteasyStores;
        stores.option.setBackground('none');
        stores.option.setPadding(18);
        stores.workspace.setExportSettings({ format: 'webp', ratio: 1 });
        const original = stores.exportService.exportImage.bind(stores.exportService);
        const metrics = { active: 0, maxActive: 0, calls: 0 };
        stores.exportService.exportImage = async (...args) => {
            metrics.active += 1;
            metrics.calls += 1;
            metrics.maxActive = Math.max(metrics.maxActive, metrics.active);
            try {
                return await original(...args);
            } finally {
                metrics.active -= 1;
            }
        };
        globalThis.__screenhelloBatchExportMetrics = metrics;
    });
    const before = await page.evaluate(() => ({
        objectUrls: window.__screenhelloObjectUrls.size,
        canvases: document.querySelectorAll('canvas').length,
    }));

    await page.getByRole('button', { name: '打开批量处理' }).click();
    await page.getByTestId('batch-file-input').setInputFiles(Array.from({ length: 12 }, (_, index) => ({
        name: `webp-${index + 1}.png`,
        mimeType: 'image/png',
        buffer: createPngFixture(64, 48),
    })));
    const batchDrawer = page.locator('.shoteasy-batch-drawer');
    await batchDrawer.getByRole('button', { name: '开始批量处理' }).click();
    await expect(batchDrawer.getByRole('status')).toContainText('12 张成功', { timeout: 60_000 });

    const after = await page.evaluate(() => ({
        metrics: window.__screenhelloBatchExportMetrics,
        objectUrls: window.__screenhelloObjectUrls.size,
        canvases: document.querySelectorAll('canvas').length,
    }));
    expect(after.metrics).toEqual({ active: 0, maxActive: 1, calls: 12 });
    expect({ objectUrls: after.objectUrls, canvases: after.canvases }).toEqual(before);

    const downloadPromise = page.waitForEvent('download');
    await batchDrawer.getByRole('button', { name: '下载 ZIP' }).click();
    const entries = unzipSync(await readDownload(await downloadPromise));
    expect(Object.keys(entries)).toHaveLength(12);
    expect(Object.keys(entries).every((name) => /^webp-\d+-screenhello\.webp$/.test(name))).toBe(true);
    for (const bytes of Object.values(entries)) {
        expect(Buffer.from(bytes.subarray(0, 4)).toString('ascii')).toBe('RIFF');
        expect(Buffer.from(bytes.subarray(8, 12)).toString('ascii')).toBe('WEBP');
    }
    const first = Object.values(entries)[0];
    const decoded = await page.evaluate(async (bytes) => {
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/webp' }));
        const size = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return size;
    }, Array.from(first));
    expect(decoded).toEqual({ width: 73, height: 55 });
});

test('batch exports a local AVIF entry and reclaims its encoder worker', async ({ page }) => {
    await trackObjectUrls(page);
    await disableFileSystemAccess(page);
    await page.addInitScript(() => {
        const NativeWorker = globalThis.Worker;
        globalThis.__screenhelloAvifWorkerLifecycle = { created: 0, terminated: 0 };
        globalThis.Worker = class TrackedAvifWorker extends NativeWorker {
            constructor(...args) {
                super(...args);
                globalThis.__screenhelloAvifWorkerLifecycle.created += 1;
            }

            terminate() {
                globalThis.__screenhelloAvifWorkerLifecycle.terminated += 1;
                return super.terminate();
            }
        };
    });
    await openOffline(page);
    await importFixture(page);
    await page.evaluate(() => {
        const stores = window.__shoteasyStores;
        stores.option.setBackground('none');
        stores.option.setPadding(18);
        stores.workspace.setExportSettings({ format: 'avif', ratio: 1 });
    });
    const initialObjectUrls = await page.evaluate(() => window.__screenhelloObjectUrls.size);

    await page.getByRole('button', { name: '打开批量处理' }).click();
    await page.getByTestId('batch-file-input').setInputFiles({
        name: 'local-avif.png',
        mimeType: 'image/png',
        buffer: createPngFixture(64, 48),
    });
    const batchDrawer = page.locator('.shoteasy-batch-drawer');
    await batchDrawer.getByRole('button', { name: '开始批量处理' }).click();
    await expect(batchDrawer.getByRole('status')).toContainText('1 张成功', { timeout: 30_000 });
    expect(await page.evaluate(() => window.__screenhelloObjectUrls.size)).toBe(initialObjectUrls);

    const downloadPromise = page.waitForEvent('download');
    await batchDrawer.getByRole('button', { name: '下载 ZIP' }).click();
    const entries = unzipSync(await readDownload(await downloadPromise));
    expect(Object.keys(entries)).toEqual(['local-avif-screenhello.avif']);
    const avif = entries['local-avif-screenhello.avif'];
    expect(Buffer.from(avif.subarray(4, 8)).toString('ascii')).toBe('ftyp');
    expect(Buffer.from(avif.subarray(8, 12)).toString('ascii')).toBe('avif');
    const decoded = await page.evaluate(async (bytes) => {
        const blob = new Blob([Uint8Array.from(bytes)], { type: 'image/avif' });
        const url = URL.createObjectURL(blob);
        try {
            const image = new Image();
            image.src = url;
            await image.decode();
            return { width: image.naturalWidth, height: image.naturalHeight };
        } finally {
            URL.revokeObjectURL(url);
        }
    }, Array.from(avif));
    expect(decoded).toEqual({ width: 73, height: 55 });
    await expect.poll(
        () => page.evaluate(() => window.__screenhelloAvifWorkerLifecycle),
        { timeout: 5_000 }
    ).toEqual({ created: 1, terminated: 1 });
});

test('encodes and decodes AVIF locally through one scalar module worker', async ({ page, browserName }) => {
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.addInitScript(() => {
        const NativeWorker = globalThis.Worker;
        globalThis.__screenhelloCreatedWorkers = [];
        globalThis.Worker = class TrackedWorker extends NativeWorker {
            constructor(url, options) {
                super(url, options);
                globalThis.__screenhelloCreatedWorkers.push(String(url));
            }
        };
    });
    await openOffline(page);

    const result = await page.evaluate(async () => {
        const { AvifEncoder, isAvifBuffer } = await import('/src/utils/avifEncoder.js');
        const width = 48;
        const height = 32;
        const pixels = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const offset = (y * width + x) * 4;
                pixels[offset] = Math.round(x / (width - 1) * 255);
                pixels[offset + 1] = Math.round(y / (height - 1) * 255);
                pixels[offset + 2] = (x + y) % 2 ? 240 : 20;
                pixels[offset + 3] = x < width / 2 ? 255 : 128;
            }
        }
        const encoder = new AvifEncoder({ idleMs: 60_000 });
        const startedAt = performance.now();
        const blob = await encoder.encode({ pixels, width, height });
        const durationMs = performance.now() - startedAt;
        const bytes = await blob.arrayBuffer();
        const url = URL.createObjectURL(blob);
        try {
            const image = new Image();
            image.src = url;
            await image.decode();
            return {
                mimeType: blob.type,
                bytes: blob.size,
                validBrand: isAvifBuffer(bytes),
                width: image.naturalWidth,
                height: image.naturalHeight,
                durationMs: Math.round(durationMs * 10) / 10,
                workers: [...globalThis.__screenhelloCreatedWorkers],
                crossOriginIsolated: globalThis.crossOriginIsolated,
            };
        } finally {
            URL.revokeObjectURL(url);
            encoder.dispose();
        }
    });

    expect(result).toMatchObject({
        mimeType: 'image/avif',
        validBrand: true,
        width: 48,
        height: 32,
        crossOriginIsolated: false,
    });
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.workers).toHaveLength(1);
    expect(result.workers[0]).toContain('avifEncoder.worker.js');
    const avifRequests = requests.filter((url) => url.includes('avif_enc'));
    expect(avifRequests.some((url) => /avif_enc\.wasm(?:\?|$)/.test(url))).toBe(true);
    expect(avifRequests.some((url) => url.includes('avif_enc_mt'))).toBe(false);
    console.log(`SCREENHELLO_AVIF_SPIKE ${browserName} ${JSON.stringify(result)}`);
});

test('characterizes the reviewed single-export pixel budget', async ({ page, browserName }) => {
    test.skip(process.env.SCREENHELLO_EXPORT_BENCHMARK !== '1', 'Run explicitly when reviewing the export budget.');
    test.setTimeout(180_000);
    const benchmarkOptions = {
        caseLabel: process.env.SCREENHELLO_EXPORT_BENCHMARK_CASE || '',
        repeat: Math.max(1, Math.min(12, Number(process.env.SCREENHELLO_EXPORT_BENCHMARK_REPEAT) || 1)),
    };
    const forceSoftwareWebp = benchmarkOptions.caseLabel.endsWith('-software');
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    if (forceSoftwareWebp) {
        await page.addInitScript(() => {
            const nativeToBlob = HTMLCanvasElement.prototype.toBlob;
            HTMLCanvasElement.prototype.toBlob = function screenHelloSoftwareWebpBenchmark(callback, type, quality) {
                return nativeToBlob.call(this, callback, type === 'image/webp' ? 'image/png' : type, quality);
            };
        });
    }
    await openOffline(page);
    await importFixture(page);

    const metrics = await page.evaluate(async ({ caseLabel, repeat }) => {
        const stores = window.__shoteasyStores;
        stores.option.setBackground('none');
        stores.option.setPaddingBg('#ffffff');
        stores.option.setShadowConf({ visible: false });
        const allCases = [
            { label: 'small-png', width: 800, height: 600, format: 'png' },
            { label: '4k-png', width: 3840, height: 2160, format: 'png' },
            { label: '4k-jpg', width: 3840, height: 2160, format: 'jpg' },
            { label: '4k-webp', width: 3840, height: 2160, format: 'webp' },
            { label: '4k-webp-software', width: 3840, height: 2160, format: 'webp' },
            { label: 'wide-boundary-png', width: 8192, height: 2048, format: 'png' },
            { label: 'square-boundary-png', width: 4096, height: 4096, format: 'png' },
            { label: 'square-boundary-webp-software', width: 4096, height: 4096, format: 'webp' },
        ];
        const selectedCases = caseLabel
            ? allCases.filter(({ label }) => label === caseLabel)
            : allCases.filter(({ label }) => !label.endsWith('-software'));
        const cases = Array.from({ length: repeat }, () => selectedCases).flat();
        const results = [];

        for (const [iteration, current] of cases.entries()) {
            stores.option.setFrameSize(current.width, current.height);
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const exported = await stores.exportService.exportImage({ format: current.format, ratio: 1 });
            results.push({
                ...current,
                iteration: iteration + 1,
                outputWidth: exported.width,
                outputHeight: exported.height,
                durationMs: Math.round(exported.durationMs * 10) / 10,
                blobBytes: exported.blob.size,
                rgbaBytes: exported.width * exported.height * 4,
            });
        }
        return results;
    }, benchmarkOptions);

    expect(metrics.length).toBeGreaterThan(0);
    for (const metric of metrics) {
        expect(metric.outputWidth).toBe(metric.width);
        expect(metric.outputHeight).toBe(metric.height);
        expect(metric.blobBytes).toBeGreaterThan(0);
    }
    if (forceSoftwareWebp) {
        expect(requests.some((url) => /webp_enc\.wasm(?:\?|$)/.test(url))).toBe(true);
    }
    console.log(`SCREENHELLO_EXPORT_BENCHMARK ${browserName} ${JSON.stringify(metrics)}`);
});
