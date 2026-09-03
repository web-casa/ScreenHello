import { readFile, readdir } from 'node:fs/promises';

const read = async (path) => (await readFile(path, 'utf8')).replaceAll('\r\n', '\n').trim();
const fail = (message) => { throw new Error(`third-party-notice-audit:${message}`); };

const notice = await read('THIRD_PARTY_NOTICES.md');

const extract = (name) => {
    const startMarker = `<!-- license:${name}:start -->`;
    const endMarker = `<!-- license:${name}:end -->`;
    const start = notice.indexOf(startMarker);
    const end = notice.indexOf(endMarker);
    if (start < 0 || end < 0 || end <= start) fail(`missing-${name}-markers`);
    return notice.slice(start + startMarker.length, end).trim();
};

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
