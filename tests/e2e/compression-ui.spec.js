import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { createPngFixture } from '../fixtures/createPngFixture.js';

test('AVIF unavailable preview is detected before encoding while direct AVIF download remains available', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => {
        const original = globalThis.createImageBitmap;
        window.__avifProbe = { calls: 0 };
        globalThis.createImageBitmap = function (...args) {
            if (args[0]?.type === 'image/avif') { window.__avifProbe.calls++; return Promise.reject(new Error('native AVIF unavailable')); }
            return Reflect.apply(original, this, args);
        };
    });
    await page.locator('.shoteasy-export-drawer').getByText('AVIF', { exact: true }).click();
    await expect(page.getByTestId('export-preview')).toBeDisabled();
    await expect(page.getByTestId('export-preview')).toHaveAccessibleDescription(/当前浏览器无法预览 AVIF/);
    expect(await page.evaluate(() => window.__avifProbe.calls)).toBe(1);
    expect(await page.evaluate(() => window.__shoteasyStores.exportService.isBusy)).toBe(false);
    await page.getByTestId('compression-lossy').click();
    for (const locale of ['zh-CN', 'en-US', 'zh-TW', 'de-DE', 'ko-KR', 'es-ES', 'pt-PT']) {
        await page.evaluate(locale => window.__shoteasyStores.i18n.setOptions(locale), locale);
        await expect(page.getByTestId('export-preview')).toHaveAccessibleDescription(/AVIF.*PNG.*JPG.*WebP/);
        await expect(page.getByTestId('export-download')).toBeEnabled();
    }
    await page.evaluate(() => window.__shoteasyStores.i18n.setOptions('zh-CN'));
    const downloaded = page.waitForEvent('download');
    await page.getByTestId('export-download').click();
    const download = await downloaded;
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toMatch(/\.avif$/);
    expect((await readFile(await download.path())).subarray(4, 12).toString()).toBe('ftypavif');
    await expect(page.locator('.shoteasy-export-drawer')).toHaveCount(0);
    await page.getByRole('button', { name: '导出图片', exact: true }).click();
    await expect(page.getByTestId('avif-preview-support')).toContainText('当前浏览器无法预览');
    await page.locator('.shoteasy-export-drawer').getByText('PNG', { exact: true }).first().click();
    await expect(page.getByTestId('avif-preview-support')).toHaveCount(0);
    await preview(page);
});

test('AVIF probe timeout and late results cannot disable another format or retain a closed panel', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => {
        const original = globalThis.createImageBitmap;
        window.__lateAvif = [];
        globalThis.createImageBitmap = function (...args) {
            if (args[0]?.type === 'image/avif') return new Promise((resolve, reject) => window.__lateAvif.push(() => Reflect.apply(original, this, args).then(resolve, reject)));
            return Reflect.apply(original, this, args);
        };
    });
    const avif = () => page.locator('.shoteasy-export-drawer').getByText('AVIF', { exact: true }).click();
    await avif();
    await expect(page.getByTestId('avif-preview-support')).toContainText('正在检查');
    await expect(page.getByTestId('export-download')).toBeEnabled();
    await expect(page.getByTestId('avif-preview-support')).toContainText('当前浏览器无法预览');
    await page.locator('.shoteasy-export-drawer').getByText('PNG', { exact: true }).first().click();
    await page.evaluate(async () => { for (const release of window.__lateAvif.splice(0)) await release(); });
    await expect(page.getByTestId('export-preview')).toBeEnabled();
    await avif();
    await expect(page.getByTestId('avif-preview-support')).toContainText('正在检查');
    await page.getByTestId('export-cancel').click();
    await page.evaluate(async () => { for (const release of window.__lateAvif.splice(0)) await release(); });
    await expect(page.locator('.shoteasy-export-drawer')).toHaveCount(0);
});

for (const [format, compression] of [
    ['png', 'lossless'], ['png', 'lossy'], ['webp', 'lossless'],
    ['webp', 'lossy'], ['jpg', 'lossy'],
]) test(`CD large built-in PC example downloads ${format}/${compression} without preview or resizing`, async ({ page }) => {
    test.setTimeout(150_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await page.getByRole('button', { name: '试用示例', exact: true }).click();
    await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();
    const size = await page.evaluate(() => {
        const { width, height } = window.__shoteasyStores.option.frameConf;
        return { width: Math.ceil(width), height: Math.ceil(height) };
    });
    expect(size.width * size.height).toBeGreaterThan(1_048_576);
    expect(size.width * size.height).toBeLessThanOrEqual(4_194_304);
    await page.getByRole('button', { name: '导出图片', exact: true }).click();
    await page.locator('.shoteasy-export-drawer').getByText(format.toUpperCase(), { exact: true }).first().click();
    await page.getByTestId(`compression-${compression}`).click();
    await expect(page.getByTestId('export-preview')).toBeDisabled();
    await expect(page.getByTestId('export-download')).toBeEnabled();
    const downloaded = page.waitForEvent('download', { timeout: 135_000 });
    await page.getByTestId('export-download').click();
    const download = await downloaded;
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
    const bytes = await readFile(await download.path());
    expect(bytes.length).toBeGreaterThan(0);
    const decoded = await page.evaluate(async ({ base64, format }) => {
        const blob = await (await fetch(`data:image/${format === 'jpg' ? 'jpeg' : format};base64,${base64}`)).blob();
        const image = await createImageBitmap(blob);
        const dimensions = { width: image.width, height: image.height };
        image.close();
        return dimensions;
    }, { base64: bytes.toString('base64'), format });
    expect(decoded).toEqual(size);
    await expect(page.locator('.shoteasy-export-drawer')).toHaveCount(0);
    expect(await page.evaluate(() => {
        const service = window.__shoteasyStores.exportService;
        return { leases: service._canvasLeases.size, contexts: service._contexts.size, busy: service.isBusy, prepared: service._prepared };
    })).toEqual({ leases: 0, contexts: 0, busy: false, prepared: null });
    expect(errors).toEqual([]);
});

test('HF1 Web AVIF large compression is blocked with localized guidance, while standard settings and other formats remain available', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '试用示例', exact: true }).click();
    await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();
    await page.getByRole('button', { name: '导出图片', exact: true }).click();
    const drawer = page.locator('.shoteasy-export-drawer');
    await drawer.getByText('AVIF', { exact: true }).click();
    await page.getByTestId('compression-lossy').click();
    await page.setViewportSize({ width: 390, height: 844 });
    for (const locale of ['zh-CN', 'en-US', 'zh-TW', 'de-DE', 'ko-KR', 'es-ES', 'pt-PT']) {
        await page.evaluate(locale => window.__shoteasyStores.i18n.setOptions(locale), locale);
        await expect(page.getByTestId('export-download')).toBeDisabled();
        await expect(page.getByTestId('export-download')).toHaveAccessibleDescription(/AVIF.*PNG.*JPG.*WebP/);
        const box = await page.getByTestId('export-download').boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        expect(box.y + box.height).toBeLessThanOrEqual(844);
    }
    const result = await page.evaluate(async () => {
        const root = window.__shoteasyStores;
        let captures = 0;
        const original = root.editor.app.tree.export;
        root.editor.app.tree.export = (...args) => { captures++; return original.apply(root.editor.app.tree, args); };
        const settings = { format: 'avif', compression: 'lossy', quality: 60, ratio: 1 };
        root.workspace.setExportSettings(settings, { replace: true });
        try {
            let directError;
            try { await root.exportService.downloadImage({ ...settings, webExportSafety: false }); }
            catch (error) { directError = error.code; }
            return { directError, captures, saved: root.workspace.exportSettings };
        } finally { root.editor.app.tree.export = original; }
    });
    expect(result).toMatchObject({ directError: 'export-web-avif-compression-size-too-large', captures: 0,
        saved: { format: 'avif', compression: 'lossy', quality: 60, ratio: 1 } });
    await page.getByTestId('compression-standard').click();
    await expect(page.getByTestId('export-download')).toBeEnabled();
    await drawer.getByText('WEBP', { exact: true }).click();
    await page.getByTestId('compression-lossless').click();
    await expect(page.getByTestId('export-download')).toBeEnabled();
});

async function openEditor(page, size = 320) {
    await page.goto('/');
    await page.locator('.shoteasy-upload-card input[type=file]').setInputFiles({ name: 'preview.png', mimeType: 'image/png', buffer: createPngFixture(size, Math.round(size * 0.75)) });
    await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();
    await page.evaluate(() => {
        const service = window.__shoteasyStores.exportService;
        const prepare = service.prepareImage.bind(service);
        window.__c2 = { encodes: 0, prepared: null, downloaded: null };
        service.prepareImage = async request => { window.__c2.encodes += 1; const result = await prepare(request); window.__c2.prepared = result; return result; };
    });
    await page.getByRole('button', { name: '导出图片', exact: true }).click();
}
async function preview(page) {
    await page.getByTestId('export-preview').click();
    await expect(page.getByTestId('preview-viewport').locator('img, canvas')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('export-download')).toBeEnabled();
}

test('MP export overlay uses bounded motion without changing other overlays or close/reopen focus', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openEditor(page);
    for (let index = 0; index < 3; index++) {
        const overlay = page.locator('.shoteasy-export-overlay');
        await expect(overlay).toBeVisible();
        for (const selector of ['.ant-drawer-content-wrapper', '.ant-drawer-mask']) {
            const durations = await overlay.locator(selector).evaluate(element => {
                const style = getComputedStyle(element);
                return [style.animationDuration, style.transitionDuration].flatMap(value => value.split(',').map(Number.parseFloat));
            });
            expect(durations.every(seconds => seconds <= 0.001)).toBe(true);
        }
        await page.keyboard.press('Escape');
        await expect(overlay).toHaveCount(0);
        await expect(page.getByRole('button', { name: '导出图片', exact: true })).toBeFocused();
        if (index < 2) await page.getByRole('button', { name: '导出图片', exact: true }).click();
    }
    const otherDuration = await page.evaluate(() => {
        const root = document.createElement('div');
        root.className = 'shoteasy-overlay-drawer';
        const mask = document.createElement('div');
        mask.className = 'ant-drawer-mask';
        mask.style.transitionDuration = '1s';
        root.append(mask); document.body.append(root);
        try { return getComputedStyle(mask).transitionDuration; }
        finally { root.remove(); }
    });
    expect(otherDuration).toBe('1s');
    expect(await page.evaluate(() => window.__c2.encodes)).toBe(0);
});

test('CD oversized download explains its own limit in seven locales on mobile', async ({ page }) => {
    await openEditor(page);
    await page.getByTestId('compression-lossy').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.__shoteasyStores.option.setFrameSize(2048, 2049));
    for (const locale of ['zh-CN', 'en-US', 'zh-TW', 'de-DE', 'ko-KR', 'es-ES', 'pt-PT']) {
        await page.evaluate(locale => window.__shoteasyStores.i18n.setOptions(locale), locale);
        const button = page.getByTestId('export-download');
        await expect(button).toBeDisabled();
        await expect(button).toHaveAccessibleDescription(/PNG\/JPG\/WebP/);
        const box = await button.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        expect(box.y + box.height).toBeLessThanOrEqual(844);
        expect(await page.locator('.shoteasy-export-drawer').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await page.getByTestId('compression-standard').click();
    await expect(page.getByTestId('export-download')).toBeEnabled();
    await expect(page.getByTestId('export-preview')).toBeDisabled();
});

test('C2 manual compression preview, 100% comparison, invalidation and byte-identical download', async ({ page }) => {
    await openEditor(page, 640);
    await page.getByTestId('compression-lossy').click();
    await page.getByTestId('palette-128').click();
    await page.getByTestId('palette-64').click();
    expect(await page.evaluate(() => window.__c2.encodes)).toBe(0);
    await preview(page);
    expect(await page.evaluate(() => window.__shoteasyStores.workspace.exportSettings)).toEqual({ format: 'png', ratio: 1 });
    await page.getByTestId('compression-lossy').click();
    await page.getByTestId('palette-64').click();
    await expect(page.getByTestId('palette-64')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('compression-result')).toBeVisible();
    await page.evaluate(() => window.__shoteasyStores.commands.execute('file.openExport'));
    await expect(page.getByTestId('palette-64')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('compression-result')).toBeVisible();
    await page.getByTestId('preview-zoom').click();
    await page.getByTestId('preview-viewport').evaluate(element => { element.scrollTo(80, 55); });
    await page.getByTestId('preview-reference').click();
    await expect(page.getByTestId('preview-viewport')).toHaveAttribute('aria-busy', 'false');
    expect(await page.getByTestId('preview-viewport').evaluate(element => element.scrollLeft)).toBe(80);
    await page.getByTestId('preview-output').click();
    await page.getByTestId('preview-background').click();
    await page.evaluate(() => window.__shoteasyStores.i18n.setOptions('de-DE'));
    await expect(page.getByTestId('export-download')).toHaveAccessibleName('Dieses Ergebnis herunterladen');
    expect(await page.evaluate(() => window.__c2.encodes)).toBe(1);
    await page.getByTestId('palette-128').click();
    await expect(page.getByTestId('compression-result')).toHaveCount(0);
    await expect(page.getByTestId('export-download')).toHaveAccessibleName('Aktuelle Einstellungen direkt exportieren');
    expect(await page.evaluate(() => window.__c2.encodes)).toBe(1);
    await preview(page);
    const expected = await page.evaluate(async () => [...new Uint8Array(await window.__c2.prepared.result.blob.arrayBuffer())]);
    const download = page.waitForEvent('download');
    await page.getByTestId('export-download').click();
    expect(await readFile(await (await download).path())).toEqual(Buffer.from(expected));
    await expect(page.locator('.shoteasy-export-drawer')).toHaveCount(0);
    expect(await page.evaluate(() => window.__c2.encodes)).toBe(2);
    expect(await page.evaluate(() => window.__shoteasyStores.workspace.exportSettings)).toEqual({ format: 'png', ratio: 1, compression: 'lossy', paletteColors: 128 });
});

test('C2 supported controls, quality keyboard, white-fill summary and unchanged standard defaults', async ({ page }) => {
    await openEditor(page);
    const drawer = page.locator('.shoteasy-export-drawer');
    await drawer.getByText('JPG', { exact: true }).first().click();
    await expect(page.getByTestId('compression-lossless')).toHaveCount(0);
    await page.getByTestId('compression-lossy').click();
    await drawer.getByRole('button', { name: '均衡', exact: true }).click();
    const quality = drawer.getByRole('slider');
    await expect(quality).toHaveValue('80');
    await quality.focus(); await page.keyboard.press('ArrowLeft');
    await expect(quality).toHaveValue('79');
    await expect(drawer).toContainText('透明区域填白');
    await preview(page);
    expect(await page.evaluate(() => window.__c2.prepared.settings)).toEqual({ format: 'jpg', ratio: 1, compression: 'lossy', quality: 79 });
    await drawer.getByText('WEBP', { exact: true }).first().click();
    await expect(page.getByTestId('compression-standard')).toHaveAttribute('aria-pressed', 'true');
    await expect(quality).toHaveCount(0);
    await page.getByTestId('compression-lossless').click();
    await preview(page);
    expect(await page.evaluate(() => window.__c2.prepared.settings)).toEqual({ format: 'webp', ratio: 1, compression: 'lossless' });
    await drawer.getByText('AVIF', { exact: true }).first().click();
    await expect(page.getByTestId('compression-lossless')).toHaveCount(0);
    await page.getByTestId('compression-lossy').click();
    await expect(quality).toHaveValue('60');
    await page.keyboard.press('Escape');
    await expect(page.locator('.shoteasy-export-drawer')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '导出图片', exact: true })).toBeFocused();
    expect(await page.evaluate(() => window.__shoteasyStores.workspace.exportSettings)).toEqual({ format: 'png', ratio: 1 });
});

test('C2 deferred handoff blocks cancel/replacement/PWA and system cancellation retries the exact Blob once', async ({ page }) => {
    await openEditor(page);
    await page.getByTestId('compression-lossless').click();
    await preview(page);
    await page.evaluate(() => {
        window.__c2.calls = [];
        window.__shoteasyStores.exportService.platform = { export: { download: blob => {
            window.__c2.calls.push(blob);
            return new Promise((resolve, reject) => { window.__c2.finish = resolve; window.__c2.cancel = () => reject(Object.assign(new Error('cancelled'), { code: 'export-cancelled' })); });
        } } };
    });
    await page.getByTestId('export-download').click();
    await expect(page.getByTestId('export-cancel')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('.shoteasy-export-drawer')).toBeVisible();
    const blocked = await page.evaluate(async () => {
        const { getUpdateBlockReason } = await import('/src/pwa/pwaSupport.js');
        const root = window.__shoteasyStores;
        return { update: getUpdateBlockReason(root), duplicate: await root.commands.downloadPreparedImage(window.__c2.prepared.token, window.__c2.prepared.settings),
            cancel: root.commands.cancelExport(), replace: await root.commands.requestWorkspaceReplacement(() => true), settings: root.workspace.exportSettings };
    });
    expect(blocked).toEqual({ update: 'busy', duplicate: false, cancel: false, replace: false, settings: { format: 'png', ratio: 1 } });
    await page.evaluate(() => window.__c2.cancel());
    await expect(page.getByTestId('export-download')).toBeEnabled();
    await expect(page.getByTestId('compression-result')).toBeVisible();
    await page.getByTestId('export-download').click();
    await page.evaluate(() => window.__c2.finish());
    await expect(page.locator('.shoteasy-export-drawer')).toHaveCount(0);
    expect(await page.evaluate(() => ({ calls: window.__c2.calls.length, same: window.__c2.calls.every(blob => blob === window.__c2.prepared.result.blob), encodes: window.__c2.encodes }))).toEqual({ calls: 2, same: true, encodes: 1 });
});

for (const backend of ['bitmap', 'image-fallback']) test(`C4 ${backend} closing during decode cancels without late resurrection and releases preview resources`, async ({ page }) => {
    await openEditor(page);
    await page.evaluate(backend => {
        const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
        window.__c2.urls = new Set();
        URL.createObjectURL = blob => { const url = create(blob); window.__c2.urls.add(url); return url; };
        URL.revokeObjectURL = url => { window.__c2.urls.delete(url); revoke(url); };
        window.__c2.decode = HTMLImageElement.prototype.decode;
        window.__c2.createBitmap = globalThis.createImageBitmap;
        if (backend === 'bitmap') {
            globalThis.createImageBitmap = blob => new Promise(resolve => {
                window.__c2.finishDecode = async () => resolve(await window.__c2.createBitmap.call(globalThis, blob));
            });
            return;
        }
        globalThis.createImageBitmap = undefined;
        HTMLImageElement.prototype.decode = function () {
            if (!this.src.startsWith('blob:')) return window.__c2.decode.call(this);
            return new Promise(resolve => { window.__c2.finishDecode = resolve; });
        };
    }, backend);
    await page.getByTestId('export-preview').click();
    await page.waitForFunction(() => window.__c2.finishDecode);
    await page.getByTestId('export-cancel').click();
    await expect(page.locator('.shoteasy-export-drawer')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.exportService.isBusy)).toBe(false);
    await page.evaluate(async () => {
        HTMLImageElement.prototype.decode = window.__c2.decode;
        // Keep the fallback selected for the retry as well.
        if (globalThis.createImageBitmap) globalThis.createImageBitmap = window.__c2.createBitmap;
        await window.__c2.finishDecode();
    });
    await page.getByRole('button', { name: '导出图片', exact: true }).click();
    await expect(page.getByTestId('compression-result')).toHaveCount(0);
    await preview(page);
    await page.getByTestId('export-cancel').click();
    await expect.poll(() => page.evaluate(() => window.__c2.urls.size)).toBe(0);
    expect(await page.evaluate(() => window.__shoteasyStores.workspace.exportSettings)).toEqual({ format: 'png', ratio: 1 });
});

test('C2 content/theme invalidation, unsupported preview and size cap preserve explicit direct export', async ({ page }) => {
    await openEditor(page);
    await preview(page);
    await page.evaluate(() => window.__shoteasyStores.editor.setTheme('light'));
    await expect(page.getByTestId('compression-result')).toHaveCount(0);
    await expect(page.getByTestId('export-download')).toHaveAccessibleName('按当前设置直接导出');
    await preview(page);
    await page.evaluate(() => window.__shoteasyStores.option.setPadding(40));
    await expect(page.getByTestId('compression-result')).toHaveCount(0);
    await page.evaluate(() => { window.__c2.createBitmap = globalThis.createImageBitmap; globalThis.createImageBitmap = () => Promise.reject(new Error('unsupported')); });
    await page.getByTestId('export-preview').click();
    // The injected global decoder failure can also affect autosave; scope this
    // assertion to the preview error, not unrelated workspace notifications.
    await expect(page.locator('.shoteasy-export-drawer').getByRole('alert')).toContainText('此浏览器无法显示');
    await expect(page.getByTestId('export-download')).toBeEnabled();
    await page.evaluate(() => { globalThis.createImageBitmap = window.__c2.createBitmap; window.__shoteasyStores.option.setFrameSize(2048, 2048); });
    await expect(page.getByTestId('export-preview')).toBeDisabled();
    await expect(page.getByTestId('export-download')).toBeEnabled();
    await page.getByTestId('compression-lossless').click();
    await expect(page.getByTestId('export-download')).toBeEnabled();
    await page.evaluate(() => window.__shoteasyStores.option.setFrameSize(2048, 2049));
    await expect(page.getByTestId('export-download')).toBeDisabled();
    await expect(page.getByTestId('export-download')).toHaveAccessibleDescription(/419 万像素/);
    await page.getByTestId('compression-standard').click();
    await expect(page.getByTestId('export-download')).toBeEnabled();
});

test('C2 seven locales, light/dark, narrow viewport and keyboard controls remain accessible', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await openEditor(page);
    await page.getByTestId('compression-lossy').click();
    await preview(page);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const locale of ['zh-CN', 'en-US', 'zh-TW', 'de-DE', 'ko-KR', 'es-ES', 'pt-PT']) {
        for (const theme of ['dark', 'light']) {
            await page.evaluate(({ locale, theme }) => { const root = window.__shoteasyStores; root.i18n.setOptions(locale); root.editor.setTheme(theme); }, { locale, theme });
            await expect(page.locator('.shoteasy-app')).toHaveAttribute('data-mode', theme);
            await expect(page.locator('.shoteasy-app')).toHaveAttribute('lang', locale);
            // Theme tokens are installed by React/Ant Design after the store action.
            // Audit a committed frame, not a mix of old computed styles and new CSS.
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const drawer = page.locator('.shoteasy-export-drawer');
            await expect.poll(() => drawer.evaluate(element => element.getAnimations({ subtree: true })
                .filter(animation => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity).length)).toBe(0);
            await expect(drawer).toBeVisible();
            expect(await drawer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
            const problems = await new AxeBuilder({ page }).include('.shoteasy-export-drawer').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
            expect(problems.violations).toEqual([]);
        }
    }
    await preview(page);
    await page.getByTestId('preview-viewport').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('compression-mobile-pt-light.png') });
    await page.getByTestId('preview-reference').focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('preview-reference')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('.shoteasy-export-drawer')).toHaveCount(0);
});
