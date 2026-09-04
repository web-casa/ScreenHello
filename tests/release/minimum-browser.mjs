import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Builder, Browser, By, until } from 'selenium-webdriver';
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

const describeError = (error) => {
    const message = typeof error?.message === 'string' ? error.message.trim() : '';
    const name = typeof error?.name === 'string' ? error.name.trim() : '';
    return message || name || String(error);
};

const browserMap = {
    chrome: Browser.CHROME,
    edge: Browser.EDGE,
    firefox: Browser.FIREFOX,
    safari: Browser.SAFARI,
};
const report = {
    schemaVersion: 2,
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

const clickMenuItem = async (menuLabel, itemLabel) => {
    const opened = await driver.executeScript((label) => {
        const trigger = [...document.querySelectorAll('[role="menubar"] [role="menuitem"]')]
            .find((element) => element.textContent?.trim() === label);
        trigger?.click();
        return Boolean(trigger);
    }, menuLabel);
    assert.equal(opened, true, `${target.id}: missing ${menuLabel} menu`);
    await driver.wait(async () => driver.executeScript((label) => (
        [...document.querySelectorAll('.shoteasy-command-menu [role="menuitem"]')]
            .some((element) => element.offsetParent && element.textContent?.includes(label))
    ), itemLabel), 10_000, `${target.id}: missing ${itemLabel} menu item`);
    const clicked = await driver.executeScript((label) => {
        const item = [...document.querySelectorAll('.shoteasy-command-menu [role="menuitem"]')]
            .find((element) => element.offsetParent && element.textContent?.includes(label));
        item?.click();
        return Boolean(item);
    }, itemLabel);
    assert.equal(clicked, true, `${target.id}: could not click ${itemLabel}`);
};

const selectFormat = async (format) => {
    const trigger = await waitForEnabled('[aria-label="导出图片"]');
    await trigger.click();
    const selected = await driver.executeScript((value) => {
        const segmented = document.querySelector('.shoteasy-export-drawer .ant-segmented');
        const option = [...(segmented?.querySelectorAll('label') || [])]
            .find((label) => label.textContent?.trim() === value);
        option?.click();
        return Boolean(option);
    }, format.toUpperCase());
    assert.equal(selected, true, `${target.id}: missing ${format} format option`);
};

const waitForVisibleSelector = async (selector, message) => driver.wait(async () => driver.executeScript((value) => {
    const element = document.querySelector(value);
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}, selector), 20_000, `${target.id}: ${message}`);

const waitForHiddenSelector = async (selector, message) => driver.wait(async () => driver.executeScript((value) => {
    const element = document.querySelector(value);
    if (!element) return true;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0;
}, selector), 20_000, `${target.id}: ${message}`);

const waitForRemovedSelector = async (selector, message) => driver.wait(
    async () => driver.executeScript((value) => !document.querySelector(value), selector),
    20_000,
    `${target.id}: ${message}`,
);

const waitForStablePopup = async (selector, message) => driver.wait(async () => driver.executeScript((value) => {
    const element = document.querySelector(value);
    if (!element) return false;
    const style = getComputedStyle(element);
    const transform = style.transform;
    return style.opacity === '1'
        && (transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)');
}, selector), 20_000, `${target.id}: ${message}`);

const checkMobileWeb = async () => {
    const requestedWindow = await driver.manage().window().setRect({ width: 430, height: 900 });
    await driver.wait(async () => driver.executeScript(() => innerWidth <= 640), 20_000,
        `${target.id}: browser did not enter the mobile CSS viewport`);
    await waitForVisibleSelector('.shoteasy-mobile-menu-trigger', 'mobile menu trigger was not visible');

    const shell = await driver.executeScript((windowRect) => {
        const visible = (element) => {
            if (!element) return false;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const selectors = [
            '.shoteasy-mobile-menu-trigger',
            '.shoteasy-project-status',
            '[aria-label="导出图片"]',
            '.shoteasy-mobile-annotation-trigger',
            '.shoteasy-mobile-zoom-trigger',
        ];
        const targets = selectors.map((selector) => document.querySelector(selector));
        const targetSizes = targets.map((element) => {
            const rect = element?.getBoundingClientRect();
            return rect ? Math.min(rect.width, rect.height) : 0;
        });
        const topbar = document.querySelector('.shoteasy-topbar');
        const viewportWidth = document.documentElement.clientWidth;
        const horizontalMetrics = {
            document: {
                clientWidth: viewportWidth,
                scrollWidth: document.documentElement.scrollWidth,
            },
            topbar: {
                clientWidth: topbar?.clientWidth || 0,
                scrollWidth: topbar?.scrollWidth || 0,
            },
            overflowingElements: [...document.body.querySelectorAll('*')].map((element) => {
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                return {
                    className: typeof element.className === 'string' ? element.className : '',
                    display: style.display,
                    position: style.position,
                    rect: {
                        left: Math.round(rect.left),
                        right: Math.round(rect.right),
                        width: Math.round(rect.width),
                    },
                    tagName: element.tagName.toLowerCase(),
                };
            }).filter(({ display, position, rect }) => (
                display !== 'none'
                && position !== 'fixed'
                && rect.width > 0
                && (rect.left < -1 || rect.right > viewportWidth + 1)
            )).slice(0, 20),
        };
        return {
            viewport: { width: innerWidth, height: innerHeight },
            requestedWindow: windowRect,
            allTargetsVisible: targets.every(visible),
            minimumTargetSize: Math.round(Math.min(...targetSizes)),
            desktopMenuHidden: !visible(document.querySelector('.shoteasy-app-menu')),
            topbarButtonCount: [...(topbar?.querySelectorAll('button') || [])].filter(visible).length,
            horizontalMetrics,
            noHorizontalOverflow: (
                horizontalMetrics.document.scrollWidth <= horizontalMetrics.document.clientWidth
                && horizontalMetrics.topbar.scrollWidth <= horizontalMetrics.topbar.clientWidth
            ),
        };
    }, requestedWindow);
    assert.equal(shell.allTargetsVisible, true, `${target.id}: a mobile primary action was not visible`);
    assert.equal(shell.desktopMenuHidden, true, `${target.id}: desktop menu remained visible on mobile`);
    assert.equal(shell.topbarButtonCount, 3, `${target.id}: mobile topbar must expose exactly three buttons`);
    assert.ok(shell.minimumTargetSize >= 44, `${target.id}: mobile target was smaller than 44px`);
    assert.equal(shell.noHorizontalOverflow, true,
        `${target.id}: mobile shell overflowed horizontally: ${JSON.stringify(shell.horizontalMetrics)}`);

    await (await waitForEnabled('.shoteasy-mobile-menu-trigger')).click();
    await waitForVisibleSelector('.shoteasy-mobile-menu-drawer [role="dialog"]', 'mobile application menu did not open');
    await waitForStablePopup('.shoteasy-mobile-menu-drawer .ant-drawer-content-wrapper',
        'mobile application menu did not finish opening');
    const menu = await driver.executeScript(() => {
        const drawer = document.querySelector('.shoteasy-mobile-menu-drawer [role="dialog"]');
        const tabs = [...(drawer?.querySelectorAll('[role="tab"]') || [])].map((tab) => tab.textContent?.trim());
        const controls = [...(drawer?.querySelectorAll('[role="tab"], [role="menuitem"], .ant-drawer-close') || [])]
            .filter((element) => element.offsetParent);
        const targetSizes = controls.map((element) => {
            const rect = element.getBoundingClientRect();
            return {
                name: element.getAttribute('aria-label') || element.textContent?.trim(),
                role: element.getAttribute('role') || element.tagName.toLowerCase(),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
            };
        });
        const hasNewProject = [...(drawer?.querySelectorAll('[role="menuitem"]') || [])]
            .some((item) => item.textContent?.includes('新建项目'));
        return {
            tabs,
            hasNewProject,
            minimumTargetSize: Math.min(...targetSizes.map(({ width, height }) => Math.min(width, height))),
            undersizedTargets: targetSizes.filter(({ width, height }) => width < 44 || height < 44),
            noHorizontalOverflow: drawer.scrollWidth <= drawer.clientWidth,
        };
    });
    assert.deepEqual(menu.tabs, ['文件', '编辑', '视图', '帮助'], `${target.id}: mobile menu sections changed`);
    assert.equal(menu.hasNewProject, true, `${target.id}: mobile file menu was not reachable`);
    assert.deepEqual(menu.undersizedTargets, [],
        `${target.id}: mobile menu targets were smaller than 44px: ${JSON.stringify(menu.undersizedTargets)}`);
    assert.equal(menu.noHorizontalOverflow, true, `${target.id}: mobile menu overflowed horizontally`);
    await (await waitForEnabled('.shoteasy-mobile-menu-drawer .ant-drawer-close')).click();
    await waitForHiddenSelector('.shoteasy-mobile-menu-drawer [role="dialog"]', 'mobile application menu did not close');

    await (await waitForEnabled('.shoteasy-mobile-annotation-trigger')).click();
    await waitForVisibleSelector('.shoteasy-mobile-annotation-drawer [role="dialog"]', 'mobile annotation sheet did not open');
    await waitForStablePopup('.shoteasy-mobile-annotation-drawer .ant-drawer-content-wrapper',
        'mobile annotation sheet did not finish opening');
    const annotation = await driver.executeScript(() => {
        const drawer = document.querySelector('.shoteasy-mobile-annotation-drawer [role="dialog"]');
        const primarySection = document.querySelector('[aria-labelledby="shoteasy-mobile-primary-tools"]');
        const buttons = [...(primarySection?.querySelectorAll('.shoteasy-mobile-tool-grid button') || [])];
        return {
            labels: buttons.map((button) => button.getAttribute('aria-label')),
            minimumTargetSize: Math.round(Math.min(...buttons.map((button) => {
                const rect = button.getBoundingClientRect();
                return Math.min(rect.width, rect.height);
            }))),
            noHorizontalOverflow: drawer.scrollWidth <= drawer.clientWidth,
        };
    });
    assert.deepEqual(annotation.labels, ['矩形', '实心矩形', '圆形', '直线', '箭头', '画笔'],
        `${target.id}: mobile primary annotation tools changed`);
    assert.ok(annotation.minimumTargetSize >= 44, `${target.id}: annotation target was smaller than 44px`);
    assert.equal(annotation.noHorizontalOverflow, true, `${target.id}: annotation sheet overflowed horizontally`);
    await (await waitForEnabled('.shoteasy-mobile-annotation-drawer .ant-drawer-close')).click();
    await waitForHiddenSelector('.shoteasy-mobile-annotation-drawer [role="dialog"]', 'mobile annotation sheet did not close');

    await (await waitForEnabled('.shoteasy-mobile-zoom-trigger')).click();
    await waitForVisibleSelector('.shoteasy-mobile-zoom-menu [role="menu"]', 'mobile zoom menu did not open');
    await waitForStablePopup('.shoteasy-mobile-zoom-menu', 'mobile zoom menu did not finish opening');
    const zoom = await driver.executeScript(() => {
        const menuElement = document.querySelector('.shoteasy-mobile-zoom-menu [role="menu"]');
        const items = [...document.querySelectorAll('.shoteasy-mobile-zoom-menu [role="menuitem"]')]
            .filter((item) => item.offsetParent);
        const targetSizes = items.map((item) => {
            const rect = item.getBoundingClientRect();
            return {
                name: item.textContent?.trim(),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
            };
        });
        return {
            labels: items.map((item) => item.textContent?.trim()),
            minimumTargetSize: Math.min(...targetSizes.map(({ width, height }) => Math.min(width, height))),
            undersizedTargets: targetSizes.filter(({ width, height }) => width < 44 || height < 44),
            noHorizontalOverflow: menuElement.scrollWidth <= menuElement.clientWidth,
        };
    });
    assert.deepEqual(zoom.labels, ['放大', '缩小', '100%', '适应画布'], `${target.id}: mobile zoom commands changed`);
    assert.deepEqual(zoom.undersizedTargets, [],
        `${target.id}: mobile zoom targets were smaller than 44px: ${JSON.stringify(zoom.undersizedTargets)}`);
    assert.equal(zoom.noHorizontalOverflow, true, `${target.id}: mobile zoom menu overflowed horizontally`);

    const minimumTargetSize = Math.min(
        shell.minimumTargetSize,
        menu.minimumTargetSize,
        annotation.minimumTargetSize,
        zoom.minimumTargetSize
    );

    return {
        viewport: shell.viewport,
        topbarActions: ['menu', 'project-status', 'export'],
        menuSections: ['file', 'edit', 'view', 'help'],
        annotationSheet: true,
        zoomMenu: true,
        minimumTargetSize,
        noHorizontalOverflow: true,
    };
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
                .test(describeError(error)),
            onAttemptFailed: ({ attempt, error, willRetry }) => {
                report.sessionCreation.attempts = attempt;
                sessionErrors.push({
                    attempt,
                    error: redact(describeError(error)),
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
    await waitForEnabled('[aria-label="导出图片"]');

    const noBackground = await driver.wait(until.elementLocated(By.css('.shoteasy-inspector [title="无背景"]')), 20_000);
    await noBackground.click();
    await clickMenuItem('编辑', '撤销');
    await clickMenuItem('编辑', '重做');

    const downloads = [];
    for (const format of ['png', 'jpg', 'webp', 'avif']) {
        await selectFormat(format);
        const previousCount = downloads.length;
        await (await waitForEnabled('[data-testid="export-download"]')).click();
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
        await waitForHiddenSelector('.shoteasy-export-drawer [role="dialog"]',
            `${format} export panel did not close after download`);
        await waitForRemovedSelector('.shoteasy-export-drawer',
            `${format} export drawer was not destroyed after closing`);
    }

    const mobileWeb = await checkMobileWeb();

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
        mobileWeb,
        secureContext: browserState.secureContext,
        serviceWorkerApi: browserState.serviceWorker,
    };
} catch (error) {
    report.error = redact(describeError(error));
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
            report.diagnosticError = redact(describeError(diagnosticError));
        }
        try {
            report.browserLogs = (await driver.manage().logs().get('browser')).slice(-20).map((entry) => ({
                level: entry.level?.name || String(entry.level),
                message: redact(entry.message),
                timestamp: entry.timestamp,
            }));
        } catch (logError) {
            report.browserLogError = redact(describeError(logError));
        }
    }
    process.exitCode = 1;
} finally {
    if (driver) {
        try {
            await driver.quit();
        } catch (cleanupError) {
            report.driverCleanupError = redact(describeError(cleanupError));
        }
    }
    if (localDriverService) {
        try {
            await localDriverService.kill();
        } catch (cleanupError) {
            report.serviceCleanupError = redact(describeError(cleanupError));
        }
    }
    await writeReport();
    console.log(JSON.stringify(report, null, 2));
}
