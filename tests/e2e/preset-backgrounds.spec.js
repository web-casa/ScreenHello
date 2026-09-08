import { expect, test } from '@playwright/test';
import { createPngFixture } from '../fixtures/createPngFixture.js';
import AxeBuilder from '@axe-core/playwright';

async function openFixture(page) {
    await page.goto('/');
    await page.locator('.shoteasy-upload-card input[type=file]').setInputFiles({ name: 'background-test.png', mimeType: 'image/png', buffer: createPngFixture(64, 48) });
    await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();
}

test('25 real backgrounds load only on selection and undo keeps their pixels available', async ({ page }) => {
    test.setTimeout(60_000);
    const images = [], errors = [];
    page.on('request', request => { if (/bg-image-/.test(request.url()) && ['image', 'fetch'].includes(request.resourceType())) images.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    await openFixture(page);
    await expect(page.locator('.se-background-preset-grid').first().locator('button')).toHaveCount(6);
    expect(images).toHaveLength(0);
    await page.getByRole('button', { name: '全部图片（25）', exact: true }).click();
    const gallery = page.locator('.shoteasy-background-drawer .se-background-preset-grid');
    await expect(gallery.locator('button')).toHaveCount(25);
    for (const button of await gallery.locator('button').all()) {
        const key = await button.getAttribute('data-background-key');
        await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => page.evaluate(() => window.__shoteasyStores.option.background)).toBe(key);
        expect(await button.locator('img').evaluate(img => img.complete && img.naturalWidth === 240 && img.naturalHeight === 160)).toBe(true);
        expect(await page.evaluate(async () => {
            const root = window.__shoteasyStores;
            const image = await createImageBitmap(root.assetStore.get(root.option.backgroundAssetId).blob);
            const valid = image.width > 1400 && image.height > 900; image.close(); return valid;
        })).toBe(true);
    }
    expect(images).toHaveLength(25);
    const undo = await page.evaluate(() => {
        const root = window.__shoteasyStores;
        root.option.setBackground('none'); root.history.undo();
        return { key: root.option.background, url: root.option.frameConf.background.url, size: root.assetStore.get(root.option.backgroundAssetId).blob.size };
    });
    expect(undo.key).toBe('image_u22_v1'); expect(undo.url).toMatch(/^blob:/); expect(undo.size).toBeGreaterThan(0);
    expect(errors).toEqual([]);
});

test('failed and superseded selections preserve the current background and remain retryable', async ({ page }) => {
    await openFixture(page);
    await page.route('**/bg-image-n01.webp*', route => route.fulfill({ status: 404, body: '' }));
    await page.getByRole('button', { name: '晨雾山脉', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: '已保留原背景' })).toBeVisible();
    expect(await page.evaluate(() => window.__shoteasyStores.option.background)).toBe('gh_img_50');
    await page.unroute('**/bg-image-n01.webp*');
    await page.getByRole('button', { name: '晨雾山脉', exact: true }).click();
    await expect(page.getByRole('button', { name: '晨雾山脉', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.route('**/bg-image-n02.webp*', async route => {
        await new Promise(resolve => setTimeout(resolve, 700));
        await route.continue().catch(() => {});
    });
    await page.getByRole('button', { name: '静谧海岸', exact: true }).click();
    await expect(page.getByText('正在加载背景…', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '柔金沙丘', exact: true }).click();
    await expect(page.getByRole('button', { name: '柔金沙丘', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.renderTaskTracker.size)).toBe(0);
    expect(await page.evaluate(() => window.__shoteasyStores.option.background)).toBe('image_n03_v1');
});

test('image backgrounds survive self-contained archives and export PNG/JPG/WebP at both pixel ratios', async ({ page }) => {
    await openFixture(page);
    await page.getByRole('button', { name: '玫瑰细纹', exact: true }).click();
    await expect(page.getByRole('button', { name: '玫瑰细纹', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const result = await page.evaluate(async () => {
        const root = window.__shoteasyStores;
        const { createProjectArchive, createPresetArchive, readWorkspaceArchive } = await import('/src/utils/workspaceArchive.js');
        const { createStylePreset } = await import('/src/utils/stylePreset.js');
        root.option.setSize({ type: 'fixed', width: 256, height: 192 });
        root.option.setPadding(12); root.option.setShadowConf({ visible: false });
        const parts = await root.workspace._currentProjectParts();
        const archive = await createProjectArchive({ ...parts, document: parts.doc, name: 'Image preset test' });
        const decoded = await readWorkspaceArchive(archive);
        const preset = createStylePreset({ option: root.option.toDocument() });
        const presetDecoded = await readWorkspaceArchive(await createPresetArchive({ preset, background: parts.background }));
        root.option.setBackground('none');
        await root.workspace._applyProject(decoded);
        const rows = [];
        for (const ratio of [1, 2]) for (const format of ['png', 'jpg', 'webp']) {
            const { result: output } = await root.exportService.prepareImage({ format, ratio });
            const image = await createImageBitmap(output.blob);
            const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
            const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); image.close();
            // Sample the background beyond the screenshot's own white padding,
            // away from the intentionally rounded outer corners.
            rows.push({ format, ratio, width: canvas.width, height: canvas.height, pixel: [...context.getImageData(Math.floor(canvas.width / 2), 16 * ratio, 1, 1).data] });
            canvas.width = canvas.height = 1;
        }
        return { rows, key: root.option.background, presetKey: presetDecoded.preset.option.background,
            presetSize: presetDecoded.background.size, sourceSize: parts.background.blob.size,
            storedUrl: decoded.document.option.frameConf.background.url };
    });
    expect(result.key).toBe('image_u01_v1'); expect(result.presetKey).toBe(result.key);
    expect(result.presetSize).toBe(result.sourceSize); expect(result.storedUrl).toBeNull();
    for (const row of result.rows) {
        expect(row.width).toBe(result.rows[0].width * row.ratio); expect(row.height).toBe(result.rows[0].height * row.ratio);
        expect(row.pixel[3]).toBe(255); expect(row.pixel.slice(0, 3)).not.toEqual([255, 255, 255]);
    }
});
test('the gallery supports seven languages, both themes and a narrow viewport', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await openFixture(page);
    await page.getByRole('button', { name: '晨雾山脉', exact: true }).click();
    await expect(page.getByRole('button', { name: '晨雾山脉', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '全部图片（25）', exact: true }).click();
    const drawer = page.locator('.shoteasy-background-drawer:visible');
    await expect(drawer).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('background-gallery-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.commands.inspectorVisible)).toBe(false);
    await page.evaluate(() => window.__shoteasyStores.commands.setPanelVisibility('inspector', true));
    await page.getByRole('button', { name: '全部图片（25）', exact: true }).click();
    await expect(drawer).toBeVisible();
    await expect.poll(() => drawer.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= window.innerWidth;
    })).toBe(true);
    await expect(drawer.getByRole('button', { name: '晨雾山脉', exact: true })).toBeInViewport();
    expect(await drawer.locator('[data-background-key="image_n01_v1"]').evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
    for (const locale of ['zh-CN', 'en-US', 'zh-TW', 'de-DE', 'ko-KR', 'es-ES', 'pt-PT']) {
        for (const theme of ['dark', 'light']) {
            await page.evaluate(({ locale, theme }) => {
                window.__shoteasyStores.i18n.setOptions(locale);
                window.__shoteasyStores.editor.setTheme(theme);
            }, { locale, theme });
            await expect(page.locator('.shoteasy-app').first()).toHaveAttribute('lang', locale);
            await expect(page.locator('.shoteasy-app').first()).toHaveAttribute('data-mode', theme);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await expect.poll(() => drawer.evaluate(element => element.getAnimations({ subtree: true })
                .filter(animation => animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity).length)).toBe(0);
            const result = await new AxeBuilder({ page }).include('.se-background-preset-section').withTags(['wcag2a', 'wcag2aa']).analyze();
            expect(result.violations.map(item => ({ locale, theme, id: item.id, nodes: item.nodes.map(node => ({ target: node.target, reason: node.failureSummary })) }))).toEqual([]);
            expect(await drawer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        }
    }
    await page.screenshot({ path: testInfo.outputPath('background-gallery-mobile.png') });
});

test('a saved image preset feeds an isolated batch without changing the active canvas', async ({ page }) => {
    await openFixture(page);
    const result = await page.evaluate(async bytes => {
        const root = window.__shoteasyStores;
        await root.option.applyBackground('image_n01_v1');
        root.option.setSize({ type: 'fixed', width: 256, height: 192 });
        root.workspace.setExportSettings({ format: 'png', ratio: 1 }, { replace: true });
        const saved = await root.workspace.savePreset('Background batch');
        const id = root.workspace.presets.find(item => item.name === 'Background batch').id;
        root.option.setBackground('none'); root.history.reset();
        const applied = await root.workspace.applyPreset(id);
        const appliedKey = root.option.background;
        root.option.setBackground('none'); root.history.reset();
        root.batch.setPreset(id);
        await root.batch.start([new File([new Uint8Array(bytes)], 'one.png', { type: 'image/png' })]);
        return { saved, applied, appliedKey, liveKey: root.option.background,
            jobs: root.batch.jobs.map(job => job.status),
            archiveSize: root.batch.archive?.size, snapshotKey: root.batch._styleSnapshot?.option?.background };
    }, [...createPngFixture(64, 48)]);
    expect(result.saved).toBe(true); expect(result.applied).toBe(true); expect(result.appliedKey).toBe('image_n01_v1');
    expect(result.liveKey).toBe('none'); expect(result.jobs).toEqual(['completed']); expect(result.archiveSize).toBeGreaterThan(0);
    expect(result.snapshotKey).toBe('image_n01_v1');
});
