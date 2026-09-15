import { expect, test } from '@playwright/test';
import { isLocalBrowserUrl } from './offline.js';
import { createPngFixture } from '../fixtures/createPngFixture.js';

/**
 * 隐私计数器：顶栏显示「已上传 0 B」，数字来自运行时出口监控。
 * 这里既验证常规编辑流程确实 0 B / 0 次外部请求，也用一次人为的远端 POST
 * 证明它真的会涨——否则那个 0 就只是文案。
 */
const fixture = { name: 'privacy.png', mimeType: 'image/png', buffer: createPngFixture(120, 80) };
const badge = (page) => page.locator('.shoteasy-privacy-badge');

test('normal editing stays at 0 B uploaded with no external requests', async ({ page }) => {
    const external = [];
    page.on('request', (request) => {
        const url = new URL(request.url());
        if (!isLocalBrowserUrl(url)) {
            external.push(request.url());
        }
    });
    await page.goto('/');
    await page.locator('.shoteasy-upload-card input[type=file]').setInputFiles(fixture);
    await page.waitForFunction(() => window.__shoteasyStores?.editor.app?.tree);

    // 走一遍会用到外部资源的流程：背景预设（同源图片）、导出、批量与草稿
    await page.evaluate(async () => {
        const root = window.__shoteasyStores;
        root.option.setBackground('gh_img_50');
        await root.exportService.exportImage({ format: 'png', ratio: 1 });
        await root.exportService.exportImage({ format: 'jpg', ratio: 2 });
    });
    await expect(page.locator('.shoteasy-frame-panel')).toBeVisible();

    const counters = await page.evaluate(() => {
        const privacy = window.__shoteasyStores.privacy;
        return {
            uploadedBytes: privacy.uploadedBytes,
            remoteRequests: privacy.remoteRequests,
            externalResourceLoads: privacy.externalResourceLoads,
            label: privacy.formatBytes(),
        };
    });
    expect(counters.uploadedBytes).toBe(0);
    expect(counters.remoteRequests).toBe(0);
    expect(counters.externalResourceLoads).toBe(0);
    expect(counters.label).toBe('0 B');
    expect(external).toEqual([]);

    await expect(badge(page)).toBeVisible();
    await expect(badge(page)).toContainText('0 B');
    await expect(badge(page)).not.toHaveClass(/is-flagged/);
    // 浮层给出统计口径与次数
    await badge(page).click();
    const details = page.locator('.shoteasy-privacy-details');
    await expect(details).toBeVisible();
    await expect(details).toContainText('外部请求 0 次');
    await expect(details).toContainText('外部资源加载 0 个');
});

test('a real external upload moves the counter and flags the badge', async ({ page }) => {
    // 远端请求在本机被拦下（不真的联网），但监控必须照实统计字节
    await page.route('https://privacy-probe.example/**', (route) => route.fulfill({ status: 200, body: 'ok' }));
    await page.goto('/');
    await expect(badge(page)).toContainText('0 B');

    const label = await page.evaluate(async () => {
        await fetch('https://privacy-probe.example/upload', { method: 'POST', body: 'x'.repeat(2048) });
        const privacy = window.__shoteasyStores.privacy;
        return { uploaded: privacy.uploadedBytes, remote: privacy.remoteRequests, label: privacy.formatBytes() };
    });
    expect(label.uploaded).toBe(2048);
    expect(label.remote).toBe(1);
    expect(label.label).toBe('2.0 kB');

    await expect(badge(page)).toContainText('2.0 kB');
    await expect(badge(page)).toHaveClass(/is-flagged/);
    await badge(page).click();
    const details = page.locator('.shoteasy-privacy-details');
    await expect(details).toContainText('外部请求 1 次');
    await expect(details).toContainText('privacy-probe.example');
});

test('multipart uploads disclose an unknown body length instead of an inaccurate byte total', async ({ page }) => {
    await page.route('https://privacy-probe.example/**', route => route.fulfill({ status: 200, body: 'ok' }));
    await page.goto('/');
    await expect(badge(page)).toContainText('0 B');

    const counters = await page.evaluate(async () => {
        const body = new FormData();
        body.append('caption', 'hello');
        body.append('image', new Blob(['image bytes'], { type: 'image/png' }), 'shot.png');
        await fetch('https://privacy-probe.example/multipart', { method: 'POST', body });
        const privacy = window.__shoteasyStores.privacy;
        return {
            uploadedBytes: privacy.uploadedBytes,
            unknownBody: privacy.unknownBody,
            label: privacy.formattedUploadedBytes,
        };
    });

    expect(counters).toEqual({ uploadedBytes: 0, unknownBody: 1, label: '≥ 0 B' });
    await expect(badge(page)).toContainText('≥ 0 B');
    await badge(page).click();
    await expect(page.locator('.shoteasy-privacy-details')).toContainText('请求体长度无法确定');
});

test('external images and scripts are reported separately from uploads', async ({ page }) => {
    await page.route('https://privacy-cdn.example/**', (route) => route.fulfill({
        status: 200, contentType: 'image/gif',
        body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
    }));
    await page.goto('/');
    await expect(badge(page)).toContainText('0 B');
    await page.evaluate(() => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(true);
        image.onerror = reject;
        image.src = 'https://privacy-cdn.example/pixel.gif';
    }));
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.privacy.externalResourceLoads)).toBeGreaterThan(0);
    const counters = await page.evaluate(() => ({
        uploaded: window.__shoteasyStores.privacy.uploadedBytes,
        label: window.__shoteasyStores.privacy.formatBytes(),
    }));
    // 资源加载只接收数据，不产生“已上传”字节，但要计入外部资源加载
    expect(counters.uploaded).toBe(0);
    expect(counters.label).toBe('0 B');
    await expect(badge(page)).toHaveClass(/is-flagged/);
    await badge(page).click();
    await expect(page.locator('.shoteasy-privacy-details')).toContainText('外部资源加载 1 个');
});

test('Request uploads disclose unknown length and preserve the actual body', async ({ page }) => {
    let sentBody;
    await page.route('https://privacy-probe.example/**', route => {
        sentBody = route.request().postData();
        return route.fulfill({ status: 200, body: 'ok' });
    });
    await page.goto('/');
    await expect(badge(page)).toBeVisible();
    await page.evaluate(() => fetch(new Request('https://privacy-probe.example/upload', {
        method: 'POST', body: 'image bytes',
    })));
    expect(sentBody).toBe('image bytes');
    await badge(page).click();
    await expect(page.locator('.shoteasy-privacy-details')).toContainText('请求体长度无法确定');
});

test('Strict Mode mounts own one subscription and disposal restores fetch', async ({ page }) => {
    await page.addInitScript(() => { window.__originalPrivacyFetch = window.fetch; });
    await page.goto('/');
    await expect(badge(page)).toBeVisible();
    const state = await page.evaluate(async () => {
        const { privacyInstrumentationState } = await import('/src/utils/privacyMonitor.js');
        const before = privacyInstrumentationState();
        window.__shoteasyStores.dispose();
        return { before, after: privacyInstrumentationState(), restored: window.fetch === window.__originalPrivacyFetch };
    });
    expect(state.before.listeners).toBe(1);
    expect(state.after).toMatchObject({ listeners: 0, patched: false });
    expect(state.restored).toBe(true);
});

test('undo notice expires after eight seconds', async ({ page }) => {
    await page.goto('/');
    await expect(badge(page)).toBeVisible();
    await page.evaluate(async () => {
        const { showUndoToast } = await import('/src/utils/undoToast.jsx');
        showUndoToast(window.__shoteasyStores, { label: 'Expiry regression', onUndo() {} });
    });
    const notice = page.getByText('Expiry regression', { exact: true });
    await expect(notice).toBeVisible();
    await expect(notice).toHaveCount(0, { timeout: 11_000 });
});

test('retained native XHR methods still send after editor disposal', async ({ page }) => {
    let body;
    await page.route('**/privacy-disposal-probe', route => {
        body = route.request().postData();
        return route.fulfill({ status: 200, body: 'ok' });
    });
    await page.goto('/');
    await expect(badge(page)).toBeVisible();
    const result = await page.evaluate(async () => {
        const open = XMLHttpRequest.prototype.open;
        const send = XMLHttpRequest.prototype.send;
        window.__shoteasyStores.dispose();
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.onload = () => resolve(xhr.responseText);
            xhr.onerror = () => reject(new Error('xhr-failed'));
            open.call(xhr, 'POST', '/privacy-disposal-probe');
            send.call(xhr, 'retained body');
        });
    });
    expect(result).toBe('ok');
    expect(body).toBe('retained body');
});

test('external URLs with leading whitespace cannot bypass upload accounting', async ({ page }) => {
    await page.route('https://privacy-probe.example/**', route => route.fulfill({ status: 200, body: 'ok' }));
    await page.goto('/');
    await expect(badge(page)).toBeVisible();
    await page.evaluate(() => fetch(' https://privacy-probe.example/upload', { method: 'POST', body: 'body' }));
    await expect(badge(page)).toContainText('4 B');
    expect(await page.evaluate(() => window.__shoteasyStores.privacy.remoteRequests)).toBe(1);
});
