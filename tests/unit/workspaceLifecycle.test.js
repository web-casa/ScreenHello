import { afterEach, expect, it, vi } from 'vitest';
import { browserPlatform } from '../../src/platform/browserPlatform.js';
import { createScreenHelloRuntime } from '../../src/stores/index.js';
import { readWorkspaceArchive } from '../../src/utils/workspaceArchive.js';
import { createStylePreset } from '../../src/utils/stylePreset.js';

const runtimes = [];
const deferred = () => {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
};
const makeRuntime = (file) => {
    const runtime = createScreenHelloRuntime({ platform: { ...browserPlatform, file: { ...browserPlatform.file, ...file } } });
    runtimes.push(runtime);
    runtime.testMessages = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
    runtime.editor.setMessage(runtime.testMessages);
    runtime.editor.setImg({ src: 'data:image/png;base64,aW1hZ2U=', width: 64, height: 48, type: 'image/png', name: 'fixture.png' });
    runtime.option.setBackground('none');
    vi.spyOn(runtime.workspace, 'refreshLibrary').mockResolvedValue(true);
    vi.spyOn(runtime.workspace, 'refreshStorage').mockResolvedValue({});
    vi.spyOn(runtime.workspace, 'analyzeSuggestions').mockResolvedValue(false);
    vi.spyOn(runtime.draftStore, 'saveRecentProject').mockResolvedValue(undefined);
    runtime.workspace.setup(true);
    return runtime;
};
afterEach(() => { runtimes.splice(0).forEach(r => r.dispose()); vi.restoreAllMocks(); });

it('captures document, name and export settings before any asynchronous asset read', async () => {
    const runtime = makeRuntime({});
    runtime.option.setPadding(12);
    runtime.workspace.setProjectName('Before');
    runtime.workspace.setExportSettings({ format: 'png', ratio: 1 });
    const read = deferred();
    vi.spyOn(runtime.workspace, '_blobFromSource').mockReturnValue(read.promise);
    const creating = runtime.workspace.createProjectBlob();
    runtime.option.setPadding(90);
    runtime.workspace.setProjectName('After');
    runtime.workspace.setExportSettings({ format: 'jpg', ratio: 2 });
    read.resolve(new Blob(['image'], { type: 'image/png' }));
    const decoded = await readWorkspaceArchive(await creating, { expectedKind: 'project' });
    expect(decoded.name).toBe('Before');
    expect(decoded.document.option.padding).toBe(12);
    expect(decoded.exportSettings).toEqual({ format: 'png', ratio: 1 });
});

it('captures preset settings before the asynchronous background read', async () => {
    const runtime = makeRuntime({});
    runtime.option.setPadding(12);
    runtime.workspace.setExportSettings({ format: 'png', ratio: 1 });
    const background = deferred();
    vi.spyOn(runtime.workspace, '_currentBackground').mockReturnValue(background.promise);
    const save = vi.spyOn(runtime.draftStore, 'savePreset').mockResolvedValue(undefined);
    const saving = runtime.workspace.savePreset('Snapshot');
    runtime.option.setPadding(90);
    runtime.workspace.setExportSettings({ format: 'jpg', ratio: 2 });
    background.resolve(null);
    expect(await saving).toBe(true);
    expect(save.mock.calls[0][0].preset.option.padding).toBe(12);
    expect(save.mock.calls[0][0].preset.exportSettings).toEqual({ format: 'png', ratio: 1 });
});

it('preserves edits made while an opened project is being cached', async () => {
    const runtime = makeRuntime({});
    runtime.option.setPadding(10);
    const blob = await runtime.workspace.createProjectBlob();
    vi.spyOn(runtime.workspace, '_applyProject').mockImplementation(async decoded => {
        runtime.option.restoreFromDocument(decoded.document.option);
    });
    const caching = deferred();
    runtime.draftStore.saveRecentProject.mockReturnValue(caching.promise);
    const opening = runtime.workspace.openProjectFile(blob);
    await vi.waitFor(() => expect(runtime.draftStore.saveRecentProject).toHaveBeenCalledOnce());
    runtime.option.setPadding(90);
    runtime.workspace.setProjectName('New edit');
    caching.resolve();
    expect(await opening).toBe(true);
    expect(runtime.workspace.projectName).toBe('New edit');
    expect(runtime.workspace.isDirty).toBe(true);
});

it('does not show a preset failure when teardown cancels a pending application', async () => {
    const runtime = makeRuntime({});
    const error = runtime.testMessages.error;
    const loading = deferred();
    vi.spyOn(runtime.draftStore, 'loadPreset').mockReturnValue(loading.promise);
    const pending = runtime.workspace.applyPreset('late');
    runtime.workspace.teardown();
    loading.resolve({ preset: createStylePreset({ option: runtime.option.toDocument() }) });
    expect(await pending).toBe(false);
    expect(error).not.toHaveBeenCalled();
});

it('keeps edits made during file writing dirty against the saved snapshot', async () => {
    const write = deferred();
    const writeToHandle = vi.fn().mockReturnValue(write.promise);
    const runtime = makeRuntime({ supportsFileSystemAccess: () => true,
        chooseSaveHandle: async () => ({ status: 'selected', handle: {} }), writeToHandle });
    runtime.option.setPadding(10);
    expect(runtime.workspace.isDirty).toBe(true);
    const saving = runtime.workspace.saveProject();
    await vi.waitFor(() => expect(writeToHandle).toHaveBeenCalledOnce());
    runtime.option.setPadding(90);
    write.resolve();
    expect(await saving).toBe(true);
    const decoded = await readWorkspaceArchive(writeToHandle.mock.calls[0][1], { expectedKind: 'project' });
    expect(decoded.document.option.padding).toBe(10);
    expect(runtime.option.padding).toBe(90);
    expect(runtime.workspace.isDirty).toBe(true);
    expect(runtime.workspace.projectFileStatus).toBe('dirty');
    expect(await runtime.workspace.saveProject()).toBe(true);
    expect(runtime.workspace.isDirty).toBe(false);
});

it('releases a selected project token when the picker resolves after teardown', async () => {
    const picking = deferred();
    const releaseHandle = vi.fn().mockResolvedValue(undefined);
    const runtime = makeRuntime({ openWithPicker: () => picking.promise, releaseHandle });
    const opening = runtime.workspace.openProjectPicker();
    runtime.workspace.teardown();
    picking.resolve({ status: 'selected', file: new File(['project'], 'demo.screenhello'),
        handle: { platform: 'desktop', token: 'a'.repeat(48), kind: 'project' } });
    expect(await opening).toBe(false);
    expect(releaseHandle).toHaveBeenCalledExactlyOnceWith({ platform: 'desktop', token: 'a'.repeat(48), kind: 'project' });
    expect(runtime.workspace.fileHandle).toBeNull();
});

it('ignores an earlier preset that resolves after the later selection', async () => {
    const runtime = makeRuntime({});
    const first = deferred();
    const preset = (id, padding) => ({ id, name: id, preset: createStylePreset({ id, name: id,
        option: { ...runtime.option.toDocument(), padding } }) });
    vi.spyOn(runtime.draftStore, 'loadPreset').mockImplementation(id => id === 'first' ? first.promise : Promise.resolve(preset('second', 80)));
    const pending = runtime.workspace.applyPreset('first');
    expect(runtime.workspace.busy).toBeNull();
    expect(await runtime.workspace.applyPreset('second')).toBe(true);
    expect(runtime.option.padding).toBe(80);
    first.resolve(preset('first', 20));
    expect(await pending).toBe(false);
    expect(runtime.option.padding).toBe(80);
});

it('invalidates a pending preset when a new project is created', async () => {
    const runtime = makeRuntime({});
    runtime.activate();
    const loading = deferred();
    const record = { id: 'old', name: 'old', preset: createStylePreset({ name: 'old',
        option: { ...runtime.option.toDocument(), padding: 81 } }) };
    vi.spyOn(runtime.draftStore, 'loadPreset').mockReturnValue(loading.promise);
    const pending = runtime.workspace.applyPreset('old');
    expect(await runtime.commands.execute('file.newProject')).toBe(true);
    expect(runtime.imageStore.list).toHaveLength(0);
    expect(runtime.option.padding).not.toBe(81);
    loading.resolve(record);
    expect(await pending).toBe(false);
    expect(runtime.option.padding).not.toBe(81);
});
