import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Builder, Browser, By, Key, until } from 'selenium-webdriver';
import { Options as SafariOptions, ServiceBuilder as SafariServiceBuilder } from 'selenium-webdriver/safari.js';
import { browserVersionIsAccepted } from '../../scripts/browser-version-policy.mjs';
import { createSessionWithRetry } from '../../scripts/webdriver-session-retry.mjs';
import { createPngFixture } from '../fixtures/createPngFixture.js';

const matrix = JSON.parse(await readFile(new URL('../../config/browser-release-matrix.json', import.meta.url), 'utf8'));
const targetId = process.env.SCREENHELLO_BROWSER_TARGET;
const remoteUrl = process.env.SELENIUM_REMOTE_URL;
const baseURL = process.env.SCREENHELLO_RELEASE_BASE_URL || 'http://host.docker.internal:4197';
const outputPath = resolve(process.env.SCREENHELLO_BROWSER_EVIDENCE
    || `artifacts/release/browser-matrix/${targetId || 'unknown'}.json`);
const target = matrix.targets.find(({ id }) => id === targetId);

assert.ok(target, `SCREENHELLO_BROWSER_TARGET must be one of: ${matrix.targets.map(({ id }) => id).join(', ')}`);
assert.ok(remoteUrl || target.localDriver, 'SELENIUM_REMOTE_URL is required unless the target uses a local driver');

let providerCapabilities = {};
if (process.env.SCREENHELLO_WEBDRIVER_CAPABILITIES_JSON) {
    providerCapabilities = JSON.parse(process.env.SCREENHELLO_WEBDRIVER_CAPABILITIES_JSON);
    assert.equal(
        providerCapabilities && typeof providerCapabilities === 'object' && !Array.isArray(providerCapabilities),
        true,
        'SCREENHELLO_WEBDRIVER_CAPABILITIES_JSON must be a JSON object'
    );
    for (const reserved of ['browserName', 'browserVersion', 'platformName']) {
        assert.equal(reserved in providerCapabilities, false, `${reserved} must use the dedicated release variables`);
    }
}

const secretValues = new Set(remoteUrl ? [remoteUrl] : []);
try {
    const parsedRemote = new URL(remoteUrl);
    if (parsedRemote.username) secretValues.add(decodeURIComponent(parsedRemote.username));
    if (parsedRemote.password) secretValues.add(decodeURIComponent(parsedRemote.password));
} catch {
    // The WebDriver builder will report an invalid endpoint without exposing its raw value.
}
const collectProviderSecrets = (value, key = '') => {
    if (value && typeof value === 'object') {
        for (const [childKey, childValue] of Object.entries(value)) collectProviderSecrets(childValue, childKey);
        return;
    }
    if (typeof value === 'string' && /(access.?key|token|secret|password|username)/i.test(key)) {
        secretValues.add(value);
    }
};
collectProviderSecrets(providerCapabilities);
const redact = (value) => {
    let result = String(value || '');
    for (const secret of secretValues) {
        if (secret && secret.length >= 4) result = result.replaceAll(secret, '<redacted>');
    }
    return result;
};

const browserMap = {
    chrome: Browser.CHROME,
    edge: Browser.EDGE,
    firefox: Browser.FIREFOX,
    safari: Browser.SAFARI,
};
const report = {
    schemaVersion: 1,
    target: target.id,
    testedAt: new Date().toISOString(),
    source: redact(process.env.SCREENHELLO_BROWSER_SOURCE || 'selenium-remote'),
    releaseCandidate: process.env.SCREENHELLO_RELEASE_CANDIDATE || 'working-tree',
    executionEnvironment: process.env.SCREENHELLO_BROWSER_EXECUTION || 'unspecified',
    runner: process.env.SCREENHELLO_RUNNER_LABEL || '',
    requested: {
        browserName: target.webDriverName,
        browserVersion: process.env.SCREENHELLO_BROWSER_VERSION || target.requestedVersion,
        platformName: process.env.SCREENHELLO_BROWSER_PLATFORM || '',
        providerCapabilityKeys: Object.keys(providerCapabilities).sort(),
    },
    status: 'failed',
};
if (target.requiresTrustedSafari) {
    report.trustedSafari = process.env.SCREENHELLO_TRUSTED_SAFARI === 'true';
    report.safariEnvironment = process.env.SCREENHELLO_SAFARI_ENVIRONMENT || '';
}
let driver;
let localDriverService;

const writeReport = async () => {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
};

const waitForEnabled = async (selector) => {
    const element = await driver.wait(until.elementLocated(By.css(selector)), 20_000);
    await driver.wait(until.elementIsVisible(element), 20_000);
    await driver.wait(until.elementIsEnabled(element), 20_000);
    return element;
};

const selectFormat = async (format) => {
    const trigger = await waitForEnabled('[aria-label^="导出格式与倍率"]');
    await trigger.click();
    const selected = await driver.executeScript((value) => {
        const segmented = document.querySelector('.shoteasy-export-popover .ant-segmented');
        const option = [...(segmented?.querySelectorAll('label') || [])]
            .find((label) => label.textContent?.trim() === value);
        option?.click();
        return Boolean(option);
    }, format);
    assert.equal(selected, true, `${target.id}: missing ${format} format option`);
    await driver.wait(async () => (await trigger.getAttribute('aria-label'))?.includes(format.toUpperCase()), 10_000);
    await driver.findElement(By.css('body')).sendKeys(Key.ESCAPE);
};

const validSignature = (format, hex) => {
    if (format === 'png') return hex.startsWith('89504e470d0a1a0a');
    if (format === 'jpg') return hex.startsWith('ffd8ff');
    if (format === 'webp') return hex.startsWith('52494646') && hex.slice(16, 24) === '57454250';
    if (format === 'avif') return hex.slice(8, 16) === '66747970' && hex.slice(16, 24) === '61766966';
    return false;
};

try {
    let localDriverUrl;
    if (target.localDriver) {
        assert.equal(target.browser, 'safari', `${target.id}: unsupported local release driver`);
        localDriverService = new SafariServiceBuilder('/usr/bin/safaridriver')
            .setStdio('inherit')
            .build();
        localDriverUrl = await localDriverService.start();
    }

    const createDriver = async () => {
        let builder = new Builder().forBrowser(
            browserMap[target.browser],
            process.env.SCREENHELLO_BROWSER_VERSION || target.requestedVersion || undefined,
            process.env.SCREENHELLO_BROWSER_PLATFORM || undefined
        );
        if (remoteUrl || localDriverUrl) builder = builder.usingServer(remoteUrl || localDriverUrl);
        if (target.browser === 'safari') builder = builder.setSafariOptions(new SafariOptions().enableLogging());
        for (const [key, value] of Object.entries(providerCapabilities)) builder.setCapability(key, value);
        return builder.build();
    };

    if (target.localDriver) {
        const sessionErrors = [];
        const maxAttempts = target.sessionCreateRetries || 1;
        report.sessionCreation = {
            attempts: 0,
            maxAttempts,
            failedAttempts: sessionErrors,
        };
        const result = await createSessionWithRetry({
            createSession: createDriver,
            maxAttempts,
            retryDelayMs: target.sessionRetryDelayMs || 0,
            shouldRetry: (error) => /session timed out while connecting to a Safari instance/i
                .test(error instanceof Error ? error.message : String(error)),
            onAttemptFailed: ({ attempt, error, willRetry }) => {
                report.sessionCreation.attempts = attempt;
                sessionErrors.push({
                    attempt,
                    error: redact(error instanceof Error ? error.message : error),
                    willRetry,
                });
            },
        });
        driver = result.session;
        report.sessionCreation.attempts = result.attempts;
    } else {
        driver = await createDriver();
    }
    await driver.manage().setTimeouts({ implicit: 0, pageLoad: 60_000, script: 120_000 });
    await driver.manage().window().setRect({ width: 1280, height: 800 });

    const capabilities = await driver.getCapabilities();
    const observed = {
        browserName: String(capabilities.get('browserName') || ''),
        browserVersion: String(capabilities.get('browserVersion') || ''),
        platformName: String(capabilities.get('platformName') || ''),
    };
    report.observed = observed;
    assert.equal(
        target.acceptedBrowserNames.map((name) => name.toLowerCase()).includes(observed.browserName.toLowerCase()),
        true,
        `${target.id}: unexpected browser name`
    );
    assert.equal(
        browserVersionIsAccepted(observed.browserVersion, target),
        true,
        `${target.id}: browser version did not satisfy the ${target.versionPolicy || 'exact'} policy`
    );

    await driver.get(baseURL);
    await driver.wait(until.elementLocated(By.css('.shoteasy-upload-card input[type="file"]')), 30_000);
    const loadedOrigin = await driver.executeScript(() => location.origin);
    assert.equal(loadedOrigin, new URL(baseURL).origin, `${target.id}: redirected to an unexpected origin`);

    report.canvasWebpEncoding = await driver.executeAsyncScript((done) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            canvas.width = canvas.height = 0;
            done(value);
        };
        const timeout = window.setTimeout(() => finish({ supported: false, observedMimeType: '', timedOut: true }), 5_000);
        try {
            canvas.toBlob((blob) => {
                window.clearTimeout(timeout);
                const observedMimeType = String(blob?.type || '').toLowerCase();
                finish({
                    supported: observedMimeType === 'image/webp',
                    observedMimeType,
                    timedOut: false,
                });
            }, 'image/webp', 0.9);
        } catch (error) {
            window.clearTimeout(timeout);
            finish({
                supported: false,
                observedMimeType: '',
                timedOut: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    await driver.executeScript(() => {
        window.__screenhelloReleaseErrors = [];
        window.__screenhelloReleaseDownloads = [];
        const blobs = new Map();
        const createObjectURL = URL.createObjectURL.bind(URL);
        const revokeObjectURL = URL.revokeObjectURL.bind(URL);
        const anchorClick = HTMLAnchorElement.prototype.click;
        URL.createObjectURL = (blob) => {
            const url = createObjectURL(blob);
            blobs.set(url, blob);
            return url;
        };
        URL.revokeObjectURL = (url) => {
            window.setTimeout(() => blobs.delete(url), 0);
            revokeObjectURL(url);
        };
        HTMLAnchorElement.prototype.click = function screenhelloReleaseClick() {
            const blob = blobs.get(this.href);
            if (this.download && blob) {
                const name = this.download;
                void blob.slice(0, 16).arrayBuffer().then((buffer) => {
                    const hex = [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
                    window.__screenhelloReleaseDownloads.push({ name, type: blob.type, size: blob.size, hex });
                });
            }
            return anchorClick.call(this);
        };
        addEventListener('error', (event) => window.__screenhelloReleaseErrors.push(String(event.error?.message || event.message)));
        addEventListener('unhandledrejection', (event) => window.__screenhelloReleaseErrors.push(String(event.reason?.message || event.reason)));
    });

    const pngBase64 = createPngFixture(64, 48).toString('base64');
    const injected = await driver.executeScript((base64) => {
        const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
        const file = new File([bytes], 'screenhello-private-minimum-browser.png', { type: 'image/png' });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        const input = document.querySelector('.shoteasy-upload-card input[type="file"]');
        if (!input) return false;
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }, pngBase64);
    assert.equal(injected, true, `${target.id}: fixture input was not available`);
    await waitForEnabled('[aria-label="下载图片"]');

    const noBackground = await driver.wait(until.elementLocated(By.css('.shoteasy-inspector [title="无背景"]')), 20_000);
    await noBackground.click();
    const undo = await waitForEnabled('[aria-label="撤销"]');
    await undo.click();
    const redo = await waitForEnabled('[aria-label="重做"]');
    await redo.click();

    const downloads = [];
    for (const format of ['png', 'jpg', 'webp', 'avif']) {
        await selectFormat(format);
        const previousCount = downloads.length;
        await (await waitForEnabled('[aria-label="下载图片"]')).click();
        await driver.wait(async () => {
            const recordsJson = await driver.executeScript(() => JSON.stringify(window.__screenhelloReleaseDownloads || []));
            const records = JSON.parse(recordsJson);
            assert.equal(Array.isArray(records), true, `${target.id}: download records were not an array`);
            downloads.splice(0, downloads.length, ...records);
            return downloads.length > previousCount;
        }, 120_000, `${target.id}: ${format} export did not complete`);
        const record = downloads.at(-1);
        assert.equal(record.type, format === 'jpg' ? 'image/jpeg' : `image/${format}`);
        assert.ok(record.size > 0, `${target.id}: empty ${format} export`);
        assert.equal(validSignature(format, record.hex), true, `${target.id}: invalid ${format} signature`);
    }

    const browserState = await driver.executeScript(() => ({
        errors: window.__screenhelloReleaseErrors,
        resourceUrls: performance.getEntriesByType('resource').map(({ name }) => name),
        secureContext: window.isSecureContext,
        serviceWorker: 'serviceWorker' in navigator,
    }));
    assert.deepEqual(browserState.errors, [], `${target.id}: uncaught browser error`);
    assert.equal(browserState.resourceUrls.every((url) => {
        const parsed = new URL(url, baseURL);
        return ['blob:', 'data:'].includes(parsed.protocol) || parsed.origin === new URL(baseURL).origin;
    }), true, `${target.id}: cross-origin resource request`);
    assert.equal(browserState.resourceUrls.some((url) => decodeURIComponent(url).includes('screenhello-private-minimum-browser')), false);

    report.status = 'passed';
    report.checks = {
        coreEditUndoRedo: true,
        imageExports: downloads.map(({ name, type, size }) => ({ name, type, size })),
        localResourceRequests: true,
        secureContext: browserState.secureContext,
        serviceWorkerApi: browserState.serviceWorker,
    };
} catch (error) {
    report.error = redact(error instanceof Error ? error.message : error);
    if (driver) {
        try {
            report.diagnostics = await driver.executeScript(() => ({
                bodyText: document.body?.innerText?.slice(0, 1_000) || '',
                location: location.href,
                readyState: document.readyState,
                rootHtml: document.querySelector('#root')?.innerHTML?.slice(0, 2_000) || '',
                title: document.title,
            }));
        } catch (diagnosticError) {
            report.diagnosticError = redact(diagnosticError instanceof Error ? diagnosticError.message : diagnosticError);
        }
        try {
            report.browserLogs = (await driver.manage().logs().get('browser')).slice(-20).map((entry) => ({
                level: entry.level?.name || String(entry.level),
                message: redact(entry.message),
                timestamp: entry.timestamp,
            }));
        } catch (logError) {
            report.browserLogError = redact(logError instanceof Error ? logError.message : logError);
        }
    }
    process.exitCode = 1;
} finally {
    if (driver) {
        try {
            await driver.quit();
        } catch (cleanupError) {
            report.driverCleanupError = redact(cleanupError instanceof Error ? cleanupError.message : cleanupError);
        }
    }
    if (localDriverService) {
        try {
            await localDriverService.kill();
        } catch (cleanupError) {
            report.serviceCleanupError = redact(cleanupError instanceof Error ? cleanupError.message : cleanupError);
        }
    }
    await writeReport();
    console.log(JSON.stringify(report, null, 2));
}
