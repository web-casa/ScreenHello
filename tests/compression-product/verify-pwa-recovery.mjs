import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, firefox, webkit, expect as playwrightExpect } from '@playwright/test';
import { createPngFixture } from '../fixtures/createPngFixture.js';
import { startProbeServer, PROBE_CSP } from '../spikes/compression/server.mjs';
import { environmentFingerprint, sha256, writeImmutableJson } from './memory-evidence.mjs';
import { readSystemPressure } from './system-pressure.mjs';
import { PWA_RECOVERY_SCOPE, PWA_RECOVERY_MODES, PWA_RECOVERY_ENGINES, PWA_MAX_FILE_BYTES,
    pwaRecoveryFingerprint, validatePwaFile, decodePwaFile, validatePwaRecovery } from './pwa-recovery-contract.mjs';

const [buildArgument, outputArgument, expectedWebSha256, selected] = process.argv.slice(2);
assert.ok(buildArgument && outputArgument && process.argv.length <= 6, 'usage: verify-pwa-recovery BUILD OUTPUT WEB_SHA256 [ENGINE]');
assert.match(expectedWebSha256 || '', /^[a-f0-9]{64}$/);
assert.ok(!selected || PWA_RECOVERY_ENGINES.includes(selected));
const build = await realpath(buildArgument);
const output = path.join(await realpath(path.dirname(path.resolve(outputArgument))), path.basename(outputArgument));
assert.ok(output !== build && !output.startsWith(`${build}${path.sep}`), 'output must not mutate candidate');
const candidate = pwaRecoveryFingerprint(build);
assert.equal(candidate.webBuildSha256, expectedWebSha256, 'candidate differs from expected bytes');
await mkdir(output); // Exclusive output identity, including failed runs.
const registration = { scope: PWA_RECOVERY_SCOPE, registeredAt: new Date().toISOString(), candidate,
    environment: environmentFingerprint(), engines: selected ? [selected] : PWA_RECOVERY_ENGINES,
    temporaryDirectory: tmpdir(),
    transport: 'http-loopback-secure-context-not-public-https', strictCsp: PROBE_CSP, fixtureSha256: sha256(createPngFixture(64, 48)), attempts: 1 };
await writeImmutableJson(path.join(output, 'registration.json'), registration);
const origin = await startProbeServer(build, { recordRequests: true });
const expect = playwrightExpect.configure({ timeout: 45_000 });
const reports = [];
let active;

async function importImage(page) {
    const input = page.locator('.shoteasy-upload-card input[type=file]');
    const button = page.locator('[aria-label="导出图片"]:not([disabled])');
    await expect(input.or(button)).toBeAttached();
    if (await input.count()) {
        try { await input.setInputFiles({ name: 'pwa-recovery.png', mimeType: 'image/png', buffer: createPngFixture(64, 48) }, { timeout: 3000 }); }
        catch (error) { if (await input.count() || !await button.isVisible()) throw error; }
    }
    await expect(button).toBeVisible();
}
async function cacheEntries(page) {
    return page.evaluate(async () => (await (await caches.open('screenhello-runtime-assets-v1')).keys()).map(request => request.url));
}
async function state(page) {
    return page.evaluate(() => ({ secureContext: isSecureContext, visibility: document.visibilityState, focused: document.hasFocus(),
        controller: navigator.serviceWorker.controller?.state, cspViolations: window.__pwaRecoveryCsp || [] }));
}
async function preview(page, engine, stage, mode, decoder) {
    active.stage = `${stage}-${mode}`;
    active.stages.push({ stage: active.stage, at: new Date().toISOString(), ...await state(page) });
    const [format, compression] = mode.split('-');
    await page.getByRole('button', { name: '导出图片', exact: true }).click();
    const drawer = page.locator('.shoteasy-export-drawer');
    await drawer.getByText(format.toUpperCase(), { exact: true }).first().click();
    await page.getByTestId(`compression-${compression}`).click();
    await drawer.getByText('1x', { exact: true }).click();
    const dimensions = (await drawer.locator('strong').filter({ hasText: /^\d+ × \d+ px$/ }).textContent()).match(/(\d+) × (\d+)/);
    const width = Number(dimensions[1]), height = Number(dimensions[2]);
    assert.ok(width * height <= 1048576);
    await page.getByTestId('export-preview').click();
    await expect(page.getByTestId('preview-viewport').locator('canvas')).toBeVisible();
    await expect(page.getByTestId('export-download')).toBeEnabled();
    const pending = page.waitForEvent('download');
    await page.getByTestId('export-download').click();
    const download = await pending;
    assert.equal(await download.failure(), null);
    assert.ok(download.suggestedFilename().endsWith(`.${format}`));
    const chunks = []; let size = 0;
    for await (const chunk of await download.createReadStream()) {
        size += chunk.length; assert.ok(size <= PWA_MAX_FILE_BYTES, 'download exceeds evidence budget'); chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks), file = `${engine}-${stage}-${mode}.${format}`;
    await writeFile(path.join(output, file), bytes, { flag: 'wx' });
    const digest = validatePwaFile(bytes, format);
    const decoded = await decoder.evaluate(decodePwaFile, { base64: bytes.toString('base64'), format });
    assert.equal(decoded.width, width); assert.equal(decoded.height, height);
    await download.delete();
    await expect(drawer).toHaveCount(0);
    return { mode, file, width, height, bytes: bytes.length, sha256: digest, decoded };
}

try {
    for (const engine of registration.engines) {
        origin.setOffline(false);
        const requestStart = origin.requests.length;
        let page, browser;
        active = { engine, version: null, attempts: 1, stage: 'browser-launch', stages: [], diagnostics: [], droppedDiagnostics: 0,
            outsideRequests: [], pageErrors: [], online: [], offline: [], systemBefore: readSystemPressure() };
        const log = value => { if (active.diagnostics.length < 1024) active.diagnostics.push({ at: new Date().toISOString(), stage: active.stage, ...value }); else active.droppedDiagnostics++; };
        try {
            browser = await ({ chromium, firefox, webkit })[engine].launch();
            active.version = browser.version(); active.stage = 'initial';
            const context = await browser.newContext({ locale: 'zh-CN', serviceWorkers: 'allow' });
            // Separate context for decoder: no editor Store/Canvas/Worker interception.
            const decoderContext = await browser.newContext({ serviceWorkers: 'block' });
            await decoderContext.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>File decoder</title>' }));
            const decoder = await decoderContext.newPage();
            await decoder.goto(origin.url);
            page = await context.newPage(); page.setDefaultTimeout(45_000);
            context.on('request', request => {
                if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(origin.url).origin) active.outsideRequests.push(request.url());
            });
            context.on('requestfailed', request => log({ type: 'requestfailed', url: request.url(), failure: request.failure() }));
            page.on('pageerror', error => active.pageErrors.push(error.message));
            page.on('console', message => { if (['warning', 'error'].includes(message.type())) log({ type: message.type(), message: message.text() }); });
            let downloads = 0; page.on('download', () => downloads++);
            await page.addInitScript(() => {
                window.showSaveFilePicker = undefined;
                window.__pwaRecoveryCsp = [];
                document.addEventListener('securitypolicyviolation', event => window.__pwaRecoveryCsp.push(event.violatedDirective));
                window.addEventListener('vite:preloadError', event => console.warn('pwa-preload-error', event.payload?.message));
            });
            const initialResponse = await page.goto(origin.url);
            assert.equal(initialResponse.headers()['content-security-policy'], PROBE_CSP);
            await expect(page.getByText('离线已就绪', { exact: true })).toBeVisible();
            assert.deepEqual((await state(page)).cspViolations, []);
            await page.reload();
            await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
            await importImage(page);
            Object.assign(active, await state(page));
            active.initialCache = await cacheEntries(page);
            assert.ok(!active.initialCache.some(url => /pngEncoder|oxipng/.test(url)));
            active.stage = 'cold-origin-503'; const coldStart = origin.requests.length;
            origin.setOffline(true);
            await page.getByRole('button', { name: '导出图片', exact: true }).click();
            await page.getByTestId('compression-lossless').click();
            await page.getByTestId('export-preview').click();
            await expect(page.getByRole('alert')).toBeVisible();
            active.coldFailure = { alerts: await page.getByRole('alert').allTextContents(), downloads, requests: origin.requests.slice(coldStart), ...await state(page) };
            assert.deepEqual(active.coldFailure.cspViolations, []);
            await expect(page.getByTestId('export-download')).toBeEnabled();
            await page.getByTestId('export-cancel').click();
            origin.setOffline(false); active.stage = 'online-reload';
            // Failed module imports remain in the old realm; actual navigation recovers it.
            await page.reload(); await importImage(page);
            for (const mode of PWA_RECOVERY_MODES) active.online.push(await preview(page, engine, 'online', mode, decoder));
            await expect.poll(async () => (await cacheEntries(page)).filter(url => /(?:webp_enc|squoosh_oxipng_bg)-.*\.wasm$/.test(url)).length).toBe(2);
            active.warmCache = await cacheEntries(page);
            assert.deepEqual((await state(page)).cspViolations, []);
            active.stage = 'offline-reload'; const offlineStart = origin.requests.length;
            origin.setOffline(true);
            assert.equal((await fetch(`${origin.url}pwa-origin-check`)).status, 503);
            await page.reload(); await importImage(page);
            for (const mode of PWA_RECOVERY_MODES) active.offline.push(await preview(page, engine, 'offline', mode, decoder));
            active.offlineRequests = origin.requests.slice(offlineStart);
            active.requests = origin.requests.slice(requestStart); active.droppedRequests = origin.droppedRequests;
            active.systemAfter = readSystemPressure();
            Object.assign(active, await state(page));
            validatePwaRecovery({ ...registration, engines: [engine] }, [active], pwaRecoveryFingerprint(build));
            await writeImmutableJson(path.join(output, `${engine}.json`), active);
            reports.push(active);
            console.log(`${engine} ${active.version}: cold refusal, online recovery, warm-cache offline reload passed`);
        } catch (error) {
            if (page) {
                active.failureState = await state(page).catch(failure => ({ readError: String(failure) }));
                active.alerts = await page.getByRole('alert').allTextContents().catch(() => []);
                await page.screenshot({ path: path.join(output, `${engine}-failure.png`) }).catch(failure => log({ screenshotError: String(failure) }));
            }
            active.requests = origin.requests.slice(requestStart);
            active.systemAfter = readSystemPressure();
            throw error;
        } finally { origin.setOffline(false); await browser?.close(); }
    }
    // Re-read all saved bytes; never infer that a download filename proves output.
    for (const report of reports) for (const entry of [...report.online, ...report.offline]) {
        const bytes = await readFile(path.join(output, entry.file));
        assert.equal(validatePwaFile(bytes, entry.mode.split('-')[0]), entry.sha256);
    }
    await writeImmutableJson(path.join(output, 'result.json'), {
        ...validatePwaRecovery(registration, reports, pwaRecoveryFingerprint(build)), reports, finalCandidate: pwaRecoveryFingerprint(build),
    });
} catch (error) {
    await writeImmutableJson(path.join(output, 'failure.json'), { error: String(error.stack || error), active, completed: reports.map(report => report.engine), deploymentAuthorized: false });
    throw error;
} finally { await origin.close(); }
