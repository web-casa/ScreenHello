import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInAction } from 'mobx';
import { createScreenHelloRuntime } from '../../src/stores/index.js';

/**
 * 低频、代价高的本地资料库删除（草稿/项目、预设、最近项目记录）：
 * 保留二次确认，删除后仍可用 toast 撤销一次，快照只活在提示打开的这段时间里。
 */

const runtimes = [];

const createRuntime = () => {
    const runtime = createScreenHelloRuntime({ locale: 'en-US' });
    runtimes.push(runtime);
    runtime.activate();
    const messages = {
        open: vi.fn(() => vi.fn()),
        success: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
    };
    runtime.editor.setMessage(messages);
    vi.spyOn(runtime.draftStore, 'isAvailable').mockReturnValue(true);
    vi.spyOn(runtime.draftStore, 'listPresets').mockResolvedValue([]);
    vi.spyOn(runtime.draftStore, 'listRecentProjects').mockResolvedValue([]);
    vi.spyOn(runtime.draftStore, 'listProjects').mockResolvedValue([]);
    vi.spyOn(runtime.workspace, 'refreshStorage').mockResolvedValue(null);
    return { runtime, messages, open: messages.open };
};

const lastNotice = (open) => open.mock.calls.at(-1)[0];
const toastLabel = (open) => lastNotice(open).content.props.children[0].props.children;
const clickUndo = (open) => lastNotice(open).content.props.children[1].props.onClick();

afterEach(() => {
    runtimes.splice(0).forEach((runtime) => runtime.dispose());
    vi.restoreAllMocks();
});

describe('library deletions keep a session undo', () => {
    it('does not treat a failed freshness read as permission to overwrite a draft', async () => {
        const { runtime } = createRuntime();
        vi.spyOn(runtime.draftStore, 'loadProjectRecord').mockRejectedValue(new Error('temporary-read-failure'));
        const save = vi.spyOn(runtime.draftStore, 'saveProject').mockResolvedValue(undefined);
        await expect(runtime.workspace._restoreDraftSnapshot({
            record: { key: 'draft:1', doc: {}, updatedAt: 1 }, assets: [],
        })).rejects.toThrow('temporary-read-failure');
        expect(save).not.toHaveBeenCalled();
    });

    it('stops restoring a draft if its instance is disposed while reading storage', async () => {
        const { runtime } = createRuntime();
        let finishRead;
        vi.spyOn(runtime.draftStore, 'loadProjectRecord').mockReturnValue(new Promise(resolve => { finishRead = resolve; }));
        const save = vi.spyOn(runtime.draftStore, 'saveProject').mockResolvedValue(undefined);
        const restore = runtime.workspace._restoreDraftSnapshot({ record: { key: 'draft:1', doc: {} }, assets: [] });
        runtime.dispose();
        finishRead(null);
        await expect(restore).rejects.toMatchObject({ code: 'workspace-operation-cancelled' });
        expect(save).not.toHaveBeenCalled();
    });

    it('does not start another asset or project write after teardown during an asset write', async () => {
        const { runtime } = createRuntime();
        vi.spyOn(runtime.draftStore, 'loadProjectRecord').mockResolvedValue(null);
        const asset = vi.spyOn(runtime.draftStore, 'saveAsset').mockImplementation(async () => { runtime.dispose(); });
        const save = vi.spyOn(runtime.draftStore, 'saveProject').mockResolvedValue(undefined);
        await expect(runtime.workspace._restoreDraftSnapshot({
            record: { key: 'draft:1', doc: {} }, assets: [{ id: 'one' }, { id: 'two' }],
        })).rejects.toMatchObject({ code: 'workspace-operation-cancelled' });
        expect(asset).toHaveBeenCalledOnce();
        expect(save).not.toHaveBeenCalled();
    });

    it('writes a deleted draft and its assets back when the toast is used', async () => {
        const { runtime, open } = createRuntime();
        const doc = { version: 1, option: { padding: 32 }, images: [{ assetId: 'asset:1' }], shapes: [] };
        const record = { key: 'draft:1', doc, kind: 'draft', name: 'Landing 项目', updatedAt: 111 };
        const asset = {
            id: 'asset:1', key: 'draft:1', type: 'image/png', name: 'shot.png', purpose: 'image',
            blob: new Blob(['bytes'], { type: 'image/png' }),
        };
        vi.spyOn(runtime.draftStore, 'loadProjectRecord').mockResolvedValue(record);
        vi.spyOn(runtime.draftStore, 'listAssetsByKey').mockResolvedValue([asset]);
        const deleteProject = vi.spyOn(runtime.draftStore, 'deleteProject').mockResolvedValue(undefined);
        vi.spyOn(runtime.draftStore, 'deleteAssetsByKey').mockResolvedValue(undefined);
        const saveProject = vi.spyOn(runtime.draftStore, 'saveProject').mockResolvedValue(undefined);
        const saveAsset = vi.spyOn(runtime.draftStore, 'saveAsset').mockResolvedValue(undefined);

        expect(await runtime.workspace.deleteDraft('draft:1')).toBe(true);
        expect(deleteProject).toHaveBeenCalledWith('draft:1');
        expect(toastLabel(open)).toBe('Deleted “Landing 项目”');

        clickUndo(open);
        await vi.waitFor(() => expect(saveAsset).toHaveBeenCalledOnce());
        expect(saveProject).toHaveBeenCalledWith('draft:1', doc, { kind: 'draft', name: 'Landing 项目', updatedAt: 111 });
        expect(saveAsset).toHaveBeenCalledWith('asset:1', 'draft:1', asset);
    });

    it('falls back to the untitled label when the draft has no name', async () => {
        const { runtime, open } = createRuntime();
        vi.spyOn(runtime.draftStore, 'loadProjectRecord').mockResolvedValue({ key: 'draft:2', doc: {}, name: null, updatedAt: 1 });
        vi.spyOn(runtime.draftStore, 'listAssetsByKey').mockResolvedValue([]);
        vi.spyOn(runtime.draftStore, 'deleteProject').mockResolvedValue(undefined);
        vi.spyOn(runtime.draftStore, 'deleteAssetsByKey').mockResolvedValue(undefined);

        expect(await runtime.workspace.deleteDraft('draft:2')).toBe(true);
        expect(toastLabel(open)).toBe('Deleted “Untitled project”');
    });

    it('restores a deleted preset including its background blob', async () => {
        const { runtime, open } = createRuntime();
        const backgroundBlob = new Blob(['bg'], { type: 'image/png' });
        const record = {
            id: 'preset:1', name: 'Blue card', preset: { option: { padding: 24 } },
            backgroundBlob, backgroundType: 'image/png', createdAt: 10, updatedAt: 20,
        };
        vi.spyOn(runtime.draftStore, 'loadPreset').mockResolvedValue(record);
        const deletePreset = vi.spyOn(runtime.draftStore, 'deletePreset').mockResolvedValue(undefined);
        const savePreset = vi.spyOn(runtime.draftStore, 'savePreset').mockResolvedValue(undefined);

        expect(await runtime.workspace.deletePreset('preset:1')).toBe(true);
        expect(deletePreset).toHaveBeenCalledWith('preset:1');
        expect(toastLabel(open)).toBe('Deleted “Blue card”');

        clickUndo(open);
        await vi.waitFor(() => expect(savePreset).toHaveBeenCalledOnce());
        expect(savePreset).toHaveBeenCalledWith(record);
    });

    it('restores a removed recent-project entry together with its current marker', async () => {
        const { runtime, open } = createRuntime();
        const record = {
            id: 'recent:1', name: 'Phase 5 项目', blob: new Blob(['zip'], { type: 'application/zip' }), updatedAt: 30,
        };
        vi.spyOn(runtime.draftStore, 'loadRecentProject').mockResolvedValue(record);
        const deleteRecent = vi.spyOn(runtime.draftStore, 'deleteRecentProject').mockResolvedValue(undefined);
        const saveRecent = vi.spyOn(runtime.draftStore, 'saveRecentProject').mockResolvedValue(undefined);

        runInAction(() => { runtime.workspace.currentRecentId = 'recent:1'; });
        expect(await runtime.workspace.deleteRecentProject('recent:1')).toBe(true);
        expect(deleteRecent).toHaveBeenCalledWith('recent:1');
        expect(runtime.workspace.currentRecentId).toBeNull();
        expect(toastLabel(open)).toBe('Removed record “Phase 5 项目”');

        clickUndo(open);
        await vi.waitFor(() => expect(saveRecent).toHaveBeenCalledOnce());
        expect(saveRecent).toHaveBeenCalledWith(record);
        expect(runtime.workspace.currentRecentId).toBe('recent:1');
    });

    it('deletes without a toast when no snapshot could be read', async () => {
        const { runtime, open } = createRuntime();
        vi.spyOn(runtime.draftStore, 'loadPreset').mockResolvedValue(null);
        const deletePreset = vi.spyOn(runtime.draftStore, 'deletePreset').mockResolvedValue(undefined);

        expect(await runtime.workspace.deletePreset('preset:missing')).toBe(true);
        expect(deletePreset).toHaveBeenCalledOnce();
        expect(open).not.toHaveBeenCalled();
    });

    it('offers no undo when the draft assets could not be read', async () => {
        const { runtime, open } = createRuntime();
        vi.spyOn(runtime.draftStore, 'loadProjectRecord').mockResolvedValue({ key: 'draft:9', doc: {}, name: 'Half', updatedAt: 5 });
        vi.spyOn(runtime.draftStore, 'listAssetsByKey').mockRejectedValue(new Error('idb-error'));
        const deleteProject = vi.spyOn(runtime.draftStore, 'deleteProject').mockResolvedValue(undefined);
        vi.spyOn(runtime.draftStore, 'deleteAssetsByKey').mockResolvedValue(undefined);

        // 半成品快照会写出「有记录、无资源」的坏草稿：宁可不提供撤销
        expect(await runtime.workspace.deleteDraft('draft:9')).toBe(true);
        expect(deleteProject).toHaveBeenCalledOnce();
        expect(open).not.toHaveBeenCalled();
    });

    it('writes draft assets before the project record so a failure cannot expose a broken draft', async () => {
        const { runtime, open } = createRuntime();
        const calls = [];
        vi.spyOn(runtime.draftStore, 'loadProjectRecord').mockResolvedValue({ key: 'draft:10', doc: {}, name: 'Ordered', updatedAt: 7 });
        vi.spyOn(runtime.draftStore, 'listAssetsByKey').mockResolvedValue([
            { id: 'asset:1', key: 'draft:10', blob: new Blob(['x']), type: 'image/png', name: 'a.png', purpose: 'image' },
        ]);
        vi.spyOn(runtime.draftStore, 'deleteProject').mockResolvedValue(undefined);
        vi.spyOn(runtime.draftStore, 'deleteAssetsByKey').mockResolvedValue(undefined);
        vi.spyOn(runtime.draftStore, 'saveAsset').mockImplementation(async () => { calls.push('asset'); });
        vi.spyOn(runtime.draftStore, 'saveProject').mockImplementation(async () => { calls.push('project'); });

        expect(await runtime.workspace.deleteDraft('draft:10')).toBe(true);
        clickUndo(open);
        await vi.waitFor(() => expect(calls).toEqual(['asset', 'project']));
    });

    it('keeps newer draft data instead of rolling it back with the snapshot', async () => {
        const { runtime, open } = createRuntime();
        const record = { key: 'draft:11', doc: { version: 1 }, name: 'Live', updatedAt: 100 };
        vi.spyOn(runtime.draftStore, 'loadProjectRecord')
            .mockResolvedValueOnce(record)
            // 撤销窗口内当前草稿被自动保存过：现记录更新
            .mockResolvedValue({ ...record, doc: { version: 2 }, updatedAt: 200 });
        vi.spyOn(runtime.draftStore, 'listAssetsByKey').mockResolvedValue([]);
        vi.spyOn(runtime.draftStore, 'deleteProject').mockResolvedValue(undefined);
        vi.spyOn(runtime.draftStore, 'deleteAssetsByKey').mockResolvedValue(undefined);
        const saveProject = vi.spyOn(runtime.draftStore, 'saveProject').mockResolvedValue(undefined);
        const refresh = vi.spyOn(runtime.workspace, 'refreshLibrary');

        expect(await runtime.workspace.deleteDraft('draft:11')).toBe(true);
        clickUndo(open);
        await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
        expect(saveProject).not.toHaveBeenCalled();
    });

    it('does not steal the current-project marker when another project was opened', async () => {
        const { runtime, open } = createRuntime();
        const record = { id: 'recent:1', name: 'Old', blob: new Blob(['zip']), updatedAt: 10 };
        vi.spyOn(runtime.draftStore, 'loadRecentProject').mockImplementation(async (id) => (id === 'recent:1' ? record : null));
        vi.spyOn(runtime.draftStore, 'deleteRecentProject').mockResolvedValue(undefined);
        const saveRecent = vi.spyOn(runtime.draftStore, 'saveRecentProject').mockResolvedValue(undefined);

        runInAction(() => { runtime.workspace.currentRecentId = 'recent:1'; });
        expect(await runtime.workspace.deleteRecentProject('recent:1')).toBe(true);
        // 窗口内用户打开了另一个项目
        runInAction(() => { runtime.workspace.currentRecentId = 'recent:2'; });

        clickUndo(open);
        await vi.waitFor(() => expect(saveRecent).toHaveBeenCalledOnce());
        expect(runtime.workspace.currentRecentId).toBe('recent:2');
    });

    it('reports a failed undo instead of throwing', async () => {
        const { runtime, messages, open } = createRuntime();
        vi.spyOn(runtime.draftStore, 'loadPreset').mockResolvedValue({ id: 'preset:2', name: 'Broken', preset: {} });
        vi.spyOn(runtime.draftStore, 'deletePreset').mockResolvedValue(undefined);
        vi.spyOn(runtime.draftStore, 'savePreset').mockRejectedValue(new Error('idb-error'));

        expect(await runtime.workspace.deletePreset('preset:2')).toBe(true);
        clickUndo(open);
        await vi.waitFor(() => expect(messages.error).toHaveBeenCalledWith('Could not undo the deletion. Try again.'));
    });

    it('explains when a pending undo was invalidated while the editor remains open', async () => {
        const { runtime, messages, open } = createRuntime();
        vi.spyOn(runtime.draftStore, 'loadPreset').mockResolvedValue({ id: 'preset:expired', name: 'Expired', preset: {} });
        vi.spyOn(runtime.draftStore, 'deletePreset').mockResolvedValue(undefined);
        const savePreset = vi.spyOn(runtime.draftStore, 'savePreset').mockResolvedValue(undefined);

        expect(await runtime.workspace.deletePreset('preset:expired')).toBe(true);
        // 模拟用户仍在此页面，但工作区已经因为一次新的 setup/teardown 失效。
        runtime.workspace.teardown();
        clickUndo(open);

        await vi.waitFor(() => expect(messages.info).toHaveBeenCalledWith('Nothing to undo'));
        expect(savePreset).not.toHaveBeenCalled();
    });

    it('keeps the existing failure path when the deletion itself fails', async () => {
        const { runtime, messages, open } = createRuntime();
        vi.spyOn(runtime.draftStore, 'loadPreset').mockResolvedValue({ id: 'preset:3', name: 'Kept', preset: {} });
        vi.spyOn(runtime.draftStore, 'deletePreset').mockRejectedValue(new Error('idb-error'));

        expect(await runtime.workspace.deletePreset('preset:3')).toBe(false);
        expect(messages.error).toHaveBeenCalledOnce();
        expect(open).not.toHaveBeenCalled();
    });
});
