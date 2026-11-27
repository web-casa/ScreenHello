import { describe, expect, it } from 'vitest';
import { deflateSync, strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocument, defaultOption } from '../../src/utils/projectDocument.js';
import { createStylePreset, normalizeExportSettings, normalizeWorkspaceName } from '../../src/utils/stylePreset.js';
import {
    createPresetArchive,
    createProjectArchive,
    readWorkspaceArchive,
} from '../../src/utils/workspaceArchive.js';

const image = (body = 'image', type = 'image/png', name = 'fixture.png') =>
    new File([body], name, { type });

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
        let value = i;
        for (let bit = 0; bit < 8; bit += 1) {
            value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
        }
        table[i] = value >>> 0;
    }
    return table;
})();

const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.byteLength; i += 1) {
        crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
};

const concatBytes = (parts) => {
    const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.byteLength;
    }
    return out;
};

/**
 * 构造原始 ZIP 二进制容器，用于安全边界回归测试（伪造尺寸、Deflate 炸弹、数据描述符、ZIP64、重名条目、尾部附加字节、非连续偏移）。
 */
const buildRawZip = (entries, options = {}) => {
    const localParts = [];
    const cdParts = [];
    let offset = 0;

    for (const item of entries) {
        if (item.gapBefore > 0) {
            localParts.push(new Uint8Array(item.gapBefore));
            offset += item.gapBefore;
        }
        const nameBytes = strToU8(item.name);
        const rawData = item.rawData ?? strToU8(item.text ?? '');
        const method = item.method ?? 0;
        const payload = item.payload ?? (method === 8 ? deflateSync(rawData, { level: 9 }) : rawData);
        const flags = item.flags ?? 0;
        const entryCrc = item.crc32 ?? crc32(rawData);
        const compSize = item.compressedSize ?? payload.byteLength;
        const uncompSize = item.uncompressedSize ?? rawData.byteLength;
        const lfhCompSize = item.lfhCompressedSize ?? compSize;
        const lfhUncompSize = item.lfhUncompressedSize ?? uncompSize;
        const lfhFlags = item.lfhFlags ?? flags;
        const lfhOffset = item.cdLfhOffset ?? offset;

        const lfh = new Uint8Array(30 + nameBytes.byteLength);
        const lfhView = new DataView(lfh.buffer);
        lfhView.setUint32(0, 0x04034b50, true);
        lfhView.setUint16(4, 20, true);
        lfhView.setUint16(6, lfhFlags, true);
        lfhView.setUint16(8, method, true);
        lfhView.setUint32(14, entryCrc, true);
        lfhView.setUint32(18, lfhCompSize, true);
        lfhView.setUint32(22, lfhUncompSize, true);
        lfhView.setUint16(26, nameBytes.byteLength, true);
        lfhView.setUint16(28, 0, true);
        lfh.set(nameBytes, 30);

        localParts.push(lfh, payload);
        offset += lfh.byteLength + payload.byteLength;

        const cd = new Uint8Array(46 + nameBytes.byteLength);
        const cdView = new DataView(cd.buffer);
        cdView.setUint32(0, 0x02014b50, true);
        cdView.setUint16(4, 20, true);
        cdView.setUint16(6, 20, true);
        cdView.setUint16(8, flags, true);
        cdView.setUint16(10, method, true);
        cdView.setUint32(16, entryCrc, true);
        cdView.setUint32(20, compSize, true);
        cdView.setUint32(24, uncompSize, true);
        cdView.setUint16(28, nameBytes.byteLength, true);
        cdView.setUint32(42, lfhOffset, true);
        cd.set(nameBytes, 46);
        cdParts.push(cd);
    }

    const cdOffset = offset;
    const cdBytes = concatBytes(cdParts);
    const cdSize = cdBytes.byteLength;
    const extraBeforeEocd = options.zip64Locator
        ? (() => {
            const loc = new Uint8Array(20);
            new DataView(loc.buffer).setUint32(0, 0x07064b50, true);
            return loc;
        })()
        : new Uint8Array(0);

    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(8, entries.length, true);
    eocdView.setUint16(10, entries.length, true);
    eocdView.setUint32(12, cdSize, true);
    eocdView.setUint32(16, cdOffset, true);
    eocdView.setUint16(20, 0, true);

    const parts = [...localParts, cdBytes, extraBeforeEocd, eocd];
    if (options.trailingBytes) parts.push(options.trailingBytes);
    return new Blob([concatBytes(parts)], { type: 'application/zip' });
};

describe('workspace archive', () => {
    it('round-trips a project with image, background, and export settings', async () => {
        const option = defaultOption();
        option.background = 'upload_image';
        option.backgroundAssetId = 'runtime-background';
        option.frame = 'genericDesktop';
        option.frameMode = 'stretch';
        option.frameConf.background = { type: 'image', url: 'blob:runtime', mode: 'cover', align: 'center' };
        const document = createDocument({
            option,
            image: { width: 64, height: 48, type: 'image/png', name: 'main.png' },
            shapes: [{ id: 'shape-1', type: 'Square', x: 2, y: 4 }],
        });
        const archive = await createProjectArchive({
            name: '演示项目',
            document,
            image: image('main', 'image/png', 'main.png'),
            background: image('background', 'image/webp', 'background.webp'),
            exportSettings: { format: 'webp', ratio: 3 },
        });

        const restored = await readWorkspaceArchive(archive, { expectedKind: 'project' });

        expect(restored.name).toBe('演示项目');
        expect(restored.images).toHaveLength(1);
        expect(restored.image.type).toBe('image/png');
        expect(await restored.image.text()).toBe('main');
        expect(await restored.background.text()).toBe('background');
        expect(restored.document.shapes).toHaveLength(1);
        expect(restored.document.option).toMatchObject({ frame: 'genericDesktop', frameMode: 'stretch' });
        expect(restored.document.option.backgroundAssetId).toBeNull();
        expect(restored.exportSettings).toEqual({ format: 'webp', ratio: 3 });
    });

    it('round-trips a portable style preset', async () => {
        const option = defaultOption();
        option.background = 'upload_image';
        option.backgroundAssetId = 'runtime-background';
        option.frameConf.background = { type: 'image', url: 'blob:runtime', mode: 'fit', align: 'top' };
        const preset = createStylePreset({
            name: '  Product / Hero  ',
            option,
            exportSettings: { format: 'jpg', ratio: 2 },
        });

        const archive = await createPresetArchive({ preset, background: image('bg', 'image/png', 'bg.png') });
        const restored = await readWorkspaceArchive(archive, { expectedKind: 'preset' });

        expect(restored.name).toBe('Product Hero');
        expect(restored.preset.exportSettings).toEqual({ format: 'jpg', ratio: 2 });
        expect(restored.preset.option.backgroundAssetId).toBeNull();
        expect(await restored.background.text()).toBe('bg');
    });

    it('round-trips multiple image layers and their stable asset references', async () => {
        const document = createDocument({
            images: [
                { id: 'front', assetId: 'asset-front', width: 64, height: 48, name: 'front.png', transform: { x: 10, y: 20, scale: 1, rotation: 0 } },
                { id: 'back', assetId: 'asset-back', width: 32, height: 32, name: 'back.png', transform: { x: 40, y: 50, scale: 0.8, rotation: -5 } },
            ],
        });
        const archive = await createProjectArchive({
            document,
            images: [
                { blob: image('front'), metadata: document.images[0] },
                { blob: image('back'), metadata: document.images[1] },
            ],
        });

        const restored = await readWorkspaceArchive(archive, { expectedKind: 'project' });
        expect(restored.images).toHaveLength(2);
        expect(restored.document.images.map(({ id, assetId }) => ({ id, assetId }))).toEqual([
            { id: 'front', assetId: 'asset-front' },
            { id: 'back', assetId: 'asset-back' },
        ]);
        expect(await restored.images[1].file.text()).toBe('back');
    });

    it('stores a shared layer asset once and rejects conflicting bytes for the same asset id', async () => {
        const document = createDocument({
            images: [
                { id: 'original', assetId: 'asset-shared', width: 64, height: 48 },
                { id: 'duplicate', assetId: 'asset-shared', width: 64, height: 48 },
            ],
        });
        const shared = image('shared');
        const archive = await createProjectArchive({
            document,
            images: [
                { blob: shared, metadata: document.images[0] },
                { blob: shared, metadata: document.images[1] },
            ],
        });
        const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));
        const manifest = JSON.parse(strFromU8(entries['manifest.json']));

        expect(Object.keys(entries).filter((path) => path.startsWith('assets/images/'))).toHaveLength(1);
        expect(manifest.assets.images[0].path).toBe(manifest.assets.images[1].path);
        await expect(readWorkspaceArchive(archive, { expectedKind: 'project' })).resolves.toMatchObject({
            document: { images: [{ assetId: 'asset-shared' }, { assetId: 'asset-shared' }] },
        });

        manifest.assets.images[1].assetId = 'asset-mismatch';
        entries['manifest.json'] = strToU8(JSON.stringify(manifest));
        const mismatched = new Blob([zipSync(entries)]);
        await expect(readWorkspaceArchive(mismatched, { expectedKind: 'project' }))
            .rejects.toMatchObject({ code: 'project-document-invalid' });

        await expect(createProjectArchive({
            document,
            images: [
                { blob: image('first'), metadata: document.images[0] },
                { blob: image('other'), metadata: document.images[1] },
            ],
        })).rejects.toMatchObject({ code: 'project-asset-conflict' });
    });

    it('reads a legacy single-image archive and migrates its V1 transform', async () => {
        const bytes = strToU8('legacy-image');
        const legacy = new Blob([zipSync({
            'manifest.json': strToU8(JSON.stringify({
                format: 'screenhello',
                containerVersion: 1,
                kind: 'project',
                name: 'Legacy',
                document: {
                    version: 1,
                    option: { offsetX: 12, offsetY: -4, scale: 1.2, rotation: 7 },
                    image: { assetId: 'legacy-asset', width: 64, height: 48, type: 'image/png', name: 'legacy.png' },
                    shapes: [],
                },
                assets: {
                    image: { path: 'assets/image.png', type: 'image/png', name: 'legacy.png', size: bytes.byteLength },
                },
            })),
            'assets/image.png': bytes,
        })]);

        const restored = await readWorkspaceArchive(legacy, { expectedKind: 'project' });
        expect(restored.document.version).toBe(2);
        expect(restored.document.images[0]).toMatchObject({
            assetId: 'legacy-asset',
            transform: { x: 12, y: -4, scale: 1.2, rotation: 7 },
        });
    });

    it('rejects unsupported kinds, extra entries, and checksum mismatches', async () => {
        const unknownEntry = new Blob([zipSync({
            'manifest.json': strToU8(JSON.stringify({
                format: 'screenhello', containerVersion: 1, kind: 'project', assets: {}, document: {},
            })),
            'unexpected.txt': strToU8('nope'),
        })]);
        await expect(readWorkspaceArchive(unknownEntry)).rejects.toMatchObject({ code: 'archive-entry-rejected' });

        const unreferencedImage = new Blob([zipSync({
            'manifest.json': strToU8(JSON.stringify({
                format: 'screenhello', containerVersion: 1, kind: 'preset', assets: {}, preset: {},
            })),
            'assets/image.png': strToU8('hidden'),
        })]);
        await expect(readWorkspaceArchive(unreferencedImage)).rejects.toMatchObject({ code: 'archive-entry-rejected' });

        const document = createDocument({ image: { width: 1, height: 1 } });
        const valid = await createProjectArchive({ document, image: image('main') });
        await expect(readWorkspaceArchive(valid, { expectedKind: 'preset' })).rejects.toMatchObject({ code: 'archive-kind-invalid' });

        const entries = unzipSync(new Uint8Array(await valid.arrayBuffer()));
        const manifest = JSON.parse(strFromU8(entries['manifest.json']));
        manifest.assets.images[0].sha256 = '0'.repeat(64);
        entries['manifest.json'] = strToU8(JSON.stringify(manifest));
        const corrupted = new Blob([zipSync(entries)]);
        await expect(readWorkspaceArchive(corrupted)).rejects.toMatchObject({ code: 'image-checksum-mismatch' });
    });

    it('normalizes names and export settings without accepting arbitrary values', () => {
        expect(normalizeWorkspaceName('../ unsafe \\ name')).toBe('.. unsafe name');
        expect(normalizeExportSettings({ format: 'svg', ratio: 99 })).toEqual({ format: 'png', ratio: 1 });
        expect(normalizeExportSettings({ format: 'avif', ratio: 2 })).toEqual({ format: 'avif', ratio: 2 });
    });

    it('rejects crafted malicious ZIP containers before allocating oversized buffers', async () => {
        const minimalManifest = JSON.stringify({
            format: 'screenhello',
            containerVersion: 1,
            kind: 'preset',
            assets: {},
            preset: {},
        });

        // 1. 伪造 originalSize=1 的 2 MiB Store 条目（Store 要求 compressedSize === uncompressedSize）
        const twoMbPayload = new Uint8Array(2 * 1024 * 1024);
        const forgedStore = buildRawZip([{
            name: 'manifest.json',
            method: 0,
            rawData: twoMbPayload,
            compressedSize: twoMbPayload.byteLength,
            uncompressedSize: 1,
        }]);
        await expect(readWorkspaceArchive(forgedStore)).rejects.toMatchObject({ code: 'archive-entry-rejected' });

        // 2. Deflate 伪造小 uncompressedSize（实际解压流超过声明值）
        const sixtyFourKb = new Uint8Array(64 * 1024);
        const forgedDeflate = buildRawZip([{
            name: 'manifest.json',
            method: 8,
            rawData: sixtyFourKb,
            uncompressedSize: 16,
        }]);
        await expect(readWorkspaceArchive(forgedDeflate)).rejects.toMatchObject({ code: 'archive-entry-rejected' });

        // 3. 超出 manifest 上限 (512 KiB) 的高压缩比 zip bomb
        const oversizedManifest = new Uint8Array(600 * 1024);
        oversizedManifest.fill(0x20);
        const manifestBomb = buildRawZip([{
            name: 'manifest.json',
            method: 8,
            rawData: oversizedManifest,
        }]);
        await expect(readWorkspaceArchive(manifestBomb)).rejects.toMatchObject({ code: 'archive-entry-rejected' });

        // 4. Bit 3 Data Descriptor 标志
        const dataDescriptorZip = buildRawZip([{
            name: 'manifest.json',
            method: 0,
            text: minimalManifest,
            flags: 0x08,
        }]);
        await expect(readWorkspaceArchive(dataDescriptorZip)).rejects.toMatchObject({ code: 'archive-entry-rejected' });

        // 5. ZIP64 Locator 签名
        const zip64Archive = buildRawZip([{
            name: 'manifest.json',
            method: 0,
            text: minimalManifest,
        }], { zip64Locator: true });
        await expect(readWorkspaceArchive(zip64Archive)).rejects.toMatchObject({ code: 'archive-entry-rejected' });

        // 6. 重名条目
        const duplicateEntries = buildRawZip([
            { name: 'manifest.json', method: 0, text: minimalManifest },
            { name: 'manifest.json', method: 0, text: minimalManifest },
        ]);
        await expect(readWorkspaceArchive(duplicateEntries)).rejects.toMatchObject({ code: 'archive-entry-rejected' });

        // 7. EOCD 尾部追加多义性/隐藏字节
        const trailingPolyglot = buildRawZip([{
            name: 'manifest.json',
            method: 0,
            text: minimalManifest,
        }], { trailingBytes: strToU8('polyglot-tail') });
        await expect(readWorkspaceArchive(trailingPolyglot)).rejects.toMatchObject({ code: 'archive-invalid' });

        // 8. 破坏严格平铺连续不变式的空洞/重叠布局
        const gappedLayout = buildRawZip([
            { name: 'manifest.json', method: 0, text: minimalManifest },
            { name: 'assets/image.png', method: 0, text: 'img', gapBefore: 16 },
        ]);
        await expect(readWorkspaceArchive(gappedLayout)).rejects.toMatchObject({ code: 'archive-entry-rejected' });
    });
});
