import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { Builder, By, Capabilities, until } from 'selenium-webdriver';
import { stopDesktopAutomation } from './desktop-process-tree.mjs';

const root = process.cwd();
const applicationName = process.platform === 'win32' ? 'screenhello-desktop.exe' : 'screenhello-desktop';
const application = path.resolve(
    root,
    process.env.SCREENHELLO_DESKTOP_APPLICATION
        || path.join('src-tauri', 'target', 'release', applicationName),
);
const driverProvider = process.env.SCREENHELLO_DESKTOP_DRIVER_PROVIDER || 'official';
const useEmbeddedDriver = driverProvider === 'embedded';
const port = Number.parseInt(process.env.SCREENHELLO_TAURI_DRIVER_PORT || '4445', 10);
const nativePort = Number.parseInt(process.env.SCREENHELLO_WEBKIT_DRIVER_PORT || '4446', 10);
const shutdownGraceMs = 5_000;
const runtimeStartedAt = Date.now();

const delay = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

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
const driverBinary = useEmbeddedDriver
    ? null
    : await resolveExecutable(process.env.SCREENHELLO_TAURI_DRIVER || 'tauri-driver');
const nativeDriver = useEmbeddedDriver
    ? null
    : await resolveExecutable(process.env.SCREENHELLO_NATIVE_DRIVER || process.env.SCREENHELLO_WEBKIT_DRIVER || 'WebKitWebDriver');
const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'screenhello-runtime-'));
const runtimeEnvironment = {
    ...process.env,
    ...(useEmbeddedDriver ? { TAURI_WEBDRIVER_PORT: String(port) } : {}),
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
    driver = await new Builder()
        .withCapabilities(capabilities)
        .usingServer(`http://127.0.0.1:${port}/`)
        .build();

    stage = 'runtime-ready';
    const status = await driver.wait(until.elementLocated(By.css('[data-testid="desktop-runtime-status"]')), 30_000);
    await driver.wait(async () => await status.getAttribute('data-status') === 'ready', 20_000);

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

    stage = 'capture-native-probe';
    const nativeCapture = await driver.executeAsyncScript(`
        const done = arguments[arguments.length - 1];
        (async () => {
            const invoke = window.__TAURI_INTERNALS__?.invoke;
            let result;
            try {
                if (typeof invoke !== 'function') throw new Error('native-invoke-missing');
                const response = await invoke('desktop_list_capture_sources');
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
    const captureSourceCount = await driver.wait(async () => {
        const count = await driver.executeScript("return document.querySelectorAll('.shoteasy-capture-dialog input[type=radio]').length");
        return count > 0 ? count : false;
    }, 20_000);
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

    stage = 'demo-load';
    await driver.wait(async () => await driver.executeScript(`
        const copy = document.querySelector('button[aria-label="复制图片"]');
        if (copy && !copy.disabled) return true;
        const demo = document.querySelector('button.shoteasy-demo-card');
        if (demo && !window.__screenhelloDemoRequested) {
            window.__screenhelloDemoRequested = true;
            demo.click();
        }
        return false;
    `), 20_000);
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

    const result = {
        title: await driver.getTitle(),
        status: await status.getAttribute('data-status'),
        platform: await status.getAttribute('data-platform'),
        arch: await status.getAttribute('data-arch'),
        label: await status.getText(),
        manifestLinks: await driver.executeScript("return document.querySelectorAll('link[rel=manifest]').length"),
        rootChildren: await driver.executeScript("return document.querySelector('#root')?.childElementCount ?? 0"),
        clipboardImage: 'written',
        capture: {
            sources: captureSourceCount,
            width: nativeCapture.width,
            height: nativeCapture.height,
            bytes: nativeCapture.bytes,
            imported: true,
        },
        shortcut: shortcutStatus,
        tray: trayStatus,
        singleInstance: 'enforced',
        durationMs: Math.max(1, Date.now() - runtimeStartedAt),
    };

    if (result.title !== 'ScreenHello Desktop') throw new Error('desktop-title-invalid');
    if (result.status !== 'ready') throw new Error('desktop-ipc-not-ready');
    const expectedPlatform = process.env.SCREENHELLO_EXPECTED_DESKTOP_PLATFORM
        || ({ darwin: 'macos', linux: 'linux', win32: 'windows' })[process.platform];
    if (!expectedPlatform || result.platform !== expectedPlatform) throw new Error('desktop-platform-invalid');
    if (!result.arch || result.arch.length > 64) throw new Error('desktop-arch-invalid');
    if (!result.label.includes('桌面')) throw new Error('desktop-status-label-invalid');
    if (result.manifestLinks !== 0) throw new Error('desktop-pwa-manifest-present');
    if (result.rootChildren < 1) throw new Error('desktop-editor-not-mounted');
    if (result.clipboardImage !== 'written') throw new Error('desktop-clipboard-image-not-written');

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
        }`).catch(() => null);
    }
    process.stderr.write(`${JSON.stringify({ stage, pageState })}\n`);
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
