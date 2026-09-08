import { readFile, readdir } from 'node:fs/promises';

const read = async (path) => (await readFile(path, 'utf8')).replaceAll('\r\n', '\n').trim();
const fail = (message) => { throw new Error(`third-party-notice-audit:${message}`); };

const notice = await read('THIRD_PARTY_NOTICES.md');
const cargoLock = await read('src-tauri/Cargo.lock');

const extract = (name) => {
    const startMarker = `<!-- license:${name}:start -->`;
    const endMarker = `<!-- license:${name}:end -->`;
    const start = notice.indexOf(startMarker);
    const end = notice.indexOf(endMarker);
    if (start < 0 || end < 0 || end <= start) fail(`missing-${name}-markers`);
    return notice.slice(start + startMarker.length, end).trim();
};

const tauriMitLicense = await read('node_modules/@tauri-apps/api/LICENSE_MIT');
if (extract('tauri-mit') !== tauriMitLicense) fail('tauri-mit-license-mismatch');
if (!notice.includes('## Tauri 2') || !notice.includes('Rust application runtime')) {
    fail('tauri-notice-invalid');
}
const clipboardPackage = JSON.parse(await read('node_modules/@tauri-apps/plugin-clipboard-manager/package.json'));
const clipboardSpdx = await read('node_modules/@tauri-apps/plugin-clipboard-manager/LICENSE.spdx');
if (clipboardPackage.version !== '2.3.3' || clipboardPackage.license !== 'MIT OR Apache-2.0') {
    fail('tauri-clipboard-package-license-invalid');
}
if (!clipboardSpdx.includes('PackageLicenseDeclared: MIT')
    || !clipboardSpdx.includes('The Tauri Programme in the Commons Conservancy')) {
    fail('tauri-clipboard-spdx-invalid');
}
if (!notice.includes('`tauri-plugin-dialog` 2.7.3')
    || !notice.includes('`tauri-plugin-clipboard-manager` 2.3.3')
    || !notice.includes('`tauri-plugin-global-shortcut` 2.3.2')
    || !notice.includes('`tauri-plugin-single-instance` 2.4.4')) {
    fail('tauri-plugin-notice-invalid');
}

const hasLockedCargoPackage = (name, version) => new RegExp(
    `\\[\\[package\\]\\]\\nname = "${name}"\\nversion = "${version.replaceAll('.', '\\.')}"(?:\\n|$)`,
    'u',
).test(cargoLock);
if (!hasLockedCargoPackage('tauri-plugin-dialog', '2.7.3')
    || !hasLockedCargoPackage('tauri-plugin-clipboard-manager', '2.3.3')
    || !hasLockedCargoPackage('tauri-plugin-global-shortcut', '2.3.2')
    || !hasLockedCargoPackage('tauri-plugin-single-instance', '2.4.4')) {
    fail('tauri-plugin-lock-version-invalid');
}
const getrandomLicense = extract('getrandom-mit');
if (!hasLockedCargoPackage('getrandom', '0.3.4')
    || !getrandomLicense.startsWith('Copyright (c) 2018-2025 The rust-random Project Developers')
    || !getrandomLicense.includes('Copyright (c) 2014 The Rust Project Developers')
    || !getrandomLicense.endsWith('DEALINGS IN THE SOFTWARE.')) {
    fail('getrandom-mit-license-mismatch');
}
if (!notice.includes('## getrandom 0.3.4') || !notice.includes('opaque, process-local screenshot source tokens')) {
    fail('getrandom-notice-invalid');
}
if (!hasLockedCargoPackage('xcap', '0.9.8')
    || !notice.includes('## xcap 0.9.8')
    || !notice.includes('Copyright 2024 nashaofu')
    || !notice.includes('The Apache License 2.0 terms are reproduced once')) {
    fail('xcap-apache-notice-invalid');
}
const tempfileLicense = extract('tempfile-mit');
if (!hasLockedCargoPackage('tempfile', '3.27.0')
    || !tempfileLicense.startsWith('Copyright (c) 2015 Steven Allen')
    || !tempfileLicense.endsWith('DEALINGS IN THE SOFTWARE.')) {
    fail('tempfile-mit-license-mismatch');
}
if (!notice.includes('## tempfile 3.27.0') || !notice.includes('atomic same-directory')) {
    fail('tempfile-notice-invalid');
}

const vitePluginLicense = await read('node_modules/vite-plugin-pwa/LICENSE');
if (extract('vite-plugin-pwa') !== vitePluginLicense) fail('vite-plugin-pwa-license-mismatch');

const virtualStoreEntries = await readdir('node_modules/.pnpm', { withFileTypes: true });
const workboxPackageDirs = virtualStoreEntries
    .filter((entry) => entry.isDirectory() && /^workbox-[^@]+@7\.4\.1(?:_|$)/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
if (!workboxPackageDirs.length) fail('workbox-packages-missing');
const workboxLicense = extract('workbox');
const workboxPackages = [];
for (const packageDir of workboxPackageDirs) {
    const packageName = packageDir.slice(0, packageDir.indexOf('@'));
    const packageLicense = await read(`node_modules/.pnpm/${packageDir}/node_modules/${packageName}/LICENSE`);
    if (packageLicense !== workboxLicense) fail(`workbox-license-mismatch-${packageName}`);
    workboxPackages.push(`${packageName}@7.4.1`);
}

const seleniumLicense = await read('node_modules/selenium-webdriver/LICENSE');
const axeLicense = await read('node_modules/@axe-core/playwright/LICENSE');
if (!seleniumLicense.startsWith('Apache License')) fail('selenium-webdriver-license-invalid');
if (!axeLicense.startsWith('Mozilla Public License, version 2.0')) fail('axe-playwright-license-invalid');
const seleniumToolNotice = extract('selenium-webdriver');
const axeToolNotice = extract('axe-playwright');
if (!seleniumToolNotice.includes('selenium-webdriver` 4.48.0') || !seleniumToolNotice.includes('Apache License 2.0')) {
    fail('selenium-webdriver-notice-invalid');
}
if (!axeToolNotice.includes('@axe-core/playwright` 4.13.0') || !axeToolNotice.includes('Mozilla Public License 2.0')) {
    fail('axe-playwright-notice-invalid');
}

const avifLicense = await read('node_modules/@jsquash/avif/LICENSE');
const webpLicense = await read('node_modules/@jsquash/webp/LICENSE');
if (webpLicense !== avifLicense) fail('jsquash-wrapper-license-mismatch');
if (extract('jsquash-apache') !== avifLicense) fail('jsquash-license-mismatch');
const libwebpLicense = await read('node_modules/@jsquash/webp/codec/LICENSE.codec.md');
if (extract('libwebp') !== libwebpLicense) fail('libwebp-license-mismatch');
if (!notice.includes('## @jsquash/avif 2.1.1') || !notice.includes('browser-local AVIF encoding')) {
    fail('jsquash-avif-notice-invalid');
}
if (!notice.includes('## @jsquash/webp 1.5.0') || !notice.includes('browser-local WebP encoding fallback')) {
    fail('jsquash-webp-notice-invalid');
}
if (!notice.includes('## libwebp codec bundled by @jsquash/webp 1.5.0')) {
    fail('libwebp-notice-invalid');
}

console.log(JSON.stringify({
    licenses: [
        '@tauri-apps/api@2.11.1 / tauri@2.11.5 (MIT selected)',
        'tauri-plugin-dialog@2.7.3 / tauri-plugin-clipboard-manager@2.3.3 / tauri-plugin-global-shortcut@2.3.2 / tauri-plugin-single-instance@2.4.4 (MIT selected)',
        'getrandom@0.3.4 (MIT selected)',
        'tempfile@3.27.0 (MIT selected)',
        'xcap@0.9.8 (Apache-2.0)',
        'vite-plugin-pwa@1.3.0',
        ...workboxPackages,
        'selenium-webdriver@4.48.0 (development only)',
        '@axe-core/playwright@4.13.0 (development only)',
        '@jsquash/avif@2.1.1',
        '@jsquash/webp@1.5.0',
        'libwebp codec (bundled by @jsquash/webp@1.5.0)',
    ],
    distributedLicenseTextsMatch: true,
    developmentToolNoticeMetadataMatch: true,
}, null, 2));
