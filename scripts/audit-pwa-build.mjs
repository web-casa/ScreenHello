import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PWA_APP_SHELL_MAX_BYTES, normalizeWebBase } from '../config/pwaConfig.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(root, process.env.SCREENHELLO_PWA_OUT_DIR || 'dist');
const expectedBase = normalizeWebBase(process.env.SCREENHELLO_BASE_PATH || '/');

const fail = (message) => { throw new Error(`pwa-audit:${message}`); };
const read = (filename) => readFileSync(path.join(outDir, filename), 'utf8');
const exists = (filename) => {
    try {
        statSync(path.join(outDir, filename));
        return true;
    } catch {
        return false;
    }
};

for (const required of ['index.html', 'manifest.webmanifest', 'sw.js']) {
    if (!exists(required)) fail(`missing-${required}`);
}

const manifest = JSON.parse(read('manifest.webmanifest'));
const expectedManifest = {
    name: 'ScreenHello — 本地截图美化工具',
    short_name: 'ScreenHello',
    start_url: expectedBase,
    scope: expectedBase,
    display: 'standalone',
    theme_color: '#111318',
    background_color: '#111318',
};
for (const [key, value] of Object.entries(expectedManifest)) {
    if (manifest[key] !== value) fail(`manifest-${key}`);
}

const expectedIcons = new Map([
    ['pwa-192x192.png', { width: 192, height: 192, purpose: 'any', alpha: true }],
    ['pwa-512x512.png', { width: 512, height: 512, purpose: 'any', alpha: true }],
    ['pwa-maskable-192x192.png', { width: 192, height: 192, purpose: 'maskable', alpha: false }],
    ['pwa-maskable-512x512.png', { width: 512, height: 512, purpose: 'maskable', alpha: false }],
]);
if (!Array.isArray(manifest.icons) || manifest.icons.length !== expectedIcons.size) fail('manifest-icons-count');
for (const icon of manifest.icons) {
    const filename = path.posix.basename(new globalThis.URL(icon.src, 'https://screenhello.invalid').pathname);
    const expected = expectedIcons.get(filename);
    if (!expected || icon.sizes !== `${expected.width}x${expected.height}` || icon.type !== 'image/png' || icon.purpose !== expected.purpose) {
        fail(`manifest-icon-${filename}`);
    }
    const expectedSrc = `${expectedBase}${filename}`;
    if (icon.src !== expectedSrc) fail(`manifest-icon-base-${filename}`);
    const data = readFileSync(path.join(outDir, filename));
    if (data.toString('ascii', 1, 4) !== 'PNG') fail(`icon-format-${filename}`);
    if (data.readUInt32BE(16) !== expected.width || data.readUInt32BE(20) !== expected.height) fail(`icon-size-${filename}`);
    const colorType = data[25];
    const hasAlphaChannel = colorType === 4 || colorType === 6;
    if (hasAlphaChannel !== expected.alpha) fail(`icon-alpha-${filename}`);
}

const html = read('index.html');
if (!html.includes(`href="${expectedBase}manifest.webmanifest"`)) fail('manifest-link-base');
const shellReferences = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => new globalThis.URL(match[1], 'https://screenhello.invalid'))
    .filter((url) => url.pathname.startsWith(`${expectedBase}assets/`) && /\.(?:js|css)$/.test(url.pathname))
    .map((url) => url.pathname.slice(expectedBase.length));
const pwaWindowRuntime = readdirSync(path.join(outDir, 'assets'))
    .find((filename) => /^workbox-window\.prod\.es5-[\w-]+\.js$/.test(filename));
if (!pwaWindowRuntime) fail('pwa-window-runtime-missing');

const sw = read('sw.js');
const precacheMatch = sw.match(/precacheAndRoute\((\[[\s\S]*?\]),\{\}\)/);
if (!precacheMatch) fail('precache-manifest-unreadable');
const precacheSource = precacheMatch[1];
const precacheUrls = [...precacheSource.matchAll(/\{url:"([^"]+)",revision:(?:"[a-f0-9]+"|null)\}/g)]
    .map((match) => match[1]);
const precacheObjectCount = (precacheSource.match(/\{url:/g) || []).length;
if (precacheUrls.length !== precacheObjectCount || precacheUrls.length === 0) fail('precache-token-count');
const uniqueUrls = new Set(precacheUrls);
if (uniqueUrls.size !== precacheUrls.length) fail('precache-duplicate-url');
for (const required of ['index.html', 'manifest.webmanifest', ...expectedIcons.keys(), ...shellReferences, `assets/${pwaWindowRuntime}`]) {
    if (!uniqueUrls.has(required)) fail(`precache-missing-${required}`);
}

const forbiddenPrecache = [
    /\.wasm$/,
    /\.worker-[^/]+\.js$/,
    /\.jpe?g$/,
    /assets\/(?:EmojiPicker|CropperDialog|DrawerBar|BatchExportPanel|BatchRenderSession|batchExportService|workspaceArchive|avifEncoder|webpEncoder)-/,
];
for (const url of precacheUrls) {
    if (forbiddenPrecache.some((pattern) => pattern.test(url))) fail(`precache-heavy-${url}`);
}

let precacheBytes = 0;
for (const url of uniqueUrls) {
    const target = path.join(outDir, url);
    if (!exists(url)) fail(`precache-file-missing-${url}`);
    precacheBytes += statSync(target).size;
}
if (precacheBytes > PWA_APP_SHELL_MAX_BYTES) fail(`precache-budget-${precacheBytes}`);

for (const marker of ['SKIP_WAITING', 'screenhello-runtime-assets-v1', 'registration', 'CacheFirst', 'CacheableResponsePlugin', 'ExpirationPlugin']) {
    if (!sw.includes(marker)) fail(`sw-missing-${marker}`);
}
if (sw.includes('clientsClaim')) fail('sw-unconditional-clients-claim');
if (/\beval\s*\(|new Function\s*\(/.test(sw)) fail('sw-unsafe-eval');

const workboxFiles = readdirSync(outDir).filter((filename) => /^workbox-[\w-]+\.js$/.test(filename));
if (workboxFiles.length !== 1) fail('workbox-runtime-count');
const workbox = read(workboxFiles[0]);
if (/\beval\s*\(|new Function\s*\(/.test(workbox)) fail('workbox-unsafe-eval');

const emittedAssets = readdirSync(path.join(outDir, 'assets'));
if (!emittedAssets.some((filename) => /\.wasm$/.test(filename))) fail('runtime-wasm-missing');
if (!emittedAssets.some((filename) => /\.worker-[^/]+\.js$/.test(filename))) fail('runtime-worker-missing');

console.log(JSON.stringify({
    base: expectedBase,
    precacheEntries: precacheUrls.length,
    precacheBytes,
    runtimeCache: 'screenhello-runtime-assets-v1',
    workboxRuntime: workboxFiles[0],
}, null, 2));
