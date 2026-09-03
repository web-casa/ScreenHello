import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocument, defaultOption } from '../../src/utils/projectDocument.js';
import { createStylePreset, normalizeExportSettings, normalizeWorkspaceName } from '../../src/utils/stylePreset.js';
import {
    createPresetArchive,
    createProjectArchive,
    readWorkspaceArchive,
} from '../../src/utils/workspaceArchive.js';

const image = (body = 'image', type = 'image/png', name = 'fixture.png') =>
    new File([body], name, { type });

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
});
