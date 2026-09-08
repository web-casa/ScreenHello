import { screenMaskFromAlpha, warpImage } from '../utils/deviceProjection';

globalThis.onmessage = ({ data }) => {
    try {
        const result = data.operation === 'screen-mask' ? screenMaskFromAlpha(data) : { pixels: warpImage(data) };
        globalThis.postMessage(result, [result.pixels.buffer]);
    } catch {
        globalThis.postMessage({ error: 'device-render-failed' });
    }
};
