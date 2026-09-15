import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureScreen } from '../../src/utils/captureScreen.js';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

const setupCapture = ({ drawError = null } = {}) => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] };
    const video = {
        onplaying: null,
        srcObject: null,
        videoWidth: 64,
        videoHeight: 48,
        play: vi.fn(async () => queueMicrotask(() => video.onplaying?.())),
    };
    const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
            drawImage: () => {
                if (drawError) throw drawError;
            },
        }),
        toBlob: (callback) => callback(new Blob(['fixture'], { type: 'image/png' })),
    };
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: vi.fn().mockResolvedValue(stream) } });
    vi.stubGlobal('document', { createElement: (tag) => (tag === 'video' ? video : canvas) });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    return { canvas, stop, video };
};

describe('captureScreen resource lifecycle', () => {
    it('stops capture tracks after a successful screenshot', async () => {
        const { canvas, stop, video } = setupCapture();

        await expect(captureScreen()).resolves.toMatchObject({
            name: 'ScreenHello-capture.png',
            type: 'image/png',
            size: 7,
        });
        expect(canvas).toMatchObject({ width: 64, height: 48 });
        expect(video).toMatchObject({ muted: true, playsInline: true });
        expect(stop).toHaveBeenCalledOnce();
        expect(video.srcObject).toBeNull();
        expect(video.onplaying).toBeNull();
    });

    it('also stops capture tracks when canvas processing fails', async () => {
        const { stop, video } = setupCapture({ drawError: new Error('draw-failed') });

        await expect(captureScreen()).resolves.toBeNull();
        expect(stop).toHaveBeenCalledOnce();
        expect(video.srcObject).toBeNull();
    });

    it('uses the injected runtime platform and rejects oversized frames before canvas allocation', async () => {
        const { stop, video } = setupCapture();
        video.videoWidth = 7681;
        video.videoHeight = 4320;
        const platform = {
            capture: { getDisplayMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) },
        };

        await expect(captureScreen(platform)).resolves.toBeNull();
        expect(platform.capture.getDisplayMedia).toHaveBeenCalledOnce();
        expect(stop).toHaveBeenCalledOnce();
    });
});
