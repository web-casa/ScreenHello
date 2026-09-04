import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const read = (repositoryPath) => readFile(path.join(root, repositoryPath), 'utf8');
const parseJson = async (repositoryPath) => JSON.parse(await read(repositoryPath));

const packageJson = await parseJson('package.json');
const config = await parseJson('src-tauri/tauri.conf.json');
const releaseConfig = await parseJson('src-tauri/tauri.phase9.conf.json');
const capability = await parseJson('src-tauri/capabilities/main.json');
const cargoToml = await read('src-tauri/Cargo.toml');
const buildScript = await read('src-tauri/build.rs');
const rustSource = await read('src-tauri/src/lib.rs');
const nativeFileSource = await read('src-tauri/src/native_files.rs');
const captureSource = await read('src-tauri/src/desktop_capture.rs');
const systemSource = await read('src-tauri/src/desktop_system.rs');

const expectEqual = (actual, expected, id) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(id);
};

expectEqual(packageJson.devDependencies?.['@tauri-apps/api'], '2.11.1', 'tauri-api-version-not-pinned');
expectEqual(packageJson.devDependencies?.['@tauri-apps/cli'], '2.11.4', 'tauri-cli-version-not-pinned');
expectEqual(packageJson.devDependencies?.['@tauri-apps/plugin-clipboard-manager'], '2.3.3', 'tauri-clipboard-version-not-pinned');
expectEqual(packageJson.scripts?.['desktop:web:dev'], 'cross-env SCREENHELLO_TARGET=desktop vite', 'desktop-dev-script-invalid');
expectEqual(packageJson.scripts?.['desktop:web:build'], 'cross-env SCREENHELLO_TARGET=desktop vite build', 'desktop-build-script-invalid');
expectEqual(packageJson.scripts?.['desktop:build'], 'tauri build --no-bundle --ci', 'desktop-native-build-script-invalid');
expectEqual(packageJson.scripts?.['desktop:test:runtime'], 'xvfb-run -a dbus-run-session -- node scripts/test-desktop-runtime.mjs', 'desktop-runtime-test-script-invalid');
expectEqual(config.build?.frontendDist, '../dist-desktop', 'desktop-frontend-dist-invalid');
expectEqual(config.build?.devUrl, 'http://localhost:1420', 'desktop-dev-url-invalid');
expectEqual(config.build?.removeUnusedCommands, true, 'desktop-unused-commands-not-removed');
expectEqual(config.app?.security?.capabilities, ['main-desktop'], 'desktop-capability-selection-invalid');
expectEqual(config.app?.windows?.map((window) => window.label), ['main'], 'desktop-window-list-not-minimal');
expectEqual(capability.windows, ['main'], 'desktop-capability-window-scope-invalid');
expectEqual(capability.platforms, ['linux', 'macOS', 'windows'], 'desktop-capability-platform-scope-invalid');
const expectedCommands = [
    'desktop_environment',
    'desktop_pick_files',
    'desktop_read_file',
    'desktop_choose_save_file',
    'desktop_write_file',
    'desktop_release_file',
    'desktop_list_capture_sources',
    'desktop_capture_source',
    'desktop_capture_primary',
    'desktop_release_capture_sources',
    'desktop_system_status',
    'desktop_subscribe_system_events',
    'desktop_unsubscribe_system_events',
];
const expectedPermissions = [
    'allow-desktop-environment',
    'allow-desktop-pick-files',
    'allow-desktop-read-file',
    'allow-desktop-choose-save-file',
    'allow-desktop-write-file',
    'allow-desktop-release-file',
    'allow-desktop-list-capture-sources',
    'allow-desktop-capture-source',
    'allow-desktop-capture-primary',
    'allow-desktop-release-capture-sources',
    'allow-desktop-system-status',
    'allow-desktop-subscribe-system-events',
    'allow-desktop-unsubscribe-system-events',
    'core:image:allow-from-bytes',
    'core:resources:allow-close',
    'clipboard-manager:allow-write-image',
];
expectEqual(capability.permissions, expectedPermissions, 'desktop-capability-permissions-not-minimal');
if ('remote' in capability) failures.push('desktop-capability-allows-remote-origin');
expectEqual(config.app?.windows?.[0]?.dragDropEnabled, false, 'desktop-html-drag-drop-not-preserved');
expectEqual(config.bundle?.active, false, 'desktop-bundling-must-remain-disabled-in-poc');
expectEqual(config.bundle?.icon, ['../public/pwa-512x512.png'], 'desktop-icon-source-invalid');
expectEqual(releaseConfig, { bundle: { active: true } }, 'desktop-release-config-must-only-enable-bundling');

const cspRequiredDirectives = [
    "default-src 'self'",
    'connect-src',
    'ipc:',
    'http://ipc.localhost',
    "script-src 'self'",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
];
const auditCsp = (value, allowedOrigins, id) => {
    const policy = String(value || '');
    for (const required of cspRequiredDirectives) {
        if (!policy.includes(required)) failures.push(`${id}-missing:${required}`);
    }
    const origins = [...policy.matchAll(/(?:https?|wss?):\/\/[a-z0-9.-]+(?::\d+)?/giu)].map(([origin]) => origin);
    if (origins.some((origin) => !allowedOrigins.includes(origin))) failures.push(`${id}-allows-remote-origin`);
};
auditCsp(config.app?.security?.csp, ['http://ipc.localhost', 'http://asset.localhost'], 'desktop-csp');
auditCsp(config.app?.security?.devCsp, [
    'http://ipc.localhost',
    'http://asset.localhost',
    'http://localhost:1420',
    'ws://localhost:1420',
], 'desktop-dev-csp');
if (config.app?.withGlobalTauri === true) failures.push('desktop-global-tauri-api-enabled');
const quotedValues = (source) => [...source.matchAll(/"([a-z][a-z0-9_-]+)"/gu)].map((match) => match[1]);
const manifestBlock = buildScript.match(/commands\(&\[(?<body>[\s\S]*?)\]\)/u)?.groups?.body || '';
const handlerBlock = rustSource.match(/generate_handler!\[(?<body>[\s\S]*?)\]\)/u)?.groups?.body || '';
expectEqual(quotedValues(manifestBlock), expectedCommands, 'desktop-command-permission-manifest-missing');
expectEqual(
    [...handlerBlock.matchAll(/(?:^|[\s,])(?:[a-z_]+::)?(desktop_[a-z_]+)/gu)].map((match) => match[1]),
    expectedCommands,
    'desktop-command-handler-missing',
);
for (const command of expectedCommands.slice(1, 6)) {
    if (!new RegExp(`#\\[tauri::command\\][\\s\\S]{0,120}fn ${command}\\b`, 'u').test(nativeFileSource)) {
        failures.push(`desktop-native-command-missing:${command}`);
    }
}
for (const command of expectedCommands.slice(6, 10)) {
    if (!new RegExp(`#\\[tauri::command\\][\\s\\S]{0,160}fn ${command}\\b`, 'u').test(captureSource)) {
        failures.push(`desktop-capture-command-missing:${command}`);
    }
}
for (const command of expectedCommands.slice(10)) {
    if (!new RegExp(`#\\[tauri::command\\][\\s\\S]{0,160}fn ${command}\\b`, 'u').test(systemSource)) {
        failures.push(`desktop-system-command-missing:${command}`);
    }
}
for (const pluginInit of ['tauri_plugin_dialog::init()', 'tauri_plugin_clipboard_manager::init()']) {
    if (!rustSource.includes(pluginInit)) failures.push(`desktop-plugin-init-missing:${pluginInit}`);
}
if (rustSource.indexOf('tauri_plugin_single_instance::init(') > rustSource.indexOf('tauri_plugin_dialog::init()')) {
    failures.push('desktop-single-instance-plugin-not-first');
}
for (const pluginInit of [
    'tauri_plugin_single_instance::init(',
    'tauri_plugin_global_shortcut::Builder::new().build()',
]) {
    if (!rustSource.includes(pluginInit)) failures.push(`desktop-plugin-init-missing:${pluginInit}`);
}
for (const forbidden of [
    'tauri-plugin-fs',
    'dialog:default',
    'clipboard-manager:default',
    'global-shortcut:default',
    'global-shortcut:allow-',
    'core:event:',
    'core:window:',
    'menu:default',
]) {
    if (cargoToml.includes(forbidden) || capability.permissions.includes(forbidden)) {
        failures.push(`desktop-overbroad-native-access:${forbidden}`);
    }
}
const pickedFileBlock = nativeFileSource.match(/struct PickedFile \{(?<body>[\s\S]*?)\n\}/u)?.groups?.body || '';
if (!pickedFileBlock || /\bpath\b/u.test(pickedFileBlock)) failures.push('desktop-picker-response-exposes-path');
const captureSourceBlock = captureSource.match(/struct CaptureSource \{(?<body>[\s\S]*?)\n\}/u)?.groups?.body || '';
if (!captureSourceBlock || /native_id|\bpid\b|app_name|\bpath\b/u.test(captureSourceBlock)) {
    failures.push('desktop-capture-response-exposes-native-detail');
}
for (const required of [
    'const MAX_MONITORS: usize = 16;',
    'const MAX_WINDOWS: usize = 128;',
    'const MAX_CAPTURE_PIXELS: u64 = 7_680 * 4_320;',
    'const MAX_CAPTURE_BYTES: usize = 48 * 1024 * 1024;',
    'operation_active: AtomicBool,',
    'compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)',
    'desktop-capture-busy',
    'Response::new(bytes)',
]) {
    if (!captureSource.includes(required)) failures.push(`desktop-capture-boundary-missing:${required}`);
}
if (/println!|dbg!|\.emit\s*\(/u.test(systemSource)
    || /(_args|_cwd)[\s\S]{0,80}(?:println|emit|send)/u.test(rustSource)) {
    failures.push('desktop-system-sensitive-data-forwarded');
}
for (const dependency of [
    'getrandom = "=0.3.4"',
    'tauri = { version = "=2.11.5", features = ["image-png", "tray-icon"] }',
    'tauri-build = { version = "=2.6.3", features = [] }',
    'tauri-plugin-clipboard-manager = "=2.3.3"',
    'tauri-plugin-dialog = "=2.7.3"',
    'tauri-plugin-global-shortcut = "=2.3.2"',
    'tauri-plugin-single-instance = "=2.4.4"',
    'tauri-plugin-wdio-webdriver = { version = "=1.3.0", optional = true }',
    'tempfile = "=3.27.0"',
    'xcap = { version = "=0.9.8", default-features = false }',
]) {
    if (!cargoToml.includes(dependency)) failures.push(`desktop-rust-version-not-pinned:${dependency.split(' ')[0]}`);
}
for (const testDriverBoundary of [
    'default = []',
    'desktop-test-driver = ["dep:tauri-plugin-wdio-webdriver"]',
]) {
    if (!cargoToml.includes(testDriverBoundary)) failures.push(`desktop-test-driver-boundary-missing:${testDriverBoundary}`);
}
if (!/#\[cfg\(feature = "desktop-test-driver"\)\][\s\S]{0,120}tauri_plugin_wdio_webdriver::init\(\)/u.test(rustSource)) {
    failures.push('desktop-test-driver-registration-not-feature-gated');
}
for (const releaseSetting of [
    'codegen-units = 1',
    'lto = true',
    'opt-level = "s"',
    'panic = "abort"',
    'strip = true',
]) {
    if (!cargoToml.includes(releaseSetting)) failures.push(`desktop-release-profile-missing:${releaseSetting}`);
}

const listFiles = async (directory) => {
    const absolute = path.join(root, directory);
    const entries = await readdir(absolute, { withFileTypes: true }).catch(() => []);
    const files = [];
    for (const entry of entries) {
        const child = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await listFiles(child));
        else files.push(child);
    }
    return files;
};

const scanBuild = async (directory, forbidden, id) => {
    const files = await listFiles(directory);
    if (!files.length) return { files: 0, bytes: 0 };
    let bytes = 0;
    for (const file of files) {
        const buffer = await readFile(path.join(root, file));
        bytes += buffer.byteLength;
        if (/\.(?:html|js|css|json|webmanifest)$/u.test(file)) {
            const content = buffer.toString('utf8');
            if (forbidden.some((pattern) => pattern.test(content) || pattern.test(file))) {
                failures.push(`${id}:${file}`);
            }
        }
    }
    return { files: files.length, bytes };
};

const web = await scanBuild('dist', [
    /desktop_environment/u,
    /desktop_pick_files/u,
    /desktop_capture_primary/u,
    /desktop_subscribe_system_events/u,
    /plugin:clipboard-manager/u,
    /__TAURI_INTERNALS__/u,
    /ipc\.localhost/u,
], 'web-build-contains-desktop-runtime');
const desktop = await scanBuild('dist-desktop', [/manifest\.webmanifest/u, /registerSW/u, /serviceWorker\.register/u], 'desktop-build-contains-pwa-runtime');
if (!web.files) failures.push('web-build-missing');
if (!desktop.files) failures.push('desktop-build-missing');

console.log(JSON.stringify({
    tauri: {
        api: '2.11.1',
        cli: '2.11.4',
        rust: '2.11.5',
        build: '2.6.3',
        dialog: '2.7.3',
        clipboard: '2.3.3',
        globalShortcut: '2.3.2',
        singleInstance: '2.4.4',
        xcap: '0.9.8',
    },
    capability: capability.identifier,
    permissions: capability.permissions,
    web,
    desktop,
    failures,
}, null, 2));

if (failures.length) process.exitCode = 1;
