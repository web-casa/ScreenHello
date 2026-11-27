import { GIFEncoder, applyPalette, quantize } from 'gifenc';

let encoder = null;
let config = null;

self.onmessage = (event) => {
    const message = event?.data;
    if (!message || typeof message !== 'object') return;

    try {
        if (message.type === 'init') {
            encoder = GIFEncoder();
            const totalFrames = Math.max(1, Math.round(Number(message.totalFrames) || 1));
            const fallbackDelay = Math.max(20, Math.round((Number(message.delayMs) || 40) / 10) * 10);
            let frameDelaysMs;
            if (message.frameDelaysMs != null) {
                if ((!Array.isArray(message.frameDelaysMs) && !ArrayBuffer.isView(message.frameDelaysMs))
                    || message.frameDelaysMs.length !== totalFrames) {
                    throw new Error('gif-delay-mismatch');
                }
                frameDelaysMs = new Array(totalFrames);
                for (let i = 0; i < totalFrames; i += 1) {
                    const value = Number(message.frameDelaysMs[i]);
                    if (!Number.isInteger(value) || value < 20 || value % 10 !== 0) {
                        throw new Error('gif-delay-mismatch');
                    }
                    frameDelaysMs[i] = value;
                }
            } else {
                frameDelaysMs = Array.from({ length: totalFrames }, () => fallbackDelay);
            }
            config = {
                width: Math.max(2, Math.round(Number(message.width) || 2)),
                height: Math.max(2, Math.round(Number(message.height) || 2)),
                totalFrames,
                delayMs: fallbackDelay,
                frameDelaysMs,
                maxColors: Math.max(16, Math.min(256, Math.round(Number(message.maxColors) || 192))),
            };
            self.postMessage({ type: 'ready' });
            return;
        }

        if (message.type === 'frame') {
            if (!encoder || !config) throw new Error('gif-worker-not-initialized');
            const frameIndex = Number(message.index);
            if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= config.totalFrames) {
                throw new Error('gif-frame-index-mismatch');
            }
            const rgba = new Uint8ClampedArray(message.rgbaBuffer);
            const palette = quantize(rgba, config.maxColors, { format: 'rgb565' });
            const indexed = applyPalette(rgba, palette, 'rgb565');
            encoder.writeFrame(indexed, config.width, config.height, {
                palette,
                delay: config.frameDelaysMs[frameIndex],
                repeat: 0,
            });
            self.postMessage({
                type: 'progress',
                index: frameIndex,
                totalFrames: config.totalFrames,
            });
            return;
        }

        if (message.type === 'finish') {
            if (!encoder) throw new Error('gif-worker-not-initialized');
            encoder.finish();
            const bytes = encoder.bytes();
            const copy = bytes.slice();
            encoder = null;
            config = null;
            self.postMessage({ type: 'done', buffer: copy.buffer }, [copy.buffer]);
        }
    } catch (error) {
        encoder = null;
        config = null;
        self.postMessage({
            type: 'error',
            message: error?.message || 'gif-encode-failed',
        });
    }
};
