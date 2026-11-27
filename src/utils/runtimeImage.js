import { browserPlatform } from '../platform/browserPlatform';
import { prepareWorkspaceImage } from './imageValidation';
import { getImage } from './utils';

/**
 * 把 File/data URL 解析为 ImageStore 可接管的实例资源。
 * blob URL 的所有权随返回值转移；调用方在安装失败时必须 releaseRuntimeImage()。
 */
export const prepareRuntimeImage = async (input, {
    type = 'blob',
    role = 'image',
    platform = browserPlatform,
} = {}) => {
    if (type === 'blob') {
        const prepared = await prepareWorkspaceImage(input, {
            retainObjectUrl: true,
            role,
            platform,
        });
        return {
            src: prepared.url,
            width: prepared.width,
            height: prepared.height,
            type: input.type,
            name: input.name,
            blob: input,
            _ownsObjectUrl: true,
        };
    }

    if (!input) throw Object.assign(new Error('image-source-unavailable'), { code: 'image-source-unavailable' });
    const image = await getImage(input);
    return {
        src: input,
        width: Math.round(image.width),
        height: Math.round(image.height),
        type: 'image/png',
        name: 'ScreenHello.png',
        blob: null,
        _ownsObjectUrl: false,
    };
};

export const releaseRuntimeImage = (image, platform = browserPlatform) => {
    if (image?._ownsObjectUrl && typeof image.src === 'string') {
        platform.file.revokeObjectURL(image.src);
    }
};
