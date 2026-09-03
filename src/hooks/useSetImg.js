import { useCallback } from 'react';
import { getImage, getDefaultFrameSize } from '@utils/utils';
import { browserPlatform } from '../platform/browserPlatform';
import { prepareWorkspaceImage } from '@utils/imageValidation';

export default (stores) => {
    return useCallback(async (file, type = 'blob', options = {}) => {
        let imgUrl;
        let width;
        let height;
        if (type === 'blob') {
            const prepared = await prepareWorkspaceImage(file, { retainObjectUrl: true, role: 'image' });
            imgUrl = prepared.url;
            width = prepared.width;
            height = prepared.height;
        } else {
            imgUrl = file;
            if (!imgUrl) throw new Error('image-source-unavailable');
            const image = await getImage(imgUrl);
            width = Math.round(image.width);
            height = Math.round(image.height);
        }
        const nextImage = {
            src: imgUrl,
            width,
            height,
            type: type === 'blob' ? file.type : 'image/png',
            name: type === 'blob' ? file.name : 'ScreenHello.png',
            blob: type === 'blob' ? file : null,
            _ownsObjectUrl: type === 'blob',
        };
        try {
            if (options.replace) {
                stores.editor.replaceImg(nextImage);
            } else if (options.append) {
                stores.imageStore.add(nextImage, { commit: options.commit !== false });
            } else {
                stores.editor.setImg(nextImage);
            }
        } catch (error) {
            if (type === 'blob') browserPlatform.file.revokeObjectURL(imgUrl);
            throw error;
        }
        if (!options.append && stores.option.size.type === 'auto') {
            // 自动尺寸保持默认 4:3 画布（与初始页一致），不再贴合图片比例
            const frameSize = getDefaultFrameSize(width, height);
            stores.option.setFrameSize(frameSize.width, frameSize.height);
        }
        if (options.replace) stores.history?.reset?.();
    }, [stores]);
}
