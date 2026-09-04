import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { unzipSync } from 'fflate';
import { createPngFixture } from '../fixtures/createPngFixture.js';

const PRIVATE_MARKER = 'screenhello-private-release-marker';

async function readDownload(download) {
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const part of stream) chunks.push(part);
    return Buffer.concat(chunks);
}

async function openReleaseCandidate(page) {
    const requests = [];
    const blocked = [];
    await page.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        requests.push({ method: request.method(), resourceType: request.resourceType(), url: request.url() });
        if (
            ['127.0.0.1', 'localhost'].includes(url.hostname)
            || url.protocol === 'blob:'
            || url.protocol === 'data:'
        ) {
            await route.continue();
            return;
        }
        blocked.push(request.url());
        await route.abort('blockedbyclient');
    });
    await page.goto('/');
    await expect(page.getByText('点击或拖拽图片到这里')).toBeVisible();
    return { blocked, requests };
}

async function importPrivateFixture(page) {
    await page.locator('.shoteasy-upload-card input[type="file"]').setInputFiles({
        name: `${PRIVATE_MARKER}.png`,
        mimeType: 'image/png',
        buffer: createPngFixture(64, 48),
    });
    await expect(page.getByRole('button', { name: '导出图片' })).toBeEnabled();
}

async function runMenuCommand(page, menuName, commandName) {
    const menubar = page.getByRole('menubar', { name: '应用菜单' });
    await menubar.getByRole('menuitem', { name: menuName, exact: true }).click();
    await page.getByRole('menuitem', { name: commandName }).last().click();
}

async function exportFormat(page, format) {
    await page.getByRole('button', { name: '导出图片' }).click();
    await page.locator('.shoteasy-export-drawer .ant-segmented').first().getByText(format.toUpperCase(), { exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-download').click();
    const download = await downloadPromise;
    await expect(page.getByRole('dialog', { name: '导出图片' })).toBeHidden();
    await expect(page.locator('.shoteasy-export-drawer')).toHaveCount(0);
    return download;
}

function assertImageSignature(bytes, format) {
    if (format === 'png') expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (format === 'jpg') expect(bytes.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
    if (format === 'webp') {
        expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
        expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP');
    }
    if (format === 'avif') {
        expect(bytes.subarray(4, 8).toString('ascii')).toBe('ftyp');
        expect(bytes.subarray(8, 12).toString('ascii')).toBe('avif');
    }
}

test('keeps private edits, project data, exports, and batch work local', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(globalThis, 'showOpenFilePicker', { configurable: true, value: undefined });
        Object.defineProperty(globalThis, 'showSaveFilePicker', { configurable: true, value: undefined });
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const audit = await openReleaseCandidate(page);
    await importPrivateFixture(page);

    await page.getByRole('button', { name: /^项目：/ }).click();
    await page.getByRole('textbox', { name: '项目名称' }).fill(PRIVATE_MARKER);
    await page.keyboard.press('Escape');
    await runMenuCommand(page, '文件', /^本地资料库/);
    await page.getByRole('tab', { name: '风格预设' }).click();
    await page.getByRole('button', { name: '保存当前风格' }).click();
    await expect(page.getByText('我的风格', { exact: true })).toBeVisible();
    const projectDownload = page.waitForEvent('download');
    await page.locator('.shoteasy-workspace-drawer .ant-drawer-close').click();
    await runMenuCommand(page, '文件', /^保存项目/);
    const projectBytes = await readDownload(await projectDownload);
    expect(projectBytes.subarray(0, 2).toString('ascii')).toBe('PK');

    for (const format of ['png', 'jpg', 'webp', 'avif']) {
        assertImageSignature(await readDownload(await exportFormat(page, format)), format);
    }

    await runMenuCommand(page, '文件', /^批量处理/);
    const batchDrawer = page.locator('.shoteasy-batch-drawer');
    await page.getByTestId('batch-file-input').setInputFiles({
        name: `${PRIVATE_MARKER}-batch.png`,
        mimeType: 'image/png',
        buffer: createPngFixture(40, 30),
    });
    await batchDrawer.getByRole('button', { name: '开始批量处理' }).click();
    await expect(batchDrawer.getByRole('status')).toContainText('1 张成功', { timeout: 40_000 });
    const zipDownload = page.waitForEvent('download');
    await batchDrawer.getByRole('button', { name: '下载 ZIP' }).click();
    expect(Object.keys(unzipSync(await readDownload(await zipDownload)))).toHaveLength(1);

    const applicationOrigin = new URL(page.url()).origin;
    const networkRequests = audit.requests.filter(({ url }) => ['http:', 'https:'].includes(new URL(url).protocol));
    expect(networkRequests.every(({ url }) => new URL(url).origin === applicationOrigin)).toBe(true);
    expect(networkRequests.some(({ url }) => decodeURIComponent(url).includes(PRIVATE_MARKER))).toBe(false);
    expect(audit.blocked).toEqual([]);
    expect(errors).toEqual([]);
});

test('falls back to the local WebP codec when Canvas cannot encode WebP', async ({ page }) => {
    await page.addInitScript(() => {
        const nativeToBlob = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function screenHelloWebpFallbackProbe(callback, type, quality) {
            return nativeToBlob.call(this, callback, type === 'image/webp' ? 'image/png' : type, quality);
        };
    });
    const audit = await openReleaseCandidate(page);
    await importPrivateFixture(page);
    const bytes = await readDownload(await exportFormat(page, 'webp'));

    assertImageSignature(bytes, 'webp');
    expect(audit.requests.some(({ url }) => /\/assets\/webp_enc-[^/]+\.wasm$/.test(new URL(url).pathname))).toBe(true);
    expect(audit.blocked).toEqual([]);
});

test('meets automated WCAG A/AA and reduced-motion release checks', async ({ page }, testInfo) => {
    await openReleaseCandidate(page);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    const initialResult = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
    await testInfo.attach('axe-initial.json', {
        body: JSON.stringify({ violations: initialResult.violations, incomplete: initialResult.incomplete }, null, 2),
        contentType: 'application/json',
    });
    expect(initialResult.violations).toEqual([]);

    const demo = page.getByRole('button', { name: /第一次使用/ });
    await demo.focus();
    await expect(demo).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: '导出图片' })).toBeEnabled();

    const paddingColor = page.getByRole('button', { name: '内边距颜色' });
    await expect(paddingColor).not.toHaveAttribute('aria-controls');
    await expect(page.getByRole('toolbar', { name: '标注工具' })).toBeVisible();
    await expect(page.getByLabel('上传本地图片')).toHaveAttribute('type', 'file');
    await paddingColor.focus();
    await expect(paddingColor).toBeFocused();
    await page.keyboard.press('Enter');
    const colorDialog = page.getByRole('dialog', { name: '内边距颜色设置' });
    await expect(colorDialog).toBeVisible();
    await expect(paddingColor).toHaveAttribute('aria-controls', await colorDialog.getAttribute('id'));
    await expect.poll(() => colorDialog.evaluate((element) => (
        getComputedStyle(element.closest('.ant-popover')).opacity
    ))).toBe('1');
    const nativeColor = colorDialog.getByLabel('内边距颜色色彩');
    await expect(nativeColor).toBeFocused();
    await expect(nativeColor).toHaveValue('#ffffff');
    const hexColor = colorDialog.getByLabel('内边距颜色十六进制值');
    const alpha = colorDialog.getByLabel('内边距颜色不透明度');
    await expect(hexColor).toHaveValue('#ffffffff');
    await expect(alpha).toHaveValue('100');
    await hexColor.fill('#33669980');
    await hexColor.press('Enter');
    await expect(nativeColor).toHaveValue('#336699');
    await expect(hexColor).toHaveValue('#33669980');
    await expect(alpha).toHaveValue('50');
    await alpha.fill('25');
    await expect(hexColor).toHaveValue('#33669940');

    const editorResult = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
    await testInfo.attach('axe-editor.json', {
        body: JSON.stringify({ violations: editorResult.violations, incomplete: editorResult.incomplete }, null, 2),
        contentType: 'application/json',
    });
    expect(editorResult.violations).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(colorDialog).toBeHidden();
    await expect(paddingColor).not.toHaveAttribute('aria-controls');
    await expect(paddingColor).toBeFocused();

    const motion = await page.locator('.shoteasy-export-primary').evaluate((element) => {
        const style = getComputedStyle(element);
        const toMilliseconds = (value) => value.split(',').map((item) => {
            const token = item.trim();
            return token.endsWith('ms') ? Number.parseFloat(token) : Number.parseFloat(token) * 1000;
        });
        return {
            animationDelay: toMilliseconds(style.animationDelay),
            animationDuration: toMilliseconds(style.animationDuration),
            transitionDelay: toMilliseconds(style.transitionDelay),
            transitionDuration: toMilliseconds(style.transitionDuration),
        };
    });
    expect(motion.animationDelay.every((value) => value === 0)).toBe(true);
    expect(motion.animationDuration.every((value) => value <= 0.02), JSON.stringify(motion)).toBe(true);
    expect(motion.transitionDelay.every((value) => value === 0)).toBe(true);
    expect(motion.transitionDuration.every((value) => value <= 0.02), JSON.stringify(motion)).toBe(true);
});
