import { utf8ByteLength } from '@utils/codeCardSchema';
import {
    WATERMARK_IMAGE_MAX_BYTES,
    WATERMARK_IMAGE_MAX_EDGE,
    isValidWatermarkImageDataUrl,
} from '@utils/watermarkSchema';

/**
 * 将本地上传的 Logo 图片在浏览器内缩放压缩为安全 Data URL（<= 64 KiB, 最长边 <= 256px），
 * 优先保留透明通道（WebP / PNG），绝不上传网络，并在 finally 清零 Canvas。
 */
export async function compressWatermarkImageFile(
    file,
    { documentRef = typeof document !== 'undefined' ? document : null } = {},
) {
    if (!file || !documentRef) {
        throw Object.assign(new Error('watermark-image-unavailable'), { code: 'watermark-image-unavailable' });
    }
    let bitmap = null;
    let objectUrl = null;
    let source = null;

    try {
        if (typeof createImageBitmap === 'function') {
            bitmap = await createImageBitmap(file);
            source = bitmap;
        } else if (typeof URL !== 'undefined' && typeof Image !== 'undefined') {
            objectUrl = URL.createObjectURL(file);
            source = await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('watermark-image-decode-failed'));
                img.src = objectUrl;
            });
        }
        if (!source || !source.width || !source.height) {
            throw Object.assign(new Error('watermark-image-decode-failed'), { code: 'watermark-image-decode-failed' });
        }

        const alphaPreservingAttempts = [
            { maxEdge: WATERMARK_IMAGE_MAX_EDGE, mime: 'image/webp', quality: 0.9 },
            { maxEdge: WATERMARK_IMAGE_MAX_EDGE, mime: 'image/png', quality: undefined },
            { maxEdge: 192, mime: 'image/webp', quality: 0.82 },
            { maxEdge: 192, mime: 'image/png', quality: undefined },
            { maxEdge: 128, mime: 'image/webp', quality: 0.78 },
            { maxEdge: 128, mime: 'image/png', quality: undefined },
            { maxEdge: 96, mime: 'image/webp', quality: 0.72 },
            { maxEdge: 96, mime: 'image/png', quality: undefined },
            { maxEdge: 64, mime: 'image/png', quality: undefined },
        ];
        const opaqueFallbackAttempts = [
            { maxEdge: 160, mime: 'image/jpeg', quality: 0.82 },
            { maxEdge: 96, mime: 'image/jpeg', quality: 0.72 },
        ];

        const canvas = documentRef.createElement('canvas');
        try {
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                throw Object.assign(new Error('watermark-context-unavailable'), { code: 'watermark-context-unavailable' });
            }
            const detectHasTransparency = (w, h) => {
                if (typeof ctx.getImageData !== 'function') return true;
                try {
                    const data = ctx.getImageData(0, 0, w, h).data;
                    for (let i = 3; i < data.length; i += 4) {
                        if (data[i] < 255) return true;
                    }
                    return false;
                } catch {
                    return true;
                }
            };

            let hasTransparency = null;
            const runAttempts = (list) => {
                for (const attempt of list) {
                    const longest = Math.max(source.width, source.height);
                    const scale = longest > attempt.maxEdge ? attempt.maxEdge / longest : 1;
                    const width = Math.max(1, Math.round(source.width * scale));
                    const height = Math.max(1, Math.round(source.height * scale));
                    canvas.width = width;
                    canvas.height = height;
                    ctx.clearRect(0, 0, width, height);
                    ctx.drawImage(source, 0, 0, width, height);
                    if (hasTransparency === null) {
                        hasTransparency = detectHasTransparency(width, height);
                    }
                    const dataUrl = canvas.toDataURL(attempt.mime, attempt.quality);
                    if (isValidWatermarkImageDataUrl(dataUrl) && utf8ByteLength(dataUrl) <= WATERMARK_IMAGE_MAX_BYTES) {
                        return { dataUrl, width, height };
                    }
                }
                return null;
            };

            const alphaResult = runAttempts(alphaPreservingAttempts);
            if (alphaResult) return alphaResult;
            if (!hasTransparency) {
                const opaqueResult = runAttempts(opaqueFallbackAttempts);
                if (opaqueResult) return opaqueResult;
            }
            throw Object.assign(new Error('watermark-image-too-large'), { code: 'watermark-image-too-large' });
        } finally {
            canvas.width = 0;
            canvas.height = 0;
        }
    } finally {
        bitmap?.close?.();
        if (objectUrl && typeof URL !== 'undefined') URL.revokeObjectURL(objectUrl);
    }
}
