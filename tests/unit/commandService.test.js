import { afterEach, describe, expect, it, vi } from 'vitest';
import { autorun } from 'mobx';
import { createScreenHelloRuntime } from '../../src/stores/index.js';

const runtimes = [];
const createRuntime = () => {
    const runtime = createScreenHelloRuntime();
    runtimes.push(runtime);
    runtime.activate();
    runtime.workspace.enabled = true;
    runtime.editor.setMessage({
        open: vi.fn(),
        success: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
    });
    return runtime;
};

const image = (name = 'fixture') => ({
    src: `data:image/png;base64,${name}`,
    width: 64,
    height: 48,
    type: 'image/png',
    name: `${name}.png`,
});

afterEach(() => {
    runtimes.splice(0).forEach((runtime) => runtime.dispose());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('CommandService', () => {
    it('derives command state from the current runtime and explains disabled commands', () => {
        const runtime = createRuntime();

        expect(runtime.commands.get('file.saveProject')).toMatchObject({
            id: 'file.saveProject',
            visible: true,
            enabled: false,
            busy: false,
            disabledReason: '请先添加图片',
            shortcut: 'Ctrl+S',
        });

        runtime.editor.replaceImg(image());
        runtime.history.reset();
        expect(runtime.commands.get('file.saveProject')).toMatchObject({ enabled: true, disabledReason: null });
        expect(runtime.commands.get('file.replaceActiveImage')).toMatchObject({ enabled: true });

        runtime.imageStore.add(image('second'));
        runtime.imageStore.select(runtime.imageStore.list.map((layer) => layer.id));
        expect(runtime.commands.get('file.replaceActiveImage')).toMatchObject({
            enabled: false,
            disabledReason: '请只选择一个未锁定图片图层',
        });

        runtime.workspace.busy = 'open';
        expect(runtime.commands.get('file.saveProject')).toMatchObject({
            enabled: false,
            busy: true,
            disabledReason: '正在处理其他本地任务',
        });
    });

    it('keeps commands isolated and only executes on the active runtime', async () => {
        const first = createRuntime();
        const second = createRuntime();
        first.editor.replaceImg(image('first'));
        second.editor.replaceImg(image('second'));
        const firstSave = vi.spyOn(first.workspace, 'saveProject').mockResolvedValue(true);
        const secondSave = vi.spyOn(second.workspace, 'saveProject').mockResolvedValue(true);

        first.activate();
        await expect(second.commands.execute('file.saveProject')).resolves.toBe(false);
        await expect(first.commands.execute('file.saveProject')).resolves.toBe(true);

        expect(first.commands).not.toBe(second.commands);
        expect(firstSave).toHaveBeenCalledOnce();
        expect(secondSave).not.toHaveBeenCalled();
    });

    it('offers save, discard, and cancel without continuing after save cancellation', async () => {
        const runtime = createRuntime();
        runtime.editor.replaceImg(image());
        runtime.workspace.isDirty = true;
        const save = vi.spyOn(runtime.workspace, 'saveProject').mockResolvedValue(false);
        const action = vi.fn().mockResolvedValue(true);

        const pending = runtime.commands.requestWorkspaceReplacement(action, { label: '打开其他项目' });
        expect(runtime.commands.guard).toMatchObject({ open: true, busy: false, label: '打开其他项目' });

        await expect(runtime.commands.resolveWorkspaceGuard('save')).resolves.toBe(false);
        expect(save).toHaveBeenCalledOnce();
        expect(action).not.toHaveBeenCalled();
        expect(runtime.commands.guard).toMatchObject({ open: true, busy: false });

        await expect(runtime.commands.resolveWorkspaceGuard('cancel')).resolves.toBe(false);
        await expect(pending).resolves.toBe(false);
        expect(action).not.toHaveBeenCalled();
    });

    it('flushes the draft before a confirmed replacement and preserves current data on target failure', async () => {
        const runtime = createRuntime();
        runtime.editor.replaceImg(image('current'));
        runtime.draftService.setup({ key: 'command-guard', autoRestore: false });
        runtime.workspace.isDirty = true;
        const source = runtime.editor.img.src;
        const flush = vi.spyOn(runtime.draftService, 'flush').mockResolvedValue(true);
        const open = vi.spyOn(runtime.workspace, 'openProjectFile').mockResolvedValue(false);
        const file = new File(['broken'], 'broken.screenhello', { type: 'application/vnd.screenhello.project+zip' });

        const pending = runtime.commands.execute('file.openProject', { file });
        await expect(runtime.commands.resolveWorkspaceGuard('discard')).resolves.toBe(false);
        await expect(pending).resolves.toBe(false);

        expect(flush).toHaveBeenCalledOnce();
        expect(open).toHaveBeenCalledWith(file);
        expect(runtime.editor.img.src).toBe(source);
    });

    it('does not expose workspace commands in library mode', () => {
        const runtime = createRuntime();
        runtime.workspace.enabled = false;

        expect(runtime.commands.get('file.openProject')).toMatchObject({ visible: false, enabled: false });
        expect(runtime.commands.get('file.openLibrary')).toMatchObject({ visible: false, enabled: false });
        expect(runtime.commands.get('file.copyFinalImage')).toMatchObject({ visible: true });
    });

    it('keeps view state per runtime without dirtying the project', async () => {
        const first = createRuntime();
        const second = createRuntime();
        first.activate();
        first.workspace.isDirty = false;

        expect(first.commands.get('view.toggleFramePanel')).toMatchObject({
            label: '隐藏尺寸与外框',
            checked: true,
            enabled: true,
        });
        await expect(first.commands.execute('view.toggleFramePanel')).resolves.toBe(true);
        expect(first.commands.get('view.toggleFramePanel')).toMatchObject({
            label: '显示尺寸与外框',
            checked: false,
        });
        expect(second.commands.get('view.toggleFramePanel')).toMatchObject({ checked: true });
        expect(first.workspace.isDirty).toBe(false);

        await expect(first.commands.execute('view.setTheme', { theme: 'dark' })).resolves.toBe(true);
        expect(first.editor.theme).toBe('dark');
        expect(first.workspace.isDirty).toBe(false);
    });

    it('routes help through the registered instance UI action', async () => {
        const runtime = createRuntime();
        const openHelp = vi.fn().mockReturnValue(true);
        runtime.commands.registerUiAction('help.shortcuts', openHelp);

        expect(runtime.commands.get('help.shortcuts')).toMatchObject({
            label: '快捷键列表',
            visible: true,
            enabled: true,
        });
        await expect(runtime.commands.execute('help.shortcuts')).resolves.toBe(true);
        expect(openHelp).toHaveBeenCalledOnce();
    });

    it('commits export settings only for confirmation and rejects duplicate export submissions', async () => {
        const runtime = createRuntime();
        runtime.editor.replaceImg(image());
        vi.spyOn(runtime.editor, 'ensureEditing').mockReturnValue(true);
        let finishExport;
        const pendingExport = new Promise((resolve) => { finishExport = resolve; });
        const download = vi.spyOn(runtime.exportService, 'downloadImage').mockReturnValue(pendingExport);
        const observedAvailability = [];
        const stopObserving = autorun(() => {
            observedAvailability.push(runtime.commands.get('file.openExport').enabled);
        });

        expect(runtime.workspace.exportSettings).toEqual({ format: 'png', ratio: 1 });
        const first = runtime.commands.execute('file.quickExport', {
            confirmedSettings: { format: 'webp', ratio: 2 },
        });
        await expect(runtime.commands.execute('file.quickExport', {
            confirmedSettings: { format: 'avif', ratio: 3 },
        })).resolves.toBe(false);

        expect(runtime.workspace.exportSettings).toEqual({ format: 'webp', ratio: 2 });
        expect(download).toHaveBeenCalledOnce();
        expect(download).toHaveBeenCalledWith(expect.objectContaining({ format: 'webp', ratio: 2 }));
        finishExport();
        await expect(first).resolves.toBe(true);
        expect(observedAvailability).toEqual(expect.arrayContaining([true, false]));
        expect(observedAvailability.at(-1)).toBe(true);
        stopObserving();
    });

    it('cancels the active export without starting another job', async () => {
        const runtime = createRuntime();
        runtime.editor.replaceImg(image());
        vi.spyOn(runtime.editor, 'ensureEditing').mockReturnValue(true);
        const download = vi.spyOn(runtime.exportService, 'downloadImage').mockImplementation(({ signal }) => (
            new Promise((resolve, reject) => {
                signal.addEventListener('abort', () => reject(Object.assign(new Error('export-cancelled'), { code: 'export-cancelled' })), { once: true });
                void resolve;
            })
        ));

        const exporting = runtime.commands.execute('file.quickExport', {
            confirmedSettings: { format: 'avif', ratio: 1 },
        });
        expect(runtime.commands.cancelExport()).toBe(true);
        await expect(exporting).resolves.toBe(false);
        expect(download).toHaveBeenCalledOnce();
        expect(runtime.workspace.exportSettings).toEqual({ format: 'avif', ratio: 1 });
        expect(runtime.commands.cancelExport()).toBe(false);
    });

    it('allows exactly one approved page unload and expires an unused approval', () => {
        vi.useFakeTimers();
        const runtime = createRuntime();
        const firstUnload = vi.fn(() => {
            expect(runtime.commands.consumePageUnloadApproval()).toBe(true);
            expect(runtime.commands.consumePageUnloadApproval()).toBe(false);
        });

        expect(runtime.commands.runApprovedPageUnload(firstUnload)).toBe(true);
        expect(firstUnload).toHaveBeenCalledOnce();

        expect(runtime.commands.runApprovedPageUnload(() => {})).toBe(true);
        expect(runtime.commands.pageUnloadApproved).toBe(true);
        vi.advanceTimersByTime(5_000);
        expect(runtime.commands.pageUnloadApproved).toBe(false);
        vi.useRealTimers();
    });

    it('keeps annotation nodes when the canvas close control deletes only an image', () => {
        const runtime = createRuntime();
        runtime.editor.replaceImg(image());
        runtime.history.reset();
        const annotation = { remove: vi.fn() };
        runtime.editor.app = { editor: { list: [annotation], cancel: vi.fn() }, destroy: vi.fn() };

        expect(runtime.commands.deleteSelection({ imagesOnly: true })).toBe(true);
        expect(annotation.remove).not.toHaveBeenCalled();
        expect(runtime.imageStore.list).toHaveLength(0);
    });

    it('does not replace an instance that becomes inactive while its draft flushes', async () => {
        const first = createRuntime();
        first.draftService.setup({ key: 'inactive-replacement', autoRestore: false });
        const pendingFlush = {};
        pendingFlush.promise = new Promise((resolve) => { pendingFlush.resolve = resolve; });
        vi.spyOn(first.draftService, 'flush').mockReturnValue(pendingFlush.promise);
        const action = vi.fn().mockResolvedValue(true);

        const replacing = first.commands.requestWorkspaceReplacement(action);
        const second = createRuntime();
        pendingFlush.resolve(true);

        await expect(replacing).resolves.toBe(false);
        expect(first.isActive).toBe(false);
        expect(second.isActive).toBe(true);
        expect(action).not.toHaveBeenCalled();
    });
});
