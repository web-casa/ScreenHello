import { expect, test } from '@playwright/test';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPngFixture } from '../fixtures/createPngFixture.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.join(root, 'dist');

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
    const readyDownload = page.locator('[aria-label="下载图片"]:not([disabled])');
    await expect(readyDownload.or(uploadInput)).toBeAttached();
    if (await uploadInput.count()) {
        await uploadInput.setInputFiles({
            name: 'screenhello-pwa.png',
            mimeType: 'image/png',
            buffer: createPngFixture(64, 48),
        });
    }
    await expect(readyDownload).toBeAttached();
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
    await expect(page.getByText('点击或拖拽图片到这里')).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
};

const clearBrowserHttpCache = async (context, page) => {
    const session = await context.newCDPSession(page);
    await session.send('Network.clearBrowserCache');
    await session.detach();
};

const selectAvif = async (page) => {
    await page.getByRole('button', { name: /导出格式与倍率/ }).click();
    await page.locator('.shoteasy-export-popover .ant-segmented-item').filter({ hasText: 'avif' }).click();
    await page.keyboard.press('Escape');
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
        await importFixture(page);
        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('button', { name: '下载图片' }).click();
        const bytes = await readDownload(await downloadPromise);
        expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

        await selectAvif(page);
        await page.getByRole('button', { name: '下载图片' }).click();
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

test('runtime-caches AVIF only after first use and reuses it fully offline', async ({ context, page }) => {
    test.setTimeout(90_000);
    await page.goto('/');
    await waitForActiveWorker(page);
    await ensureControlled(page);
    await importFixture(page);
    await selectAvif(page);

    const onlineDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载图片' }).click();
    const onlineBytes = await readDownload(await onlineDownload);
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
        await selectAvif(page);
        const offlineDownload = page.waitForEvent('download');
        await page.getByRole('button', { name: '下载图片' }).click();
        const offlineBytes = await readDownload(await offlineDownload);
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
        await expect(firefoxPage.getByText('点击或拖拽图片到这里')).toBeVisible();
        await expect(firefoxPage.getByRole('button', { name: '安装', exact: true })).toHaveCount(0);
        await expect(firefoxPage.getByRole('button', { name: '查看步骤' })).toHaveCount(0);
    } finally {
        await firefoxContext.close();
    }
});

test('holds a waiting update behind dirty confirmation and cleans stale precache entries', async ({ page }) => {
    test.setTimeout(90_000);
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

        await page.getByRole('button', { name: '放弃更改并更新' }).click();
        await expect(page.getByText('确认放弃未保存更改并载入新版本？', { exact: true })).toBeVisible();
        expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting?.state)).toBe('installed');

        await Promise.all([
            page.waitForEvent('load'),
            page.getByRole('button', { name: '确认更新' }).click(),
        ]);
        await expect(page.getByText('点击或拖拽图片到这里')).toBeVisible();
        await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
        await expect.poll(() => page.evaluate(async (url) => {
            const keys = await caches.keys();
            for (const key of keys) {
                if (await (await caches.open(key)).match(url)) return true;
            }
            return false;
        }, staleUrl)).toBe(false);
    } finally {
        writeFileSync(swPath, originalSw);
    }
});
