import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserPlatform } from '../../src/platform/browserPlatform.js';
import { createScreenHelloRuntime } from '../../src/stores/index.js';
import { readWorkspaceArchive } from '../../src/utils/workspaceArchive.js';
import { createDocument } from '../../src/utils/projectDocument.js';

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

const createRuntime = (options) => {
    const runtime = createScreenHelloRuntime(options);
    runtimes.push(runtime);
    runtime.testMessages = {
        success: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
    };
    runtime.editor.setMessage(runtime.testMessages);
    runtime.editor.setImg({
        src: 'data:image/png;base64,aW1hZ2U=',
        width: 64,
        height: 48,
        type: 'image/png',
        name: 'fixture.png',
    });
    runtime.option.setBackground('none');
    return runtime;
};

afterEach(() => {
    runtimes.splice(0).forEach((runtime) => runtime.dispose());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('WorkspaceStore', () => {
    it('keeps project-file status independent from draft persistence', () => {
        const runtime = createRuntime();

        runtime.workspace.resetProject();
        expect(runtime.workspace.projectFileStatus).toBe('never-saved');
        expect(runtime.workspace.lastSavedAt).toBeNull();

        runtime.workspace.isDirty = true;
        expect(runtime.workspace.projectFileStatus).toBe('dirty');
        runtime.workspace.busy = 'save';
        expect(runtime.workspace.projectFileStatus).toBe('saving');
        runtime.workspace.busy = null;
        runtime.workspace.saveErrorCode = 'write-failed';
        expect(runtime.workspace.projectFileStatus).toBe('error');

        runtime.workspace._markClean();
        expect(runtime.workspace.projectFileStatus).toBe('saved');
        expect(runtime.workspace.lastSavedAt).toEqual(expect.any(Number));
    });

    it('keeps the current project when a later image fails decoding', async () => {
        class FakeImage {
            width = 64;
            height = 48;
            naturalWidth = 64;
            naturalHeight = 48;
            set src(value) { queueMicrotask(() => value.includes('broken') ? this.onerror?.() : this.onload?.()); }
        }
        const runtime = createRuntime();
        const previousSrc = runtime.editor.img.src;
        vi.stubGlobal('Image', FakeImage);
        vi.spyOn(browserPlatform.file, 'createObjectURL').mockImplementation((file) => `blob:${file.name}`);
        const revoke = vi.spyOn(browserPlatform.file, 'revokeObjectURL').mockImplementation(() => {});
        const document = createDocument({
            images: [
                { id: 'valid', assetId: 'asset-valid', width: 64, height: 48 },
                { id: 'broken', assetId: 'asset-broken', width: 64, height: 48 },
            ],
        });

        await expect(runtime.workspace._applyProject({
            document,
            images: [
                { file: new File(['valid'], 'valid.png', { type: 'image/png' }), assetId: 'asset-valid' },
                { file: new File(['broken'], 'broken.png', { type: 'image/png' }), assetId: 'asset-broken' },
            ],
        })).rejects.toMatchObject({ code: 'project-image-2-decode-failed' });

        expect(runtime.editor.img.src).toBe(previousSrc);
        expect(runtime.imageStore.list).toHaveLength(1);
        expect(revoke).toHaveBeenCalledWith('blob:valid.png');
        expect(revoke).toHaveBeenCalledWith('blob:broken.png');
    });

    it('cancels image preparation on teardown without replacing the project', async () => {
        class PendingImage {
            width = 64;
            height = 48;
            naturalWidth = 64;
            naturalHeight = 48;
            static instance;
            set src(_value) { PendingImage.instance = this; }
        }
        const runtime = createRuntime();
        const previousSrc = runtime.editor.img.src;
        vi.stubGlobal('Image', PendingImage);
        vi.spyOn(browserPlatform.file, 'createObjectURL').mockReturnValue('blob:pending');
        const revoke = vi.spyOn(browserPlatform.file, 'revokeObjectURL').mockImplementation(() => {});
        const document = createDocument({ images: [{ id: 'pending', assetId: 'pending-asset', width: 64, height: 48 }] });
        const opening = runtime.workspace._applyProject({
            document,
            images: [{ file: new File(['pending'], 'pending.png', { type: 'image/png' }), assetId: 'pending-asset' }],
        });
        await vi.waitFor(() => expect(PendingImage.instance).toBeTruthy());
        runtime.workspace.teardown();
        PendingImage.instance.onload();

        await expect(opening).rejects.toMatchObject({ code: 'workspace-operation-cancelled' });
        expect(runtime.editor.img.src).toBe(previousSrc);
        expect(revoke).toHaveBeenCalledWith('blob:pending');
    });

    it('decodes a shared project asset once for duplicate layers', async () => {
        class FakeImage {
            width = 64;
            height = 48;
            naturalWidth = 64;
            naturalHeight = 48;
            set src(_value) { queueMicrotask(() => this.onload?.()); }
        }
        const runtime = createRuntime();
        vi.stubGlobal('Image', FakeImage);
        const createObjectURL = vi.spyOn(browserPlatform.file, 'createObjectURL').mockReturnValue('blob:shared');
        vi.spyOn(browserPlatform.file, 'revokeObjectURL').mockImplementation(() => {});
        const file = new File(['shared'], 'shared.png', { type: 'image/png' });
        const document = createDocument({
            images: [
                { id: 'original', assetId: 'shared-asset', width: 64, height: 48 },
                { id: 'duplicate', assetId: 'shared-asset', width: 64, height: 48 },
            ],
        });

        await runtime.workspace._applyProject({
            document,
            images: [
                { file, assetId: 'shared-asset' },
                { file, assetId: 'shared-asset' },
            ],
        });

        expect(createObjectURL).toHaveBeenCalledOnce();
        expect(runtime.imageStore.list).toHaveLength(2);
        expect(runtime.imageStore.resources.size).toBe(1);
    });

    it('does not notify or clear a newer busy state when a stale draft open finishes', async () => {
        const runtime = createRuntime();
        const record = deferred();
        vi.spyOn(runtime.draftStore, 'loadProjectRecord').mockReturnValue(record.promise);

        const opening = runtime.workspace.openDraft('stale-draft');
        expect(runtime.workspace.busy).toBe('open-draft');
        runtime.workspace.teardown();
        runtime.workspace.busy = 'new-operation';
        record.resolve(null);

        await expect(opening).resolves.toBe(false);
        expect(runtime.workspace.busy).toBe('new-operation');
        expect(runtime.testMessages.error).not.toHaveBeenCalled();
        expect(runtime.testMessages.success).not.toHaveBeenCalled();
    });

    it('does not restart a recent-project open after workspace teardown', async () => {
        const runtime = createRuntime();
        const record = deferred();
        vi.spyOn(runtime.draftStore, 'loadRecentProject').mockReturnValue(record.promise);
        const openProjectFile = vi.spyOn(runtime.workspace, 'openProjectFile').mockResolvedValue(true);

        const opening = runtime.workspace.openRecentProject('stale-recent');
        runtime.workspace.teardown();
        record.resolve({
            blob: new Blob(['project'], { type: 'application/x-screenhello-project' }),
            fileName: 'stale.screenhello',
            name: 'Stale',
        });

        await expect(opening).resolves.toBe(false);
        expect(openProjectFile).not.toHaveBeenCalled();
        expect(runtime.testMessages.error).not.toHaveBeenCalled();
    });

    it('does not apply a preset that finishes loading after workspace teardown', async () => {
        const runtime = createRuntime();
        const record = deferred();
        vi.spyOn(runtime.draftStore, 'loadPreset').mockReturnValue(record.promise);
        const commit = vi.spyOn(runtime.history, 'commit');
        runtime.option.setPadding(12);
        commit.mockClear();

        const applying = runtime.workspace.applyPreset('stale-preset');
        runtime.workspace.teardown();
        record.resolve({
            name: 'Stale preset',
            preset: {
                option: { ...runtime.option.toDocument(), padding: 99 },
                exportSettings: { format: 'png', ratio: 1 },
            },
        });

        await expect(applying).resolves.toBe(false);
        expect(runtime.option.padding).toBe(12);
        expect(commit).not.toHaveBeenCalled();
        expect(runtime.testMessages.success).not.toHaveBeenCalled();
        expect(runtime.testMessages.error).not.toHaveBeenCalled();
    });

    it('does not refresh the library after a preset write outlives workspace teardown', async () => {
        const runtime = createRuntime();
        const pendingSave = deferred();
        vi.spyOn(runtime.draftStore, 'loadPreset').mockResolvedValue({
            id: 'source',
            name: 'Source',
            preset: {
                option: runtime.option.toDocument(),
                exportSettings: { format: 'png', ratio: 1 },
            },
        });
        const savePreset = vi.spyOn(runtime.draftStore, 'savePreset').mockReturnValue(pendingSave.promise);
        const refreshLibrary = vi.spyOn(runtime.workspace, 'refreshLibrary').mockResolvedValue(true);

        const duplicating = runtime.workspace.duplicatePreset('source');
        await vi.waitFor(() => expect(savePreset).toHaveBeenCalledOnce());
        runtime.workspace.teardown();
        pendingSave.resolve();

        await expect(duplicating).resolves.toBe(false);
        expect(refreshLibrary).not.toHaveBeenCalled();
        expect(runtime.testMessages.error).not.toHaveBeenCalled();
    });

    it('does not mark the project dirty when only the active layer changes', async () => {
        const runtime = createRuntime();
        const firstId = runtime.imageStore.activeId;
        const second = runtime.imageStore.add({
            src: 'data:image/png;base64,c2Vjb25k', width: 32, height: 24, type: 'image/png', name: 'second.png',
        });
        vi.spyOn(runtime.draftStore, 'isAvailable').mockReturnValue(true);
        vi.spyOn(runtime.draftStore, 'listPresets').mockResolvedValue([]);
        vi.spyOn(runtime.draftStore, 'listRecentProjects').mockResolvedValue([]);
        vi.spyOn(runtime.draftStore, 'listProjects').mockResolvedValue([]);
        vi.spyOn(browserPlatform.storage, 'estimate').mockResolvedValue({ supported: false, usage: null, quota: null });
        runtime.workspace.setup(true);
        await vi.waitFor(() => expect(runtime.workspace.ready).toBe(true));
        runtime.imageStore.select([firstId]);
        runtime.workspace._markClean();

        runtime.imageStore.select([second.id]);

        expect(runtime.workspace.isDirty).toBe(false);
    });

    it('ignores library and storage results that finish after teardown', async () => {
        const runtime = createRuntime();
        const presets = deferred();
        const estimate = deferred();
        vi.spyOn(runtime.draftStore, 'listPresets').mockReturnValue(presets.promise);
        vi.spyOn(runtime.draftStore, 'listRecentProjects').mockResolvedValue([]);
        vi.spyOn(runtime.draftStore, 'listProjects').mockResolvedValue([]);
        vi.spyOn(browserPlatform.storage, 'estimate').mockReturnValue(estimate.promise);
        vi.spyOn(browserPlatform.storage, 'isPersisted').mockResolvedValue(true);

        runtime.workspace.setup(true);
        runtime.workspace.teardown();
        presets.resolve([{ id: 'stale-preset' }]);
        estimate.resolve({ supported: true, usage: 12, quota: 24 });
        await Promise.all([presets.promise, estimate.promise]);
        await vi.waitFor(() => expect(runtime.workspace.ready).toBe(false));

        expect(runtime.workspace.enabled).toBe(false);
        expect(runtime.workspace.presets).toEqual([]);
        expect(runtime.workspace.storage).toEqual({
            supported: false,
            usage: null,
            quota: null,
            persistence: 'unknown',
        });
    });

    it('does not update persistence state or notify after teardown', async () => {
        const runtime = createRuntime();
        const persistence = deferred();
        vi.spyOn(browserPlatform.storage, 'requestPersistence').mockReturnValue(persistence.promise);

        const request = runtime.workspace.requestPersistentStorage();
        runtime.workspace.teardown();
        persistence.resolve(true);

        await expect(request).resolves.toBe(true);
        expect(runtime.workspace.storage.persistence).toBe('unknown');
        expect(runtime.testMessages.success).not.toHaveBeenCalled();
    });

    it('saves a portable project with download fallback and a local recent copy', async () => {
        const runtime = createRuntime();
        const download = vi.spyOn(browserPlatform.export, 'download').mockResolvedValue(undefined);
        vi.spyOn(browserPlatform.file, 'supportsFileSystemAccess').mockReturnValue(false);
        vi.spyOn(browserPlatform.storage, 'estimate').mockResolvedValue({ supported: false, usage: null, quota: null });
        const saveRecentProject = vi.spyOn(runtime.draftStore, 'saveRecentProject').mockResolvedValue(undefined);
        vi.spyOn(runtime.draftStore, 'listRecentProjects').mockResolvedValue([]);
        vi.spyOn(runtime.draftStore, 'listPresets').mockResolvedValue([]);
        vi.spyOn(runtime.draftStore, 'listProjects').mockResolvedValue([]);

        runtime.workspace.setProjectName('Release / Card');
        runtime.workspace.setProjectName('Release / Card ');
        expect(runtime.workspace.projectName).toBe('Release / Card ');
        runtime.workspace.setExportSettings({ format: 'webp', ratio: 2 });

        await expect(runtime.workspace.saveProject()).resolves.toBe(true);
        expect(download).toHaveBeenCalledWith(expect.any(Blob), 'Release Card.screenhello');
        expect(saveRecentProject).toHaveBeenCalledOnce();
        const savedBlob = saveRecentProject.mock.calls[0][0].blob;
        const decoded = await readWorkspaceArchive(savedBlob, { expectedKind: 'project' });
        expect(decoded.name).toBe('Release Card');
        expect(decoded.exportSettings).toEqual({ format: 'webp', ratio: 2 });
        expect(await decoded.image.text()).toBe('image');
        expect(decoded.images).toHaveLength(1);
        expect(runtime.workspace.isDirty).toBe(false);
    });

    it('does not report a successful file write as failed when recent caching is unavailable', async () => {
        const runtime = createRuntime();
        const handle = { createWritable: vi.fn() };
        vi.spyOn(browserPlatform.file, 'supportsFileSystemAccess').mockReturnValue(true);
        vi.spyOn(browserPlatform.file, 'chooseSaveHandle').mockResolvedValue({ status: 'selected', handle });
        vi.spyOn(browserPlatform.file, 'writeToHandle').mockResolvedValue(undefined);
        vi.spyOn(browserPlatform.storage, 'estimate').mockResolvedValue({ supported: false, usage: null, quota: null });
        vi.spyOn(runtime.draftStore, 'saveRecentProject').mockRejectedValue(new DOMException('quota', 'QuotaExceededError'));

        await expect(runtime.workspace.saveProject()).resolves.toBe(true);
        expect(browserPlatform.file.chooseSaveHandle).toHaveBeenCalledOnce();
        expect(browserPlatform.file.writeToHandle).toHaveBeenCalledWith(handle, expect.any(Blob));
        expect(runtime.testMessages.warning).toHaveBeenCalledWith('项目文件已保存，但浏览器存储空间不足，未加入最近项目');
        expect(runtime.testMessages.error).not.toHaveBeenCalled();
    });

    it('retains the active desktop project handle and releases replaced or failed handles', async () => {
        const first = { platform: 'desktop', token: 'a'.repeat(48), kind: 'project' };
        const second = { platform: 'desktop', token: 'b'.repeat(48), kind: 'project' };
        const failed = { platform: 'desktop', token: 'c'.repeat(48), kind: 'project' };
        const releaseHandle = vi.fn().mockResolvedValue(undefined);
        const chooseSaveHandle = vi.fn()
            .mockResolvedValueOnce({ status: 'selected', handle: first })
            .mockResolvedValueOnce({ status: 'selected', handle: second })
            .mockResolvedValueOnce({ status: 'selected', handle: failed });
        const writeToHandle = vi.fn()
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('/private/path/write-failed'));
        const platform = {
            ...browserPlatform,
            file: {
                ...browserPlatform.file,
                supportsFileSystemAccess: () => true,
                chooseSaveHandle,
                writeToHandle,
                releaseHandle,
            },
        };
        const runtime = createRuntime({ platform });
        vi.spyOn(runtime.draftStore, 'saveRecentProject').mockResolvedValue(undefined);
        vi.spyOn(runtime.draftStore, 'listRecentProjects').mockResolvedValue([]);
        vi.spyOn(runtime.draftStore, 'listPresets').mockResolvedValue([]);
        vi.spyOn(runtime.draftStore, 'listProjects').mockResolvedValue([]);

        await expect(runtime.workspace.saveProject()).resolves.toBe(true);
        expect(runtime.workspace.fileHandle).toBe(first);
        expect(releaseHandle).not.toHaveBeenCalledWith(first);

        await expect(runtime.workspace.saveProject({ saveAs: true })).resolves.toBe(true);
        await vi.waitFor(() => expect(releaseHandle).toHaveBeenCalledWith(first));
        expect(runtime.workspace.fileHandle).toBe(second);

        await expect(runtime.workspace.saveProject({ saveAs: true })).resolves.toBe(false);
        expect(runtime.workspace.fileHandle).toBe(second);
        expect(releaseHandle).toHaveBeenCalledWith(failed);
        expect(runtime.testMessages.error).toHaveBeenCalledWith('项目保存失败，请重试');
    });

    it('stores, duplicates, renames, applies, and deletes style presets', async () => {
        const runtime = createRuntime();
        const records = new Map();
        vi.spyOn(runtime.draftStore, 'savePreset').mockImplementation(async (record) => { records.set(record.id, record); });
        vi.spyOn(runtime.draftStore, 'loadPreset').mockImplementation(async (id) => records.get(id) || null);
        vi.spyOn(runtime.draftStore, 'deletePreset').mockImplementation(async (id) => { records.delete(id); });
        vi.spyOn(runtime.draftStore, 'listPresets').mockImplementation(async () => Array.from(records.values()));
        vi.spyOn(runtime.draftStore, 'listRecentProjects').mockResolvedValue([]);
        vi.spyOn(runtime.draftStore, 'listProjects').mockResolvedValue([]);
        vi.spyOn(browserPlatform.storage, 'estimate').mockResolvedValue({ supported: false, usage: null, quota: null });

        runtime.option.setPadding(32);
        await expect(runtime.workspace.savePreset('Blue Card')).resolves.toBe(true);
        const firstId = Array.from(records.keys())[0];
        await expect(runtime.workspace.duplicatePreset(firstId)).resolves.toBe(true);
        const duplicateId = Array.from(records.keys()).find((id) => id !== firstId);
        await expect(runtime.workspace.renamePreset(duplicateId, 'Hero')).resolves.toBe(true);

        runtime.option.setPadding(0);
        await expect(runtime.workspace.applyPreset(duplicateId)).resolves.toBe(true);
        expect(runtime.option.padding).toBe(32);
        expect(records.get(duplicateId).name).toBe('Hero');

        await runtime.workspace.deletePreset(firstId);
        expect(records.has(firstId)).toBe(false);
    });
});
