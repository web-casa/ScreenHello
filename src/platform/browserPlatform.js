// @ts-check

/**
 * @typedef {Object} BrowserFileCapabilities
 * @property {(blob: Blob) => string | null} createObjectURL
 * @property {(url: string) => void} revokeObjectURL
 * @property {(blob: Blob) => Promise<string>} readAsDataURL
 * @property {() => boolean} supportsFileSystemAccess
 * @property {(options: Object) => Promise<{status: 'selected', file: File, handle: Object} | {status: 'cancelled' | 'unsupported'}>} openWithPicker
 * @property {(options: Object) => Promise<{status: 'selected', handle: Object} | {status: 'cancelled' | 'unsupported'}>} chooseSaveHandle
 * @property {(handle: Object, blob: Blob) => Promise<void>} writeToHandle
 * @property {(blob: Blob, options: Object) => Promise<{status: 'saved', handle: Object} | {status: 'cancelled' | 'unsupported'}>} saveWithPicker
 */

/**
 * @typedef {Object} BrowserStorageCapabilities
 * @property {(key: string) => string | null} getPreference
 * @property {(key: string, value: string) => boolean} setPreference
 * @property {() => IDBFactory | null} getIndexedDB
 * @property {() => Promise<{supported: boolean, usage: number | null, quota: number | null}>} estimate
 * @property {() => Promise<boolean | null>} isPersisted
 * @property {() => Promise<boolean | null>} requestPersistence
 */

/**
 * @typedef {Object} BrowserPlatformCapabilities
 * @property {BrowserFileCapabilities} file
 * @property {BrowserStorageCapabilities} storage
 * @property {{ writeImage: (blob: Blob) => Promise<void> }} clipboard
 * @property {{ getDisplayMedia: () => Promise<MediaStream> }} capture
 * @property {{ download: (data: Blob | string, name: string) => Promise<void> }} export
 */

/** @type {BrowserPlatformCapabilities} */
export const browserPlatform = {
    file: {
        createObjectURL(blob) {
            const urlApi = globalThis.URL;
            return typeof urlApi?.createObjectURL === 'function' ? urlApi.createObjectURL(blob) : null;
        },
        revokeObjectURL(url) {
            const urlApi = globalThis.URL;
            if (url && typeof urlApi?.revokeObjectURL === 'function') urlApi.revokeObjectURL(url);
        },
        readAsDataURL(blob) {
            return new Promise((resolve, reject) => {
                const Reader = globalThis.FileReader;
                if (!Reader) {
                    reject(new Error('file-reader-unavailable'));
                    return;
                }
                const reader = new Reader();
                reader.onloadend = () => {
                    if (typeof reader.result === 'string') resolve(reader.result);
                    else reject(new Error('file-reader-invalid-result'));
                };
                reader.onerror = () => reject(reader.error || new Error('file-reader-failed'));
                reader.readAsDataURL(blob);
            });
        },
        supportsFileSystemAccess() {
            const windowApi = /** @type {any} */ (globalThis);
            return typeof windowApi.showOpenFilePicker === 'function'
                && typeof windowApi.showSaveFilePicker === 'function';
        },
        async openWithPicker(options = {}) {
            const windowApi = /** @type {any} */ (globalThis);
            if (typeof windowApi.showOpenFilePicker !== 'function') return { status: 'unsupported' };
            try {
                const handles = await windowApi.showOpenFilePicker(options);
                const handle = Array.isArray(handles) ? handles[0] : null;
                if (!handle?.getFile) throw new Error('file-picker-invalid-handle');
                return { status: 'selected', file: await handle.getFile(), handle };
            } catch (error) {
                if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
                    return { status: 'cancelled' };
                }
                throw error;
            }
        },
        async saveWithPicker(blob, options = {}) {
            const config = /** @type {any} */ (options);
            const existingHandle = config.handle;
            const selected = /** @type {{status: 'selected', handle: Object} | {status: 'cancelled' | 'unsupported'}} */ (existingHandle
                ? { status: 'selected', handle: existingHandle }
                : await browserPlatform.file.chooseSaveHandle(config));
            if (selected.status !== 'selected') return selected;
            await browserPlatform.file.writeToHandle(selected.handle, blob);
            return /** @type {{status: 'saved', handle: Object}} */ ({
                status: 'saved',
                handle: selected.handle,
            });
        },
        async chooseSaveHandle(options = {}) {
            const windowApi = /** @type {any} */ (globalThis);
            if (typeof windowApi.showSaveFilePicker !== 'function') return { status: 'unsupported' };
            const config = /** @type {any} */ (options);
            try {
                const { handle: ignoredHandle, ...pickerOptions } = config;
                void ignoredHandle;
                const handle = await windowApi.showSaveFilePicker(pickerOptions);
                if (!handle?.createWritable) throw new Error('file-picker-invalid-handle');
                return { status: 'selected', handle };
            } catch (error) {
                if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
                    return { status: 'cancelled' };
                }
                throw error;
            }
        },
        async writeToHandle(handle, blob) {
            const fileHandle = /** @type {any} */ (handle);
            if (!fileHandle?.createWritable) throw new Error('file-picker-invalid-handle');
            const writable = await fileHandle.createWritable();
            try {
                await writable.write(blob);
                await writable.close();
            } catch (error) {
                await writable.abort?.().catch?.(() => {});
                throw error;
            }
        },
    },
    storage: {
        getPreference(key) {
            try {
                const storage = globalThis.localStorage;
                return storage?.getItem(key) ?? null;
            } catch {
                return null;
            }
        },
        setPreference(key, value) {
            try {
                const storage = globalThis.localStorage;
                if (!storage) return false;
                storage.setItem(key, value);
                return true;
            } catch {
                return false;
            }
        },
        getIndexedDB() {
            try {
                return globalThis.indexedDB || null;
            } catch {
                return null;
            }
        },
        async estimate() {
            try {
                const storage = globalThis.navigator?.storage;
                if (!storage?.estimate) return { supported: false, usage: null, quota: null };
                const result = await storage.estimate();
                return {
                    supported: true,
                    usage: typeof result.usage === 'number' && Number.isFinite(result.usage) ? result.usage : null,
                    quota: typeof result.quota === 'number' && Number.isFinite(result.quota) ? result.quota : null,
                };
            } catch {
                return { supported: false, usage: null, quota: null };
            }
        },
        async isPersisted() {
            try {
                const storage = globalThis.navigator?.storage;
                if (!storage?.persisted) return null;
                return Boolean(await storage.persisted());
            } catch {
                return null;
            }
        },
        async requestPersistence() {
            try {
                const storage = globalThis.navigator?.storage;
                if (!storage?.persist) return null;
                return Boolean(await storage.persist());
            } catch {
                return false;
            }
        },
    },
    clipboard: {
        async writeImage(blob) {
            const clipboard = globalThis.navigator?.clipboard;
            const ClipboardItemCtor = globalThis.ClipboardItem;
            if (!clipboard?.write || !ClipboardItemCtor) throw new Error('clipboard-image-unavailable');
            await clipboard.write([new ClipboardItemCtor({ [blob.type || 'image/png']: blob })]);
        },
    },
    capture: {
        async getDisplayMedia() {
            const mediaDevices = globalThis.navigator?.mediaDevices;
            if (!mediaDevices?.getDisplayMedia) throw new Error('display-capture-unavailable');
            return mediaDevices.getDisplayMedia();
        },
    },
    export: {
        async download(data, name) {
            let objectUrl = '';
            let href = '';
            if (typeof data !== 'string') {
                objectUrl = browserPlatform.file.createObjectURL(data) || '';
                href = objectUrl;
            } else if (data.startsWith('data:')) {
                const response = await fetch(data);
                objectUrl = browserPlatform.file.createObjectURL(await response.blob()) || '';
                href = objectUrl;
            } else {
                href = data;
            }
            if (!href) throw new Error('download-url-unavailable');

            const documentApi = globalThis.document;
            if (!documentApi?.body) throw new Error('document-unavailable');
            const link = documentApi.createElement('a');
            link.href = href;
            link.download = name;
            link.style.position = 'fixed';
            link.style.left = '-9999px';
            link.style.top = '-9999px';
            documentApi.body.appendChild(link);
            link.click();
            link.remove();

            if (objectUrl) setTimeout(() => browserPlatform.file.revokeObjectURL(objectUrl), 30_000);
        },
    },
};
