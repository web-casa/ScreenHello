import { consumeBitmapPixels } from '../compression-product/bitmap-pixels.mjs';

self.onmessage = ({ data: { bitmap, width, height } }) => {
    try {
        const pixels = consumeBitmapPixels(bitmap, width, height);
        self.postMessage({ pixels, closed: bitmap.width === 0 }, [pixels.buffer]);
    } catch (error) {
        self.postMessage({ error: error.message });
    }
};
