import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { canonicalizeIcns } from '../../scripts/canonicalize-icns.mjs';
import { devFaviconPlugin, versionFaviconHtml, readWebIconVersions, versionWebIconHtml, webFaviconPlugin } from '../../config/devFaviconPlugin.mjs';
import { WEB_ICON_FILES } from '../../config/pwaConfig.js';

const read = name => readFileSync(new URL(`../../${name}`, import.meta.url));

describe('ScreenHello identity assets', () => {
    it('preserves the desktop development icon and does not rewrite the Web entry', () => {
        const iconPath = new URL('../../src/assets/favicon.png', import.meta.url);
        const plugin = devFaviconPlugin(iconPath);
        expect(plugin.apply).toBe('serve');
        expect(plugin.transformIndexHtml.order).toBe('pre');
        const hash = createHash('sha256').update(readFileSync(iconPath)).digest('hex').slice(0, 12);
        for (const [entry, prefix] of [['index.html', './'], ['desktop/index.html', '../']]) {
            const html = read(entry).toString('utf8');
            expect(plugin.transformIndexHtml.handler(html)).toBe(html.replace(
                `${prefix}src/assets/favicon.png`, `${prefix}src/assets/favicon.png?v=${hash}`,
            ));
        }
    });

    it('versions only Web icon hrefs and shares production versions with the PWA config', () => {
        const publicDirectory = new URL('../../public/', import.meta.url).pathname;
        const versions = readWebIconVersions(publicDirectory);
        const html = read('index.html').toString();
        const transformed = versionWebIconHtml(html, versions);
        for (const filename of WEB_ICON_FILES.slice(0, 4)) {
            expect(transformed).toContain(`href="%BASE_URL%${filename}?v=${versions[filename]}"`);
        }
        expect(versionWebIconHtml(transformed, versions)).toBe(transformed);
        expect(versionWebIconHtml(html, { ...versions, 'favicon.svg': 'new-content' })).not.toBe(transformed);
        const unrelated = '<img src="%BASE_URL%favicon.svg"><a href="https://example.com/favicon.svg">';
        expect(versionWebIconHtml(unrelated, versions)).toBe(unrelated);
        const plugin = webFaviconPlugin(publicDirectory, versions);
        plugin.configResolved({ command: 'build' });
        expect(plugin.transformIndexHtml.handler(html)).toBe(transformed);
        plugin.configResolved({ command: 'serve' });
        expect(plugin.transformIndexHtml.handler(html)).toBe(transformed);
    });

    it('pins the six imported Web icons without overwriting the original logo', () => {
        const manifest = JSON.parse(read('config/webIconAssets.json'));
        expect(Object.keys(manifest.files)).toEqual(WEB_ICON_FILES);
        expect(createHash('sha256').update(read('src/assets/logo.svg')).digest('hex')).toBe(manifest.sourceLogoSha256);
        for (const [filename, hash] of Object.entries(manifest.files)) {
            expect(createHash('sha256').update(read(`public/${filename}`)).digest('hex')).toBe(hash);
        }
        const svg = read('public/favicon.svg').toString();
        expect(svg).not.toMatch(/<(?:script|foreignObject|image|style)\b|\bon\w+\s*=|\b(?:href|xlink:href)\s*=/i);
        for (const [filename, size] of [['favicon-96x96.png', 96], ['apple-touch-icon.png', 180],
            ['web-app-manifest-192x192.png', 192], ['web-app-manifest-512x512.png', 512]]) {
            const png = PNG.sync.read(read(`public/${filename}`));
            expect([png.width, png.height]).toEqual([size, size]);
            // The generator's manifest called these maskable, but the actual
            // transparent files must be used as any; keep our opaque maskables.
            if (filename.startsWith('web-app')) expect(png.data[3]).toBe(0);
        }
        const ico = read('public/favicon.ico');
        expect(ico.readUInt32LE(0)).toBe(65536);
        expect(ico.readUInt16LE(4)).toBe(3);
    });

    it('changes the favicon URL only when its bytes change, leaving other URLs alone', () => {
        const html = '<link rel="icon" href="./src/assets/favicon.png">';
        const first = versionFaviconHtml(html, 'first-icon');
        expect(first).toBe(versionFaviconHtml(html, 'first-icon'));
        expect(first).not.toBe(versionFaviconHtml(html, 'second-icon'));
        expect(versionFaviconHtml(first, 'first-icon')).toBe(first);
        const unrelated = '<img src="./src/assets/favicon.png"><a href="https://example.com/favicon.png">';
        expect(versionFaviconHtml(unrelated, 'first-icon')).toBe(unrelated);
    });

    it('normalizes ICNS chunk order without changing image payloads', () => {
        const current = read('src-tauri/icons/icon.icns');
        const chunks = [];
        for (let offset = 8; offset < current.length;) {
            const length = current.readUInt32BE(offset + 4);
            chunks.push(current.subarray(offset, offset + length));
            offset += length;
        }
        expect(chunks).toHaveLength(12);
        const reversed = Buffer.concat([current.subarray(0, 8), ...chunks.reverse()]);
        expect(canonicalizeIcns(reversed)).toEqual(current);
        expect(canonicalizeIcns(current)).toEqual(current);
        expect(canonicalizeIcns(reversed).length).toBe(reversed.length);
    });

    it('rejects invalid ICNS headers, chunks and duplicates instead of dropping content', () => {
        const current = read('src-tauri/icons/icon.icns');
        expect(() => canonicalizeIcns(current.subarray(0, 6))).toThrow('invalid-icns-header');
        expect(() => canonicalizeIcns(current.subarray(0, -1))).toThrow('invalid-icns-header');
        const invalid = Buffer.from(current);
        invalid.writeUInt32BE(0, 12);
        expect(() => canonicalizeIcns(invalid)).toThrow('invalid-icns-chunk');
        const first = current.subarray(8, 8 + current.readUInt32BE(12));
        const duplicate = Buffer.concat([current, first]);
        duplicate.writeUInt32BE(duplicate.length, 4);
        expect(() => canonicalizeIcns(duplicate)).toThrow('invalid-icns-chunk');
    });

    it('preserves the supplied static SVG source without active or external content', () => {
        const source = read('src/assets/logo.svg');
        expect(createHash('sha256').update(source).digest('hex'))
            .toBe('d9412cf6667d8a18ed0ea171db6a48cfeef0c0e5cc35629e3c50626b89217489');
        const svg = source.toString('utf8');
        expect(svg).toContain('viewBox="0 0 1254 1254"');
        expect(svg).not.toMatch(/<(?:script|foreignObject|image|style)\b|\bon\w+\s*=|\b(?:href|xlink:href)\s*=/i);
    });

    it('keeps web, browser-frame and desktop identities on the same generated pixels', () => {
        expect(read('src/assets/logo.png')).toEqual(read('public/pwa-512x512.png'));
        expect(read('src/assets/logo.png')).toEqual(read('src-tauri/icons/icon.png'));
        expect(read('src/assets/favicon.png')).toEqual(read('src-tauri/icons/32x32.png'));
        for (const [file, size] of [
            ['src/assets/logo.png', 512], ['src/assets/favicon.png', 32],
            ['public/pwa-192x192.png', 192], ['public/pwa-512x512.png', 512],
        ]) {
            const bytes = read(file);
            const png = PNG.sync.read(bytes);
            expect([png.width, png.height, bytes[25]]).toEqual([size, size, 6]);
            expect(png.data[3]).toBe(0);
            let visible = 0;
            for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
                const alpha = png.data[(y * size + x) * 4 + 3];
                if (x === 0 || y === 0 || x === size - 1 || y === size - 1) expect(alpha).toBe(0);
                if (alpha > 128) visible++;
            }
            expect(visible / (size * size)).toBeGreaterThan(0.25);
            expect(visible / (size * size)).toBeLessThan(0.65);
        }
    });

    it('gives maskable icons an opaque base and keeps all artwork inside the safe circle', () => {
        for (const size of [192, 512]) {
            const bytes = read(`public/pwa-maskable-${size}x${size}.png`);
            const png = PNG.sync.read(bytes);
            expect([png.width, png.height, bytes[25]]).toEqual([size, size, 2]);
            let foreground = 0;
            for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
                const offset = (y * size + x) * 4;
                const pixel = [...png.data.subarray(offset, offset + 4)];
                const isBackground = pixel[0] === 17 && pixel[1] === 19 && pixel[2] === 24;
                expect(pixel[3]).toBe(255);
                if (!isBackground) foreground++;
                if (Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) > size * 0.4) {
                    expect(isBackground).toBe(true);
                }
            }
            expect(foreground).toBeGreaterThan(size * size * 0.1);
        }
    });
});
