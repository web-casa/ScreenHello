import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { Builder, By, Capabilities, until } from 'selenium-webdriver';
import { desktopCodecArtifacts } from './audit-desktop-codecs.mjs';
import { createDesktopSession, stopDesktopAutomation } from './desktop-process-tree.mjs';

const root = process.cwd();
const applicationName = process.platform === 'win32' ? 'screenhello-desktop.exe' : 'screenhello-desktop';
const driverProvider = process.env.SCREENHELLO_DESKTOP_DRIVER_PROVIDER || 'official';
const useEmbeddedDriver = driverProvider === 'embedded';
const application = path.resolve(
    root,
    process.env.SCREENHELLO_DESKTOP_APPLICATION
        || path.join('src-tauri', useEmbeddedDriver ? 'target-test-driver' : 'target', 'release', applicationName),
);
const port = Number.parseInt(process.env.SCREENHELLO_TAURI_DRIVER_PORT || '4445', 10);
const nativePort = Number.parseInt(process.env.SCREENHELLO_WEBKIT_DRIVER_PORT || '4446', 10);
const shutdownGraceMs = 5_000;
const runtimeStartedAt = Date.now();
const expectedCodecFormats = Object.freeze(desktopCodecArtifacts.map(({ id }) => id));
const captureCapabilityBackends = new Set(['x11', 'wayland-portal', 'macos-core-graphics', 'windows-gdi']);
const captureCapabilityStatuses = new Set(['ready', 'system-permission-required', 'portal-required', 'no-display']);
const desktopStateStatuses = new Set(['initialized', 'ready', 'migrated', 'unavailable']);
const expectedPlatform = process.env.SCREENHELLO_EXPECTED_DESKTOP_PLATFORM
    || ({ darwin: 'macos', linux: 'linux', win32: 'windows' })[process.platform];

const validCaptureCapability = (value) => (
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === 4
    && value.schemaVersion === 1
    && captureCapabilityBackends.has(value.backend)
    && captureCapabilityStatuses.has(value.status)
    && typeof value.sourcePicker === 'boolean'
    && value.sourcePicker === (value.status === 'ready')
    && (expectedPlatform === 'linux'
        ? ['x11', 'wayland-portal'].includes(value.backend)
        : expectedPlatform === 'macos'
            ? value.backend === 'macos-core-graphics'
            : expectedPlatform === 'windows'
                ? value.backend === 'windows-gdi'
                : false)
);

const validDesktopState = (value) => (
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === 3
    && value.schemaVersion === 1
    && desktopStateStatuses.has(value.status)
    && value.dataSchemaVersion === 1
);

const delay = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

const waitForVisible = async (driver, selector, timeoutMs = 10_000) => {
    const element = await driver.wait(until.elementLocated(By.css(selector)), timeoutMs, `desktop-element-missing:${selector}`);
    await driver.wait(async () => await element.isDisplayed(), timeoutMs, `desktop-element-hidden:${selector}`);
    return element;
};

// Geometry can pass while CSP has rejected the theme's dynamic style tags.
const assertThemedSurface = async (driver, selector) => {
    await waitForVisible(driver, selector);
    const surface = await driver.executeScript(`
        const style = getComputedStyle(document.querySelector(arguments[0]));
        return {
            background: style.backgroundColor,
            color: style.color,
            token: style.getPropertyValue('--ant-color-text').trim(),
        };
    `, selector);
    if (!surface.token || ['transparent', 'rgba(0, 0, 0, 0)'].includes(surface.background)) {
        throw new Error(`desktop-theme-style-missing:${selector}:${JSON.stringify(surface)}`);
    }
    return surface;
};

const assertViewportOverlay = async (driver, selector, { fixed = false } = {}) => {
    await waitForVisible(driver, selector);
    const geometry = await driver.executeScript(`
        const node = document.querySelector(arguments[0]);
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
            position: style.position,
            display: style.display,
            visibility: style.visibility,
            width: rect.width,
            height: rect.height,
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
        };
    `, selector);
    const positioned = fixed ? geometry?.position === 'fixed' : ['absolute', 'fixed'].includes(geometry?.position);
    const insideViewport = geometry
        && geometry.width > 0
        && geometry.height > 0
        && geometry.left >= -1
        && geometry.top >= -1
        && geometry.right <= geometry.viewportWidth + 1
        && geometry.bottom <= geometry.viewportHeight + 1;
    if (!positioned || geometry?.display === 'none' || geometry?.visibility === 'hidden' || !insideViewport) {
        throw new Error(`desktop-overlay-layout-invalid:${selector}:${JSON.stringify(geometry)}`);
    }
    return geometry;
};

const desktopCodecAssets = async () => {
    const assetsDirectory = path.join(root, 'dist-desktop', 'assets');
    const entries = await readdir(assetsDirectory, { withFileTypes: true }).catch(() => null);
    if (!entries) throw new Error('desktop-codec-assets-missing');
    const names = entries.filter((entry) => entry.isFile()).map(({ name }) => name);
    return Object.fromEntries(desktopCodecArtifacts.map(({ id, worker, wasm }) => {
        const workers = names.filter((name) => worker.test(name));
        const wasmFiles = names.filter((name) => wasm.test(name));
        if (workers.length !== 1 || wasmFiles.length !== 1) throw new Error(`desktop-codec-assets-invalid:${id}`);
        return [id, { format: id, worker: workers[0], wasm: wasmFiles[0] }];
    }));
};

const resolveExecutable = async (name) => {
    const candidates = path.isAbsolute(name) || name.includes(path.sep)
        ? [path.resolve(root, name)]
        : (process.env.PATH || '').split(path.delimiter).filter(Boolean).map((entry) => path.join(entry, name));
    for (const candidate of candidates) {
        const executable = await access(candidate, constants.X_OK).then(() => true, () => false);
        if (executable) return candidate;
    }
    throw new Error(`executable-not-found:${name}`);
};

const assertPort = (value, label) => {
    if (!Number.isInteger(value) || value < 1024 || value > 65535) {
        throw new Error(`${label}-invalid`);
    }
};

const waitForPort = async (targetPort, processHandle, timeoutMs = 20_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (processHandle.exitCode !== null) throw new Error(`desktop-automation-exited:${processHandle.exitCode}`);
        const connected = await new Promise((resolve) => {
            const socket = net.createConnection({ host: '127.0.0.1', port: targetPort });
            socket.setTimeout(250);
            socket.once('connect', () => {
                socket.destroy();
                resolve(true);
            });
            const close = () => {
                socket.destroy();
                resolve(false);
            };
            socket.once('error', close);
            socket.once('timeout', close);
        });
        if (connected) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('desktop-automation-start-timeout');
};

const waitForChildExit = (child, timeoutMs = 10_000) => new Promise((resolve, reject) => {
    let output = '';
    const append = (chunk) => { output = `${output}${chunk}`.slice(-4_096); };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('secondary-instance-timeout'));
    }, timeoutMs);
    child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
    });
    child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal, output });
    });
});

assertPort(port, 'tauri-driver-port');
if (!['official', 'embedded'].includes(driverProvider)) throw new Error('desktop-driver-provider-invalid');
if (!useEmbeddedDriver) assertPort(nativePort, 'native-driver-port');
await access(application, constants.X_OK);
const codecAssets = await desktopCodecAssets();
const driverBinary = useEmbeddedDriver
    ? null
    : await resolveExecutable(process.env.SCREENHELLO_TAURI_DRIVER || 'tauri-driver');
const nativeDriver = useEmbeddedDriver
    ? null
    : await resolveExecutable(process.env.SCREENHELLO_NATIVE_DRIVER || process.env.SCREENHELLO_WEBKIT_DRIVER || 'WebKitWebDriver');
const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'screenhello-runtime-'));
const runtimeEnvironment = {
    ...process.env,
    ...(useEmbeddedDriver ? { TAURI_WEBDRIVER_PORT: String(port), SCREENHELLO_TEST_DRIVER_RUN: 'runner-only' } : {}),
    XDG_CACHE_HOME: path.join(runtimeRoot, 'cache'),
    XDG_CONFIG_HOME: path.join(runtimeRoot, 'config'),
    XDG_DATA_HOME: path.join(runtimeRoot, 'data'),
};
await Promise.all([
    mkdir(runtimeEnvironment.XDG_CACHE_HOME, { recursive: true }),
    mkdir(runtimeEnvironment.XDG_CONFIG_HOME, { recursive: true }),
    mkdir(runtimeEnvironment.XDG_DATA_HOME, { recursive: true }),
]);

const automationProcess = useEmbeddedDriver
    ? spawn(application, [], {
        cwd: root,
        env: runtimeEnvironment,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
    })
    : spawn(driverBinary, [
        '--port', String(port),
        '--native-port', String(nativePort),
        '--native-driver', nativeDriver,
    ], {
    cwd: root,
    env: runtimeEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
});

let driver;
let secondInstance;
let driverOutput = '';
let stage = 'driver-start';
const appendOutput = (chunk) => {
    driverOutput = `${driverOutput}${chunk}`.slice(-16_384);
};
automationProcess.stdout.on('data', appendOutput);
automationProcess.stderr.on('data', appendOutput);
const driverStartError = new Promise((_, reject) => automationProcess.once('error', reject));

try {
    await Promise.race([waitForPort(port, automationProcess), driverStartError]);

    stage = 'session-create';
    const capabilities = new Capabilities();
    if (useEmbeddedDriver) capabilities.setBrowserName('tauri');
    else {
        capabilities.set('tauri:options', { application });
        capabilities.setBrowserName('wry');
    }
    driver = await createDesktopSession({
        embedded: useEmbeddedDriver,
        processHandle: automationProcess,
        createSession: () => new Builder()
            .withCapabilities(capabilities)
            .usingServer(`http://127.0.0.1:${port}/`)
            .build(),
    });

    stage = 'runtime-ready';
    const status = await driver.wait(until.elementLocated(By.css('[data-testid="desktop-runtime-status"]')), 30_000);
    await driver.wait(async () => await status.getAttribute('data-status') === 'ready', 20_000);
    await driver.wait(async () => ['initialized', 'ready', 'migrated'].includes(
        await status.getAttribute('data-state-migration'),
    ), 20_000);

    stage = 'system-integrations-ready';
    await driver.wait(async () => await status.getAttribute('data-single-instance') === 'ready', 20_000);
    const shortcutStatus = await status.getAttribute('data-shortcut');
    const trayStatus = await status.getAttribute('data-tray');
    if (shortcutStatus !== 'registered') throw new Error(`desktop-global-shortcut-${shortcutStatus || 'missing'}`);
    if (trayStatus !== 'ready') throw new Error(`desktop-tray-${trayStatus || 'missing'}`);

    stage = 'single-instance';
    secondInstance = spawn(application, ['--screenhello-single-instance-probe'], {
        cwd: root,
        env: runtimeEnvironment,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const secondary = await waitForChildExit(secondInstance);
    secondInstance = null;
    if (secondary.code !== 0 || secondary.signal) {
        throw new Error(`desktop-secondary-instance-failed:${secondary.code}:${secondary.signal}:${secondary.output}`);
    }
    await driver.wait(async () => await status.getAttribute('data-status') === 'ready', 5_000);

    stage = 'codec-workers';
    await driver.manage().setTimeouts({ script: 180_000 });
    const codecs = await driver.executeAsyncScript(`
        const descriptors = arguments[0];
        const formats = arguments[1];
        const done = arguments[arguments.length - 1];
        // This is the 1×1 RGBA fixture shape generated by
        // tests/fixtures/createPngFixture.js, including valid chunk CRCs.
        const pngBytes = () => Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGN4Ye32HwAF4QJp2Djw+gAAAABJRU5ErkJggg=='), (character) => character.charCodeAt(0));
        const hasAscii = (bytes, offset, value) => value.split('').every((character, index) => bytes[offset + index] === character.charCodeAt(0));
        const validOutput = (format, buffer) => {
            if (!(buffer instanceof ArrayBuffer)) return false;
            const bytes = new Uint8Array(buffer);
            if (format === 'avif') return bytes.length >= 16 && hasAscii(bytes, 4, 'ftyp')
                && (hasAscii(bytes, 8, 'avif') || hasAscii(bytes, 8, 'avis'));
            if (format === 'webp') return bytes.length >= 12 && hasAscii(bytes, 0, 'RIFF') && hasAscii(bytes, 8, 'WEBP');
            return bytes.length >= 33 && bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])
                && new DataView(buffer).getUint32(16) === 1 && new DataView(buffer).getUint32(20) === 1;
        };
        const run = (descriptor) => new Promise((resolve) => {
            const workerUrl = new URL('assets/' + descriptor.worker, window.location.href).href;
            const wasmUrl = new URL('assets/' + descriptor.wasm, window.location.href).href;
            let worker;
            let settled = false;
            const finish = (result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                worker?.terminate();
                resolve(result);
            };
            const timeout = setTimeout(() => finish({ format: descriptor.format, ok: false, error: 'codec-worker-timeout' }), 90_000);
            try {
                worker = new Worker(workerUrl, { type: 'module', name: 'screenhello-codec-smoke-' + descriptor.format });
                worker.onerror = (event) => finish({
                    format: descriptor.format,
                    ok: false,
                    error: String(event?.message || event?.error || 'codec-worker-error').slice(0, 160),
                });
                worker.onmessageerror = () => finish({ format: descriptor.format, ok: false, error: 'codec-worker-message-error' });
                worker.onmessage = ({ data }) => {
                    const ok = data?.ok === true && validOutput(descriptor.format, data.buffer);
                    finish({
                        format: descriptor.format,
                        ok,
                        ...(ok ? {} : { error: String(data?.message || 'codec-output-invalid').slice(0, 160) }),
                    });
                };
                if (descriptor.format === 'png') {
                    const buffer = pngBytes().buffer;
                    worker.postMessage({ id: descriptor.format, format: 'png', compression: 'lossless', ratio: 1, width: 1, height: 1, buffer, wasmUrl }, [buffer]);
                } else {
                    const pixels = new Uint8Array([24, 132, 210, 255]).buffer;
                    worker.postMessage({ id: descriptor.format, format: descriptor.format, ratio: 1, width: 1, height: 1, pixels, wasmUrl }, [pixels]);
                }
            } catch (error) {
                finish({ format: descriptor.format, ok: false, error: String(error?.message || error).slice(0, 160) });
            }
        });
        (async () => {
            try {
                const results = [];
                for (const format of formats) results.push(await run(descriptors[format]));
                done({
                    ok: results.length === 3 && results.every((result) => result.ok),
                    formats: results.filter((result) => result.ok).map(({ format }) => format),
                    resourceProtocol: new URL(window.location.href).protocol,
                    results,
                });
            } catch (error) {
                done({ ok: false, formats: [], error: String(error?.message || error).slice(0, 160) });
            }
        })();
    `, codecAssets, expectedCodecFormats);
    if (!codecs?.ok
        || JSON.stringify(codecs.formats) !== JSON.stringify(expectedCodecFormats)
        || !['http:', 'https:', 'tauri:'].includes(codecs.resourceProtocol)) {
        throw new Error(`desktop-codec-worker-smoke-failed:${JSON.stringify(codecs)}`);
    }

    stage = 'capture-capability';
    const captureCapability = await driver.executeAsyncScript(`
        const done = arguments[arguments.length - 1];
        (async () => {
            try {
                const value = await window.__TAURI_INTERNALS__.invoke('desktop_capture_capability');
                done(value);
            } catch {
                done(null);
            }
        })();
    `);
    if (!validCaptureCapability(captureCapability)) {
        throw new Error('desktop-capture-capability-invalid');
    }

    stage = 'state-migration';
    const stateMigration = await driver.executeAsyncScript(`
        const done = arguments[arguments.length - 1];
        (async () => {
            try {
                done(await window.__TAURI_INTERNALS__.invoke('desktop_state_status'));
            } catch {
                done(null);
            }
        })();
    `);
    if (!validDesktopState(stateMigration) || stateMigration.status === 'unavailable') {
        throw new Error('desktop-state-migration-invalid');
    }

    stage = 'capture-permission-probe';
    const consentRequired = await driver.executeAsyncScript(`
        const done = arguments[arguments.length - 1];
        (async () => {
            const invoke = window.__TAURI_INTERNALS__.invoke;
            const results = [];
            for (const command of ['desktop_list_capture_sources', 'desktop_capture_primary']) {
                try { await invoke(command); results.push('unexpected-success'); }
                catch (error) { results.push(String(error)); }
            }
            done(results);
        })();
    `);
    if (consentRequired?.length !== 2 || consentRequired.some((code) => code !== 'desktop-capture-consent-required')) {
        throw new Error('desktop-capture-permission-boundary-failed');
    }

    let nativeCapture = null;
    let captureSourceCount = 0;
    const interactiveCapture = process.env.SCREENHELLO_DESKTOP_CAPTURE_INTERACTIVE === '1';
    if (interactiveCapture) {
    // A human/native UI automation must approve both OS prompts. No IPC bypass.
    await driver.manage().setTimeouts({ script: 120_000 });
    stage = 'capture-native-probe';
    nativeCapture = await driver.executeAsyncScript(`
        const done = arguments[arguments.length - 1];
        (async () => {
            const invoke = window.__TAURI_INTERNALS__?.invoke;
            let result;
            try {
                if (typeof invoke !== 'function') throw new Error('native-invoke-missing');
                const response = await invoke('desktop_list_capture_sources', { requestConsent: true });
                const source = response?.sources?.find((item) => item.kind === 'monitor' && item.primary)
                    || response?.sources?.find((item) => item.kind === 'monitor');
                if (!source) throw new Error('native-monitor-missing');
                const width = Math.min(640, source.width);
                const height = Math.min(480, source.height);
                const value = await invoke('desktop_capture_source', {
                    token: source.token,
                    region: { x: 0, y: 0, width, height },
                });
                const bytes = value instanceof ArrayBuffer
                    ? new Uint8Array(value)
                    : (ArrayBuffer.isView(value)
                        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
                        : null);
                if (!bytes || bytes.byteLength < 24) throw new Error('native-capture-invalid');
                const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                result = {
                    ok: true,
                    width: view.getUint32(16),
                    height: view.getUint32(20),
                    bytes: bytes.byteLength,
                };
            } catch (error) {
                result = { ok: false, error: String(error?.message || error).slice(0, 160) };
            }
            try { await invoke?.('desktop_release_capture_sources'); } catch {}
            done(result);
        })();
    `);
    if (!nativeCapture?.ok
        || nativeCapture.width !== 640
        || nativeCapture.height !== 480
        || nativeCapture.bytes < 24
        || nativeCapture.bytes > 48 * 1024 * 1024) {
        throw new Error(`desktop-native-capture-invalid:${JSON.stringify(nativeCapture)}`);
    }

    stage = 'capture-menu';
    const imageLayersBeforeCapture = await driver.executeScript("return document.querySelectorAll('[data-layer-name]').length");
    const fileMenu = await driver.findElement(By.xpath("//button[contains(@class,'shoteasy-app-menu__trigger') and normalize-space()='文件']"));
    await fileMenu.click();
    await driver.wait(until.elementLocated(By.css('.shoteasy-command-menu--file')), 5_000);
    const captureMenuItem = await driver.findElement(By.xpath("//div[contains(@class,'shoteasy-command-menu--file')]//*[@role='menuitem'][contains(.,'截取屏幕')]"));
    await captureMenuItem.click();
    stage = 'capture-dialog-open';
    await driver.wait(until.elementLocated(By.css('.shoteasy-capture-dialog .ant-modal')), 20_000);
    stage = 'capture-source-list';
    captureSourceCount = await driver.wait(async () => {
        const count = await driver.executeScript("return document.querySelectorAll('.shoteasy-capture-dialog input[type=radio]').length");
        return count > 0 ? count : false;
    }, 120_000);
    stage = 'capture-region-mode';
    await driver.executeScript(`
        const modal = document.querySelector('.shoteasy-capture-dialog');
        const region = Array.from(modal?.querySelectorAll('label') || [])
            .find((element) => (element.textContent || '').includes('指定区域'));
        if (!region) throw new Error('desktop-capture-region-control-missing');
        region.click();
    `);
    stage = 'capture-region-input';
    const widthInput = await driver.wait(until.elementLocated(By.css('input[aria-label="区域宽度"]')), 5_000);
    const heightInput = await driver.findElement(By.css('input[aria-label="区域高度"]'));
    await widthInput.clear();
    await widthInput.sendKeys('640');
    await heightInput.clear();
    await heightInput.sendKeys('480');
    const submitCapture = await driver.findElement(By.xpath("//div[contains(@class,'shoteasy-capture-dialog')]//button[.//span[normalize-space()='截取并添加'] or normalize-space()='截取并添加']"));
    stage = 'capture-submit';
    await submitCapture.click();
    await driver.wait(async () => !(await driver.findElements(By.css('.shoteasy-capture-dialog .ant-modal'))).length, 30_000);
    await driver.wait(async () => {
        const count = await driver.executeScript("return document.querySelectorAll('[data-layer-name]').length");
        return count > imageLayersBeforeCapture;
    }, 20_000);

    }
    stage = 'demo-load';
    await driver.wait(async () => await driver.executeScript(`
        const copy = document.querySelector('button[aria-label="复制图片"]');
        if (copy && !copy.disabled) return true;
        const demo = document.querySelector('button.shoteasy-demo-button, button.shoteasy-demo-card');
        if (demo && !window.__screenhelloDemoRequested) {
            window.__screenhelloDemoRequested = true;
            demo.click();
        }
        return false;
    `), 20_000);

    // The desktop WebView must verify geometry, not merely that Ant Design
    // portals exist in the DOM. Without the static layer CSS, each element
    // below is present but renders in ordinary document flow and becomes
    // effectively unusable (the exact class of regression users reported).
    stage = 'desktop-overlay-layout';
    const overlayLayouts = {};
    const desktopChrome = await driver.executeScript(`
        const brand = document.querySelector('.shoteasy-desktop-app .shoteasy-topbar__brand');
        const menu = document.querySelector('.shoteasy-desktop-app .shoteasy-app-menu');
        const privacy = document.querySelector('.shoteasy-desktop-app .shoteasy-privacy-badge');
        const menuRect = menu?.getBoundingClientRect();
        return {
            inWebBrandDisplay: brand ? getComputedStyle(brand).display : null,
            menuLeft: menuRect?.left ?? null,
            privacyLabel: privacy?.getAttribute('aria-label') ?? null,
            privacyFlagged: privacy?.classList.contains('is-flagged') ?? null,
        };
    `);
    // The native title bar owns the application name and window controls. The
    // WebView must not render a second brand beside the menu bar. A fresh
    // isolated profile must also remain clean after local Tauri resource IPC.
    if (desktopChrome.inWebBrandDisplay !== 'none' || desktopChrome.menuLeft == null || desktopChrome.menuLeft < 0) {
        throw new Error(`desktop-chrome-layout-invalid:${JSON.stringify(desktopChrome)}`);
    }
    if (desktopChrome.privacyFlagged || !desktopChrome.privacyLabel?.endsWith('0 B')) {
        throw new Error(`desktop-privacy-local-ipc-invalid:${JSON.stringify(desktopChrome)}`);
    }
    stage = 'desktop-file-menu-layout';
    const fileMenu = await driver.findElement(By.xpath("//button[contains(@class,'shoteasy-app-menu__trigger') and normalize-space()='文件']"));
    await fileMenu.click();
    overlayLayouts.menu = await assertViewportOverlay(driver, '.shoteasy-command-menu--file');
    overlayLayouts.menuSurface = await assertThemedSurface(driver, '.shoteasy-command-menu--file .ant-dropdown-menu');
    await fileMenu.click();

    const sizeTrigger = await driver.findElement(By.css('button[aria-label="选择画布尺寸"]'));
    stage = 'desktop-size-popover-layout';
    await sizeTrigger.click();
    overlayLayouts.sizePopover = await assertViewportOverlay(driver, '.shoteasy-size-overlay');
    overlayLayouts.sizeSurface = await assertThemedSurface(driver, '.shoteasy-size-overlay .ant-popover-container');
    await sizeTrigger.click();

    const browserFrame = await driver.findElement(By.css('.shoteasy-frame-option input[value="macosBarLight"]'));
    stage = 'desktop-browser-url-edit';
    await driver.executeScript('arguments[0].click()', browserFrame);
    const browserUrl = await waitForVisible(driver, 'input[aria-label="浏览器地址栏 URL"]');
    await browserUrl.clear();
    await browserUrl.sendKeys('https://example.com/desktop-preview');
    if (await browserUrl.getAttribute('value') !== 'https://example.com/desktop-preview') {
        throw new Error('desktop-browser-address-input-not-editable');
    }

    const cropButton = await driver.findElement(By.css('button[aria-label="裁剪图片"]'));
    stage = 'desktop-crop-modal-layout';
    await cropButton.click();
    overlayLayouts.cropModal = await assertViewportOverlay(driver, '.shoteasy-cropper-modal .ant-modal-wrap', { fixed: true });
    const cropClose = await driver.findElement(By.css('.shoteasy-cropper-modal .ant-modal-close'));
    stage = 'desktop-crop-modal-close';
    await cropClose.click();
    await driver.wait(async () => !(await driver.findElements(By.css('.shoteasy-cropper-modal .ant-modal-wrap'))).length, 10_000);

    const exportButton = await driver.findElement(By.css('button[aria-label="导出图片"]'));
    stage = 'desktop-export-drawer-layout';
    await exportButton.click();
    overlayLayouts.exportDrawer = await assertViewportOverlay(driver, '.shoteasy-export-overlay.ant-drawer', { fixed: true });
    overlayLayouts.exportContent = await assertViewportOverlay(driver, '.shoteasy-export-overlay .ant-drawer-content-wrapper');
    // The footer action is a regular user-visible control. WebKit's native
    // driver can report the decorative header glyph as non-interactable while
    // the drawer is entering, so use the semantic Cancel action to prove that
    // a user can close the fully laid-out panel.
    overlayLayouts.exportSurface = await assertThemedSurface(driver, '.shoteasy-export-overlay .ant-drawer-section');
    const exportCancel = await waitForVisible(driver, '[data-testid="export-cancel"]');
    stage = 'desktop-export-drawer-close';
    await exportCancel.click();
    await driver.wait(async () => !(await driver.findElements(By.css('.shoteasy-export-overlay.ant-drawer'))).length, 10_000);

    stage = 'clipboard-write';
    await driver.executeScript(`
        window.__screenhelloDesktopMessages = [];
        window.__screenhelloDesktopMessageObserver?.disconnect();
        const recordMessages = () => {
            for (const element of document.querySelectorAll('.ant-message-notice-content')) {
                const text = element.textContent || '';
                if (text && !window.__screenhelloDesktopMessages.includes(text)) {
                    window.__screenhelloDesktopMessages.push(text);
                }
            }
            const bodyText = document.body.innerText || '';
            for (const expected of ['正在复制', '复制成功', '复制失败']) {
                if (bodyText.includes(expected) && !window.__screenhelloDesktopMessages.includes(expected)) {
                    window.__screenhelloDesktopMessages.push(expected);
                }
            }
        };
        window.__screenhelloDesktopMessageObserver = new MutationObserver(recordMessages);
        window.__screenhelloDesktopMessageObserver.observe(document.body, { childList: true, subtree: true });
        recordMessages();
    `);
    const copy = await driver.findElement(By.css('button[aria-label="复制图片"]'));
    await copy.click();
    const clipboardMessage = await driver.wait(async () => {
        const messages = await driver.executeScript('return window.__screenhelloDesktopMessages || []');
        return messages.find((message) => message.includes('复制成功') || message.includes('复制失败')) || false;
    }, 30_000);
    await driver.executeScript('window.__screenhelloDesktopMessageObserver?.disconnect()');
    if (!clipboardMessage.includes('复制成功')) throw new Error('desktop-clipboard-image-write-failed');

    // Optional native close probe; no production IPC close permission is added.
    // The helper must send the platform's ordinary window-close request.
    const closeHelper = process.env.SCREENHELLO_DESKTOP_CLOSE_HELPER;
    if (closeHelper) {
        stage = 'native-close-cancel';
        const executable = await resolveExecutable(closeHelper);
        await new Promise((resolve, reject) => {
            const child = spawn(executable, [], { env: runtimeEnvironment, stdio: 'inherit' });
            child.once('error', reject);
            child.once('exit', code => code === 0 ? resolve() : reject(new Error(`desktop-close-helper-failed:${code}`)));
        });
        const dialog = await waitForVisible(driver, '.shoteasy-workspace-guard [role="dialog"]');
        if (!(await dialog.getText()).includes('退出 ScreenHello')) throw new Error('desktop-exit-guard-missing');
        const cancel = await dialog.findElement(By.xpath('.//button[normalize-space(.)="取 消" or normalize-space(.)="取消"]'));
        await cancel.click();
        await driver.wait(async () => !(await driver.findElements(By.css('.shoteasy-workspace-guard'))).length, 10_000);
        if (await driver.getTitle() !== 'ScreenHello Desktop') throw new Error('desktop-close-cancel-lost-window');
        console.log('Native close -> unsaved guard -> cancel: passed');
    }

    const result = {
        title: await driver.getTitle(),
        status: await status.getAttribute('data-status'),
        platform: await status.getAttribute('data-platform'),
        arch: await status.getAttribute('data-arch'),
        label: await status.getText(),
        manifestLinks: await driver.executeScript("return document.querySelectorAll('link[rel=manifest]').length"),
        rootChildren: await driver.executeScript("return document.querySelector('#root')?.childElementCount ?? 0"),
        clipboardImage: 'written',
        capturePermissionBoundary: 'enforced',
        codecs: {
            status: 'passed',
            formats: codecs.formats,
            resourceProtocol: codecs.resourceProtocol,
        },
        captureCapability,
        stateMigration,
        capture: nativeCapture ? {
            status: 'passed',
            sources: captureSourceCount,
            width: nativeCapture.width,
            height: nativeCapture.height,
            bytes: nativeCapture.bytes,
            imported: true,
        } : { status: 'manual', reason: 'Native consent was not exercised; no capture success is claimed.' },
        editorImport: 'passed',
        desktopChrome,
        overlays: { status: 'passed', layouts: overlayLayouts },
        shortcut: shortcutStatus,
        tray: trayStatus,
        singleInstance: 'enforced',
        durationMs: Math.max(1, Date.now() - runtimeStartedAt),
    };

    if (result.title !== 'ScreenHello Desktop') throw new Error('desktop-title-invalid');
    if (result.status !== 'ready') throw new Error('desktop-ipc-not-ready');
    if (!expectedPlatform || result.platform !== expectedPlatform) throw new Error('desktop-platform-invalid');
    if (!result.arch || result.arch.length > 64) throw new Error('desktop-arch-invalid');
    if (!result.label.includes('桌面')) throw new Error('desktop-status-label-invalid');
    if (result.manifestLinks !== 0) throw new Error('desktop-pwa-manifest-present');
    if (result.rootChildren < 1) throw new Error('desktop-editor-not-mounted');
    if (result.clipboardImage !== 'written') throw new Error('desktop-clipboard-image-not-written');
    if (result.editorImport !== 'passed') throw new Error('desktop-editor-import-not-written');
    if (result.desktopChrome.inWebBrandDisplay !== 'none' || result.desktopChrome.privacyFlagged) {
        throw new Error('desktop-chrome-layout-invalid');
    }
    if (result.overlays.status !== 'passed') throw new Error('desktop-overlay-layout-invalid');
    if (result.codecs.status !== 'passed' || JSON.stringify(result.codecs.formats) !== JSON.stringify(expectedCodecFormats)) {
        throw new Error('desktop-codec-worker-smoke-invalid');
    }
    if (!validCaptureCapability(result.captureCapability)) {
        throw new Error('desktop-capture-capability-invalid');
    }
    if (!validDesktopState(result.stateMigration) || result.stateMigration.status === 'unavailable') {
        throw new Error('desktop-state-migration-invalid');
    }

    const screenshotTarget = process.env.SCREENHELLO_DESKTOP_SCREENSHOT;
    if (screenshotTarget) {
        const absoluteScreenshot = path.resolve(root, screenshotTarget);
        await mkdir(path.dirname(absoluteScreenshot), { recursive: true });
        await writeFile(absoluteScreenshot, await driver.takeScreenshot(), 'base64');
        result.screenshot = path.relative(root, absoluteScreenshot);
    }

    const runtimeEvidenceTarget = process.env.SCREENHELLO_DESKTOP_RUNTIME_EVIDENCE;
    if (runtimeEvidenceTarget) {
        const absoluteEvidence = path.resolve(root, runtimeEvidenceTarget);
        await mkdir(path.dirname(absoluteEvidence), { recursive: true });
        await writeFile(absoluteEvidence, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }

    console.log(JSON.stringify(result, null, 2));
} catch (error) {
    let pageState = null;
    if (driver) {
        pageState = await driver.executeScript(`return {
            messages: Array.from(document.querySelectorAll('.ant-message-notice-content')).map((element) => element.textContent),
            observedMessages: window.__screenhelloDesktopMessages || [],
            copyDisabled: document.querySelector('button[aria-label="复制图片"]')?.disabled ?? null,
            imageLayers: document.querySelectorAll('[data-layer-name]').length,
            desktopStatus: document.querySelector('[data-testid="desktop-runtime-status"]')?.getAttribute('data-status') ?? null,
            captureDialogText: document.querySelector('.shoteasy-capture-dialog')?.textContent?.slice(0, 1000) ?? null,
            captureSourceRadios: document.querySelectorAll('.shoteasy-capture-dialog input[type=radio]').length,
            commandMenuText: document.querySelector('.shoteasy-command-menu--file')?.textContent?.slice(0, 1000) ?? null,
            overlays: Array.from(document.querySelectorAll('.shoteasy-command-menu, .shoteasy-size-overlay, .shoteasy-cropper-modal, .shoteasy-export-overlay')).slice(0, 12).map((node) => ({
                className: node.className,
                display: getComputedStyle(node).display,
                visibility: getComputedStyle(node).visibility,
                width: node.getBoundingClientRect().width,
                height: node.getBoundingClientRect().height,
            })),
        }`).catch(() => null);
    }
    process.stderr.write(`${JSON.stringify({ stage, pageState })}\n`);
    // Failed runs must retain useful diagnostics without writing a successful
    // runtime.json or substituting a failure image for the acceptance screenshot.
    if (driver && process.env.SCREENHELLO_DESKTOP_SCREENSHOT) {
        try {
            const directory = path.dirname(path.resolve(root, process.env.SCREENHELLO_DESKTOP_SCREENSHOT));
            await mkdir(directory, { recursive: true });
            await writeFile(path.join(directory, 'runtime-failure.json'), JSON.stringify({ stage, error: error.message, pageState }, null, 2));
            await writeFile(path.join(directory, 'runtime-failure.png'), await driver.takeScreenshot(), 'base64');
        } catch (diagnosticError) {
            process.stderr.write(`desktop-failure-diagnostics-unavailable:${diagnosticError.message}\n`);
        }
    }
    if (driverOutput) process.stderr.write(driverOutput);
    throw error;
} finally {
    if (secondInstance?.exitCode === null) secondInstance.kill('SIGKILL');
    // The embedded provider is the application itself, so its ChildProcess handle
    // is the lifetime owner. The Linux official driver owns a dedicated process
    // group so its native driver and application descendants are also bounded.
    if ((useEmbeddedDriver || process.platform === 'win32') && driver) {
        await Promise.race([driver.quit().catch(() => {}), delay(shutdownGraceMs)]);
    }
    await stopDesktopAutomation(automationProcess, {
        useProcessGroup: !useEmbeddedDriver && process.platform !== 'win32',
    });
    await rm(runtimeRoot, { recursive: true, force: true });
}
