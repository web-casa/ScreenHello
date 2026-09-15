import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { createScreenHelloRuntime } from '../../src/stores/index.js';
import { PRESET_BACKGROUNDS } from '../../src/utils/presetBackgrounds.js';
import { normalizeOption, createDocument } from '../../src/utils/projectDocument.js';
import { prepareWorkspaceImage } from '../../src/utils/imageValidation.js';
import { createProjectArchive, createPresetArchive, readWorkspaceArchive } from '../../src/utils/workspaceArchive.js';
import { createStylePreset } from '../../src/utils/stylePreset.js';
import { isCorePrecacheEntry } from '../../config/pwaConfig.js';
import { englishMessages } from '../../src/i18n/catalog.js';
import { catalogs } from '../../src/i18n/messages.js';

vi.mock('../../src/utils/imageValidation.js', () => ({ prepareWorkspaceImage: vi.fn(async () => ({ width: 1536, height: 1024 })) }));
const runtimes = [];
const runtime = () => { const root = createScreenHelloRuntime(); root.history.reset(); runtimes.push(root); return root; };
const blob = () => new Blob(['image'], { type: 'image/webp' });
const response = () => ({ ok: true, blob: async () => blob() });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
afterEach(() => {
    runtimes.splice(0).forEach(root => root.dispose());
    vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
    prepareWorkspaceImage.mockResolvedValue({ width: 1536, height: 1024 });
});

describe('local preset backgrounds', () => {
    it('ships 25 stable separate image/thumbnail pairs inside a bounded budget', () => {
        const manifest = JSON.parse(readFileSync(new URL('../../src/assets/backgrounds/manifest.json', import.meta.url), 'utf8'));
        expect(PRESET_BACKGROUNDS).toHaveLength(25);
        expect(new Set(PRESET_BACKGROUNDS.map(x => x.key)).size).toBe(25);
        for (const entry of PRESET_BACKGROUNDS) {
            expect(englishMessages[entry.label]).toBeTruthy();
            for (const catalog of Object.values(catalogs)) expect(catalog[entry.label]).toBeTruthy();
        }
        let imageBytes = 0, thumbBytes = 0;
        for (const asset of manifest.assets) {
            for (const kind of ['image', 'thumb']) {
                const file = new URL(`../../src/assets/backgrounds/${asset[kind].file}`, import.meta.url);
                expect(statSync(file).size).toBe(asset[kind].bytes);
                expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(asset[kind].sha256);
            }
            imageBytes += asset.image.bytes; thumbBytes += asset.thumb.bytes;
            expect(isCorePrecacheEntry({ url: `assets/bg-image-${asset.id}-abcdefgh.webp`, size: asset.image.bytes })).toBe(false);
            expect(isCorePrecacheEntry({ url: `assets/bg-thumb-${asset.id}-abcdefgh.webp`, size: asset.thumb.bytes })).toBe(true);
        }
        expect(imageBytes).toBeLessThan(3 * 1024 * 1024); expect(thumbBytes).toBeLessThan(96 * 1024);
    });

    it('commits decoded blobs, keeps instance isolation and strips persisted URLs', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response()));
        const first = runtime(), second = runtime();
        expect(await first.option.applyBackground('image_n01_v1')).toBe(true);
        expect(first.option.frameConf.background.url).toMatch(/^blob:/);
        const doc = first.option.toDocument();
        expect(doc.frameConf.background.url).toBeNull();
        expect(normalizeOption(doc).backgroundAssetId).toBe(first.option.backgroundAssetId);
        expect(normalizeOption({ ...doc, frameConf: { background: { url: 'https://untrusted.test/a.png' } } }).frameConf.background.url).toBeNull();
        expect(normalizeOption({ ...doc, background: 'gh_img_50' }).backgroundAssetId).toBeNull();
        expect(second.option.background).toBe('gh_img_50'); expect(second.assetStore.assets.size).toBe(0);
        expect(first.option.setBackground('image_n02_v1')).toBe(false);
    });

    it('retains uploaded and preset backgrounds for undo/redo and prunes only committed history assets', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response()));
        const root = runtime();
        const uploaded = root.assetStore.add(blob()); root.option.setUploadedBackground(uploaded);
        await root.option.applyBackground('image_n01_v1');
        const presetId = root.option.backgroundAssetId;
        root.option.setBackground('none');
        root.history.undo(); expect(root.option.frameConf.background.url).toBe(root.assetStore.get(presetId).url);
        root.history.undo(); expect(root.option.frameConf.background.url).toBe(uploaded.url);
        root.history.redo(); expect(root.option.backgroundAssetId).toBe(presetId);
        const staging = root.assetStore.add(blob());
        root.history.reset();
        expect(root.assetStore.get(uploaded.id)).toBeNull();
        expect(root.assetStore.get(presetId)).toBeTruthy(); expect(root.assetStore.get(staging.id)).toBeTruthy();
        root.option.setBackground('none'); root.history.reset(); expect(root.assetStore.get(presetId)).toBeNull();
    });

    it('keeps the newest selection even when fetch ignores abort', async () => {
        const slow = deferred(); vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(slow.promise).mockResolvedValue(response()));
        const root = runtime(); const old = root.option.applyBackground('image_n01_v1');
        expect(await root.option.applyBackground('image_n02_v1')).toBe(true);
        expect(await old).toBe(false); slow.resolve(response()); await Promise.resolve();
        expect(root.option.background).toBe('image_n02_v1'); expect(root.assetStore.assets.size).toBe(1);
    });

    it.each(['cancel', 'solid', 'restore', 'clear', 'dispose'])('cancels a pending selection on %s without a stale commit', async action => {
        const slow = deferred(); vi.stubGlobal('fetch', vi.fn(() => slow.promise)); const root = runtime();
        const old = root.option.applyBackground('image_n01_v1');
        if (action === 'cancel') root.option.cancelBackgroundSelection();
        if (action === 'solid') root.option.setCustomSolidBackground('#ff0000');
        if (action === 'restore') root.option.restoreFromDocument({ background: 'none' });
        if (action === 'clear') root.editor.clearImg();
        if (action === 'dispose') root.dispose();
        expect(await old).toBe(false); slow.resolve(response()); await Promise.resolve();
        expect(root.option.background).not.toBe('image_n01_v1'); expect(root.assetStore.assets.size).toBe(0);
        expect(root.option.backgroundError).toBe(false);
    });

    it('preserves the old background on network, decode and timeout failures and supports retry', async () => {
        const root = runtime(); vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
        await expect(root.option.applyBackground('image_n01_v1')).rejects.toThrow('404');
        expect(root.option.background).toBe('gh_img_50'); expect(root.option.backgroundError).toBe(true);
        fetch.mockResolvedValue(response()); prepareWorkspaceImage.mockRejectedValueOnce(new Error('decode-failed'));
        await expect(root.option.applyBackground('image_n01_v1')).rejects.toThrow('decode-failed');
        expect(root.assetStore.assets.size).toBe(0);
        vi.useFakeTimers(); fetch.mockReturnValueOnce(new Promise(() => {}));
        const pending = expect(root.option.applyBackground('image_n01_v1')).rejects.toThrow('background-load-timeout');
        await vi.advanceTimersByTimeAsync(15_000); await pending; vi.useRealTimers();
        expect(await root.option.applyBackground('image_n01_v1')).toBe(true);
        expect(root.option.backgroundError).toBe(false);
    });

    it('round-trips local project/preset bytes and refuses missing backgrounds', async () => {
        const option = normalizeOption({ background: 'image_u22_v1', backgroundAssetId: 'owned' });
        const document = createDocument({ option, image: { width: 64, height: 48, type: 'image/png' } });
        const file = new File(['fixture'], 'fixture.png', { type: 'image/png' });
        await expect(createProjectArchive({ document, image: file })).rejects.toThrow('background-asset-missing');
        const project = await createProjectArchive({ document, image: file, background: blob() });
        const read = await readWorkspaceArchive(project);
        expect(read.document.option.background).toBe('image_u22_v1'); expect(await read.background.text()).toBe('image');
        const preset = createStylePreset({ option });
        await expect(createPresetArchive({ preset })).rejects.toThrow('background-asset-missing');
        const restored = await readWorkspaceArchive(await createPresetArchive({ preset, background: blob() }));
        expect(restored.preset.option.background).toBe('image_u22_v1'); expect(await restored.background.text()).toBe('image');
    });
});
