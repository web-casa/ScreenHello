import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createPngFixture } from '../fixtures/createPngFixture.js';

async function readDownload(download) {
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const part of stream) chunks.push(part);
    return Buffer.concat(chunks);
}

async function openOffline(page) {
    await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (['127.0.0.1', 'localhost'].includes(url.hostname) || ['blob:', 'data:'].includes(url.protocol)) {
            await route.continue();
        } else {
            await route.abort('blockedbyclient');
        }
    });
    await page.goto('/');
}

async function importFixture(page, name = 'phase853-base.png') {
    await page.locator('.shoteasy-upload-card input[type="file"]').setInputFiles({
        name,
        mimeType: 'image/png',
        buffer: createPngFixture(64, 48),
    });
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.imageStore.list.length)).toBe(1);
}

async function appendFixtures(page, names) {
    await page.getByTestId('add-image-input').setInputFiles(names.map((name) => ({
        name,
        mimeType: 'image/png',
        buffer: createPngFixture(48, 64),
    })));
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.imageStore.list.length)).toBe(names.length + 1);
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.commands.imageBusy)).toBe(false);
}

async function runMenuCommand(page, menuName, commandName) {
    const menubar = page.getByRole('menubar', { name: '应用菜单' });
    await menubar.getByRole('menuitem', { name: menuName, exact: true }).click();
    const item = page.getByRole('menuitem', { name: commandName }).last();
    await expect(item).toBeVisible();
    await item.click();
}

async function waitForVisualStability(page) {
    await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) => (
        animation.playState === 'running'
        && animation.effect?.getComputedTiming().iterations !== Infinity
    )).length), { timeout: 5_000 }).toBe(0);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test('[Phase 8.5.3] initial workspace states the local promise and opens a reversible quick start', async ({ page }) => {
    const externalRequests = [];
    page.on('request', (request) => {
        const url = new URL(request.url());
        if (!['127.0.0.1', 'localhost'].includes(url.hostname) && !['blob:', 'data:'].includes(url.protocol)) {
            externalRequests.push(request.url());
        }
    });
    await openOffline(page);

    await expect(page.getByText('图片仅在此设备处理，不会上传')).toBeVisible();
    const quickStart = page.getByRole('button', { name: '打开快速入门' });
    await quickStart.focus();
    await quickStart.press('Enter');
    const dialog = page.getByRole('dialog', { name: '快速入门' });
    await expect(dialog).toContainText('添加图片');
    await expect(dialog).toHaveCSS('transform', 'none');
    await page.getByTestId('help-close').click();
    await expect(page.locator('.shoteasy-help-modal')).toHaveCount(0);
    await expect(quickStart).toBeFocused();

    await runMenuCommand(page, '帮助', /快速入门/);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('transform', 'none');
    await page.getByTestId('help-close').click();
    await expect(page.locator('.shoteasy-help-modal')).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: '帮助', exact: true })).toBeFocused();
    expect(externalRequests).toEqual([]);
});

test('[Phase 8.5.3] each local suggestion is discoverable in its editing context and undoable', async ({ page }) => {
    const externalRequests = [];
    page.on('request', (request) => {
        const url = new URL(request.url());
        if (!['127.0.0.1', 'localhost'].includes(url.hostname) && !['blob:', 'data:'].includes(url.protocol)) {
            externalRequests.push(request.url());
        }
    });
    await openOffline(page);
    await importFixture(page);
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.workspace.suggestions.status)).toBe('ready');

    const initialBackground = await page.evaluate(() => window.__shoteasyStores.option.background);
    await page.getByRole('button', { name: '应用背景本地建议' }).click();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.option.background)).toBe('custom_solid');
    await runMenuCommand(page, '编辑', /^撤销/);
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.option.background)).toBe(initialBackground);

    await page.getByRole('button', { name: '应用内描边本地建议' }).click();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.option.innerBorder.visible)).toBe(true);
    await runMenuCommand(page, '编辑', /^撤销/);
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.option.innerBorder.visible)).toBe(false);

    await page.getByRole('button', { name: '应用外框本地建议' }).click();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.option.frame)).not.toBe('none');
    await runMenuCommand(page, '编辑', /^撤销/);
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.option.frame)).toBe('none');

    expect(externalRequests).toEqual([]);
});

test('[Phase 8.5.3] layer thumbnails, summary, drag, keyboard, and buttons share one history-safe order', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(globalThis, 'showOpenFilePicker', { configurable: true, value: undefined });
        Object.defineProperty(globalThis, 'showSaveFilePicker', { configurable: true, value: undefined });
        const active = new Map();
        const create = URL.createObjectURL.bind(URL);
        const revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = (blob) => {
            const url = create(blob);
            active.set(url, blob.type);
            return url;
        };
        URL.revokeObjectURL = (url) => {
            active.delete(url);
            revoke(url);
        };
        globalThis.__screenhelloObjectUrls = active;
    });
    await openOffline(page);
    await importFixture(page);
    await appendFixtures(page, ['phase853-two.png', 'phase853-three.png']);

    const layerList = page.getByRole('list', { name: '图片图层' });
    await expect(page.getByText('已选 1 / 共 3 层')).toBeVisible();
    await expect(layerList.locator('img')).toHaveCount(3);
    await expect.poll(() => layerList.locator('img').evaluateAll((images) => (
        images.every((image) => image.complete && image.naturalWidth > 0)
    ))).toBe(true);
    const objectUrls = await page.evaluate(() => window.__screenhelloObjectUrls.size);
    const imageObjectUrls = await page.evaluate(() => (
        [...window.__screenhelloObjectUrls.values()].filter((type) => type.startsWith('image/')).length
    ));

    const sourceName = 'phase853-base.png';
    const targetName = 'phase853-three.png';
    const initialOrder = await page.evaluate(() => (
        window.__shoteasyStores.imageStore.list.map((layer) => layer.name)
    ));
    const initialHistory = await page.evaluate(() => ({
        count: window.__shoteasyStores.history.manager.count,
        order: window.__shoteasyStores.history.manager.current.images.map((layer) => layer.name),
    }));
    expect(initialHistory.order).toEqual(initialOrder);
    const expectedAfterDrag = initialOrder.filter((name) => name !== sourceName);
    expectedAfterDrag.splice(expectedAfterDrag.indexOf(targetName) + 1, 0, sourceName);
    const source = layerList.locator(`[data-layer-name="${sourceName}"]`);
    const sourceButton = source.getByRole('button');
    const target = layerList.locator(`[data-layer-name="${targetName}"]`);
    await source.dragTo(target, { targetPosition: { x: 20, y: 2 } });
    await expect.poll(() => page.evaluate(() => (
        window.__shoteasyStores.imageStore.list.map((layer) => layer.name)
    ))).toEqual(expectedAfterDrag);
    await expect.poll(() => page.evaluate(() => ({
        count: window.__shoteasyStores.history.manager.count,
        order: window.__shoteasyStores.history.manager.current.images.map((layer) => layer.name),
    }))).toEqual({ count: initialHistory.count + 1, order: expectedAfterDrag });
    await runMenuCommand(page, '编辑', /^撤销/);
    await expect.poll(() => page.evaluate(() => (
        window.__shoteasyStores.imageStore.list.map((layer) => layer.name)
    ))).toEqual(initialOrder);

    await sourceButton.focus();
    await sourceButton.press('Alt+ArrowUp');
    const expectedAfterKeyboard = [...initialOrder];
    const sourceIndex = expectedAfterKeyboard.indexOf(sourceName);
    [expectedAfterKeyboard[sourceIndex], expectedAfterKeyboard[sourceIndex + 1]] = [
        expectedAfterKeyboard[sourceIndex + 1],
        expectedAfterKeyboard[sourceIndex],
    ];
    await expect.poll(() => page.evaluate(() => (
        window.__shoteasyStores.imageStore.list.map((layer) => layer.name)
    ))).toEqual(expectedAfterKeyboard);
    await page.getByRole('button', { name: '移到顶层' }).click();
    const savedOrder = [...initialOrder.filter((name) => name !== sourceName), sourceName];
    await expect.poll(() => page.evaluate(() => (
        window.__shoteasyStores.imageStore.list.map((layer) => layer.name)
    ))).toEqual(savedOrder);

    const rendered = await page.evaluate(async () => {
        const stores = window.__shoteasyStores;
        const layers = stores.imageStore.list;
        const exported = await stores.exportService.exportImage({ format: 'png', ratio: 1 });
        return {
            documentOrder: stores.editor.serializeProject().images.map((layer) => layer.name),
            nodeOrder: layers.map((layer) => ({
                name: layer.name,
                zIndex: stores.imageStore.nodes.get(layer.id)?.zIndex,
            })),
            output: {
                mimeType: exported.mimeType,
                size: exported.blob.size,
                signature: [...new Uint8Array(await exported.blob.slice(0, 8).arrayBuffer())],
            },
        };
    });
    expect(rendered.documentOrder).toEqual(savedOrder);
    expect(rendered.nodeOrder).toEqual(savedOrder.map((name, zIndex) => ({ name, zIndex: zIndex / 100 })));
    expect(rendered.output.mimeType).toBe('image/png');
    expect(rendered.output.size).toBeGreaterThan(8);
    expect(rendered.output.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    const downloadPromise = page.waitForEvent('download');
    await runMenuCommand(page, '文件', /^保存项目/);
    const projectDownload = await downloadPromise;
    const projectBytes = await readDownload(projectDownload);
    expect(projectBytes.subarray(0, 2).toString()).toBe('PK');

    await page.getByRole('button', { name: '移到底层' }).click();
    await expect.poll(() => page.evaluate(() => (
        window.__shoteasyStores.imageStore.list.map((layer) => layer.name)
    ))).not.toEqual(savedOrder);
    await page.getByTestId('project-file-input').setInputFiles({
        name: projectDownload.suggestedFilename(),
        mimeType: 'application/vnd.screenhello.project+zip',
        buffer: projectBytes,
    });
    const discard = page.getByRole('button', { name: '不保存并继续' });
    await expect(discard).toBeVisible();
    await waitForVisualStability(page);
    await discard.click();
    await expect(page.locator('.shoteasy-workspace-guard')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (
        window.__shoteasyStores.imageStore.list.map((layer) => layer.name)
    ))).toEqual(savedOrder);

    await expect.poll(() => page.evaluate(() => (
        [...window.__screenhelloObjectUrls.values()].filter((type) => type.startsWith('image/')).length
    ))).toBe(imageObjectUrls);
    const activeObjectUrlTypes = await page.evaluate(() => [...window.__screenhelloObjectUrls.values()]);
    expect(activeObjectUrlTypes.filter((type) => type.startsWith('image/'))).toHaveLength(imageObjectUrls);
    expect(activeObjectUrlTypes.filter((type) => type === 'application/vnd.screenhello.project+zip')).toHaveLength(1);
    expect(await page.evaluate(() => window.__screenhelloObjectUrls.size)).toBe(objectUrls + 1);
    await waitForVisualStability(page);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(axe.violations).toEqual([]);
});
