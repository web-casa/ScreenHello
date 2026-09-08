import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import UPNG from 'upng-js';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { MAX_PIXELS, validateRequest } from '../spikes/compression/contract.js';
import { createPngFixture } from '../fixtures/createPngFixture.js';
import { createProjectArchive, readWorkspaceArchive } from '../../src/utils/workspaceArchive.js';
import { createDocument } from '../../src/utils/projectDocument.js';
import { normalizeExportSettings } from '../../src/utils/stylePreset.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformUpngEntry } from '../spikes/compression/upngCjsPlugin.mjs';
import { processTreeRssMiB } from '../spikes/compression/rss.mjs';
import { createDesktopPlatform } from '../../src/platform/desktopPlatform.js';

const require = createRequire(import.meta.url);
const upngRequire = createRequire(require.resolve('upng-js'));
const upngSource = readFileSync(require.resolve('upng-js'), 'utf8');
// Execute exactly the source transformation used by Vite's worker build. This
// Node-only fixture does not introduce eval/vm into any browser or runtime code.
const sandbox = { module: { exports: {} }, require: upngRequire };
vm.runInNewContext(transformUpngEntry(upngSource), sandbox);
const pinnedUPNG = sandbox.module.exports;

describe('C0 compression experiment boundaries (not a public export API)', () => {
    it('C4 transports real palette/tRNS PNG bytes through the existing desktop save contract without adding IPC', async () => {
        const pixels = new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0, 80, 90, 100, 128]);
        const bytes = new Uint8Array(pinnedUPNG.encode([pixels.buffer], 3, 1, 3)).slice();
        expect(bytes[25]).toBe(3);
        expect(Buffer.from(bytes).includes(Buffer.from('PLTE'))).toBe(true);
        expect(Buffer.from(bytes).includes(Buffer.from('tRNS'))).toBe(true);
        expect(PNG.sync.read(Buffer.from(bytes)).width).toBe(3);
        const token = 'a'.repeat(48), calls = [];
        const platform = createDesktopPlatform({
            tokenFactory: () => token,
            invokeCommand: async (command, args, options) => {
                calls.push(command);
                if (command === 'desktop_choose_save_file') {
                    expect(args).toEqual({ kind: 'image-png', suggestedName: 'palette.png', token });
                    return { status: 'selected', token };
                }
                if (command === 'desktop_write_file') {
                    expect(args).toEqual(bytes);
                    expect(options).toEqual({ headers: { 'x-screenhello-file-token': token } });
                    return;
                }
                if (command === 'desktop_release_file') return true;
                throw new Error(`unexpected command: ${command}`);
            },
        });
        await platform.export.download(new Blob([bytes], { type: 'image/png' }), 'palette.png');
        expect(calls).toEqual(['desktop_choose_save_file', 'desktop_write_file', 'desktop_release_file']);
    });
    it('counts auxiliary-thread children without counting a process twice', () => {
        const files = {
            '/proc/10/status': 'VmRSS: 1024 kB\n', '/proc/10/task/10/children': '20',
            '/proc/10/task/11/children': '20 30', '/proc/20/status': 'VmRSS: 2048 kB\n',
            '/proc/30/status': 'VmRSS: 4096 kB\n', '/proc/30/task/30/children': '40',
            '/proc/40/status': 'VmRSS: 8192 kB\n',
        };
        expect(processTreeRssMiB(10, { readText: path => files[path] || '',
            listThreads: path => path === '/proc/10/task' ? ['10', '11'] : [],
        })).toBe(15);
    });
    it('tolerates processes disappearing during a Linux RSS sample', () => {
        expect(processTreeRssMiB(10, { readText: () => '', listThreads: () => [] })).toBe(0);
    });
    it('retains exact installed codec/test license notices, including the pako zlib header', () => {
        const notices = readFileSync(new URL('../../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');
        const extract = key => notices.split(`<!-- license:${key}:start -->`)[1]?.split(`<!-- license:${key}:end -->`)[0]?.trim();
        for (const [key, file] of Object.entries({
            oxipng: '@jsquash/oxipng/codec/LICENSE.codec.md', upng: 'upng-js/LICENSE',
            pngjs: 'pngjs/LICENSE', pako: 'pako/LICENSE',
        })) {
            expect(extract(`compression-${key}`)).toBe(readFileSync((key === 'pako' ? upngRequire : require).resolve(file), 'utf8').trim());
        }
        expect(extract('jsquash-apache')).toBe(readFileSync(require.resolve('@jsquash/oxipng/LICENSE'), 'utf8').trim());
        const deflate = readFileSync(upngRequire.resolve('pako/lib/zlib/deflate.js'), 'utf8');
        const header = deflate.slice(deflate.indexOf('// (C)'), deflate.indexOf('\nvar utils')).replace(/^\/\/ ?/gm, '').trim();
        expect(extract('compression-pako-zlib')).toBe(header);
    });
    it('patches only the exact pinned UPNG entry and rejects any source drift', () => {
        const source = upngSource;
        const transformed = transformUpngEntry(source);
        expect(transformed).not.toContain('pako = window.pako');
        expect(transformed.slice(transformed.indexOf('UPNG.encode.compressPNG ='))).toBe(source.slice(source.indexOf('UPNG.encode.compressPNG =')));
        expect(() => transformUpngEntry(`${source}\n`)).toThrow('compression-upng-source-changed-review-required');
    });
    const request = () => ({ mode: 'png-lossy', width: 2, height: 2, colors: 256, pixels: new ArrayBuffer(16) });
    it.each([64, 128, 256])('accepts only the selected palette size %i', (colors) => {
        expect(validateRequest({ ...request(), colors }).colors).toBe(colors);
    });
    it.each([0, 1, 63, 257, NaN, '64'])('rejects an invalid palette size %s', (colors) => {
        expect(() => validateRequest({ ...request(), colors })).toThrow('compression-colors-invalid');
    });
    it.each([0, -1, 1.5, Infinity, NaN, 8193])('rejects invalid dimensions %s before encoding', (width) => {
        expect(() => validateRequest({ ...request(), width })).toThrow('compression-pixel-budget');
    });
    it('rejects just over the pixel budget and wrong buffer length', () => {
        expect(() => validateRequest({ ...request(), width: 2048, height: 1025 })).toThrow('compression-pixel-budget');
        expect(() => validateRequest({ ...request(), pixels: new ArrayBuffer(15) })).toThrow('compression-pixels-invalid');
        expect(MAX_PIXELS).toBe(2048 * 1024);
        expect(validateRequest({ ...request(), width: 2048, height: 1024, pixels: new ArrayBuffer(MAX_PIXELS * 4) }).height).toBe(1024);
    });
    it.each([0, 101, NaN, Infinity, 2.5, '80'])('rejects bad lossy quality %s', (quality) => {
        expect(() => validateRequest({ ...request(), mode: 'webp-lossy', quality })).toThrow('compression-quality-invalid');
    });
    it('validates the PNG header against bounded dimensions, including before codec parsing', () => {
        const bytes = createPngFixture(2, 2);
        const png = Uint8Array.from(bytes).buffer;
        expect(validateRequest({ mode: 'png-lossless', width: 2, height: 2, png }).width).toBe(2);
        expect(() => validateRequest({ mode: 'png-lossless', width: 2, height: 1, png })).toThrow('compression-png-invalid');
        new DataView(png).setUint32(16, 0x7fffffff);
        expect(() => validateRequest({ mode: 'png-lossless', width: 2, height: 2, png })).toThrow('compression-png-invalid');
    });
    it.each([64, 128, 256])('independently decodes the pinned UPNG output at %i colors', (colors) => {
        const source = PNG.sync.read(createPngFixture(32, 24));
        source.data.fill(0, 0, 32 * 4);
        const output = Buffer.from(UPNG.encode([Uint8Array.from(source.data).buffer], 32, 24, colors));
        const decoded = PNG.sync.read(output);
        expect(decoded.width).toBe(32);
        expect(decoded.height).toBe(24);
        const used = new Set();
        for (let i = 0; i < decoded.data.length; i += 4) used.add(decoded.data.readUInt32BE(i));
        expect(used.size).toBeLessThanOrEqual(colors);
        expect(decoded.data[3]).toBe(0);
        // Already few-color content is allowed to remain pixel exact.
        expect(decoded.data).toEqual(source.data);
    });
    it.each([64, 128, 256])('supports a 1px fully transparent PNG at %i colors', (colors) => {
        const output = pinnedUPNG.encode([new Uint8Array([0, 0, 0, 0]).buffer], 1, 1, colors);
        const decoded = PNG.sync.read(Buffer.from(output));
        expect([...decoded.data]).toEqual([0, 0, 0, 0]);
    });
    it.each([[1, 64], [64, 1], [2, 2], [8, 8], [64, 48]])('writes a complete static PNG container for %ix%i', (width, height) => {
        const source = PNG.sync.read(createPngFixture(width, height));
        const encoded = pinnedUPNG.encode([Uint8Array.from(source.data).buffer], width, height, 256);
        expect(PNG.sync.read(Buffer.from(encoded)).data).toEqual(source.data);
    });
    it('does not expand the adapter into APNG support', () => {
        expect(() => pinnedUPNG.encode([new ArrayBuffer(4), new ArrayBuffer(4)], 1, 1, 64)).toThrow('compression-static-png-only');
    });
    it('preserves C0 project documents and retains the additive C1 compression preferences', async () => {
        const blob = new Blob([createPngFixture()], { type: 'image/png' });
        const document = createDocument({ image: { width: 64, height: 48, type: 'image/png', name: 'c0.png' } });
        const old = await createProjectArchive({ document, image: blob, exportSettings: { format: 'png', ratio: 2 } });
        const entries = unzipSync(new Uint8Array(await old.arrayBuffer()));
        const manifest = JSON.parse(strFromU8(entries['manifest.json']));
        manifest.exportSettings = { ...manifest.exportSettings, compression: 'lossy', paletteColors: 128 };
        entries['manifest.json'] = strToU8(JSON.stringify(manifest));
        const loaded = await readWorkspaceArchive(new Blob([zipSync(entries)]), { expectedKind: 'project' });
        expect(loaded.document).toEqual((await readWorkspaceArchive(old, { expectedKind: 'project' })).document);
        // C0 proved old-reader fallback. The current C1 reader now retains this
        // additive preference without changing the project document schema.
        expect(loaded.exportSettings).toEqual({ format: 'png', ratio: 2, compression: 'lossy', paletteColors: 128 });
        expect(normalizeExportSettings({ format: 'png', ratio: 2, quality: 10 })).toEqual({ format: 'png', ratio: 2 });
    });
});
