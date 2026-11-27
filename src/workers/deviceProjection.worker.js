import { screenMaskFromAlpha, warpImage, warpPerspectiveImage } from '../utils/deviceProjection';

globalThis.onmessage = ({ data }) => {
    try {
        let result;
        if (data.operation === 'screen-mask') {
            result = screenMaskFromAlpha(data);
        } else if (data.operation === 'perspective-warp') {
            result = { pixels: warpPerspectiveImage(data) };
        } else {
            result = { pixels: warpImage(data) };
        }
        globalThis.postMessage(result, [result.pixels.buffer]);
    } catch {
        globalThis.postMessage({ error: 'device-render-failed' });
    }
};
