import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserPlatform } from '../../src/platform/browserPlatform.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('browser platform capabilities', () => {
    it('degrades preference storage without leaking host exceptions', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => { throw new Error('blocked'); },
            setItem: () => { throw new Error('blocked'); },
        });
        expect(browserPlatform.storage.getPreference('theme')).toBeNull();
        expect(browserPlatform.storage.setPreference('theme', 'dark')).toBe(false);
    });

    it('degrades IndexedDB when the host getter is blocked', () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
        Object.defineProperty(globalThis, 'indexedDB', {
            configurable: true,
            get: () => { throw new Error('blocked'); },
        });
        try {
            expect(browserPlatform.storage.getIndexedDB()).toBeNull();
        } finally {
            if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);
            else delete globalThis.indexedDB;
        }
    });

    it('owns object URL creation and release behind the file capability', () => {
        const createObjectURL = vi.fn(() => 'blob:screenhello');
        const revokeObjectURL = vi.fn();
        vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
        const blob = new Blob(['image'], { type: 'image/png' });

        expect(browserPlatform.file.createObjectURL(blob)).toBe('blob:screenhello');
        browserPlatform.file.revokeObjectURL('blob:screenhello');
        expect(createObjectURL).toHaveBeenCalledWith(blob);
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:screenhello');
    });

    it('routes clipboard and display capture through explicit capabilities', async () => {
        const write = vi.fn().mockResolvedValue(undefined);
        const getDisplayMedia = vi.fn().mockResolvedValue({ getTracks: () => [] });
        class FakeClipboardItem {
            constructor(data) { this.data = data; }
        }
        vi.stubGlobal('navigator', { clipboard: { write }, mediaDevices: { getDisplayMedia } });
        vi.stubGlobal('ClipboardItem', FakeClipboardItem);
        const blob = new Blob(['image'], { type: 'image/png' });

        await expect(browserPlatform.clipboard.writeImage(blob)).resolves.toBeUndefined();
        await expect(browserPlatform.capture.getDisplayMedia()).resolves.toEqual({ getTracks: expect.any(Function) });
        expect(write).toHaveBeenCalledOnce();
        expect(getDisplayMedia).toHaveBeenCalledOnce();
    });

    it('uses file-system pickers when available and treats cancellation as a normal result', async () => {
        const selectedFile = new File(['project'], 'demo.screenhello');
        const openHandle = { getFile: vi.fn().mockResolvedValue(selectedFile) };
        const write = vi.fn().mockResolvedValue(undefined);
        const close = vi.fn().mockResolvedValue(undefined);
        const saveHandle = { createWritable: vi.fn().mockResolvedValue({ write, close }) };
        vi.stubGlobal('showOpenFilePicker', vi.fn().mockResolvedValue([openHandle]));
        vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue(saveHandle));

        expect(browserPlatform.file.supportsFileSystemAccess()).toBe(true);
        await expect(browserPlatform.file.openWithPicker({ multiple: false })).resolves.toMatchObject({
            status: 'selected',
            file: selectedFile,
            handle: openHandle,
        });
        const blob = new Blob(['archive']);
        await expect(browserPlatform.file.saveWithPicker(blob, { suggestedName: 'demo.screenhello' }))
            .resolves.toEqual({ status: 'saved', handle: saveHandle });
        expect(write).toHaveBeenCalledWith(blob);
        expect(close).toHaveBeenCalledOnce();

        vi.stubGlobal('showOpenFilePicker', vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')));
        await expect(browserPlatform.file.openWithPicker()).resolves.toEqual({ status: 'cancelled' });
    });

    it('reports unsupported picker and storage capabilities without throwing', async () => {
        vi.stubGlobal('showOpenFilePicker', undefined);
        vi.stubGlobal('showSaveFilePicker', undefined);
        vi.stubGlobal('navigator', {});

        expect(browserPlatform.file.supportsFileSystemAccess()).toBe(false);
        await expect(browserPlatform.file.openWithPicker()).resolves.toEqual({ status: 'unsupported' });
        await expect(browserPlatform.file.chooseSaveHandle()).resolves.toEqual({ status: 'unsupported' });
        await expect(browserPlatform.file.saveWithPicker(new Blob(['archive']))).resolves.toEqual({ status: 'unsupported' });
        await expect(browserPlatform.storage.estimate()).resolves.toEqual({
            supported: false,
            usage: null,
            quota: null,
        });
        await expect(browserPlatform.storage.isPersisted()).resolves.toBeNull();
        await expect(browserPlatform.storage.requestPersistence()).resolves.toBeNull();
    });

    it('reads and requests the browser persistence state independently', async () => {
        const persisted = vi.fn().mockResolvedValue(true);
        const persist = vi.fn().mockResolvedValue(false);
        vi.stubGlobal('navigator', { storage: { persisted, persist } });

        await expect(browserPlatform.storage.isPersisted()).resolves.toBe(true);
        await expect(browserPlatform.storage.requestPersistence()).resolves.toBe(false);
        expect(persisted).toHaveBeenCalledOnce();
        expect(persist).toHaveBeenCalledOnce();
    });
});
