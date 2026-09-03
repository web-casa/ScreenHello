import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScreenHelloRuntime } from '../../src/stores/index.js';
import { browserPlatform } from '../../src/platform/browserPlatform.js';
import { createDocument } from '../../src/utils/projectDocument.js';

class FakeImage {
    width = 80;
    height = 60;
    naturalWidth = 80;
    naturalHeight = 60;
    set src(_value) { queueMicrotask(() => this.onload?.()); }
}

const runtimes = [];
const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};
const createRuntime = () => {
    const runtime = createScreenHelloRuntime();
    runtimes.push(runtime);
    return runtime;
};

afterEach(() => {
    runtimes.splice(0).forEach((runtime) => runtime.dispose());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('DraftService multi-image persistence', () => {
    it('writes every image asset before committing a V2 document', async () => {
        const runtime = createRuntime();
        runtime.editor.replaceImg({ src: 'data:image/png;base64,one', width: 64, height: 48, name: 'one.png', type: 'image/png' });
        runtime.imageStore.add({ src: 'data:image/png;base64,two', width: 32, height: 24, name: 'two.png', type: 'image/png' });
        runtime.draftService.setup({ key: 'multi', autoRestore: false });
        vi.spyOn(runtime.draftService, '_srcToBlob').mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
        const events = [];
        vi.spyOn(runtime.draftStore, 'saveAsset').mockImplementation(async (id) => { events.push(`asset:${id}`); });
        const saveProject = vi.spyOn(runtime.draftStore, 'saveProject').mockImplementation(async (_key, doc) => {
            events.push('project');
            expect(doc.version).toBe(2);
            expect(doc.images).toHaveLength(2);
        });

        await expect(runtime.draftService.flush()).resolves.toBe(true);

        expect(saveProject).toHaveBeenCalledOnce();
        expect(events.filter((event) => event.startsWith('asset:'))).toHaveLength(2);
        expect(events.at(-1)).toBe('project');
    });

    it('does not commit the document when a later image asset fails', async () => {
        const runtime = createRuntime();
        runtime.editor.replaceImg({ src: 'data:image/png;base64,one', width: 64, height: 48, name: 'one.png', type: 'image/png' });
        runtime.imageStore.add({ src: 'data:image/png;base64,two', width: 32, height: 24, name: 'two.png', type: 'image/png' });
        runtime.editor.setMessage({ warning: vi.fn() });
        runtime.draftService.setup({ key: 'multi-fail', autoRestore: false });
        vi.spyOn(runtime.draftService, '_srcToBlob').mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
        vi.spyOn(runtime.draftStore, 'saveAsset')
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('idb-transaction-failed'));
        const saveProject = vi.spyOn(runtime.draftStore, 'saveProject').mockResolvedValue(undefined);

        await expect(runtime.draftService.flush()).resolves.toBe(true);
        expect(saveProject).not.toHaveBeenCalled();
    });

    it('does not report an obsolete save failure after teardown', async () => {
        const runtime = createRuntime();
        const warning = vi.fn();
        const pendingSave = deferred();
        runtime.editor.setMessage({ warning });
        runtime.editor.replaceImg({ src: 'data:image/png;base64,one', width: 64, height: 48, name: 'one.png', type: 'image/png' });
        runtime.draftService.setup({ key: 'stale-save', autoRestore: false });
        vi.spyOn(runtime.draftService, '_srcToBlob').mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
        const saveAsset = vi.spyOn(runtime.draftStore, 'saveAsset').mockReturnValue(pendingSave.promise);

        const flushing = runtime.draftService.flush();
        await vi.waitFor(() => expect(saveAsset).toHaveBeenCalledOnce());
        runtime.draftService.teardown();
        pendingSave.reject(new Error('idb-transaction-failed'));
        await flushing;

        expect(warning).not.toHaveBeenCalled();
        expect(runtime.draftService._autosaveEnabled).toBe(true);
    });

    it('removes a stored draft when history restores an empty image list', async () => {
        const runtime = createRuntime();
        runtime.editor.replaceImg({ src: 'data:image/png;base64,one', width: 64, height: 48, name: 'one.png', type: 'image/png' });
        runtime.draftService.setup({ key: 'multi-empty', autoRestore: false });
        const events = [];
        const deleteProject = vi.spyOn(runtime.draftStore, 'deleteProject').mockImplementation(async () => { events.push('project'); });
        const deleteAssets = vi.spyOn(runtime.draftStore, 'deleteAssetsByKey').mockImplementation(async () => { events.push('assets'); });
        const saveProject = vi.spyOn(runtime.draftStore, 'saveProject').mockResolvedValue(undefined);

        runtime.imageStore.clearAll({ release: false });
        await expect(runtime.draftService.flush()).resolves.toBe(true);

        expect(deleteProject).toHaveBeenCalledWith('multi-empty');
        expect(deleteAssets).toHaveBeenCalledWith('multi-empty');
        expect(events).toEqual(['project', 'assets']);
        expect(saveProject).not.toHaveBeenCalled();
    });

    it('restores every V2 image and trusts decoded dimensions over stored metadata', async () => {
        const runtime = createRuntime();
        const document = createDocument({
            images: [
                { id: 'one', assetId: 'asset-one', width: 999, height: 999, name: 'one.png' },
                { id: 'two', assetId: 'asset-two', width: 999, height: 999, name: 'two.png' },
            ],
        });
        runtime.draftService.setup({ key: 'multi-restore', autoRestore: true });
        vi.spyOn(runtime.draftStore, 'isAvailable').mockReturnValue(true);
        vi.spyOn(runtime.draftStore, 'loadProject').mockResolvedValue(document);
        vi.spyOn(runtime.draftStore, 'loadAsset').mockImplementation(async (id) => ({
            blob: new Blob([id], { type: 'image/png' }),
            type: 'image/png',
            name: `${id}.png`,
        }));
        vi.stubGlobal('Image', FakeImage);
        vi.spyOn(browserPlatform.file, 'createObjectURL')
            .mockReturnValueOnce('blob:one')
            .mockReturnValueOnce('blob:two');
        vi.spyOn(browserPlatform.file, 'revokeObjectURL').mockImplementation(() => {});

        await expect(runtime.draftService.restore()).resolves.toBe(true);

        expect(runtime.imageStore.list).toHaveLength(2);
        expect(runtime.imageStore.list.every((layer) => layer.width === 80 && layer.height === 60)).toBe(true);
        expect(runtime.editor.img.src).toBe('blob:one');
    });

    it('loads and decodes a shared draft asset once for duplicate layers', async () => {
        const runtime = createRuntime();
        const document = createDocument({
            images: [
                { id: 'original', assetId: 'asset-shared', width: 80, height: 60 },
                { id: 'duplicate', assetId: 'asset-shared', width: 80, height: 60 },
            ],
        });
        runtime.draftService.setup({ key: 'shared-restore', autoRestore: true });
        vi.spyOn(runtime.draftStore, 'isAvailable').mockReturnValue(true);
        vi.spyOn(runtime.draftStore, 'loadProject').mockResolvedValue(document);
        const loadAsset = vi.spyOn(runtime.draftStore, 'loadAsset').mockResolvedValue({
            blob: new Blob(['shared'], { type: 'image/png' }),
            type: 'image/png',
            name: 'shared.png',
        });
        vi.stubGlobal('Image', FakeImage);
        const createObjectURL = vi.spyOn(browserPlatform.file, 'createObjectURL').mockReturnValue('blob:shared');
        vi.spyOn(browserPlatform.file, 'revokeObjectURL').mockImplementation(() => {});

        await expect(runtime.draftService.restore()).resolves.toBe(true);

        expect(loadAsset).toHaveBeenCalledOnce();
        expect(createObjectURL).toHaveBeenCalledOnce();
        expect(runtime.imageStore.list).toHaveLength(2);
        expect(runtime.imageStore.resources.size).toBe(1);
    });
});
