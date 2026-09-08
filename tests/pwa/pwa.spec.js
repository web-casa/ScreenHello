import { expect, test } from '@playwright/test';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPngFixture } from '../fixtures/createPngFixture.js';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Match the preview server's candidate directory, including the temporary SW
// update fixture. Never mutate a different build than the one under test.
const dist = path.resolve(root, process.env.SCREENHELLO_PWA_OUT_DIR || 'dist');

const emittedAsset = (pattern) => {
    const filename = readdirSync(path.join(dist, 'assets')).find((item) => pattern.test(item));
    if (!filename) throw new Error(`missing-emitted-asset:${pattern}`);
    return `/assets/${filename}`;
};

const readDownload = async (download) => {
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
};

const importFixture = async (page) => {
    const uploadInput = page.locator('.shoteasy-upload-card input[type="file"]');
    const readyExport = page.locator('[aria-label="导出图片"]:not([disabled])');
    await expect(readyExport.or(uploadInput)).toBeAttached();
    if (await uploadInput.count()) {
        await uploadInput.setInputFiles({
            name: 'screenhello-pwa.png',
            mimeType: 'image/png',
            buffer: createPngFixture(64, 48),
        });
    }
    await expect(readyExport).toBeAttached();
};

const waitForActiveWorker = async (page) => {
    await expect(page.getByText('离线已就绪', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        return registration.active?.state;
    })).toBe('activated');
};

const ensureControlled = async (page) => {
    await page.reload();
    await expect(page.getByRole('button', { name: '选择图片', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
};

const clearBrowserHttpCache = async (context, page) => {
    const session = await context.newCDPSession(page);
    await session.send('Network.clearBrowserCache');
    await session.detach();
};

for (const [frame, title, prefix, variant, mit] of [
    ['surface-pro-8', 'Surface Pro', 'surface-pro-8'], ['iphone-bitmap', 'iPhone', 'iphone'],
    ['macbook-air-m2-silver-v1', 'MacBook Air M2', 'macbook-air-m2-starlight-v1', 'macbook-air-m2-starlight-v1'],
    ['pixel-9-pro-original-v1', 'Pixel 9 Pro', 'pixel-9-pro-original-v1', null, true],
]) {
test(`optional real device ${title} reopens and exports from the offline runtime cache`, async ({ context, page }) => {
    test.skip(!readdirSync(path.join(dist, 'assets')).some(name => name.startsWith(`${prefix}-`) && name.endsWith('.png')),
        'The public build does not contain the optional third-party pack.');
    await page.goto('/');
    await waitForActiveWorker(page);
    await ensureControlled(page);
    await importFixture(page);
    await page.getByRole('button', { name: '更多外框', exact: true }).click();
    await page.locator('.shoteasy-frame-drawer .shoteasy-frame-option').filter({ has: page.locator(`input[value="${frame}"]`) }).click();
    if (variant) await page.locator(`.shoteasy-frame-drawer .shoteasy-device-color input[value="${variant}"]`).check();
    await page.locator('.shoteasy-frame-drawer-shell .ant-drawer-close').click();
    const exportDevice = async () => {
        await page.getByRole('button', { name: '导出图片', exact: true }).click();
        const download = page.waitForEvent('download');
        await page.getByTestId('export-download').click();
        const notice = page.getByRole('dialog', { name: '素材许可说明' });
        if (!mit && frame !== 'iphone-bitmap') {
            await expect(notice).toContainText(title);
            if (variant) await expect(notice).toContainText('星光色');
            await notice.getByRole('button', { name: '了解并继续' }).click();
        } else await expect(notice).toBeHidden();
        return PNG.sync.read(await readDownload(await download));
    };
    const online = await exportDevice();
    const expectedAssets = [`${prefix}-`, 'deviceProjection.worker-', 'renderRasterDevice-', ...(frame === 'surface-pro-8' ? ['surface-pro-8-screen-'] : [])];
    await expect.poll(() => page.evaluate(async prefixes => {
        const cache = await caches.open('screenhello-runtime-assets-v1');
        const urls = (await cache.keys()).map(request => request.url);
        return prefixes.every(prefix => urls.some(url => url.includes(`/assets/${prefix}`)));
    }, expectedAssets)).toBe(true);
    // Wait for the saved draft, then assert its restored editor explicitly. An
    // empty-state input can disappear between count() and setInputFiles() during
    // automatic restoration; that is not an offline asset failure.
    await expect(page.getByRole('button', { name: /项目：.*草稿已保存到本机/ })).toBeVisible();
    await clearBrowserHttpCache(context, page);
    await context.setOffline(true);
    try {
        await page.reload();
        await expect(page.getByRole('button', { name: '导出图片', exact: true })).toBeEnabled();
        // A restored color changes the model card's value; select the model by
        // its name rather than assuming it still carries the default color ID.
        await page.getByRole('button', { name: '更多外框', exact: true }).click();
        await page.locator('.shoteasy-frame-drawer .shoteasy-frame-option').filter({ hasText: title }).click();
        if (variant) await page.locator(`.shoteasy-frame-drawer .shoteasy-device-color input[value="${variant}"]`).check();
        await page.locator('.shoteasy-frame-drawer-shell .ant-drawer-close').click();
        const offline = await exportDevice();
        expect([offline.width, offline.height]).toEqual([online.width, online.height]);
        expect(offline.data).toEqual(online.data);
    } finally { await context.setOffline(false); }
});
}

for (const [width, variant] of [[390, 'mobile'], [1024, 'desktop']]) {
test(`the ${variant} example is lazy and remains usable from the offline runtime cache`, async ({ context, page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await waitForActiveWorker(page);
    await ensureControlled(page);
    const before = await page.evaluate(async () => {
        const urls = [];
        for (const key of await caches.keys()) urls.push(...(await (await caches.open(key)).keys()).map(request => request.url));
        return urls;
    });
    expect(before.some(url => /demo-(?:mobile|desktop)-.*\.webp/.test(url))).toBe(false);
    const asset = emittedAsset(new RegExp(`^demo-${variant}-.*\\.webp$`));
    await page.getByRole('button', { name: '试用示例', exact: true }).click();
    await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();
    await expect.poll(() => page.evaluate(async asset => Boolean(await (await caches.open('screenhello-runtime-assets-v1')).match(asset)), asset)).toBe(true);
    await clearBrowserHttpCache(context, page);
    await context.setOffline(true);
    try {
        const bytes = await page.evaluate(async asset => [...new Uint8Array(await (await fetch(asset)).arrayBuffer())], asset);
        expect(Buffer.from(bytes)).toEqual(readFileSync(path.join(root, `src/assets/demo-${variant}.webp`)));
    } finally { await context.setOffline(false); }
});
}

test('all seven languages can be selected on an offline cold reload', async ({ context, page }) => {
    await page.goto('/');
    await waitForActiveWorker(page);
    await clearBrowserHttpCache(context, page);
    await context.setOffline(true);
    try {
        await ensureControlled(page);
        for (const [locale, name] of [
            ['en-US', 'English'], ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'],
            ['de-DE', 'Deutsch'], ['ko-KR', '한국어'], ['es-ES', 'Español'], ['pt-PT', 'Português'],
        ]) {
            await page.locator('.shoteasy-language-trigger').click();
            await page.getByRole('menuitemradio', { name, exact: true }).click();
            await expect(page.locator('html')).toHaveAttribute('lang', locale);
            await page.reload();
            await expect(page.locator('html')).toHaveAttribute('lang', locale);
            await expect(page.locator('.shoteasy-language-trigger')).toHaveAttribute('title', name);
        }
    } finally {
        await context.setOffline(false);
    }
});

const openExportFormat = async (page, format) => {
    await page.getByRole('button', { name: '导出图片' }).click();
    await page.locator('.shoteasy-export-drawer .ant-segmented-item').filter({ hasText: format.toUpperCase() }).click();
};

const downloadFormat = async (page, format) => {
    await openExportFormat(page, format);
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-download').click();
    return downloadPromise;
};

test('activates the audited app shell before reporting ready and starts the editor offline', async ({ context, page }, testInfo) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('/');
    await waitForActiveWorker(page);
    await page.locator('.shoteasy-pwa-tray').screenshot({ path: testInfo.outputPath('offline-ready.png') });

    const shell = await page.evaluate(async () => {
        const keys = await caches.keys();
        const entries = [];
        for (const key of keys) {
            const cache = await caches.open(key);
            entries.push(...(await cache.keys()).map((request) => request.url));
        }
        return { keys, entries };
    });
    expect(shell.keys.some((key) => key.includes('precache'))).toBe(true);
    expect(shell.entries.some((url) => /avif_enc|\.worker-|EmojiPicker|CropperDialog|\.jpe?g$/.test(url))).toBe(false);
    expect(shell.entries.some((url) => /blob:|data:|\.screenhello(?:-preset)?$/.test(url))).toBe(false);

    const [manifestResponse, workerResponse, wasmResponse] = await Promise.all([
        page.request.get('/manifest.webmanifest'),
        page.request.get(emittedAsset(/\.worker-[^/]+\.js$/)),
        page.request.get(emittedAsset(/\.wasm$/)),
    ]);
    expect(manifestResponse.headers()['content-type']).toContain('application/manifest+json');
    expect(workerResponse.headers()['content-type']).toMatch(/javascript/);
    expect(wasmResponse.headers()['content-type']).toContain('application/wasm');

    await clearBrowserHttpCache(context, page);
    await context.setOffline(true);
    try {
        await ensureControlled(page);
        // The same new identity is available from the core cache on a cold,
        // offline welcome view, not merely from the browser HTTP cache.
        const offlineLogo = page.locator('.shoteasy-init-brand img');
        await expect.poll(() => offlineLogo.evaluate(image => image.complete && image.naturalWidth)).toBe(512);
        const iconURL = new URL(await page.locator('link[rel="icon"][type="image/png"]').getAttribute('href'), page.url());
        expect(iconURL.pathname).toBe('/favicon-96x96.png');
        expect(iconURL.search).toMatch(/^\?v=[a-f0-9]{12}$/);
        const cachedIdentity = await page.evaluate(async () => {
            const files = [document.querySelector('.shoteasy-init-brand img').src,
                document.querySelector('link[rel="icon"][type="image/png"]').href, '/pwa-maskable-192x192.png'];
            return Promise.all(files.map(async url => {
                const response = await fetch(url);
                return [...new Uint8Array(await response.arrayBuffer())];
            }));
        });
        for (const [index, file] of ['src/assets/logo.png', 'public/favicon-96x96.png', 'public/pwa-maskable-192x192.png'].entries()) {
            expect(Buffer.from(cachedIdentity[index])).toEqual(readFileSync(path.join(root, file)));
        }
        await importFixture(page);
        const bytes = await readDownload(await downloadFormat(page, 'png'));
        expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

        await openExportFormat(page, 'avif');
        await page.getByTestId('export-download').click();
        await expect(page.getByText('AVIF 导出失败，请改用 PNG 或 WebP', { exact: true })).toBeVisible();
        await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();
        const cachedAfterLocalWork = await page.evaluate(async () => {
            const urls = [];
            for (const key of await caches.keys()) {
                urls.push(...(await (await caches.open(key)).keys()).map((request) => request.url));
            }
            return urls;
        });
        expect(cachedAfterLocalWork.some((url) => /blob:|data:|\.screenhello(?:-preset)?$|avif_enc|\.worker-/.test(url))).toBe(false);
        expect(pageErrors).toEqual([]);
    } finally {
        await context.setOffline(false);
    }
});

test('C1/C2/C3 load PNG codecs on demand and preview/download/batch again after a cold offline reload', async ({ context, page }) => {
    await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
    await page.goto('/'); await waitForActiveWorker(page); await ensureControlled(page); await importFixture(page);
    const cacheEntries = () => page.evaluate(async () => (await (await caches.open('screenhello-runtime-assets-v1')).keys()).map(request => request.url));
    expect((await cacheEntries()).some(url => /pngEncoder|oxipng/.test(url))).toBe(false);
    const save = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: '文件', exact: true }).click();
    await page.getByRole('menuitem', { name: /^保存项目/ }).click();
    const entries = unzipSync(await readDownload(await save));
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    manifest.name = 'C1-offline'; manifest.exportSettings = { format: 'png', ratio: 1, compression: 'lossless' };
    entries['manifest.json'] = strToU8(JSON.stringify(manifest));
    const project = { name: 'C1.screenhello', mimeType: 'application/vnd.screenhello.project+zip', buffer: Buffer.from(zipSync(entries)) };
    const openAndExport = async () => {
        await page.getByTestId('project-file-input').setInputFiles(project);
        const opened = page.getByRole('button', { name: /项目：C1-offline/ });
        const discard = page.getByRole('button', { name: '不保存并继续', exact: true });
        await expect(opened.or(discard)).toBeVisible();
        if (await discard.isVisible()) await discard.click();
        await expect(opened).toBeVisible();
        await page.getByRole('button', { name: '导出图片', exact: true }).click();
        await expect(page.getByTestId('compression-lossless')).toHaveAttribute('aria-pressed', 'true');
        await page.getByTestId('export-preview').click();
        await expect(page.getByTestId('preview-viewport').locator('canvas')).toBeVisible();
        const displayed = await page.getByTestId('preview-viewport').locator('canvas').evaluate(element => {
            const snapshot = document.createElement('canvas'); snapshot.width = element.width; snapshot.height = element.height;
            try {
                const context = snapshot.getContext('2d'); context.drawImage(element, 0, 0);
                return { width: element.width, height: element.height, pixels: [...context.getImageData(0, 0, element.width, element.height).data] };
            } finally { snapshot.width = snapshot.height = 0; }
        });
        const download = page.waitForEvent('download');
        await page.getByTestId('export-download').click();
        const bytes = await readDownload(await download);
        const decoded = PNG.sync.read(bytes);
        expect([decoded.width, decoded.height]).toEqual([displayed.width, displayed.height]);
        // Preview owns a Canvas, not a second Blob URL. Same-Blob download
        // identity is separately asserted against the prepared result in C2.
        expect(decoded.data).toEqual(Buffer.from(displayed.pixels));
        return decoded;
    };
    const online = await openAndExport();
    const batchExport = async () => {
        await page.getByRole('menuitem', { name: '文件', exact: true }).click();
        await page.getByRole('menuitem', { name: /^批量处理/ }).click();
        await page.getByTestId('batch-file-input').setInputFiles({ name: 'offline-batch.png', mimeType: 'image/png', buffer: createPngFixture() });
        const drawer = page.locator('.shoteasy-batch-drawer');
        await drawer.getByRole('button', { name: '开始批量处理' }).click();
        await expect(drawer.getByRole('status')).toContainText('1 张成功');
        await expect(page.getByTestId('batch-frozen-settings')).toContainText('无损优化');
        const download = page.waitForEvent('download');
        await drawer.getByRole('button', { name: '下载 ZIP' }).click();
        const entries = unzipSync(await readDownload(await download));
        const image = PNG.sync.read(Buffer.from(entries['offline-batch-screenhello.png']));
        await drawer.getByRole('button', { name: '关闭', exact: true }).click();
        return image;
    };
    const onlineBatch = await batchExport();
    await expect.poll(async () => (await cacheEntries()).some(url => /squoosh_oxipng_bg-.*\.wasm$/.test(url))).toBe(true);
    expect((await cacheEntries()).some(url => /pngEncoder\.worker-/.test(url))).toBe(true);
    await clearBrowserHttpCache(context, page); await context.setOffline(true);
    try {
        await page.reload();
        // A saved draft may already have restored before the first assertion.
        // Both the empty editor and restored editor are valid cold starts.
        await expect(page.getByRole('button', { name: '选择图片', exact: true }).or(page.locator('.shoteasy-editor-canvas'))).toBeVisible();
        await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
        const offline = await openAndExport();
        expect(offline.data).toEqual(online.data);
        const offlineBatch = await batchExport();
        expect(offlineBatch.data).toEqual(onlineBatch.data);
    } finally { await context.setOffline(false); }
});

test('runtime-caches AVIF only after first use and reuses it fully offline', async ({ context, page }) => {
    test.setTimeout(90_000);
    await page.goto('/');
    await waitForActiveWorker(page);
    await ensureControlled(page);
    await importFixture(page);
    const onlineBytes = await readDownload(await downloadFormat(page, 'avif'));
    expect(onlineBytes.subarray(4, 12).toString('ascii')).toBe('ftypavif');

    const runtimeEntries = await page.evaluate(async () => {
        const cache = await caches.open('screenhello-runtime-assets-v1');
        return (await cache.keys()).map((request) => request.url);
    });
    expect(runtimeEntries.some((url) => /avifEncoder-.*\.js$/.test(url))).toBe(true);
    expect(runtimeEntries.some((url) => /\.worker-.*\.js$/.test(url))).toBe(true);
    expect(runtimeEntries.some((url) => /avif_enc-.*\.wasm$/.test(url))).toBe(true);

    await clearBrowserHttpCache(context, page);
    await context.setOffline(true);
    try {
        await ensureControlled(page);
        await importFixture(page);
        const offlineBytes = await readDownload(await downloadFormat(page, 'avif'));
        expect(offlineBytes.subarray(4, 12).toString('ascii')).toBe('ftypavif');
    } finally {
        await context.setOffline(false);
    }
});

test('uses a real install capability event once and never fabricates a browser install action', async ({ page }) => {
    await page.goto('/');
    await waitForActiveWorker(page);
    await page.evaluate(() => {
        const event = new Event('beforeinstallprompt', { cancelable: true });
        Object.defineProperties(event, {
            prompt: {
                value: async () => {
                    globalThis.__screenhelloInstallPromptCalls = (globalThis.__screenhelloInstallPromptCalls || 0) + 1;
                    return { outcome: 'accepted' };
                },
            },
            userChoice: { value: Promise.resolve({ outcome: 'accepted' }) },
        });
        window.dispatchEvent(event);
    });

    await expect(page.getByRole('button', { name: '安装', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '安装', exact: true }).click();
    await expect.poll(() => page.evaluate(() => globalThis.__screenhelloInstallPromptCalls)).toBe(1);
    await expect(page.getByRole('button', { name: '安装', exact: true })).toHaveCount(0);
});

test('existing PWA errors follow locale changes without losing the install event', async ({ page }) => {
    await page.goto('/');
    await waitForActiveWorker(page);
    await page.evaluate(() => {
        const event = new Event('beforeinstallprompt', { cancelable: true });
        Object.defineProperties(event, {
            prompt: { value: async () => {
                globalThis.__installAttempts = (globalThis.__installAttempts || 0) + 1;
                throw new Error('test-install-unavailable');
            } },
            userChoice: { value: Promise.resolve({ outcome: 'dismissed' }) },
        });
        window.dispatchEvent(event);
    });
    await page.getByRole('button', { name: '安装', exact: true }).click();
    await expect(page.locator('.shoteasy-pwa-card--error')).toContainText('浏览器安装提示未能打开');
    await page.locator('.shoteasy-language-trigger').click();
    await page.getByRole('menuitemradio', { name: 'Português', exact: true }).click();
    await expect(page.locator('.shoteasy-pwa-card--error')).toContainText('Não foi possível abrir a instalação.');
    await page.getByRole('button', { name: 'Instalar', exact: true }).click();
    await expect.poll(() => page.evaluate(() => globalThis.__installAttempts)).toBe(2);
});

test('shows the iOS manual path but no fabricated Firefox desktop install button', async ({ browser, baseURL }, testInfo) => {
    const iosContext = await browser.newContext({
        baseURL,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 Version/16.4 Mobile/15E148 Safari/604.1',
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        serviceWorkers: 'block',
    });
    try {
        const iosPage = await iosContext.newPage();
        await iosPage.goto('/');
        const stepsButton = iosPage.getByRole('button', { name: '查看步骤' });
        await expect(stepsButton).toBeVisible();
        await importFixture(iosPage);
        const overlap = await iosPage.evaluate(() => {
            const tray = document.querySelector('.shoteasy-pwa-tray').getBoundingClientRect();
            const targets = [
                document.querySelector('[aria-label="导出图片"]'),
                document.querySelector('.shoteasy-mobile-annotation-trigger'),
                document.querySelector('.shoteasy-mobile-zoom-trigger'),
            ].map((element) => {
                const rect = element.getBoundingClientRect();
                return {
                    name: element.getAttribute('aria-label'),
                    width: rect.width,
                    height: rect.height,
                    intersects: rect.left < tray.right && rect.right > tray.left && rect.top < tray.bottom && rect.bottom > tray.top,
                };
            });
            return { targets };
        });
        expect(overlap.targets.every(({ intersects }) => !intersects)).toBe(true);
        expect(overlap.targets.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
        const installActions = iosPage.locator('.shoteasy-pwa-card--install').getByRole('button');
        const undersizedInstallActions = await installActions.evaluateAll((buttons) => buttons
            .map((button) => {
                const rect = button.getBoundingClientRect();
                return { width: rect.width, height: rect.height };
            })
            .filter(({ width, height }) => width < 44 || height < 44));
        expect(undersizedInstallActions).toEqual([]);
        await stepsButton.focus();
        await iosPage.keyboard.press('Enter');
        const instructions = iosPage.locator('.shoteasy-pwa-card--install p');
        await expect(instructions).toContainText('添加到主屏幕');
        await expect(instructions).toContainText('作为 Web App 打开');
        await iosPage.locator('.shoteasy-pwa-card--install').screenshot({ path: testInfo.outputPath('ios-install-steps.png') });
        await iosPage.getByRole('button', { name: '关闭安装提示' }).click();
        await expect(iosPage.locator('.shoteasy-pwa-card--install')).toHaveCount(0);
    } finally {
        await iosContext.close();
    }

    const firefoxContext = await browser.newContext({
        baseURL,
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
        serviceWorkers: 'block',
    });
    try {
        const firefoxPage = await firefoxContext.newPage();
        await firefoxPage.goto('/');
        await expect(firefoxPage.getByRole('button', { name: '选择图片', exact: true })).toBeVisible();
        await expect(firefoxPage.getByRole('button', { name: '安装', exact: true })).toHaveCount(0);
        await expect(firefoxPage.getByRole('button', { name: '查看步骤' })).toHaveCount(0);
    } finally {
        await firefoxContext.close();
    }
});

test('holds a waiting update behind dirty confirmation and cleans stale precache entries', async ({ page }) => {
    test.setTimeout(90_000);
    const unexpectedDialogs = [];
    page.on('dialog', async (dialog) => {
        unexpectedDialogs.push(dialog.type());
        await dialog.dismiss();
    });
    const swPath = path.join(dist, 'sw.js');
    const originalSw = readFileSync(swPath, 'utf8');
    await page.goto('/');
    await waitForActiveWorker(page);
    await ensureControlled(page);
    await importFixture(page);

    const staleUrl = await page.evaluate(async () => {
        const keys = await caches.keys();
        const precacheName = keys.find((key) => key.includes('precache'));
        if (!precacheName) throw new Error('missing-precache');
        const url = `${location.origin}/assets/stale-build-AbCd1234.js`;
        const cache = await caches.open(precacheName);
        await cache.put(url, new Response('stale', { headers: { 'content-type': 'text/javascript' } }));
        return url;
    });

    try {
        writeFileSync(swPath, `${originalSw}\n// screenhello-pwa-update-fixture\n`);
        await page.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            await registration.update();
        });
        await expect(page.getByText('ScreenHello 有新版本', { exact: true })).toBeVisible();
        await expect(page.getByText('当前项目还有未保存更改', { exact: false })).toBeVisible();

        await page.getByRole('button', { name: '处理更改并更新' }).click();
        await expect(page.getByRole('button', { name: '保存项目并继续' })).toBeVisible();
        await expect(page.getByRole('button', { name: '不保存并继续' })).toBeVisible();
        await expect(page.getByRole('button', { name: /取\s*消/ })).toBeVisible();
        expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting?.state)).toBe('installed');

        await Promise.all([
            page.waitForEvent('load'),
            page.getByRole('button', { name: '不保存并继续' }).click(),
        ]);
        await expect(page.getByRole('button', { name: '选择图片', exact: true })).toBeVisible();
        await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
        await expect.poll(() => page.evaluate(async (url) => {
            const keys = await caches.keys();
            for (const key of keys) {
                if (await (await caches.open(key)).match(url)) return true;
            }
            return false;
        }, staleUrl)).toBe(false);
        expect(unexpectedDialogs).toEqual([]);
    } finally {
        writeFileSync(swPath, originalSw);
    }
});
test('preset backgrounds restore from local draft blobs offline without precaching every full image', async ({ context, page }) => {
    await page.goto('/'); await waitForActiveWorker(page); await ensureControlled(page); await importFixture(page);
    const selected = page.getByRole('button', { name: '晨雾山脉', exact: true });
    await selected.click(); await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(async () => {
        const cache = await caches.open('screenhello-runtime-assets-v1');
        return (await cache.keys()).filter(request => request.url.includes('/assets/bg-image-')).length;
    })).toBe(1);
    const precacheImages = await page.evaluate(async () => {
        const names = (await caches.keys()).filter(name => name.includes('precache'));
        const urls = (await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(request => request.url)))).flat();
        return { full: urls.filter(url => url.includes('/assets/bg-image-')).length, thumbs: urls.filter(url => url.includes('/assets/bg-thumb-')).length };
    });
    expect(precacheImages).toEqual({ full: 0, thumbs: 25 });
    await expect(page.getByRole('button', { name: /项目：.*草稿已保存到本机/ })).toBeVisible();
    await clearBrowserHttpCache(context, page); await context.setOffline(true);
    try {
        await page.reload(); await expect(selected).toHaveAttribute('aria-pressed', 'true');
        await page.getByRole('button', { name: '静谧海岸', exact: true }).click();
        await expect(page.getByRole('alert').filter({ hasText: '已保留原背景' })).toBeVisible();
        await expect(selected).toHaveAttribute('aria-pressed', 'true');
        await page.getByRole('button', { name: '导出图片', exact: true }).click();
        const download = page.waitForEvent('download'); await page.getByTestId('export-download').click();
        const pixels = PNG.sync.read(await readDownload(await download));
        expect(pixels.width).toBeGreaterThan(0);
    } finally { await context.setOffline(false); }
});
