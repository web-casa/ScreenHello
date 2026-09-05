import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserPlatform } from '../../src/platform/browserPlatform.js';
import { createScreenHelloRuntime } from '../../src/stores/index.js';
import { getBackgroundDefinition } from '../../src/utils/backgroundConfig.js';

const runtimes = [];
const createRuntime = (options) => {
    const runtime = createScreenHelloRuntime(options);
    runtimes.push(runtime);
    return runtime;
};

afterEach(() => {
    runtimes.splice(0).forEach((runtime) => runtime.dispose());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('ScreenHelloRuntime isolation', () => {
    it('injects one platform through owned stores and releases only its native file handle', async () => {
        const releaseHandle = vi.fn().mockResolvedValue(undefined);
        const createObjectURL = vi.fn().mockReturnValue('blob:desktop-owned');
        const revokeObjectURL = vi.fn();
        const platform = {
            ...browserPlatform,
            file: {
                ...browserPlatform.file,
                createObjectURL,
                revokeObjectURL,
                releaseHandle,
            },
        };
        const runtime = createRuntime({ platform });
        const handle = { platform: 'desktop', token: 'a'.repeat(48), kind: 'project' };
        const asset = runtime.assetStore.add(new Blob(['background'], { type: 'image/png' }));

        runtime.workspace._setFileHandle(handle);
        expect(runtime.platform).toBe(platform);
        expect(runtime.assetStore.platform).toBe(platform);
        expect(runtime.exportService.platform).toBe(platform);
        expect(runtime.batch.platform).toBe(platform);
        expect(asset?.url).toBe('blob:desktop-owned');

        runtime.dispose();
        await vi.waitFor(() => expect(releaseHandle).toHaveBeenCalledWith(handle));
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:desktop-owned');
    });

    it('keeps editor, option, history, theme, and draft configuration instance-local', () => {
        const first = createRuntime();
        const second = createRuntime();

        first.editor.setTheme('dark');
        first.history.reset();
        first.option.setPadding(24);
        first.draftService.setup({ key: 'draft-first', autoRestore: false });
        second.draftService.setup({ key: 'draft-second', autoRestore: false });

        expect(first.editor).not.toBe(second.editor);
        expect(first.exportService).not.toBe(second.exportService);
        expect(first.option).not.toBe(second.option);
        expect(first.editor.theme).toBe('dark');
        expect(second.editor.theme).toBe('light');
        expect(first.option.padding).toBe(24);
        expect(second.option.padding).toBe(0);
        expect(first.history.canUndo).toBe(true);
        expect(second.history.canUndo).toBe(false);
        expect(() => structuredClone(first.option.toDocument())).not.toThrow();
        expect(first.draftService.getKey()).toBe('draft-first');
        expect(second.draftService.getKey()).toBe('draft-second');
    });

    it('persists generic devices in history and never leaks invalid runtime fill modes', () => {
        const runtime = createRuntime();
        const other = createRuntime();

        runtime.history.reset();
        runtime.option.setFrame('genericLaptop');
        runtime.option.setFrameMode('fit');
        other.option.setFrame('genericTablet');
        other.option.setFrameMode('cover');
        expect(runtime.option.toDocument()).toMatchObject({ frame: 'genericLaptop', frameMode: 'fit' });
        expect(other.option.toDocument()).toMatchObject({ frame: 'genericTablet', frameMode: 'cover' });
        runtime.history.undo();
        expect(runtime.option.toDocument()).toMatchObject({ frame: 'genericLaptop', frameMode: 'cover' });
        runtime.history.undo();
        expect(runtime.option.frame).toBe('none');
        runtime.history.redo();
        runtime.history.redo();
        expect(runtime.option.toDocument()).toMatchObject({ frame: 'genericLaptop', frameMode: 'fit' });

        runtime.option.restoreFromDocument({ frame: 'genericPhone', frameMode: 'strench' });
        expect(runtime.option.frameMode).toBe('stretch');
        expect(runtime.option.mode).toBe('stretch');

        runtime.option.setFrameMode('unknown');
        expect(runtime.option.frameMode).toBe('stretch');
        runtime.option.setFrame('none');
        expect(runtime.option.mode).toBe('cover');
        expect(other.option.toDocument()).toMatchObject({ frame: 'genericTablet', frameMode: 'cover' });
    });

    it('keeps the padding color default canonical across set, restore, and reset', () => {
        const runtime = createRuntime();

        expect(runtime.option.paddingBg).toBe('rgba(255,255,255,1)');
        expect(runtime.option.imageStyleIsDefault).toBe(true);

        runtime.option.setPaddingBg('rgba(255, 255, 255, 100)');
        expect(runtime.option.paddingBg).toBe('rgba(255,255,255,1)');
        expect(runtime.option.imageStyleIsDefault).toBe(true);

        runtime.option.setPaddingBg('rgba(12, 34, 56, 0.25)');
        expect(runtime.option.imageStyleIsDefault).toBe(false);
        expect(runtime.option.resetImageStyle()).toBe(true);
        expect(runtime.option.toDocument().paddingBg).toBe('rgba(255,255,255,1)');

        runtime.option.restoreFromDocument({
            paddingBg: 'rgba(255,255,255, 100)',
            background: 'none',
            frameConf: { background: null },
        });
        expect(runtime.option.paddingBg).toBe('rgba(255,255,255,1)');
    });

    it('disposes only owned object URLs and leaves the other runtime usable', () => {
        const revoke = vi.spyOn(URL, 'revokeObjectURL');
        const first = createRuntime();
        const second = createRuntime();
        const hostOwnedUrl = URL.createObjectURL(new Blob(['host'], { type: 'image/png' }));
        const firstImageUrl = URL.createObjectURL(new Blob(['first'], { type: 'image/png' }));
        const secondImageUrl = URL.createObjectURL(new Blob(['second'], { type: 'image/png' }));
        const firstBackground = first.assetStore.add(new Blob(['background'], { type: 'image/png' }));

        first.editor.setImg({ src: hostOwnedUrl, width: 1, height: 1 });
        first.editor.setImg({ src: firstImageUrl, width: 1, height: 1, _ownsObjectUrl: true });
        second.editor.setImg({ src: secondImageUrl, width: 1, height: 1, _ownsObjectUrl: true });
        first.option.setUploadedBackground(firstBackground);
        first.dispose();

        expect(first.exportService.isDisposed).toBe(true);
        expect(second.exportService.isDisposed).toBe(false);
        expect(revoke).toHaveBeenCalledWith(firstImageUrl);
        expect(revoke).toHaveBeenCalledWith(firstBackground.url);
        expect(revoke).not.toHaveBeenCalledWith(hostOwnedUrl);
        expect(revoke).not.toHaveBeenCalledWith(secondImageUrl);
        expect(second.editor.img.src).toBe(secondImageUrl);
        expect(second.history.manager).not.toBeNull();
    });

    it('routes global shortcuts to the active runtime only', () => {
        const first = createRuntime();
        const second = createRuntime();

        first.activate();
        expect(first.isActive).toBe(true);
        expect(second.isActive).toBe(false);

        second.activate();
        expect(first.isActive).toBe(false);
        expect(second.isActive).toBe(true);

        second.dispose();
        expect(first.isActive).toBe(false);
    });

    it('reports unavailable storage, quota errors, and corrupt drafts without throwing', async () => {
        const runtime = createRuntime();
        const warning = vi.fn();
        runtime.editor.setMessage({ warning, info: vi.fn() });
        runtime.draftService.setup({ key: 'draft-errors', autoRestore: true });

        const isAvailable = vi.spyOn(runtime.draftStore, 'isAvailable').mockReturnValue(false);
        await expect(runtime.draftService.restore()).resolves.toBe(false);
        runtime.draftService._handleSaveError(new DOMException('quota exceeded', 'QuotaExceededError'));
        runtime.draftService._handleSaveError(new Error('idb-transaction-failed'));

        expect(warning).toHaveBeenCalledWith('本地草稿存储不可用，本次编辑仍可继续，但关闭页面后不会自动恢复');
        expect(warning).toHaveBeenCalledWith('存储空间不足，已停止自动保存，本次编辑仍可继续');
        expect(warning).toHaveBeenCalledWith('本地草稿保存失败，已停止自动保存，本次编辑仍可继续');

        runtime.draftService.setup({ key: 'draft-corrupt', autoRestore: true });
        isAvailable.mockReturnValue(true);
        vi.spyOn(runtime.draftStore, 'loadProject').mockResolvedValue({ version: 999, option: {}, shapes: [] });
        await expect(runtime.draftService.restore()).resolves.toBe(false);
        expect(warning).toHaveBeenCalledWith('草稿数据已损坏或版本不受支持，已忽略');
    });

    it('applies a compatibility background without fetch or asset allocation', async () => {
        const runtime = createRuntime();
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(runtime.option.applyBackground('gh_img_65')).resolves.toBe(true);
        expect(runtime.assetStore.assets.size).toBe(0);
        expect(runtime.option.background).toBe('gh_img_65');
        expect(['linear', 'angular']).toContain(runtime.option.frameConf.background.type);
        expect(runtime.option.frameConf.background).not.toHaveProperty('url');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('migrates a persisted legacy image fill to its code gradient definition', () => {
        const runtime = createRuntime();
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        runtime.option.restoreFromDocument({
            background: 'gh_img_65',
            backgroundAssetId: 'background:retired',
            frameConf: {
                background: { type: 'image', url: 'https://attacker.invalid/tracking.png' },
            },
        });

        expect(runtime.option.backgroundAssetId).toBeNull();
        expect(runtime.option.frameConf.background).toMatchObject({
            type: getBackgroundDefinition('gh_img_65').fill.type,
            stops: getBackgroundDefinition('gh_img_65').fill.stops,
        });
        expect(runtime.option.frameConf.background).not.toHaveProperty('url');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
