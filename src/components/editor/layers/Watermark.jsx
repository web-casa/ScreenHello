import { useEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { Rect } from 'leafer-ui';
import useStores from '@stores/useStores';
import { computeWatermarkPlacement } from '@utils/watermarkSchema';

export default observer(function Watermark({ parent }) {
    const stores = useStores();
    const rect = useMemo(() => new Rect({
        name: 'screenhello-watermark',
        x: 0,
        y: 0,
        hittable: false,
        editable: false,
    }), [parent]);

    const wm = stores.option.watermark;
    const isImageMode = Boolean(wm?.enabled && wm.mode === 'image' && wm.imageDataUrl);

    useEffect(() => {
        rect.zIndex = stores.option.waterIndex;
    }, [rect, stores.option.waterIndex]);

    useEffect(() => {
        const frameWidth = stores.option.frameConf.width;
        const frameHeight = stores.option.frameConf.height;

        if (isImageMode) {
            rect.opacity = (Number(wm.opacity) || 65) / 100;
            if (wm.position === 'tile') {
                rect.x = 0;
                rect.y = 0;
                rect.width = frameWidth;
                rect.height = frameHeight;
                rect.fill = {
                    type: 'image',
                    url: wm.imageDataUrl,
                    mode: 'repeat',
                    size: Math.max(24, Math.round(frameWidth * ((Number(wm.scale) || 16) / 100))),
                };
            } else {
                const placement = computeWatermarkPlacement(frameWidth, frameHeight, wm);
                rect.x = placement.x;
                rect.y = placement.y;
                rect.width = placement.width;
                rect.height = placement.height;
                rect.fill = {
                    type: 'image',
                    url: wm.imageDataUrl,
                    mode: 'stretch',
                };
            }
            return;
        }

        rect.x = 0;
        rect.y = 0;
        rect.width = frameWidth;
        rect.height = frameHeight;
        rect.opacity = 1;
        rect.fill = {
            type: 'image',
            url: stores.option.waterSvg,
            mode: 'repeat',
            format: 'svg',
            size: Math.round(frameWidth / 6),
        };
    }, [
        isImageMode,
        rect,
        stores.option.frameConf.height,
        stores.option.frameConf.width,
        stores.option.waterSvg,
        wm?.imageDataUrl,
        wm?.imageHeight,
        wm?.imageWidth,
        wm?.margin,
        wm?.opacity,
        wm?.position,
        wm?.scale,
    ]);

    useEffect(() => {
        parent.add(rect);
        return () => {
            rect.remove();
        };
    }, [parent, rect]);
    return null;
});
