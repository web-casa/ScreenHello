// @ts-check

import { invoke } from '@tauri-apps/api/core';
import { Image } from '@tauri-apps/api/image';
import { writeImage } from '@tauri-apps/plugin-clipboard-manager';
import { browserPlatform } from './browserPlatform';
import { createDesktopToken, isDesktopToken } from '../desktop/desktopToken';

/** @typedef {'project' | 'images'} DesktopOpenKind */
/** @typedef {'project' | 'preset' | 'image-png' | 'image-jpeg' | 'image-webp' | 'image-avif' | 'batch-zip'} DesktopSaveKind */
/** @typedef {{platform: 'desktop', token: string, kind: DesktopSaveKind}} DesktopFileHandle */
/** @typedef {{token: string, name: string, mimeType: string, size: number}} DesktopPickedFile */
/** @typedef {{close: () => Promise<void>}} DesktopImageResource */
/** @typedef {'monitor' | 'window'} DesktopCaptureSourceKind */
/** @typedef {{token: string, kind: DesktopCaptureSourceKind, name: string, x: number, y: number, width: number, height: number, scaleFactor: number, primary: boolean}} DesktopCaptureSource */
/** @typedef {{x: number, y: number, width: number, height: number}} DesktopCaptureRegion */

export const DESKTOP_MAX_PROJECT_BYTES = 64 * 1024 * 1024;
export const DESKTOP_MAX_IMAGE_BYTES = 48 * 1024 * 1024;
export const DESKTOP_MAX_EXPORT_BYTES = 128 * 1024 * 1024;
export const DESKTOP_MAX_BATCH_BYTES = 256 * 1024 * 1024;
export const DESKTOP_MAX_PICKED_IMAGES = 12;
export const DESKTOP_MAX_CAPTURE_BYTES = 48 * 1024 * 1024;
export const DESKTOP_MAX_CAPTURE_PIXELS = 7680 * 4320;
export const DESKTOP_MAX_CAPTURE_SOURCES = 144;

const MIME_BY_KIND = Object.freeze({
    project: 'application/vnd.screenhello.project+zip',
    preset: 'application/vnd.screenhello.preset+zip',
});
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/bmp', 'image/gif', 'image/webp']);
const LIMIT_BY_SAVE_KIND = Object.freeze({
    project: DESKTOP_MAX_PROJECT_BYTES,
    preset: DESKTOP_MAX_PROJECT_BYTES,
    'image-png': DESKTOP_MAX_EXPORT_BYTES,
    'image-jpeg': DESKTOP_MAX_EXPORT_BYTES,
    'image-webp': DESKTOP_MAX_EXPORT_BYTES,
    'image-avif': DESKTOP_MAX_EXPORT_BYTES,
    'batch-zip': DESKTOP_MAX_BATCH_BYTES,
});
const SAVE_KINDS = new Set(Object.keys(LIMIT_BY_SAVE_KIND));

/** @param {string} code */
const desktopError = (code) => Object.assign(new Error(code), { code });

/** @param {unknown} name @returns {DesktopSaveKind} */
const saveKindForName = (name) => {
    const normalized = String(name || '').toLowerCase();
    if (normalized.endsWith('.screenhello-preset')) return 'preset';
    if (normalized.endsWith('.screenhello')) return 'project';
    if (normalized.endsWith('.png')) return 'image-png';
    if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image-jpeg';
    if (normalized.endsWith('.webp')) return 'image-webp';
    if (normalized.endsWith('.avif')) return 'image-avif';
    if (normalized.endsWith('.zip')) return 'batch-zip';
    throw desktopError('desktop-save-type-unsupported');
};

/** @param {any} value @param {DesktopSaveKind | null} [expectedKind] @returns {DesktopFileHandle} */
const normalizeHandle = (value, expectedKind = null) => {
    if (!value || value.platform !== 'desktop' || !isDesktopToken(value.token)) {
        throw desktopError('desktop-file-handle-invalid');
    }
    if (!SAVE_KINDS.has(value.kind)) throw desktopError('desktop-file-handle-invalid');
    if (expectedKind && value.kind !== expectedKind) throw desktopError('desktop-file-handle-invalid');
    return Object.freeze({ platform: 'desktop', token: value.token, kind: value.kind });
};

const CAPTURE_ERROR_CODES = new Set([
    'desktop-capture-busy',
    'desktop-capture-unavailable',
    'desktop-capture-no-display',
    'desktop-capture-source-limit',
    'desktop-capture-source-invalid',
    'desktop-capture-source-unavailable',
    'desktop-capture-region-invalid',
    'desktop-capture-too-large',
    'desktop-capture-failed',
    'desktop-capture-encode-failed',
    'desktop-capture-window-unavailable',
    'desktop-capture-window-restore-failed',
]);

/** @param {unknown} error @param {string} fallback */
const normalizedCaptureError = (error, fallback) => {
    const value = typeof error === 'string'
        ? error
        : (error && typeof error === 'object' && 'code' in error ? String(error.code) : '');
    return desktopError(CAPTURE_ERROR_CODES.has(value) ? value : fallback);
};

/** @param {unknown} value @param {{requireMonitor?: boolean}} [options] @returns {DesktopCaptureSource[]} */
const normalizeCaptureSources = (value, { requireMonitor = true } = {}) => {
    const response = /** @type {any} */ (value);
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || response.schemaVersion !== 1 || !Array.isArray(response.sources)
        || response.sources.length < 1 || response.sources.length > DESKTOP_MAX_CAPTURE_SOURCES) {
        throw desktopError('desktop-capture-sources-invalid-response');
    }
    const seen = new Set();
    let monitorCount = 0;
    let windowCount = 0;
    const sources = response.sources.map((/** @type {any} */ source) => {
        const token = String(source?.token || '');
        const kind = source?.kind;
        const name = String(source?.name || '');
        const x = Number(source?.x);
        const y = Number(source?.y);
        const width = Number(source?.width);
        const height = Number(source?.height);
        const scaleFactor = Number(source?.scaleFactor);
        const primary = source?.primary;
        const hasControl = Array.from(name).some((character) => {
            const codePoint = character.codePointAt(0);
            return Number(codePoint) < 32 || codePoint === 127;
        });
        /** @param {number} number */
        const validInteger = (number) => Number.isSafeInteger(number);
        if (!isDesktopToken(token) || seen.has(token) || !['monitor', 'window'].includes(kind)
            || !name || name.length > 120 || hasControl
            || !validInteger(x) || !validInteger(y) || !validInteger(width) || !validInteger(height)
            || width <= 0 || height <= 0 || width > 0xffffffff || height > 0xffffffff
            || !Number.isFinite(scaleFactor) || scaleFactor <= 0 || scaleFactor > 8
            || typeof primary !== 'boolean' || (kind === 'window' && primary)) {
            throw desktopError('desktop-capture-sources-invalid-response');
        }
        const pixels = width * height;
        if (!Number.isSafeInteger(pixels) || (kind === 'window' && pixels > DESKTOP_MAX_CAPTURE_PIXELS)) {
            throw desktopError('desktop-capture-sources-invalid-response');
        }
        seen.add(token);
        if (kind === 'monitor') monitorCount += 1;
        else windowCount += 1;
        return Object.freeze({ token, kind, name, x, y, width, height, scaleFactor, primary });
    });
    if ((requireMonitor && !monitorCount) || monitorCount > 16 || windowCount > 128) {
        throw desktopError('desktop-capture-sources-invalid-response');
    }
    return sources;
};

/** @param {unknown} value @returns {ArrayBuffer} */
const normalizeCaptureBytes = (value) => {
    let bytes;
    if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
    else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    else throw desktopError('desktop-capture-invalid-response');
    if (bytes.byteLength < 24 || bytes.byteLength > DESKTOP_MAX_CAPTURE_BYTES
        || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47
        || bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a
        || bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
        throw desktopError('desktop-capture-invalid-response');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (!width || !height || width * height > DESKTOP_MAX_CAPTURE_PIXELS) {
        throw desktopError('desktop-capture-invalid-response');
    }
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return /** @type {ArrayBuffer} */ (copy.buffer);
};

/** @param {DesktopCaptureSource} source @param {DesktopCaptureRegion | null | undefined} region */
const normalizeCaptureRegion = (source, region) => {
    if (region == null) return null;
    if (source.kind !== 'monitor' || !region || typeof region !== 'object') {
        throw desktopError('desktop-capture-region-invalid');
    }
    const result = {
        x: Number(region.x),
        y: Number(region.y),
        width: Number(region.width),
        height: Number(region.height),
    };
    if (!Object.values(result).every(Number.isSafeInteger)
        || result.x < 0 || result.y < 0 || result.width <= 0 || result.height <= 0
        || result.x + result.width > source.width || result.y + result.height > source.height
        || result.width * result.height > DESKTOP_MAX_CAPTURE_PIXELS) {
        throw desktopError('desktop-capture-region-invalid');
    }
    return result;
};

/**
 * @param {any} value
 * @param {{kind: DesktopOpenKind, tokens: string[], multiple: boolean}} options
 * @returns {{status: 'cancelled'} | {status: 'selected', files: DesktopPickedFile[]}}
 */
const normalizePickResponse = (value, { kind, tokens, multiple }) => {
    if (value?.status === 'cancelled') return { status: 'cancelled' };
    if (value?.status !== 'selected' || !Array.isArray(value.files)) {
        throw desktopError('desktop-file-picker-invalid-response');
    }
    const maximum = multiple ? DESKTOP_MAX_PICKED_IMAGES : 1;
    if (!value.files.length || value.files.length > maximum) {
        throw desktopError('desktop-file-picker-invalid-response');
    }
    const allowedTokens = new Set(tokens);
    const seenTokens = new Set();
    const files = value.files.map((/** @type {any} */ entry) => {
        const name = String(entry?.name || '');
        const mimeType = String(entry?.mimeType || '').toLowerCase();
        const size = Number(entry?.size);
        const token = String(entry?.token || '');
        const limit = kind === 'images' ? DESKTOP_MAX_IMAGE_BYTES : DESKTOP_MAX_PROJECT_BYTES;
        const validMime = kind === 'images' ? IMAGE_MIMES.has(mimeType) : mimeType === MIME_BY_KIND[kind];
        const hasControlCharacter = Array.from(name).some((character) => {
            const codePoint = character.codePointAt(0);
            return Number(codePoint) < 32 || codePoint === 127;
        });
        if (!allowedTokens.has(token) || seenTokens.has(token) || !isDesktopToken(token)
            || !name || name.length > 255 || hasControlCharacter || name.includes('/') || name.includes('\\')
            || !validMime || !Number.isSafeInteger(size) || size <= 0 || size > limit) {
            throw desktopError('desktop-file-picker-invalid-response');
        }
        seenTokens.add(token);
        return Object.freeze({ token, name, mimeType, size });
    });
    return { status: 'selected', files };
};

/** @param {unknown} value @param {number} expectedSize @returns {ArrayBuffer} */
const toRawBuffer = (value, expectedSize) => {
    /** @type {Uint8Array} */
    let bytes;
    if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
    else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    else throw desktopError('desktop-file-read-invalid-response');
    if (bytes.byteLength !== expectedSize) throw desktopError('desktop-file-read-size-changed');
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return /** @type {ArrayBuffer} */ (copy.buffer);
};

/**
 * Tauri-only platform factory. Every runtime receives its own adapter object and
 * opaque token generator; no path or mutable handle is shared with browser mode.
 */
/**
 * @param {{
 *   invokeCommand?: (command: string, args?: any, options?: any) => Promise<any>,
 *   basePlatform?: typeof browserPlatform,
 *   createImage?: (bytes: Uint8Array) => Promise<DesktopImageResource>,
 *   writeClipboardImage?: (image: any) => Promise<void>,
 *   tokenFactory?: () => string,
 * }} [options]
 */
export const createDesktopPlatform = ({
    invokeCommand = invoke,
    basePlatform = browserPlatform,
    createImage = (bytes) => Image.fromBytes(bytes),
    writeClipboardImage = writeImage,
    tokenFactory = createDesktopToken,
} = {}) => {
    /** @param {string} token */
    const releaseToken = async (token) => {
        if (!isDesktopToken(token)) return;
        await invokeCommand('desktop_release_file', { token });
    };

    /** @param {DesktopPickedFile} descriptor */
    const readDescriptor = async (descriptor) => {
        try {
            const response = await invokeCommand('desktop_read_file', { token: descriptor.token });
            const buffer = toRawBuffer(response, descriptor.size);
            return new File([buffer], descriptor.name, { type: descriptor.mimeType });
        } catch {
            throw desktopError('desktop-file-read-failed');
        }
    };

    /** @param {{kind: DesktopOpenKind, multiple?: boolean}} options */
    const pickFiles = async ({ kind, multiple = false }) => {
        const tokenCount = multiple ? DESKTOP_MAX_PICKED_IMAGES : 1;
        const tokens = Array.from({ length: tokenCount }, () => tokenFactory());
        if (tokens.some((token) => !isDesktopToken(token)) || new Set(tokens).size !== tokens.length) {
            throw desktopError('desktop-random-invalid');
        }
        let result;
        try {
            result = normalizePickResponse(
                await invokeCommand('desktop_pick_files', { kind, multiple, tokens }),
                { kind, tokens, multiple },
            );
        } catch (error) {
            await Promise.allSettled(tokens.map((token) => releaseToken(token)));
            if (error && typeof error === 'object' && 'code' in error
                && String(error.code).startsWith('desktop-')) throw error;
            throw desktopError('desktop-file-picker-failed');
        }
        if (result.status !== 'selected') return result;

        const selectedFiles = [];
        try {
            for (const descriptor of result.files) {
                selectedFiles.push({ descriptor, file: await readDescriptor(descriptor) });
            }
        } catch (error) {
            await Promise.allSettled(result.files.map(({ token }) => releaseToken(token)));
            throw error;
        }
        return { status: 'selected', files: selectedFiles };
    };

    const file = {
        ...basePlatform.file,
        supportsFileSystemAccess: () => true,
        async openWithPicker() {
            const result = await pickFiles({ kind: 'project', multiple: false });
            if (result.status !== 'selected') return result;
            const [{ descriptor, file: selectedFile }] = result.files;
            return {
                status: 'selected',
                file: selectedFile,
                handle: normalizeHandle({ platform: 'desktop', token: descriptor.token, kind: 'project' }),
            };
        },
        /** @param {{multiple?: boolean}} [options] */
        async openImages({ multiple = true } = {}) {
            const result = await pickFiles({ kind: 'images', multiple });
            if (result.status !== 'selected') return result;
            return { status: 'selected', files: result.files.map(({ file: selectedFile }) => selectedFile) };
        },
        /** @param {{suggestedName?: string}} [options] */
        async chooseSaveHandle({ suggestedName } = {}) {
            const kind = saveKindForName(suggestedName);
            const token = tokenFactory();
            if (!isDesktopToken(token)) throw desktopError('desktop-random-invalid');
            let response;
            try {
                response = await invokeCommand('desktop_choose_save_file', { kind, suggestedName, token });
            } catch {
                throw desktopError('desktop-file-picker-failed');
            }
            if (response?.status === 'cancelled') return { status: 'cancelled' };
            if (response?.status !== 'selected' || response.token !== token) {
                await releaseToken(token).catch(() => {});
                throw desktopError('desktop-file-picker-invalid-response');
            }
            return {
                status: 'selected',
                handle: normalizeHandle({ platform: 'desktop', token, kind }),
            };
        },
        /** @param {DesktopFileHandle} handle @param {Blob} blob */
        async writeToHandle(handle, blob) {
            const target = normalizeHandle(handle);
            if (!(blob instanceof Blob)) throw desktopError('desktop-file-write-invalid');
            const limit = LIMIT_BY_SAVE_KIND[target.kind];
            if (!limit || blob.size <= 0 || blob.size > limit) throw desktopError('desktop-file-write-too-large');
            const bytes = new Uint8Array(await blob.arrayBuffer());
            try {
                await invokeCommand('desktop_write_file', bytes, {
                    headers: { 'x-screenhello-file-token': target.token },
                });
            } catch {
                throw desktopError('desktop-file-write-failed');
            }
        },
        /** @param {DesktopFileHandle} handle */
        async releaseHandle(handle) {
            const target = normalizeHandle(handle);
            await releaseToken(target.token);
        },
        /** @param {Blob} blob @param {{handle?: DesktopFileHandle, suggestedName?: string}} [options] */
        async saveWithPicker(blob, options = {}) {
            const ownsHandle = !options.handle;
            let handle = null;
            try {
                const selected = options.handle
                    ? { status: 'selected', handle: normalizeHandle(options.handle) }
                    : await file.chooseSaveHandle(options);
                if (selected.status !== 'selected' || !selected.handle) return selected;
                handle = normalizeHandle(selected.handle);
                await file.writeToHandle(handle, blob);
                return { status: 'saved', handle };
            } catch (error) {
                if (ownsHandle && handle) await file.releaseHandle(handle).catch(() => {});
                throw error;
            }
        },
    };

    const platform = {
        file,
        storage: basePlatform.storage,
        capture: {
            isSupported: () => true,
            supportsSourcePicker: () => true,
            shortcut: globalThis.navigator?.platform?.toLowerCase().includes('mac')
                ? 'Command+Shift+H'
                : 'Ctrl+Shift+H',
            async listSources() {
                try {
                    return normalizeCaptureSources(await invokeCommand('desktop_list_capture_sources'));
                } catch (error) {
                    await invokeCommand('desktop_release_capture_sources').catch(() => {});
                    if (error && typeof error === 'object' && 'code' in error
                        && String(error.code).endsWith('invalid-response')) throw error;
                    throw normalizedCaptureError(error, 'desktop-capture-unavailable');
                }
            },
            /** @param {DesktopCaptureSource} source @param {{region?: DesktopCaptureRegion | null}} [options] */
            async captureSource(source, { region = null } = {}) {
                const normalized = normalizeCaptureSources(
                    { schemaVersion: 1, sources: [source] },
                    { requireMonitor: false },
                )[0];
                const normalizedRegion = normalizeCaptureRegion(normalized, region);
                try {
                    const response = await invokeCommand('desktop_capture_source', {
                        token: normalized.token,
                        region: normalizedRegion,
                    });
                    const bytes = normalizeCaptureBytes(response);
                    return new File([bytes], 'ScreenHello-capture.png', { type: 'image/png' });
                } catch (error) {
                    throw normalizedCaptureError(error, 'desktop-capture-failed');
                } finally {
                    await invokeCommand('desktop_release_capture_sources').catch(() => {});
                }
            },
            async capturePrimary() {
                try {
                    const bytes = normalizeCaptureBytes(await invokeCommand('desktop_capture_primary'));
                    return new File([bytes], 'ScreenHello-capture.png', { type: 'image/png' });
                } catch (error) {
                    throw normalizedCaptureError(error, 'desktop-capture-failed');
                }
            },
            async releaseSources() {
                await invokeCommand('desktop_release_capture_sources');
            },
        },
        clipboard: {
            supportsWriteImage: () => true,
            /** @param {Blob} blob */
            async writeImage(blob) {
                if (!(blob instanceof Blob) || blob.type !== 'image/png'
                    || blob.size <= 0 || blob.size > DESKTOP_MAX_EXPORT_BYTES) {
                    throw desktopError('desktop-clipboard-image-invalid');
                }
                let image = null;
                let writeError = null;
                try {
                    image = await createImage(new Uint8Array(await blob.arrayBuffer()));
                    await writeClipboardImage(image);
                } catch {
                    writeError = desktopError('desktop-clipboard-write-failed');
                } finally {
                    if (image) {
                        try {
                            await image.close();
                        } catch {
                            if (!writeError) writeError = desktopError('desktop-clipboard-release-failed');
                        }
                    }
                }
                if (writeError) throw writeError;
            },
        },
        export: {
            /** @param {Blob | string} data @param {string} name */
            async download(data, name) {
                let blob = data;
                if (typeof blob === 'string' && blob.startsWith('data:')) blob = await (await fetch(blob)).blob();
                if (!(blob instanceof Blob)) throw desktopError('desktop-export-data-invalid');
                const selected = await file.chooseSaveHandle({ suggestedName: name });
                if (selected.status === 'cancelled' || !selected.handle) {
                    throw desktopError('export-cancelled');
                }
                const handle = normalizeHandle(selected.handle);
                try {
                    await file.writeToHandle(handle, blob);
                } finally {
                    await file.releaseHandle(handle).catch(() => {});
                }
            },
        },
    };
    return Object.freeze(platform);
};
