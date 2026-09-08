import { getImage, supportImg } from '@utils/utils';
import { browserPlatform } from '../platform/browserPlatform';

export const MAX_WORKSPACE_IMAGE_BYTES = 48 * 1024 * 1024;
export const MAX_WORKSPACE_IMAGE_DIMENSION = 32_768;
export const MAX_WORKSPACE_IMAGE_PIXELS = 100_000_000;

const imageError = (code) => Object.assign(new Error(code), { code });

/**
 * Decode an untrusted local image before it reaches the editor or AssetStore.
 * MIME/manifest metadata alone is insufficient because a ZIP entry can claim
 * to be a PNG while containing arbitrary bytes.
 */
export async function prepareWorkspaceImage(blob, {
    retainObjectUrl = false,
    role = 'image',
    platform = browserPlatform,
} = {}) {
    if (!(blob instanceof Blob) || blob.size <= 0 || blob.size > MAX_WORKSPACE_IMAGE_BYTES) {
        throw imageError(`${role}-invalid`);
    }
    const type = String(blob.type || '').toLowerCase();
    if (!supportImg.includes(type)) throw imageError(`${role}-type-unsupported`);

    const url = platform.file.createObjectURL(blob);
    if (!url) throw imageError(`${role}-object-url-unavailable`);
    let retained = false;
    try {
        let image;
        try {
            image = await getImage(url);
        } catch {
            throw imageError(`${role}-decode-failed`);
        }
        const width = Math.round(Number(image.naturalWidth || image.width));
        const height = Math.round(Number(image.naturalHeight || image.height));
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
            throw imageError(`${role}-dimensions-invalid`);
        }
        if (width > MAX_WORKSPACE_IMAGE_DIMENSION
            || height > MAX_WORKSPACE_IMAGE_DIMENSION
            || width * height > MAX_WORKSPACE_IMAGE_PIXELS) {
            throw imageError(`${role}-pixels-too-large`);
        }
        retained = retainObjectUrl;
        return { url, width, height };
    } finally {
        if (!retained) platform.file.revokeObjectURL(url);
    }
}
