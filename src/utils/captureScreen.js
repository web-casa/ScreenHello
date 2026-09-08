import { browserPlatform } from '../platform/browserPlatform';

const MAX_CAPTURE_PIXELS = 7680 * 4320;

/** @param {HTMLCanvasElement} canvas */
const canvasToPng = (canvas) => new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
        if (blob?.size) resolve(new File([blob], 'ScreenHello-capture.png', { type: 'image/png' }));
        else reject(new Error('screen-capture-encode-failed'));
    }, 'image/png');
});

export const captureScreen = async (platform = browserPlatform) => {
    let mediaStream = null;
    let video = null;
    try {
        mediaStream = await platform.capture.getDisplayMedia();
        video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.srcObject = mediaStream;

        // 等待视频帧稳定
        const playing = new Promise((resolve) => { video.onplaying = resolve; });
        await video.play();
        await playing;

        // 创建canvas并绘制当前视频帧
        const width = Math.round(video.videoWidth);
        const height = Math.round(video.videoHeight);
        if (!width || !height || width * height > MAX_CAPTURE_PIXELS) {
            throw new Error('screen-capture-size-invalid');
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('screen-capture-canvas-unavailable');
        ctx.drawImage(video, 0, 0);

        return await canvasToPng(canvas);
    } catch {
        return null;
    } finally {
        mediaStream?.getTracks().forEach((track) => track.stop());
        if (video) {
            video.onplaying = null;
            video.srcObject = null;
        }
    }
};
