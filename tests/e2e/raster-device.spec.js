import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import AxeBuilder from '@axe-core/playwright';
import { createPngFixture } from '../fixtures/createPngFixture';

const installed = ['surface-studio', 'surface-pro-8'].every(id =>
    existsSync(new URL(`../../local-device-assets/${id}.png`, import.meta.url)));
test.skip(!installed, 'Real third-party assets are optional and not redistributed with the public source.');
const fixture = { name: 'screen.png', mimeType: 'image/png', buffer: createPngFixture(200, 100) };
const notice = page => page.getByRole('dialog', { name: '素材许可说明' });

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('.shoteasy-upload-card input[type=file]').setInputFiles(fixture);
    await page.waitForFunction(() => window.__shoteasyStores?.editor.app?.tree);
    await page.evaluate(() => {
        const root = window.__shoteasyStores;
        root.option.setSize({ type: 'custom', title: '自定义', width: 600, height: 500 }); root.option.setPadding(0); root.option.setRound(0);
        root.option.setBackground('none'); root.option.setFrame('surface-studio');
        root.option.setShadowConf({ visible: false });
    });
});

test('real devices render in every fit mode and format, with transparent PNG and correct final ratios', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const rows = await page.evaluate(async () => {
        const root = window.__shoteasyStores;
        const rows = [];
        for (const frame of ['surface-studio', 'surface-pro-8']) {
            root.option.setFrame(frame);
            for (const mode of ['cover', 'fit', 'stretch']) {
                root.option.setFrameMode(mode);
                for (const format of ['png', 'jpg', 'webp', 'avif']) {
                    const result = await root.exportService.exportImage({ format, ratio: format === 'png' ? 2 : 1 });
                    const url = URL.createObjectURL(result.blob);
                    const img = new Image(); img.src = url; await img.decode();
                    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
                    const imageNode = root.editor.app.tree.children[0].children.find(node => node.__screenhelloImageId);
                    rows.push({ frame, mode, format, width: canvas.width, height: canvas.height,
                        corner: [...ctx.getImageData(0, 0, 1, 1).data], size: result.blob.size,
                        geometry: { width: imageNode.width, height: imageNode.height },
                        center: [...ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height * .35), 1, 1).data] });
                    img.src = ''; URL.revokeObjectURL(url); canvas.width = canvas.height = 0;
                }
            }
        }
        return { rows, pending: root.renderTaskTracker.size, leases: root.exportService._canvasLeases.size };
    });
    for (const row of rows.rows) {
        expect([row.width, row.height]).toEqual(row.format === 'png' ? [1200, 1000] : [600, 500]);
        expect(row.size).toBeGreaterThan(1500);
        expect(row.center[3]).toBe(255);
        expect(row.geometry.width / row.geometry.height).toBeCloseTo(1440 / (row.frame === 'surface-studio' ? 1257 : 1160));
        if (row.format === 'png') expect(row.corner).toEqual([0, 0, 0, 0]);
        if (['jpg', 'webp'].includes(row.format)) {
            // Native lossy encoders can quantize white slightly (WebKit: 252).
            expect(row.corner[3]).toBe(255);
            for (const channel of row.corner.slice(0, 3)) expect(channel).toBeGreaterThanOrEqual(252);
        }
    }
    expect(rows.pending).toBe(0); expect(rows.leases).toBe(0); expect(errors).toEqual([]);
});

test('device thumbnails stay transparent with dark-only contour shadows in quick and mobile full pickers', async ({ page }, testInfo) => {
    const checkThumbs = async (scope, theme) => {
        const thumbs = scope.locator('.shoteasy-frame-thumb[data-kind="raster-device"]');
        await expect(thumbs.first()).toBeVisible();
        for (const thumb of await thumbs.all()) {
            await expect(thumb).toHaveAttribute('data-mode', theme);
            await expect(thumb).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
            await expect(thumb.locator('img')).toHaveCSS('filter', theme === 'dark' ? /drop-shadow\(rgba?\(255, 255, 255/ : 'none');
        }
    };
    // The desktop rail remains mounted but hidden while the mobile drawer opens.
    const panel = page.locator('.shoteasy-frame-panel:visible');
    for (const theme of ['dark', 'light', 'dark']) {
        await page.evaluate(theme => window.__shoteasyStores.editor.setTheme(theme), theme);
        await checkThumbs(panel, theme);
        await panel.screenshot({ path: testInfo.outputPath(`transparent-devices-${theme}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '打开应用菜单' }).click();
    await page.getByRole('tab', { name: '视图', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: '显示尺寸与外框', exact: true }).click();
    await checkThumbs(panel, 'dark');
    await page.getByRole('button', { name: '更多外框', exact: true }).click();
    const drawer = page.locator('.shoteasy-frame-drawer');
    await expect(drawer).toBeVisible();
    await checkThumbs(drawer, 'dark');
    await page.evaluate(() => window.__shoteasyStores.editor.setTheme('light'));
    await checkThumbs(drawer, 'light');
});

test('download notice cancels, focuses, prevents stale output and delivers the exact compression-preview Blob', async ({ page }) => {
    await page.evaluate(() => {
        const root = window.__shoteasyStores;
        window.__deviceDownloads = [];
        root.exportService.platform.export.download = async blob => { window.__deviceDownloads.push(blob); };
        window.__deviceOperation = root.commands.downloadCurrentImage();
    });
    await expect(notice(page)).toBeVisible();
    await expect(notice(page).getByRole('button', { name: /取\s*消/ })).toBeFocused();
    await expect(notice(page)).toContainText('Tony Thomas');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.__deviceOperation)).toBe(false);
    expect(await page.evaluate(() => window.__deviceDownloads.length)).toBe(0);

    await page.evaluate(async () => {
        const root = window.__shoteasyStores;
        root.option.setFrame('surface-pro-8');
        window.__devicePrepared = await root.exportService.prepareImage({ format: 'png', compression: 'lossless' });
        window.__deviceOperation = root.commands.downloadPreparedImage(window.__devicePrepared.token, window.__devicePrepared.settings);
    });
    await expect(notice(page)).toBeVisible();
    await expect(notice(page)).toContainText('MockupFree.co');
    await expect(notice(page)).toContainText('Surface Pro');
    await expect(notice(page)).not.toContainText('Surface Pro 8');
    await expect(notice(page).getByRole('link', { name: '完整许可' })).toHaveAttribute('href', 'https://mockupfree.co/licence/');
    await notice(page).getByRole('button', { name: '了解并继续' }).click();
    expect(await page.evaluate(() => window.__deviceOperation)).toBe(true);
    expect(await page.evaluate(() => window.__deviceDownloads[0] === window.__devicePrepared.result.blob)).toBe(true);

    await page.evaluate(() => { window.__deviceOperation = window.__shoteasyStores.commands.downloadCurrentImage(); });
    await expect(notice(page)).toBeVisible();
    await page.evaluate(() => window.__shoteasyStores.option.setFrame('surface-studio'));
    await expect(notice(page)).toBeHidden(); // Content invalidation aborts the notice.
    expect(await page.evaluate(() => window.__deviceOperation)).toBe(false);
    expect(await page.evaluate(() => window.__deviceDownloads.length)).toBe(1);
});

test('device selection shows real thumbnails, license UI is accessible and mobile stays within viewport', async ({ page }, testInfo) => {
    await page.getByRole('button', { name: '更多外框', exact: true }).click();
    const deviceCount = await page.evaluate(async () => (await import('/src/utils/frameConfig.js')).getFrameGroups().find(group => group.id === 'device').items.length);
    await expect(page.locator('.shoteasy-frame-drawer .shoteasy-frame-thumb[data-kind="raster-device"] img')).toHaveCount(deviceCount);
    for (const thumb of await page.locator('.shoteasy-frame-drawer .shoteasy-frame-thumb[data-kind="raster-device"]').all()) {
        await thumb.scrollIntoViewIfNeeded();
        await expect.poll(() => thumb.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
        const bounds = await thumb.evaluate(el => {
            const outer = el.getBoundingClientRect(), image = el.querySelector('img').getBoundingClientRect();
            const label = el.nextElementSibling.getBoundingClientRect();
            return { contained: image.top >= outer.top && image.bottom <= outer.bottom,
                labelBelow: label.top >= outer.bottom };
        });
        expect(bounds).toEqual({ contained: true, labelBelow: true });
    }
    await page.locator('.shoteasy-frame-drawer .shoteasy-frame-option').filter({ has: page.locator('input[value="surface-pro-8"]') }).click();
    await expect(page.locator('.shoteasy-frame-drawer')).toContainText('MockupFree.co');
    await page.locator('.shoteasy-frame-drawer-shell .ant-drawer-close').click();
    await page.evaluate(() => { window.__deviceOperation = window.__shoteasyStores.commands.downloadCurrentImage(); });
    await expect(notice(page)).toBeVisible();
    for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const result = await new AxeBuilder({ page }).include('.ant-modal').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        expect(result.violations).toEqual([]);
        expect(await notice(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`license-${width}.png`) });
    }
    await notice(page).getByRole('button', { name: /取\s*消/ }).click();
});

test('failed assets block export and recover; rapid changes do not leak old images into the final snapshot', async ({ page }) => {
    await page.route('**/surface-pro-8.png*', route => route.abort());
    const failed = await page.evaluate(async () => {
        const root = window.__shoteasyStores; root.option.setFrame('surface-pro-8');
        try { await root.exportService.exportImage(); return null; } catch (error) { return error.code; }
    });
    expect(failed).toBe('device-render-failed');
    await page.unroute('**/surface-pro-8.png*');
    const result = await page.evaluate(async () => {
        const root = window.__shoteasyStores;
        for (let index = 0; index < 8; index++) {
            root.option.setFrame(index % 2 ? 'surface-pro-8' : 'surface-studio');
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        root.option.setFrameMode('fit'); root.option.toggleFlip('x'); root.option.setRound(12);
        root.option.setPadding(12); root.option.setInnerBorder({ visible: true, color: '#ff0000', width: 4 });
        root.editor.addShape({ id: 'device-magnifier', type: 'Magnifier', x: 100, y: 100, width: 60, height: 60 });
        const exported = await root.exportService.exportImage();
        return { bytes: exported.blob.size, frame: root.option.frame, pending: root.renderTaskTracker.size, snap: !!root.editor.snap };
    });
    expect(result).toMatchObject({ frame: 'surface-pro-8', pending: 0, snap: true });
    expect(result.bytes).toBeGreaterThan(1500);
});

test('CORS-approved host images remain exportable through the device compositor', async ({ page }) => {
    const remote = 'https://screenhello-image.test/cors.png';
    await page.route(remote, route => route.fulfill({ contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: fixture.buffer }));
    const bytes = await page.evaluate(async remote => {
        const root = window.__shoteasyStores;
        // Use the same preparation path as the public defaultImg prop. It keeps
        // the supplied URL rather than normalizing it into an owned local Blob.
        const { prepareRuntimeImage } = await import('/src/utils/runtimeImage.js');
        root.editor.setImg(await prepareRuntimeImage(remote, { type: 'dataURL', platform: root.platform }));
        root.option.setFrame('surface-pro-8');
        const result = await root.exportService.exportImage();
        return [...new Uint8Array(await result.blob.arrayBuffer())];
    }, remote);
    const png = PNG.sync.read(Buffer.from(bytes));
    expect([png.width, png.height]).toEqual([600, 500]);
    expect(bytes.length).toBeGreaterThan(1500);
});

test('batch ZIP notice uses its frozen device even after the editor changes', async ({ page }) => {
    test.setTimeout(60_000);
    const started = await page.evaluate(async () => {
        const root = window.__shoteasyStores;
        const image = await fetch(root.editor.img.src).then(response => response.blob());
        root.batch.selectFiles([new File([image], 'one.png', { type: 'image/png' }), new File([image], 'two.png', { type: 'image/png' })]);
        return root.batch.start();
    });
    expect(started).toBe(true);
    expect(await page.evaluate(() => window.__shoteasyStores.batch.summary.successCount)).toBe(2);
    await page.evaluate(() => {
        const root = window.__shoteasyStores;
        root.option.setFrame('surface-pro-8');
        window.__deviceOperation = root.batch.download();
    });
    await expect(notice(page)).toBeVisible(); await expect(notice(page)).toContainText('Surface Studio');
    const download = page.waitForEvent('download');
    await notice(page).getByRole('button', { name: '了解并继续' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.zip$/);
    const { unzipSync } = await import('fflate');
    const entries = Object.values(unzipSync(await readFile(await file.path())));
    expect(entries).toHaveLength(2);
    for (const bytes of entries) expect(PNG.sync.read(Buffer.from(bytes)).width).toBe(600);
});

test('two editor instances own their raster URLs, notices and teardown independently', async ({ page }) => {
    await page.evaluate(async () => {
        const { mountI18nHarness } = await import('/tests/fixtures/i18n-harness.jsx');
        const container = document.createElement('div'); document.body.append(container);
        window.__devicePair = mountI18nHarness(container);
    });
    for (const name of ['first', 'second']) await page.getByTestId(`locale-${name}`).locator('.shoteasy-upload-card input[type=file]').setInputFiles(fixture);
    await page.waitForFunction(() => ['first', 'second'].every(name => window.__devicePair.runtimes[name]?.editor.app?.tree));
    const result = await page.evaluate(async () => {
        const { first, second } = window.__devicePair.runtimes;
        const { getRasterDevice } = await import('/src/utils/rasterDeviceConfig.js');
        const colored = getRasterDevice('imac-24-purple-v1')?.available;
        for (const [root, frame] of [[first, colored ? 'macbook-air-m2-starlight-v1' : 'surface-studio'], [second, colored ? 'imac-24-purple-v1' : 'surface-pro-8']]) {
            root.option.setFrame(frame); root.option.setFrameSize(600, 500);
        }
        await Promise.all([first.exportService.exportImage(), second.exportService.exportImage()]);
        const raster = root => root.editor.app.tree.children[0].children.find(node => node.__screenhelloImageId).children[1];
        const firstUrl = raster(first).fill.url, secondUrl = raster(second).fill.url;
        first.option.setFrame('none');
        await first.exportService.exportImage();
        const remains = (await fetch(secondUrl)).ok;
        let released = false;
        try { await fetch(firstUrl); } catch { released = true; }
        const secondResult = await second.exportService.exportImage();
        window.__devicePair.unmount();
        return { different: firstUrl !== secondUrl, remains, released, bytes: secondResult.blob.size };
    });
    expect(result).toMatchObject({ different: true, remains: true, released: true });
    expect(result.bytes).toBeGreaterThan(1500);
});

test('project and preset archives retain device/fit without redistributing the device pack', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const root = window.__shoteasyStores;
        root.option.setFrame('surface-pro-8'); root.option.setFrameMode('fit');
        const { createProjectArchive, createPresetArchive, readWorkspaceArchive } = await import('/src/utils/workspaceArchive.js');
        const { createStylePreset } = await import('/src/utils/stylePreset.js');
        const project = root.editor.serializeProject();
        const option = project.option;
        const presetBlob = await createPresetArchive({ preset: createStylePreset({ option }) });
        const preset = await readWorkspaceArchive(presetBlob, { expectedKind: 'preset' });
        const images = await Promise.all(project.images.map(async metadata => ({ metadata,
            blob: await fetch(root.imageStore.resolve(metadata).src).then(response => response.blob()) })));
        const projectBlob = await createProjectArchive({ name: 'Surface project', document: project, images });
        const restored = await readWorkspaceArchive(projectBlob, { expectedKind: 'project' });
        return { option, presetFrame: preset.preset.option.frame, restoredFrame: restored.document.option.frame,
            archive: [...new Uint8Array(await projectBlob.arrayBuffer())], saved: JSON.stringify(project) };
    });
    expect(result.option).toMatchObject({ frame: 'surface-pro-8', frameMode: 'fit' });
    expect(result.presetFrame).toBe('surface-pro-8');
    expect(result.restoredFrame).toBe('surface-pro-8');
    expect(result.saved).not.toMatch(/local-device-assets|medialoot|mockupfree|surface-(studio|pro-8)(-screen)?\.png/);
    const { unzipSync } = await import('fflate');
    const names = Object.keys(unzipSync(new Uint8Array(result.archive)));
    expect(names.filter(name => name.startsWith('assets/images/'))).toHaveLength(1);
    expect(names).toHaveLength(2); // Only the manifest and user's own image.
});

const restoredIds = ['macbook-pro-bitmap', 'macbook-air-bitmap', 'imac-bitmap', 'ipad-bitmap', 'iphone-bitmap'];
const restoredPackInstalled = restoredIds.every(id => existsSync(new URL(`../../local-device-assets/${id.replace('-bitmap', '')}.png`, import.meta.url)));
const colorIds = ['macbook-air-m2-silver', 'macbook-air-m2-starlight', 'macbook-air-m2-space-gray', 'macbook-air-m2-midnight',
    'imac-24-blue', 'imac-24-orange', 'imac-24-purple', 'imac-24-red', 'imac-24-silver', 'pixel-9-pro-original'].map(id => `${id}-v1`);
const colorPackInstalled = colorIds.every(id => existsSync(new URL(`../../local-device-assets/${id}.png`, import.meta.url)));

test('device model cards group colors, keyboard changes undo once, seven locales and legacy appearance stay intact', async ({ page }, testInfo) => {
    test.skip(!colorPackInstalled, 'Optional color pack is not installed.');
    test.setTimeout(90_000);
    await page.getByRole('button', { name: '更多外框', exact: true }).click();
    const drawer = page.locator('.shoteasy-frame-drawer');
    const group = drawer.getByRole('radiogroup', { name: '设备', exact: true });
    await expect(group.locator('.shoteasy-frame-option')).toHaveCount(8);
    await expect(group.locator('input[value="macbook-air-bitmap"], input[value="imac-bitmap"]')).toHaveCount(0);
    await group.locator('.shoteasy-frame-option').filter({ hasText: 'MacBook Air M2' }).click();
    await expect(drawer.locator('.shoteasy-device-color')).toHaveCount(4);
    await drawer.locator('.shoteasy-device-color input[value="macbook-air-m2-silver-v1"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.option.frame)).toBe('macbook-air-m2-starlight-v1');
    await page.evaluate(() => window.__shoteasyStores.history.undo());
    await expect(drawer.locator('.shoteasy-device-color input[value="macbook-air-m2-silver-v1"]')).toBeChecked();
    await page.evaluate(() => window.__shoteasyStores.history.redo());
    await expect(drawer.locator('.shoteasy-device-color input[value="macbook-air-m2-starlight-v1"]')).toBeChecked();
    await group.locator('.shoteasy-frame-option').filter({ hasText: 'iMac 24″' }).click();
    await expect(drawer.locator('.shoteasy-device-color')).toHaveCount(5);
    await drawer.locator('.shoteasy-device-color').filter({ hasText: '紫色' }).click();
    const png = await page.evaluate(async () => {
        const result = await window.__shoteasyStores.exportService.exportImage();
        return [...new Uint8Array(await result.blob.arrayBuffer())];
    });
    await testInfo.attach('imac-purple-product.png', { body: Buffer.from(png), contentType: 'image/png' });
    await group.scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath('device-colors-product.png') });
    for (const locale of ['en-US', 'zh-CN', 'zh-TW', 'de-DE', 'ko-KR', 'es-ES', 'pt-PT']) {
        await page.evaluate(locale => window.__shoteasyStores.i18n.setOptions(locale), locale);
        await expect(drawer.locator('.shoteasy-device-color')).toHaveCount(5);
        const redLabels = { 'en-US': 'Red', 'zh-CN': '红色', 'zh-TW': '紅色', 'de-DE': 'Rot', 'ko-KR': '빨간색', 'es-ES': 'Rojo', 'pt-PT': 'Vermelho' };
        await expect(drawer.locator('.shoteasy-device-color').filter({ has: page.locator('input[value="imac-24-red-v1"]') })).toHaveText(redLabels[locale]);
        expect(await page.evaluate(() => window.__shoteasyStores.option.frame)).toBe('imac-24-purple-v1');
        if (locale !== 'zh-CN') expect(await drawer.locator('.shoteasy-device-colors legend').innerText()).not.toBe('机身配色');
    }
    await page.evaluate(() => { window.__shoteasyStores.i18n.setOptions('zh-CN'); window.__shoteasyStores.editor.setTheme('light'); });
    await page.setViewportSize({ width: 390, height: 844 });
    // Compact layout remounts the rail in its own drawer; open it through the real mobile menu.
    await page.getByRole('button', { name: '打开应用菜单' }).click();
    await page.getByRole('tab', { name: '视图', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: '显示尺寸与外框', exact: true }).click();
    await page.getByRole('button', { name: '更多外框', exact: true }).click();
    await expect(drawer).toBeVisible();
    expect((await new AxeBuilder({ page }).include('.shoteasy-frame-drawer').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    expect(await drawer.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (const label of await drawer.locator('.shoteasy-device-color').all()) expect((await label.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await page.evaluate(async () => { window.__shoteasyStores.option.setFrame('genericPhone'); await window.__shoteasyStores.exportService.exportImage(); });
    await expect(drawer).toContainText('旧版设备（兼容）');
    expect(await page.evaluate(() => window.__shoteasyStores.option.frame)).toBe('genericPhone');
});

test('color archive, preset and frozen batch retain exact variant; MIT delivery has no modal', async ({ page }) => {
    test.skip(!colorPackInstalled, 'Optional color pack is not installed.');
    test.setTimeout(90_000);
    const saved = await page.evaluate(async () => {
        const root = window.__shoteasyStores;
        root.option.setFrame('imac-24-red-v1'); root.option.setFrameMode('fit');
        const { createProjectArchive, createPresetArchive, readWorkspaceArchive } = await import('/src/utils/workspaceArchive.js');
        const { createStylePreset } = await import('/src/utils/stylePreset.js');
        const project = root.editor.serializeProject();
        const images = await Promise.all(project.images.map(async metadata => ({ metadata, blob: await fetch(root.imageStore.resolve(metadata).src).then(response => response.blob()) })));
        const archive = await createProjectArchive({ name: 'Colors', document: project, images });
        const restored = await readWorkspaceArchive(archive, { expectedKind: 'project' });
        const preset = await readWorkspaceArchive(await createPresetArchive({ preset: createStylePreset({ option: project.option }) }), { expectedKind: 'preset' });
        const image = images[0].blob;
        root.batch.selectFiles([new File([image], 'color.png', { type: 'image/png' })]);
        const started = await root.batch.start();
        root.option.setFrame('pixel-9-pro-original-v1'); window.__deviceOperation = root.batch.download();
        return { restored: restored.document.option.frame, preset: preset.preset.option.frame, started, archive: [...new Uint8Array(await archive.arrayBuffer())] };
    });
    expect(saved).toMatchObject({ restored: 'imac-24-red-v1', preset: 'imac-24-red-v1', started: true });
    const { unzipSync } = await import('fflate'); expect(Object.keys(unzipSync(new Uint8Array(saved.archive)))).toHaveLength(2);
    await expect(notice(page)).toContainText('Monkr'); await expect(notice(page)).toContainText('红色');
    await notice(page).getByRole('button', { name: /取\s*消/ }).click(); expect(await page.evaluate(() => window.__deviceOperation)).toBe(false);
    expect(await page.evaluate(async () => {
        const root = window.__shoteasyStores; window.__colorBlobs = [];
        root.exportService.platform.export.download = async blob => window.__colorBlobs.push(blob);
        return root.commands.downloadCurrentImage();
    })).toBe(true);
    await expect(notice(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__colorBlobs.length)).toBe(1);
});

test('failed color blocks output, prepared color becomes stale and rapid color changes settle on the requested body', async ({ page }) => {
    test.skip(!colorPackInstalled, 'Optional color pack is not installed.');
    test.setTimeout(60_000);
    await page.route('**/macbook-air-m2-midnight-v1.png*', route => route.abort());
    const failed = await page.evaluate(async () => {
        const root = window.__shoteasyStores; root.option.setFrame('macbook-air-m2-midnight-v1');
        try { await root.exportService.exportImage(); return null; } catch (error) { return error.code; }
    });
    expect(failed).toBe('device-render-failed');
    await page.unroute('**/macbook-air-m2-midnight-v1.png*');
    await page.evaluate(async () => {
        const root = window.__shoteasyStores;
        root.option.setFrame('macbook-air-m2-silver-v1');
        window.__devicePrepared = await root.exportService.prepareImage({ format: 'png', compression: 'lossless' });
        window.__deviceOperation = root.commands.downloadPreparedImage(window.__devicePrepared.token, window.__devicePrepared.settings);
    });
    await expect(notice(page)).toContainText('银色');
    await page.evaluate(() => window.__shoteasyStores.option.setFrame('macbook-air-m2-starlight-v1'));
    await expect(notice(page)).toBeHidden(); expect(await page.evaluate(() => window.__deviceOperation)).toBe(false);
    const final = await page.evaluate(async () => {
        const root = window.__shoteasyStores;
        for (let i = 0; i < 8; i++) { root.option.setFrame(i % 2 ? 'macbook-air-m2-midnight-v1' : 'imac-24-purple-v1'); await new Promise(resolve => setTimeout(resolve, 20)); }
        const image = await root.exportService.exportImage();
        return { frame: root.option.frame, bytes: image.blob.size, pending: root.renderTaskTracker.size, leases: root.exportService._canvasLeases.size };
    });
    expect(final).toMatchObject({ frame: 'macbook-air-m2-midnight-v1', pending: 0, leases: 0 }); expect(final.bytes).toBeGreaterThan(1500);
});

test('restored and approved color devices preserve real shells, cutouts and alpha in every fit mode and export format', async ({ page }) => {
    test.skip(!restoredPackInstalled, 'The historical bitmap pack is optional and not publicly redistributed.');
    test.setTimeout(300_000);
    const rows = await page.evaluate(async ids => {
        const root = window.__shoteasyStores;
        const { getRasterDevice } = await import('/src/utils/rasterDeviceConfig.js');
        const { renderRasterDevice } = await import('/src/utils/renderRasterDevice.js');
        const decode = async (url, width, height) => {
            const img = new Image(); img.src = url; await img.decode();
            const canvas = document.createElement('canvas'); canvas.width = width || img.naturalWidth; canvas.height = height || img.naturalHeight;
            try {
                const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                return { width: canvas.width, height: canvas.height, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
            } finally { img.src = ''; canvas.width = canvas.height = 0; }
        };
        const rows = [];
        for (const id of ids) {
            root.option.setFrame(id);
            const device = getRasterDevice(id);
            const original = await decode(device.image, device.width, device.height);
            const compositeUrl = await renderRasterDevice(device, root.editor.img.src, { mode: 'cover' });
            try {
                const composite = await decode(compositeUrl);
                let protectedPixels = 0, changedShellPixels = 0;
                for (let index = 0; index < original.pixels.length; index += 4) {
                    if (original.pixels[index + 3] !== 255) continue;
                    protectedPixels++;
                    if ([0, 1, 2, 3].some(channel => original.pixels[index + channel] !== composite.pixels[index + channel])) changedShellPixels++;
                }
                const center = (Math.floor(device.height / 2) * device.width + Math.floor(device.width / 2)) * 4;
                rows.push({ id, protectedPixels, changedShellPixels, centerAlpha: composite.pixels[center + 3], outsideAlpha: composite.pixels[3] });
            } finally { URL.revokeObjectURL(compositeUrl); }
            for (const mode of ['cover', 'fit', 'stretch']) {
                root.option.setFrameMode(mode);
                for (const format of ['png', 'jpg', 'webp', 'avif']) {
                    const result = await root.exportService.exportImage({ format, ratio: format === 'png' ? 2 : 1 });
                    const url = URL.createObjectURL(result.blob);
                    try {
                        const output = await decode(url);
                        rows.push({ id, mode, format, width: output.width, height: output.height, corner: [...output.pixels.slice(0, 4)] });
                    } finally { URL.revokeObjectURL(url); }
                }
            }
        }
        return rows;
    }, [...restoredIds, ...(colorPackInstalled ? colorIds : [])]);
    for (const row of rows) {
        if (!row.format) {
            expect(row.protectedPixels).toBeGreaterThan(2000);
            expect(row.changedShellPixels).toBe(0); // Includes the notch/dynamic island, not only the screen bounds.
            expect(row.centerAlpha).toBe(255); expect(row.outsideAlpha).toBe(0);
        } else {
            expect([row.width, row.height]).toEqual(row.format === 'png' ? [1200, 1000] : [600, 500]);
            if (row.format === 'png') expect(row.corner).toEqual([0, 0, 0, 0]);
            if (['jpg', 'webp'].includes(row.format)) {
                expect(row.corner[3]).toBe(255);
                for (const channel of row.corner.slice(0, 3)) expect(channel).toBeGreaterThanOrEqual(252);
            }
        }
    }
});

test('real device choices exclude legacy vector frames and retain source links without verification warnings', async ({ page }, testInfo) => {
    test.skip(!restoredPackInstalled, 'The historical bitmap pack is optional and not publicly redistributed.');
    await page.getByRole('button', { name: '更多外框', exact: true }).click();
    const group = page.getByRole('radiogroup', { name: '设备', exact: true });
    const count = await page.evaluate(async () => (await import('/src/utils/frameConfig.js')).getFrameGroups().find(group => group.id === 'device').items.length);
    await expect(group.locator('img')).toHaveCount(count);
    await expect(group).not.toContainText('通用');
    await expect(group).toContainText('Surface Pro'); await expect(group).not.toContainText('Surface Pro 8');
    const simple = page.locator('.shoteasy-frame-simple-devices');
    await expect(simple).toHaveCount(0);
    await group.locator('.shoteasy-frame-option').filter({ hasText: 'iPhone' }).click();
    await group.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('restored-devices.png'), animations: 'disabled' });
    await page.locator('.shoteasy-frame-drawer-shell .ant-drawer-close').click();
    const singleDownload = page.waitForEvent('download');
    await page.evaluate(() => { window.__deviceOperation = window.__shoteasyStores.commands.downloadCurrentImage(); });
    expect(PNG.sync.read(await readFile(await (await singleDownload).path())).width).toBe(600);
    await expect(notice(page)).toBeHidden();
    expect(await page.evaluate(() => window.__deviceOperation)).toBe(true);
    expect(await page.evaluate(async () => {
        const root = window.__shoteasyStores;
        const blob = await fetch(root.editor.img.src).then(response => response.blob());
        root.batch.selectFiles([new File([blob], 'phone.png', { type: 'image/png' })]);
        return root.batch.start();
    })).toBe(true);
    const download = page.waitForEvent('download');
    await page.evaluate(() => {
        const root = window.__shoteasyStores;
        root.option.setFrame('surface-studio');
        window.__deviceOperation = root.batch.download();
    });
    const { unzipSync } = await import('fflate');
    const entries = Object.values(unzipSync(await readFile(await (await download).path())));
    expect(entries).toHaveLength(1);
    expect(PNG.sync.read(Buffer.from(entries[0])).width).toBe(600);
    await expect(notice(page)).toBeHidden();
});

test('Shoteasy and Monkr source panels omit verification warnings in all seven languages without relabeling licenses', async ({ page }) => {
    test.skip(!restoredPackInstalled || !colorPackInstalled, 'Both optional packs are required.');
    test.setTimeout(90_000);
    await page.getByRole('button', { name: '更多外框', exact: true }).click();
    for (const [id, author] of [['iphone-bitmap', 'Shoteasy'], ['macbook-air-m2-silver-v1', 'Monkr']]) {
        await page.evaluate(id => window.__shoteasyStores.option.setFrame(id), id);
        for (const locale of ['zh-CN', 'en-US', 'zh-TW', 'de-DE', 'ko-KR', 'es-ES', 'pt-PT']) {
            await page.evaluate(locale => window.__shoteasyStores.i18n.setOptions(locale), locale);
            for (const panel of ['.shoteasy-frame-panel', '.shoteasy-frame-drawer']) {
                const source = page.locator(`${panel} .shoteasy-device-license`);
                // Only the author paragraph remains; no replacement warning or blank paragraph.
                await expect(source.locator('p')).toHaveCount(1);
                await expect(source.locator('p')).toHaveText(author);
                await expect(source.locator('a')).toHaveCount(1);
            }
        }
        const downloaded = id === 'iphone-bitmap' ? page.waitForEvent('download') : null;
        const metadata = await page.evaluate(async id => (await import('/src/utils/rasterDeviceConfig.js')).getRasterDevice(id), id);
        expect(metadata.licenseStatus).toBe('unverified');
        expect(metadata.license).toBeNull();
        await page.evaluate(() => {
            window.__shoteasyStores.i18n.setOptions('zh-CN');
            window.__deviceOperation = window.__shoteasyStores.commands.downloadCurrentImage();
        });
        if (downloaded) {
            expect(await (await downloaded).failure()).toBeNull();
            await expect(notice(page)).toBeHidden();
            expect(await page.evaluate(() => window.__deviceOperation)).toBe(true);
            continue;
        }
        await expect(notice(page)).toBeVisible();
        const device = await page.evaluate(() => window.__shoteasyStores.deviceLicense.pending);
        expect(device.licenseStatus).toBe('unverified');
        expect(device.license).toBeNull();
        await expect(notice(page).locator('.shoteasy-device-license > p')).toHaveCount(id === 'iphone-bitmap' ? 4 : 5);
        await expect(notice(page)).not.toContainText('尚待核实');
        await expect(notice(page).getByRole('link', { name: '素材来源' })).toHaveAttribute('href', device.source);
        await notice(page).getByRole('button', { name: /取\s*消/ }).click();
        expect(await page.evaluate(() => window.__deviceOperation)).toBe(false);
    }
});
