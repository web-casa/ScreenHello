import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserPlatform } from '../../src/platform/browserPlatform.js';
import {
    MAX_WORKSPACE_IMAGE_PIXELS,
    prepareWorkspaceImage,
} from '../../src/utils/imageValidation.js';

class FakeImage {
    width = 1200;
    height = 800;
    naturalWidth = 1200;
    naturalHeight = 800;
    onload = null;
    onerror = null;

    set src(value) {
        queueMicrotask(() => {
            if (value.includes('broken')) this.onerror?.();
            else this.onload?.();
        });
    }
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('workspace image validation', () => {
    it('decodes supported images and retains only explicitly requested URLs', async () => {
        vi.stubGlobal('Image', FakeImage);
        vi.spyOn(browserPlatform.file, 'createObjectURL').mockReturnValue('blob:valid');
        const revoke = vi.spyOn(browserPlatform.file, 'revokeObjectURL').mockImplementation(() => {});
        const blob = new Blob(['png'], { type: 'image/png' });

        await expect(prepareWorkspaceImage(blob)).resolves.toMatchObject({ width: 1200, height: 800 });
        expect(revoke).toHaveBeenCalledWith('blob:valid');
        revoke.mockClear();
        await expect(prepareWorkspaceImage(blob, { retainObjectUrl: true })).resolves.toMatchObject({ url: 'blob:valid' });
        expect(revoke).not.toHaveBeenCalled();
    });

    it('rejects spoofed MIME content after decode and releases the temporary URL', async () => {
        vi.stubGlobal('Image', FakeImage);
        vi.spyOn(browserPlatform.file, 'createObjectURL').mockReturnValue('blob:broken');
        const revoke = vi.spyOn(browserPlatform.file, 'revokeObjectURL').mockImplementation(() => {});

        await expect(prepareWorkspaceImage(new Blob(['not-png'], { type: 'image/png' })))
            .rejects.toMatchObject({ code: 'image-decode-failed' });
        expect(revoke).toHaveBeenCalledWith('blob:broken');
    });

    it('rejects decompression-safe but excessive decoded pixel counts', async () => {
        class HugeImage extends FakeImage {
            width = MAX_WORKSPACE_IMAGE_PIXELS + 1;
            height = 1;
            naturalWidth = MAX_WORKSPACE_IMAGE_PIXELS + 1;
            naturalHeight = 1;
        }
        vi.stubGlobal('Image', HugeImage);
        vi.spyOn(browserPlatform.file, 'createObjectURL').mockReturnValue('blob:huge');
        vi.spyOn(browserPlatform.file, 'revokeObjectURL').mockImplementation(() => {});

        await expect(prepareWorkspaceImage(new Blob(['png'], { type: 'image/png' })))
            .rejects.toMatchObject({ code: 'image-pixels-too-large' });
    });
});
