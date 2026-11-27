import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { chromium, firefox, webkit, expect as playwrightExpect } from '@playwright/test';
import { checkedPreviewOrigin, PREVIEW_CSP, checkPreviewResponse, validateOfflineProbe } from './https-preview-contract.mjs';
import { fetchVerifiedHttps } from './https-entrypoints.mjs';
import { createPngFixture } from '../fixtures/createPngFixture.js';
import { PWA_RECOVERY_MODES, validatePwaFile, decodePwaFile } from '../compression-product/pwa-recovery-contract.mjs';
import { writeImmutableJson, sha256, hashPaths } from '../compression-product/memory-evidence.mjs';
import { startPreviewNetworkGate } from './preview-network-gate.mjs';

assert.ok(process.argv.length === 5 || process.argv.length === 6, 'usage: verify-https-preview STATIC_REPORT OUTPUT_DIR EXPECTED_UPLOAD_SHA256 [ENGINE]');
// process.argv also includes node/script, hence three required arguments.
const staticReport = JSON.parse(await readFile(process.argv[2], 'utf8'));
const origin = checkedPreviewOrigin(staticReport.origin);
assert.equal(staticReport.status, 'STATIC-PASS'); assert.deepEqual(staticReport.failures, []);
assert.match(process.argv[4], /^[a-f0-9]{64}$/);
assert.equal(staticReport.uploadSha256, process.argv[4]);
const engines = process.argv[5] ? [process.argv[5]] : ['chromium', 'firefox', 'webkit'];
assert.ok(engines.every(engine => ['chromium', 'firefox', 'webkit'].includes(engine)));
const output = path.join(await realpath(path.dirname(path.resolve(process.argv[3]))), path.basename(process.argv[3]));
await mkdir(output);
const expect = playwrightExpect.configure({ timeout: 45000 });
const registration = { scope: 'https-preview-offline/v1', origin, uploadSha256: staticReport.uploadSha256,
    runnerSha256: hashPaths(path.resolve('tests/release'), ['verify-https-preview.mjs', 'https-preview-contract.mjs', 'https-entrypoints.mjs', 'preview-network-gate.mjs']),
    registeredAt: new Date().toISOString(), attempts: 1, engines, transport: 'public-https-end-to-end-tls-connect-gateway-disconnect',
    fixtureSha256: sha256(createPngFixture(64, 48)), updateAcrossDeployments: false, productionDeploymentAuthorized: false };
await writeImmutableJson(path.join(output, 'registration.json'), registration);
const reports = [];
let active;
async function importImage(page) {
    const input = page.locator('.shoteasy-upload-card input[type=file]');
    const button = page.locator('[aria-label="导出图片"]:not([disabled])');
    await expect(input.or(button)).toBeAttached();
    if (await input.count()) {
        try { await input.setInputFiles({ name: 'https-preview.png', mimeType: 'image/png', buffer: createPngFixture(64, 48) }, { timeout: 3000 }); }
        catch (error) { if (await input.count() || !await button.isVisible()) throw error; }
    }
    await expect(button).toBeVisible();
}
const cacheEntries = page => page.evaluate(async () => (await (await caches.open('screenhello-runtime-assets-v1')).keys()).map(request => request.url));
async function checkOffline(page, gateway) {
    const before = gateway.snapshot();
    const result = await page.evaluate(async () => {
        try {
            const response = await fetch(`/assets/https-offline-sentinel.bin?stage=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
            return { status: response.status, body: (await response.text()).slice(0, 100) };
        } catch (error) { return { error: error.name }; }
    });
    const after = gateway.snapshot(); validateOfflineProbe(result, before, after);
    return { observed: result, before, after };
}
async function exportFile(page, decoder, mode, stage) {
    active.stage = `${stage}-${mode}`;
    const [format, compression] = mode.split('-');
    await page.getByRole('button', { name: '导出图片', exact: true }).click();
    const drawer = page.locator('.shoteasy-export-drawer');
    await drawer.getByText(format.toUpperCase(), { exact: true }).first().click();
    await page.getByTestId(`compression-${compression}`).click();
    await drawer.getByText('1x', { exact: true }).click();
    await page.getByTestId('export-preview').click();
    await expect(page.getByTestId('preview-viewport').locator('canvas')).toBeVisible();
    const pending = page.waitForEvent('download');
    await page.getByTestId('export-download').click();
    const download = await pending; assert.equal(await download.failure(), null);
    assert.ok(download.suggestedFilename().endsWith(`.${format}`));
    const chunks = []; let size = 0;
    for await (const chunk of await download.createReadStream()) { size += chunk.length; assert.ok(size <= 1048576); chunks.push(chunk); }
    const bytes = Buffer.concat(chunks), file = `${active.engine}-${stage}-${mode}.${format}`;
    const digest = validatePwaFile(bytes, format);
    await writeFile(path.join(output, file), bytes, { flag: 'wx' });
    const decoded = await decoder.evaluate(decodePwaFile, { base64: bytes.toString('base64'), format });
    assert.deepEqual([decoded.width, decoded.height], [73, 55]);
    assert.ok(decoded.colors > 1 && decoded.center[3] > 0);
    await download.delete(); await expect(drawer).toHaveCount(0);
    return { mode, file, size, sha256: digest, decoded };
}
try {
    for (const engine of engines) {
        let browser, page, gateway;
        active = { engine, stage: 'launch', online: [], offline: [], pageErrors: [], outsideRequests: [], diagnostics: [], droppedDiagnostics: 0, csp: [] };
        try {
            for (const file of ['index.html', 'sw.js']) {
                const row = staticReport.inventory.find(row => row.file === file); assert.ok(row);
                checkPreviewResponse(row, await fetchVerifiedHttps(origin + row.requestPath));
            }
            gateway = await startPreviewNetworkGate(origin);
            browser = await ({ chromium, firefox, webkit })[engine].launch({ proxy: { server: gateway.url } }); active.version = browser.version();
            const context = await browser.newContext({ locale: 'zh-CN', serviceWorkers: 'allow', ignoreHTTPSErrors: false });
            const decoderContext = await browser.newContext({ serviceWorkers: 'block' });
            await decoderContext.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Decoder</title>' }));
            const decoder = await decoderContext.newPage(); await decoder.goto(origin);
            page = await context.newPage(); page.setDefaultTimeout(45000);
            page.on('pageerror', error => active.pageErrors.push(error.message));
            const log = data => { if (active.diagnostics.length < 1024) active.diagnostics.push({ stage: active.stage, ...data }); else active.droppedDiagnostics++; };
            context.on('requestfailed', request => log({ url: request.url(), failure: request.failure() }));
            context.on('request', request => {
                if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) active.outsideRequests.push(request.url());
            });
            await page.exposeFunction('__previewCspReport', directive => active.csp.push(directive));
            await page.addInitScript(() => {
                window.showSaveFilePicker = undefined;
                document.addEventListener('securitypolicyviolation', event => window.__previewCspReport(event.violatedDirective));
            });
            active.stage = 'initial'; const response = await page.goto(origin);
            assert.equal(response.headers()['content-security-policy'], PREVIEW_CSP);
            await expect(page.getByText('离线已就绪', { exact: true })).toBeVisible();
            await page.reload(); await importImage(page);
            active.secureContext = await page.evaluate(() => isSecureContext); assert.equal(active.secureContext, true);
            await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
            active.initialCache = await cacheEntries(page); assert.ok(!active.initialCache.some(url => /pngEncoder|oxipng/.test(url)));
            active.stage = 'cold-offline'; gateway.setOffline(true); active.coldGateBefore = gateway.snapshot(); active.coldNetwork = await checkOffline(page, gateway);
            let downloads = 0; page.on('download', () => downloads++);
            await page.getByRole('button', { name: '导出图片', exact: true }).click();
            await page.getByTestId('compression-lossless').click(); await page.getByTestId('export-preview').click();
            await expect(page.getByRole('alert')).toContainText('预览失败'); assert.equal(downloads, 0);
            active.coldAlerts = await page.getByRole('alert').allTextContents();
            active.coldGateAfter = gateway.snapshot();
            assert.equal(active.coldGateAfter.opened, active.coldGateBefore.opened);
            assert.ok(active.coldGateAfter.refused > active.coldGateBefore.refused);
            await page.getByTestId('export-cancel').click();
            active.stage = 'online-recovery'; gateway.setOffline(false); await page.reload(); await importImage(page);
            for (const mode of PWA_RECOVERY_MODES) active.online.push(await exportFile(page, decoder, mode, 'online'));
            await expect.poll(async () => (await cacheEntries(page)).filter(url => /(?:webp_enc|squoosh_oxipng_bg)-.*\.wasm$/.test(url)).length).toBe(2);
            active.warmCache = await cacheEntries(page);
            active.stage = 'warm-offline'; gateway.setOffline(true); active.warmGateBefore = gateway.snapshot(); active.warmNetwork = await checkOffline(page, gateway);
            await page.reload(); await importImage(page);
            for (const mode of PWA_RECOVERY_MODES) active.offline.push(await exportFile(page, decoder, mode, 'offline'));
            assert.equal(downloads, 6);
            active.warmGateAfter = gateway.snapshot();
            assert.equal(active.warmGateAfter.opened, active.warmGateBefore.opened);
            assert.ok(active.warmGateAfter.refused > active.warmGateBefore.refused);
            for (let index = 0; index < 3; index++) assert.deepEqual(active.online[index].decoded, active.offline[index].decoded);
            assert.deepEqual(active.csp, []); assert.deepEqual(active.pageErrors, []); assert.deepEqual(active.outsideRequests, []); assert.equal(active.droppedDiagnostics, 0);
            gateway.setOffline(false);
            await page.screenshot({ path: path.join(output, `${engine}.png`) });
            active.status = 'passed'; await writeImmutableJson(path.join(output, `${engine}.json`), active); reports.push(active);
            console.log(`${engine} ${active.version}: HTTPS cold failure/recovery + warm offline exports passed`);
        } catch (error) {
            if (page) await page.screenshot({ path: path.join(output, `${engine}-failure.png`) }).catch(() => {});
            throw error;
        } finally { try { await browser?.close(); } finally { await gateway?.close(); } }
    }
    for (const report of reports) for (const item of [...report.online, ...report.offline]) assert.equal(sha256(await readFile(path.join(output, item.file))), item.sha256);
    await writeImmutableJson(path.join(output, 'result.json'), { ...registration, reports, status: engines.length === 3 ? 'HTTPS-OFFLINE-PASS' : 'DIAGNOSTIC-PASS', releaseGate: 'HOLD' });
} catch (error) {
    await writeImmutableJson(path.join(output, 'failure.json'), { error: String(error.stack || error), active, completed: reports.map(report => report.engine) });
    throw error;
}
