import { afterEach, describe, expect, it, vi } from 'vitest';
import { autorun, isAction } from 'mobx';
import { browserPlatform } from '../../src/platform/browserPlatform.js';
import { createScreenHelloRuntime } from '../../src/stores/index.js';
import { modKey } from '../../src/utils/utils.js';

const runtimes = [];
const createRuntime = (options) => {
    const runtime = createScreenHelloRuntime(options);
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
    it('HF1 quick export keeps restored AVIF settings and reports the Web restriction without rendering', async () => {
        const runtime = createRuntime({ webExportSafety: true, locale: 'en-US' });
        const openMessage = vi.fn();
        runtime.editor.setMessage({ open: openMessage });
        vi.spyOn(runtime.editor, 'ensureEditing').mockReturnValue(true);
        runtime.option.setFrameSize(2048, 2048);
        const settings = { format: 'avif', compression: 'lossy', quality: 80, ratio: 1 };
        runtime.workspace.setExportSettings(settings, { replace: true });
        const capture = vi.spyOn(runtime.exportService, '_capture');
        expect(await runtime.commands.downloadCurrentImage()).toBe(false);
        expect(capture).not.toHaveBeenCalled();
        expect(runtime.workspace.exportSettings).toEqual(settings);
        expect(openMessage).toHaveBeenLastCalledWith(expect.objectContaining({
            type: 'error', content: expect.stringContaining('AVIF compression on the website'),
        }));
        expect(runtime.commands.exportActive).toBe(false);
    });
    it('routes prepared tokens through the export service and commits only successful current settings', async () => {
        const runtime = createRuntime();
        vi.spyOn(runtime.editor, 'ensureEditing').mockReturnValue(true);
        const token = Object.freeze({});
        const settings = { format: 'png', ratio: 1, compression: 'lossy', paletteColors: 64 };
        const handoff = vi.spyOn(runtime.exportService, 'downloadPreparedImage');
        const render = vi.spyOn(runtime.exportService, 'downloadImage');
        handoff.mockRejectedValueOnce(Object.assign(new Error('cancelled'), { code: 'export-cancelled' }));
        expect(await runtime.commands.downloadPreparedImage(token, settings)).toBe(false);
        expect(runtime.workspace.exportSettings).toEqual({ format: 'png', ratio: 1 });
        handoff.mockResolvedValueOnce({ current: false });
        expect(await runtime.commands.downloadPreparedImage(token, settings)).toBe(false);
        expect(runtime.workspace.exportSettings).toEqual({ format: 'png', ratio: 1 });
        handoff.mockResolvedValueOnce({ current: true });
        expect(await runtime.commands.downloadPreparedImage(token, settings)).toBe(true);
        expect(handoff).toHaveBeenLastCalledWith(token, expect.objectContaining({ settings, requireActive: true, signal: expect.any(AbortSignal) }));
        expect(runtime.workspace.exportSettings).toEqual(settings);
        expect(render).not.toHaveBeenCalled();
        expect(await runtime.commands.downloadPreparedImage(null, settings)).toBe(false);
    });
    it('captures within MobX actions before and after await without configuring the host', async () => {
        const capturePrimary = vi.fn().mockRejectedValue(new Error('permission-denied'));
        const runtime = createRuntime({ platform: {
            ...browserPlatform,
            capture: { ...browserPlatform.capture, isSupported: () => true, capturePrimary },
        } });
        const warn = vi.spyOn(console, 'warn');
        const states = [];
        const dispose = autorun(() => states.push(runtime.commands.captureBusy));
        try {
            expect(isAction(runtime.commands.execute)).toBe(true);
            await expect(runtime.commands.execute('file.captureScreen', { mode: 'primary' })).resolves.toBe(false);
            expect(states).toEqual([false, true, false]);
            expect(warn.mock.calls.flat().join(' ')).not.toMatch(/strict-mode|outside an action/i);
        } finally {
            dispose();
        }
    });
    it('reports native filename collisions without suggesting a different encoding format', async () => {
        const runtime = createRuntime();
        const openMessage = vi.fn();
        runtime.editor.setMessage({ open: openMessage });
        vi.spyOn(runtime.editor, 'ensureEditing').mockReturnValue(true);
        runtime.workspace.setExportSettings({ format: 'avif', ratio: 1 });
        vi.spyOn(runtime.exportService, 'downloadImage').mockRejectedValue(
            Object.assign(new Error('desktop-file-exists'), { code: 'desktop-file-exists' }),
        );
        await expect(runtime.commands.downloadCurrentImage()).resolves.toBe(false);
        expect(openMessage).toHaveBeenLastCalledWith(expect.objectContaining({
            type: 'error', content: expect.stringContaining('未覆盖原文件'),
        }));
        expect(runtime.commands.exportActive).toBe(false);
    });

    it('routes browser, desktop picker, and primary screenshot results through the instance image transaction', async () => {
        class FakeImage {
            width = 64;
            height = 48;
            naturalWidth = 64;
            naturalHeight = 48;
            set src(_value) { queueMicrotask(() => this.onload?.()); }
        }
        vi.stubGlobal('Image', FakeImage);
        const captureFile = new File(['capture'], 'ScreenHello-capture.png', { type: 'image/png' });
        const capturePrimary = vi.fn().mockResolvedValue(captureFile);
        const platform = {
            ...browserPlatform,
            file: {
                ...browserPlatform.file,
                createObjectURL: vi.fn().mockReturnValue('blob:captured-image'),
                revokeObjectURL: vi.fn(),
            },
            capture: {
                ...browserPlatform.capture,
                isSupported: () => true,
                supportsSourcePicker: () => true,
                shortcut: 'Ctrl+Shift+H',
                capturePrimary,
            },
        };
        const runtime = createRuntime({ platform });
        const openCapture = vi.fn().mockReturnValue(true);
        runtime.commands.registerUiAction('file.openCapture', openCapture);

        expect(runtime.commands.get('file.captureScreen')).toMatchObject({
            enabled: true,
            shortcut: 'Ctrl+Shift+H',
        });
        await expect(runtime.commands.execute('file.captureScreen')).resolves.toBe(true);
        expect(openCapture).toHaveBeenCalledOnce();
        await expect(runtime.commands.execute('file.captureScreen', { mode: 'primary' })).resolves.toBe(true);
        expect(capturePrimary).toHaveBeenCalledOnce();
        expect(runtime.imageStore.list).toHaveLength(1);
        expect(runtime.editor.img.name).toBe('ScreenHello-capture.png');

        await expect(runtime.commands.execute('file.captureScreen', { file: captureFile })).resolves.toBe(true);
        expect(runtime.imageStore.list).toHaveLength(2);
    });

    it('serializes primary screenshot commands before starting the image transaction', async () => {
        class FakeImage {
            width = 64;
            height = 48;
            naturalWidth = 64;
            naturalHeight = 48;
            set src(_value) { queueMicrotask(() => this.onload?.()); }
        }
        vi.stubGlobal('Image', FakeImage);
        let resolveCapture;
        const capturePrimary = vi.fn(() => new Promise((resolve) => { resolveCapture = resolve; }));
        const platform = {
            ...browserPlatform,
            file: {
                ...browserPlatform.file,
                createObjectURL: vi.fn().mockReturnValue('blob:captured-image'),
                revokeObjectURL: vi.fn(),
            },
            capture: {
                ...browserPlatform.capture,
                isSupported: () => true,
                supportsSourcePicker: () => true,
                capturePrimary,
            },
        };
        const runtime = createRuntime({ platform });
        const first = runtime.commands.execute('file.captureScreen', { mode: 'primary' });
        expect(runtime.commands.captureBusy).toBe(true);
        expect(runtime.commands.get('file.captureScreen')).toMatchObject({ enabled: false, busy: true });
        await expect(runtime.commands.execute('file.captureScreen', { mode: 'primary' })).resolves.toBe(false);
        expect(capturePrimary).toHaveBeenCalledOnce();
        resolveCapture(new File(['capture'], 'capture.png', { type: 'image/png' }));
        await expect(first).resolves.toBe(true);
        expect(runtime.commands.captureBusy).toBe(false);
    });

    it('uses the injected native image picker and clipboard capability without a browser fallback', async () => {
        class FakeImage {
            width = 64;
            height = 48;
            naturalWidth = 64;
            naturalHeight = 48;
            set src(_value) { queueMicrotask(() => this.onload?.()); }
        }
        vi.stubGlobal('Image', FakeImage);
        const selectedFile = new File(['image'], 'native.png', { type: 'image/png' });
        const openImages = vi.fn()
            .mockResolvedValueOnce({ status: 'selected', files: [selectedFile] })
            .mockResolvedValueOnce({ status: 'cancelled' });
        const platform = {
            ...browserPlatform,
            file: {
                ...browserPlatform.file,
                openImages,
                createObjectURL: vi.fn().mockReturnValue('blob:native-image'),
                revokeObjectURL: vi.fn(),
            },
            clipboard: { ...browserPlatform.clipboard, supportsWriteImage: () => true },
        };
        const runtime = createRuntime({ platform });
        const pickerError = vi.fn();
        runtime.editor.setMessage({ error: pickerError });
        const selectImages = vi.fn().mockReturnValue(true);
        runtime.commands.registerUiAction('file.selectImages', selectImages);

        await expect(runtime.commands.execute('file.addImages')).resolves.toBe(true);
        expect(openImages).toHaveBeenCalledWith({ multiple: true });
        expect(runtime.imageStore.list).toHaveLength(1);
        expect(runtime.editor.img.name).toBe('native.png');
        expect(selectImages).not.toHaveBeenCalled();

        await expect(runtime.commands.execute('file.addImages')).resolves.toBe(false);
        expect(selectImages).not.toHaveBeenCalled();
        runtime.editor.replaceImg(image());
        expect(runtime.commands.get('file.copyFinalImage')).toMatchObject({ enabled: true });

        openImages.mockRejectedValueOnce(new Error('/private/path/picker-failed'));
        await expect(runtime.commands.execute('file.replaceActiveImage')).resolves.toBe(false);
        expect(pickerError).toHaveBeenCalledWith('无法打开系统图片选择器');
        expect(pickerError.mock.calls.flat().join(' ')).not.toContain('/private/path');
    });

    it('derives command state from the current runtime and explains disabled commands', () => {
        const runtime = createRuntime();

        expect(runtime.commands.get('file.saveProject')).toMatchObject({
            id: 'file.saveProject',
            visible: true,
            enabled: false,
            busy: false,
            disabledReason: '请先添加图片',
            shortcut: `${modKey}+S`,
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

    it('commits export settings only after handoff success and rejects duplicate export submissions', async () => {
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

        expect(runtime.workspace.exportSettings).toEqual({ format: 'png', ratio: 1 });
        expect(download).toHaveBeenCalledOnce();
        expect(download).toHaveBeenCalledWith(expect.objectContaining({ format: 'webp', ratio: 2 }));
        finishExport();
        await expect(first).resolves.toBe(true);
        expect(runtime.workspace.exportSettings).toEqual({ format: 'webp', ratio: 2 });
        expect(observedAvailability).toEqual(expect.arrayContaining([true, false]));
        expect(observedAvailability.at(-1)).toBe(true);
        stopObserving();
    });

    it('rejects failed handoffs without saving settings and blocks replacement during handoff', async () => {
        const runtime = createRuntime();
        runtime.editor.replaceImg(image());
        runtime.workspace._markClean();
        vi.spyOn(runtime.editor, 'ensureEditing').mockReturnValue(true);
        let rejectDownload;
        vi.spyOn(runtime.exportService, 'downloadImage').mockReturnValue(new Promise((resolve, reject) => { rejectDownload = reject; }));
        vi.spyOn(runtime.exportService, 'isHandingOff', 'get').mockReturnValue(true);
        const result = runtime.commands.execute('file.quickExport', { confirmedSettings: { format: 'jpg', ratio: 2, compression: 'lossy', quality: 80 } });
        expect(runtime.commands.cancelExport()).toBe(false);
        const replace = vi.fn();
        await expect(runtime.commands.requestWorkspaceReplacement(replace)).resolves.toBe(false);
        expect(replace).not.toHaveBeenCalled();
        rejectDownload(Object.assign(new Error('desktop-file-exists'), { code: 'desktop-file-exists' }));
        await expect(result).resolves.toBe(false);
        expect(runtime.workspace.exportSettings).toEqual({ format: 'png', ratio: 1 });
        expect(runtime.workspace.isDirty).toBe(false);
    });

    it('keeps successful compression preferences dirty rather than falsely marking the project saved', async () => {
        const runtime = createRuntime();
        runtime.editor.replaceImg(image()); runtime.workspace.setup(true); runtime.workspace._markClean();
        vi.spyOn(runtime.editor, 'ensureEditing').mockReturnValue(true);
        vi.spyOn(runtime.exportService, 'downloadImage').mockResolvedValue({ current: true });
        const settings = { format: 'jpg', ratio: 2, compression: 'lossy', quality: 80 };
        await expect(runtime.commands.execute('file.quickExport', { confirmedSettings: settings })).resolves.toBe(true);
        expect(runtime.workspace.exportSettings).toEqual(settings);
        expect(runtime.workspace.isDirty).toBe(true);
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
        expect(runtime.workspace.exportSettings).toEqual({ format: 'png', ratio: 1 });
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
