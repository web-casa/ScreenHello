import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as desktopContract from '../../src/platform/desktopPlatform.js';
import {
    createDesktopPlatform,
    DESKTOP_MAX_CAPTURE_PIXELS,
    DESKTOP_MAX_EXPORT_BYTES,
} from '../../src/platform/desktopPlatform.js';
import { browserPlatform } from '../../src/platform/browserPlatform.js';

const tokens = Array.from({ length: 20 }, (_, index) => index.toString(16).padStart(48, '0'));
const captureToken = 'f'.repeat(48);

describe('Rust / JavaScript desktop IPC boundaries', () => {
    const files = readFileSync(new URL('../../src-tauri/src/native_files.rs', import.meta.url), 'utf8');
    const capture = readFileSync(new URL('../../src-tauri/src/desktop_capture.rs', import.meta.url), 'utf8');
    // Deliberately limited to integer products: changed Rust expressions require
    // review instead of evaluating arbitrary source text in the test runner.
    const nativeLimit = (source, name) => {
        const expression = source.match(new RegExp(`const ${name}: \\w+ = ([\\d_* ]+);`, 'u'))?.[1];
        expect(expression, `Missing native limit ${name}`).toBeDefined();
        return expression.split('*').reduce((product, value) => product * Number(value.replaceAll('_', '').trim()), 1);
    };

    it.each(['PROJECT_BYTES', 'IMAGE_BYTES', 'EXPORT_BYTES', 'BATCH_BYTES', 'PICKED_IMAGES'])(
        'keeps %s consistent with native file validation', (name) => {
            expect(desktopContract[`DESKTOP_MAX_${name}`]).toBe(nativeLimit(files, `MAX_${name}`));
        },
    );
    it.each(['CAPTURE_BYTES', 'CAPTURE_PIXELS'])('keeps %s consistent with native capture validation', (name) => {
        expect(desktopContract[`DESKTOP_MAX_${name}`]).toBe(nativeLimit(capture, `MAX_${name}`));
    });
    it('keeps the source count and token header consistent', () => {
        expect(capture).toMatch(/const MAX_CAPTURE_SOURCES: usize = MAX_MONITORS \+ MAX_WINDOWS;/u);
        expect(desktopContract.DESKTOP_MAX_CAPTURE_SOURCES).toBe(nativeLimit(capture, 'MAX_MONITORS') + nativeLimit(capture, 'MAX_WINDOWS'));
        expect(desktopContract.DESKTOP_FILE_TOKEN_HEADER).toBe(files.match(/const TOKEN_HEADER: &str = "([^"]+)";/u)?.[1]);
        expect(desktopContract.DESKTOP_WRITE_SESSION_HEADER).toBe(files.match(/const SESSION_HEADER: &str = "([^"]+)";/u)?.[1]);
    });
});

const pngBytes = (width = 64, height = 48) => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return bytes;
};

const createHarness = (invokeImplementation = async () => undefined) => {
    let tokenIndex = 0;
    const invokeCommand = vi.fn(invokeImplementation);
    const createImage = vi.fn();
    const writeClipboardImage = vi.fn();
    const platform = createDesktopPlatform({
        invokeCommand,
        basePlatform: browserPlatform,
        createImage,
        writeClipboardImage,
        tokenFactory: () => tokens[tokenIndex++],
    });
    return { platform, invokeCommand, createImage, writeClipboardImage };
};

describe('desktop platform', () => {
    it('accepts the explicit ScreenCaptureKit capability without broadening unknown backends', async () => {
        const { platform, invokeCommand } = createHarness(async () => ({ schemaVersion: 1, backend: 'macos-screen-capture-kit', status: 'ready', sourcePicker: true }));
        await expect(platform.capture.getCapability()).resolves.toMatchObject({ backend: 'macos-screen-capture-kit', sourcePicker: true });
        invokeCommand.mockResolvedValue({ schemaVersion: 1, backend: 'arbitrary-native', status: 'ready', sourcePicker: true });
        await expect(platform.capture.getCapability()).rejects.toThrow();
    });

    it('treats directory authorization cancellation as cancellation and releases a new save handle', async () => {
        const { platform, invokeCommand } = createHarness(async (command) => {
            if (command === 'desktop_choose_save_file') return { status: 'selected', token: tokens[0] };
            if (command === 'desktop_write_file') throw 'native-file-save-cancelled';
        });
        await expect(platform.file.saveWithPicker(new Blob(['image']), { suggestedName: 'image.png' })).resolves.toEqual({ status: 'cancelled' });
        expect(invokeCommand).toHaveBeenCalledWith('desktop_release_file', { token: tokens[0] });
        invokeCommand.mockClear();
        const handle = { platform: 'desktop', token: tokens[0], kind: 'image-png' };
        await expect(platform.file.saveWithPicker(new Blob(['image']), { handle })).resolves.toEqual({ status: 'cancelled' });
        expect(invokeCommand).not.toHaveBeenCalledWith('desktop_release_file', expect.anything());
    });

    it('opens only known help topics and normalizes native errors', async () => {
        const { platform, invokeCommand } = createHarness();
        await platform.help.open('help.github');
        expect(invokeCommand).toHaveBeenCalledWith('desktop_open_help', { topic: 'help.github' });
        invokeCommand.mockClear();
        await expect(platform.help.open('https://evil.example')).rejects.toMatchObject({ code: 'desktop-help-topic-invalid' });
        expect(invokeCommand).not.toHaveBeenCalled();
        invokeCommand.mockRejectedValue(new Error('/private/system/path'));
        await expect(platform.help.open('help.github')).rejects.toMatchObject({ code: 'desktop-help-open-failed' });
    });
    it('preserves only the exact native collision code and releases an unadopted save handle', async () => {
        for (const [nativeError, expectedCode] of [
            ['native-file-exists', 'desktop-file-exists'],
            ['native-file-directory-invalid', 'desktop-file-directory-invalid'],
            ['/private/native-file-exists/detail', 'desktop-file-write-failed'],
        ]) {
            const { platform, invokeCommand } = createHarness(async (command) => {
                if (command === 'desktop_choose_save_file') return { status: 'selected', token: tokens[0] };
                if (command === 'desktop_write_file') throw nativeError;
            });
            await expect(platform.file.saveWithPicker(new Blob(['png']), { suggestedName: 'report.png' }))
                .rejects.toMatchObject({ code: expectedCode, message: expectedCode });
            expect(invokeCommand).toHaveBeenCalledWith('desktop_release_file', { token: tokens[0] });
        }
    });

    it('opens a project through opaque metadata and a raw response without exposing a path', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const { platform, invokeCommand } = createHarness(async (command, args) => {
            if (command === 'desktop_pick_files') {
                expect(args).toEqual({ kind: 'project', multiple: false, tokens: [tokens[0]] });
                return {
                    status: 'selected',
                    files: [{
                        token: tokens[0],
                        name: 'demo.screenhello',
                        mimeType: 'application/vnd.screenhello.project+zip',
                        size: bytes.byteLength,
                    }],
                };
            }
            if (command === 'desktop_read_file') {
                expect(args).toEqual({ token: tokens[0] });
                return bytes.buffer;
            }
            throw new Error(`unexpected:${command}`);
        });

        await expect(platform.file.openWithPicker()).resolves.toMatchObject({
            status: 'selected',
            file: { name: 'demo.screenhello', type: 'application/vnd.screenhello.project+zip', size: 3 },
            handle: { platform: 'desktop', token: tokens[0], kind: 'project' },
        });
        expect(JSON.stringify(invokeCommand.mock.calls)).not.toContain('/');
    });

    it('imports multiple images and rejects duplicated or over-broad picker metadata', async () => {
        const selectedTokens = tokens.slice(0, 12);
        const { platform } = createHarness(async (command) => {
            if (command === 'desktop_pick_files') {
                return {
                    status: 'selected',
                    files: [
                        { token: selectedTokens[0], name: 'one.png', mimeType: 'image/png', size: 1 },
                        { token: selectedTokens[1], name: 'two.webp', mimeType: 'image/webp', size: 1 },
                    ],
                };
            }
            if (command === 'desktop_read_file') return new Uint8Array([1]);
            if (command === 'desktop_release_file') return true;
            throw new Error(`unexpected:${command}`);
        });
        await expect(platform.file.openImages()).resolves.toMatchObject({
            status: 'selected',
            files: [
                { name: 'one.png', type: 'image/png' },
                { name: 'two.webp', type: 'image/webp' },
            ],
        });

        const invalid = createHarness(async (command) => {
            if (command === 'desktop_pick_files') {
                return {
                    status: 'selected',
                    files: [{ token: tokens[0], name: '../secret.png', mimeType: 'image/png', size: 1 }],
                };
            }
            if (command === 'desktop_read_file') return new Uint8Array([1]);
            return true;
        });
        await expect(invalid.platform.file.openImages({ multiple: false }))
            .rejects.toMatchObject({ code: 'desktop-file-picker-invalid-response' });
        expect(invalid.invokeCommand.mock.calls.map(([command]) => command)).toEqual([
            'desktop_pick_files',
            'desktop_release_file',
        ]);
    });

    it('writes raw bytes with only an opaque token header and releases transient exports', async () => {
        const payload = new Blob(['png'], { type: 'image/png' });
        const { platform, invokeCommand } = createHarness(async (command, args, options) => {
            if (command === 'desktop_choose_save_file') {
                return { status: 'selected', token: tokens[0] };
            }
            if (command === 'desktop_write_file') {
                expect(args).toBeInstanceOf(Uint8Array);
                expect(Array.from(args)).toEqual(Array.from(new TextEncoder().encode('png')));
                expect(options).toEqual({ headers: { 'x-screenhello-file-token': tokens[0] } });
                return undefined;
            }
            if (command === 'desktop_release_file') return true;
            throw new Error(`unexpected:${command}`);
        });

        await expect(platform.export.download(payload, 'capture.png')).resolves.toBeUndefined();
        expect(invokeCommand.mock.calls.map(([command]) => command)).toEqual([
            'desktop_choose_save_file',
            'desktop_write_file',
            'desktop_release_file',
        ]);
    });

    it('streams payloads larger than the chunk threshold via begin/chunk/finish and aborts on failure', async () => {
        const chunkBytes = desktopContract.DESKTOP_STREAM_WRITE_CHUNK_BYTES;
        const largePayload = new Blob([new Uint8Array(chunkBytes + 128)], { type: 'application/zip' });
        const sessionId = 'e'.repeat(48);
        const receivedChunks = [];
        const { platform, invokeCommand } = createHarness(async (command, args, options) => {
            if (command === 'desktop_choose_save_file') return { status: 'selected', token: tokens[0] };
            if (command === 'desktop_write_begin') {
                expect(args).toEqual({ token: tokens[0], expectedSize: largePayload.size });
                return sessionId;
            }
            if (command === 'desktop_write_chunk') {
                expect(options).toEqual({ headers: { [desktopContract.DESKTOP_WRITE_SESSION_HEADER]: sessionId } });
                receivedChunks.push(args.byteLength);
                return undefined;
            }
            if (command === 'desktop_write_finish') {
                expect(args).toEqual({ sessionId });
                return undefined;
            }
            if (command === 'desktop_release_file') return true;
            throw new Error(`unexpected:${command}`);
        });

        await expect(platform.export.download(largePayload, 'batch.zip')).resolves.toBeUndefined();
        expect(receivedChunks).toEqual([chunkBytes, 128]);
        expect(invokeCommand.mock.calls.map(([command]) => command)).toEqual([
            'desktop_choose_save_file',
            'desktop_write_begin',
            'desktop_write_chunk',
            'desktop_write_chunk',
            'desktop_write_finish',
            'desktop_release_file',
        ]);

        // Mid-stream failure must call desktop_write_abort and map busy errors cleanly
        const failing = createHarness(async (command) => {
            if (command === 'desktop_choose_save_file') return { status: 'selected', token: tokens[0] };
            if (command === 'desktop_write_begin') return sessionId;
            if (command === 'desktop_write_chunk') throw 'native-file-write-busy';
            if (command === 'desktop_write_abort') return true;
            if (command === 'desktop_release_file') return true;
            throw new Error(`unexpected:${command}`);
        });
        await expect(failing.platform.export.download(largePayload, 'batch.zip'))
            .rejects.toMatchObject({ code: 'desktop-file-write-busy' });
        expect(failing.invokeCommand.mock.calls.map(([command]) => command)).toEqual([
            'desktop_choose_save_file',
            'desktop_write_begin',
            'desktop_write_chunk',
            'desktop_write_abort',
            'desktop_release_file',
        ]);
    });

    it('maps save cancellation normally and enforces the JS-side payload boundary', async () => {
        const cancelled = createHarness(async () => ({ status: 'cancelled' }));
        await expect(cancelled.platform.export.download(new Blob(['png']), 'capture.png'))
            .rejects.toMatchObject({ code: 'export-cancelled' });

        const { platform } = createHarness(async (command) => {
            if (command === 'desktop_choose_save_file') return { status: 'selected', token: tokens[0] };
            return undefined;
        });
        const handle = (await platform.file.chooseSaveHandle({ suggestedName: 'capture.png' })).handle;
        class OversizedBlob extends Blob {
            get size() { return DESKTOP_MAX_EXPORT_BYTES + 1; }
        }
        const oversized = new OversizedBlob([]);
        await expect(platform.file.writeToHandle(handle, oversized))
            .rejects.toMatchObject({ code: 'desktop-file-write-too-large' });
        await expect(platform.file.writeToHandle({ ...handle, kind: 'unknown' }, new Blob(['x'])))
            .rejects.toMatchObject({ code: 'desktop-file-handle-invalid' });
    });

    it('releases save tokens after malformed responses or failed owned writes', async () => {
        const malformed = createHarness(async (command) => {
            if (command === 'desktop_choose_save_file') {
                return { status: 'selected', token: tokens[1] };
            }
            if (command === 'desktop_release_file') return true;
            throw new Error(`unexpected:${command}`);
        });
        await expect(malformed.platform.file.chooseSaveHandle({ suggestedName: 'capture.png' }))
            .rejects.toMatchObject({ code: 'desktop-file-picker-invalid-response' });
        expect(malformed.invokeCommand.mock.calls).toEqual([
            ['desktop_choose_save_file', { kind: 'image-png', suggestedName: 'capture.png', token: tokens[0] }],
            ['desktop_release_file', { token: tokens[0] }],
        ]);

        const failedWrite = createHarness(async (command) => {
            if (command === 'desktop_choose_save_file') return { status: 'selected', token: tokens[0] };
            if (command === 'desktop_write_file') throw new Error('/private/write/detail');
            if (command === 'desktop_release_file') return true;
            throw new Error(`unexpected:${command}`);
        });
        await expect(failedWrite.platform.file.saveWithPicker(
            new Blob(['png'], { type: 'image/png' }),
            { suggestedName: 'capture.png' },
        )).rejects.toMatchObject({ code: 'desktop-file-write-failed' });
        expect(failedWrite.invokeCommand.mock.calls.map(([command]) => command)).toEqual([
            'desktop_choose_save_file',
            'desktop_write_file',
            'desktop_release_file',
        ]);
    });

    it('writes only PNG clipboard images and always closes the managed Image resource', async () => {
        const image = { close: vi.fn().mockResolvedValue(undefined) };
        const { platform, createImage, writeClipboardImage } = createHarness();
        createImage.mockResolvedValue(image);
        writeClipboardImage.mockResolvedValue(undefined);

        await expect(platform.clipboard.writeImage(new Blob(['png'], { type: 'image/png' })))
            .resolves.toBeUndefined();
        expect(createImage).toHaveBeenCalledWith(expect.any(Uint8Array));
        expect(writeClipboardImage).toHaveBeenCalledWith(image);
        expect(image.close).toHaveBeenCalledOnce();
        expect(platform.clipboard.supportsWriteImage()).toBe(true);

        writeClipboardImage.mockRejectedValueOnce(new Error('/private/clipboard/detail'));
        await expect(platform.clipboard.writeImage(new Blob(['png'], { type: 'image/png' })))
            .rejects.toMatchObject({ code: 'desktop-clipboard-write-failed' });
        expect(image.close).toHaveBeenCalledTimes(2);
        await expect(platform.clipboard.writeImage(new Blob(['jpg'], { type: 'image/jpeg' })))
            .rejects.toMatchObject({ code: 'desktop-clipboard-image-invalid' });
    });

    it('lists bounded opaque capture sources and captures a selected region over raw IPC', async () => {
        const source = {
            token: captureToken,
            kind: 'monitor',
            name: 'Primary display',
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
            scaleFactor: 1.25,
            primary: true,
        };
        const bytes = pngBytes(640, 480);
        const { platform, invokeCommand } = createHarness(async (command, args) => {
            if (command === 'desktop_list_capture_sources') {
                return { schemaVersion: 1, sources: [source] };
            }
            if (command === 'desktop_capture_source') {
                expect(args).toEqual({
                    token: captureToken,
                    region: { x: 10, y: 20, width: 640, height: 480 },
                });
                return bytes;
            }
            if (command === 'desktop_release_capture_sources') return undefined;
            throw new Error(`unexpected:${command}`);
        });

        await expect(platform.capture.listSources()).resolves.toEqual([source]);
        const file = await platform.capture.captureSource(source, {
            region: { x: 10, y: 20, width: 640, height: 480 },
        });
        expect(file).toMatchObject({ name: 'ScreenHello-capture.png', type: 'image/png', size: 24 });
        expect(invokeCommand.mock.calls.map(([command]) => command)).toEqual([
            'desktop_list_capture_sources',
            'desktop_capture_source',
            'desktop_release_capture_sources',
        ]);
    });

    it('accepts only the fixed native capture-capability contract', async () => {
        const { platform, invokeCommand } = createHarness(async (command) => {
            if (command === 'desktop_capture_capability') {
                return {
                    schemaVersion: 1,
                    backend: 'windows-gdi',
                    status: 'ready',
                    sourcePicker: true,
                };
            }
            throw new Error(`unexpected:${command}`);
        });

        await expect(platform.capture.getCapability()).resolves.toEqual({
            schemaVersion: 1,
            backend: 'windows-gdi',
            status: 'ready',
            sourcePicker: true,
        });
        expect(invokeCommand).toHaveBeenCalledWith('desktop_capture_capability');

        const malformed = createHarness(async () => ({
            schemaVersion: 1,
            backend: 'wayland-portal',
            status: 'portal-required',
            sourcePicker: true,
            environment: 'should-not-cross-ipc',
        }));
        await expect(malformed.platform.capture.getCapability())
            .rejects.toMatchObject({ code: 'desktop-capture-capability-invalid-response' });

        const unavailable = createHarness(async () => {
            throw 'desktop-capture-system-permission-required';
        });
        await expect(unavailable.platform.capture.getCapability())
            .rejects.toMatchObject({ code: 'desktop-capture-system-permission-required' });
    });

    it('rejects malformed source metadata, invalid regions and non-PNG capture payloads', async () => {
        const malformed = createHarness(async (command) => {
            if (command === 'desktop_list_capture_sources') {
                return {
                    schemaVersion: 1,
                    sources: [{
                        token: captureToken,
                        kind: 'window',
                        name: 'Secret\nwindow',
                        x: 0,
                        y: 0,
                        width: 100,
                        height: 100,
                        scaleFactor: 1,
                        primary: false,
                    }],
                };
            }
            return undefined;
        });
        await expect(malformed.platform.capture.listSources())
            .rejects.toMatchObject({ code: 'desktop-capture-sources-invalid-response' });
        expect(malformed.invokeCommand.mock.calls.map(([command]) => command)).toEqual([
            'desktop_list_capture_sources',
            'desktop_release_capture_sources',
        ]);

        const source = {
            token: captureToken,
            kind: 'monitor',
            name: 'Display',
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scaleFactor: 1,
            primary: true,
        };
        const invalidRegion = createHarness();
        await expect(invalidRegion.platform.capture.captureSource(source, {
            region: { x: 1910, y: 0, width: 20, height: 10 },
        })).rejects.toMatchObject({ code: 'desktop-capture-region-invalid' });
        expect(invalidRegion.invokeCommand).not.toHaveBeenCalled();

        const invalidPng = createHarness(async (command) => {
            if (command === 'desktop_capture_primary') return new Uint8Array(24);
            return undefined;
        });
        await expect(invalidPng.platform.capture.capturePrimary())
            .rejects.toMatchObject({ code: 'desktop-capture-failed' });
        expect(invalidPng.platform.capture.isSupported()).toBe(true);
        expect(invalidPng.platform.capture.supportsSourcePicker()).toBe(true);

        expect(DESKTOP_MAX_CAPTURE_PIXELS).toBe(7680 * 4320);
    });

    it('accepts mirrored monitor metadata without assuming a unique native primary flag', async () => {
        const first = {
            token: 'b'.repeat(48), kind: 'monitor', name: 'Mirror A', x: 0, y: 0,
            width: 1920, height: 1080, scaleFactor: 1, primary: true,
        };
        const second = {
            token: 'c'.repeat(48), kind: 'monitor', name: 'Mirror B', x: 0, y: 0,
            width: 1920, height: 1080, scaleFactor: 1, primary: true,
        };
        const { platform } = createHarness(async (command) => {
            if (command === 'desktop_list_capture_sources') return { schemaVersion: 1, sources: [first, second] };
            throw new Error(`unexpected:${command}`);
        });
        await expect(platform.capture.listSources()).resolves.toEqual([first, second]);
    });
});
