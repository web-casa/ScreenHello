import { browserPlatform } from '../platform/browserPlatform';

export const captureScreen = async () => {
    let mediaStream = null;
    let video = null;
    try {
        mediaStream = await browserPlatform.capture.getDisplayMedia();
        video = document.createElement('video');
        video.srcObject = mediaStream;

        // 等待视频帧稳定
        const playing = new Promise((resolve) => { video.onplaying = resolve; });
        await video.play();
        await playing;

        // 创建canvas并绘制当前视频帧
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);

        // 获取屏幕截图
        const screenshot = canvas.toDataURL('image/png');

        return screenshot;
    } catch (err) {
        console.log('Error capturing screen:', err);
        return null;
    } finally {
        mediaStream?.getTracks().forEach((track) => track.stop());
        if (video) {
            video.onplaying = null;
            video.srcObject = null;
        }
    }
};
