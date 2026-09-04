import { useCallback } from 'react';
import { getDefaultFrameSize } from '@utils/utils';
import { prepareRuntimeImage, releaseRuntimeImage } from '@utils/runtimeImage';

export default (stores) => {
    return useCallback(async (file, type = 'blob', options = {}) => {
        const nextImage = await prepareRuntimeImage(file, { type, role: 'image', platform: stores.platform });
        try {
            if (options.replace) {
                stores.editor.replaceImg(nextImage);
            } else if (options.append) {
                stores.imageStore.add(nextImage, { commit: options.commit !== false });
            } else {
                stores.editor.setImg(nextImage);
            }
        } catch (error) {
            releaseRuntimeImage(nextImage, stores.platform);
            throw error;
        }
        if (!options.append && stores.option.size.type === 'auto') {
            // 自动尺寸保持默认 4:3 画布（与初始页一致），不再贴合图片比例
            const frameSize = getDefaultFrameSize(nextImage.width, nextImage.height);
            stores.option.setFrameSize(frameSize.width, frameSize.height);
        }
        if (options.replace) stores.history?.reset?.();
    }, [stores]);
}
