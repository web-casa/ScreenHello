import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    ANIMATION_PRESETS,
    MOTION_DURATIONS,
    MOTION_FPS_OPTIONS,
    MOTION_MAX_EDGE,
    MOTION_MAX_FRAMES,
    buildGifFrameDelaysMs,
    computeMotionDimensions,
    computeMotionFramePlan,
    sampleAnimationTransform,
} from '../../src/utils/animationPresets.js';
import {
    encodeGifDirect,
    encodeGifInWorker,
    encodeWebmFromCanvas,
    probeWebmMimeType,
} from '../../src/utils/gifEncoder.js';
import {
    captureLayeredMotionSnapshot,
    composeMotionFrame,
    disposeMotionSnapshot,
} from '../../src/utils/animationFrameRenderer.js';

/**
 * 解析 GIF89a 二进制中的全部 Graphic Control Extension (0x21 0xF9 0x04) 延迟字段（单位厘秒）。
 */
const parseGifGceDelaysCs = (bytes) => {
    const delays = [];
    for (let i = 0; i + 7 < bytes.length; i += 1) {
        if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04 && bytes[i + 7] === 0x00) {
            const delayCs = bytes[i + 4] | (bytes[i + 5] << 8);
            delays.push(delayCs);
            i += 7;
        }
    }
    return delays;
};

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('Animation presets and motion budgets', () => {
    it('defines 5 presets with continuous seamless transforms', () => {
        expect(ANIMATION_PRESETS).toHaveLength(5);
        for (const preset of ANIMATION_PRESETS) {
            const start = sampleAnimationTransform(preset.id, 0, 1000, 600);
            const nearEnd = sampleAnimationTransform(preset.id, 0.9999, 1000, 600);
            expect(Math.abs(start.translateX - nearEnd.translateX)).toBeLessThan(2);
            expect(Math.abs(start.translateY - nearEnd.translateY)).toBeLessThan(2);
            expect(Math.abs(start.scaleX - nearEnd.scaleX)).toBeLessThan(0.02);
            expect(Math.abs(start.rotationDeg - nearEnd.rotationDeg)).toBeLessThan(0.2);
        }
    });

    it('bounds output dimensions to <= 1280px and enforces even pixel dimensions', () => {
        const wide = computeMotionDimensions(2560, 1441);
        expect(wide.width).toBeLessThanOrEqual(MOTION_MAX_EDGE);
        expect(wide.height).toBeLessThanOrEqual(MOTION_MAX_EDGE);
        expect(wide.width % 2).toBe(0);
        expect(wide.height % 2).toBe(0);

        const smallOdd = computeMotionDimensions(601, 403);
        expect(smallOdd.width).toBe(600);
        expect(smallOdd.height).toBe(402);
    });

    it('caps total frames to MOTION_MAX_FRAMES (90)', () => {
        const plan = computeMotionFramePlan({ durationSec: 4, fps: 30 });
        expect(plan.totalFrames).toBe(MOTION_MAX_FRAMES);
        expect(plan.capped).toBe(true);
        expect(plan.frameDelayMs).toBeGreaterThanOrEqual(20);

        const standard = computeMotionFramePlan({ durationSec: 2, fps: 15 });
        expect(standard.totalFrames).toBe(30);
        expect(standard.capped).toBe(false);
    });
});

describe('Local GIF89a encoder and 3-band z-order composition', () => {
    it('encodes multi-frame RGBA buffers into a valid GIF89a binary blob', async () => {
        const width = 16;
        const height = 16;
        const makeFrame = (r, g, b) => {
            const buf = new Uint8ClampedArray(width * height * 4);
            for (let i = 0; i < buf.length; i += 4) {
                buf[i] = r;
                buf[i + 1] = g;
                buf[i + 2] = b;
                buf[i + 3] = 255;
            }
            return buf;
        };
        const progressCalls = [];
        const blob = encodeGifDirect({
            width,
            height,
            delayMs: 50,
            frames: [makeFrame(255, 64, 64), makeFrame(64, 180, 255), makeFrame(80, 220, 120)],
            onProgress: (ratio) => progressCalls.push(ratio),
        });
        expect(blob.type).toBe('image/gif');
        expect(progressCalls.at(-1)).toBe(1);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const header = String.fromCharCode(...bytes.slice(0, 6));
        expect(header).toBe('GIF89a');
        expect(bytes.at(-1)).toBe(0x3b); // GIF trailer byte
    });

    it('aborts GIF encoding immediately when AbortSignal is already aborted', () => {
        const controller = new AbortController();
        controller.abort();
        expect(() => encodeGifDirect({
            width: 8,
            height: 8,
            frames: [new Uint8ClampedArray(8 * 8 * 4)],
            signal: controller.signal,
        })).toThrow(/export-cancelled/);
    });

    it('probes WebM MIME gracefully when MediaRecorder is absent', () => {
        expect(probeWebmMimeType()).toBeNull();
    });

    it('draws background, then transformed foreground, then static top watermark in strict 3-band order', () => {
        const drawOrder = [];
        const ctx = {
            save: vi.fn(),
            restore: vi.fn(),
            clearRect: vi.fn(),
            fillRect: vi.fn(),
            translate: vi.fn(),
            rotate: vi.fn(),
            scale: vi.fn(),
            drawImage: vi.fn((source) => drawOrder.push(source.tag)),
            fillStyle: '',
            globalAlpha: 1,
        };
        const snapshot = {
            width: 400,
            height: 300,
            hasTransparentBackground: true,
            backgroundCanvas: { tag: 'bg-band', width: 400, height: 300 },
            foregroundCanvas: { tag: 'fg-band', width: 400, height: 300 },
            topWatermarkCanvas: { tag: 'top-watermark-band', width: 400, height: 300 },
        };
        composeMotionFrame(ctx, snapshot, { presetId: 'float', progress: 0.25, opaqueFallback: true });
        expect(drawOrder).toEqual(['bg-band', 'fg-band', 'top-watermark-band']);
        expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 400, 300);
    });

    it('streams GIF frames incrementally in no-Worker fallback without buffering all frames', async () => {
        let renderedCount = 0;
        const blob = await encodeGifInWorker({
            width: 8,
            height: 8,
            totalFrames: 3,
            delayMs: 40,
            renderFrameRgba: (idx) => {
                renderedCount += 1;
                const buf = new Uint8ClampedArray(8 * 8 * 4);
                buf.fill(50 + idx * 40);
                for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
                return buf;
            },
        });
        expect(renderedCount).toBe(3);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        expect(String.fromCharCode(...bytes.slice(0, 6))).toBe('GIF89a');
    });

    it('releases failed export wrappers and preserves concurrent edits without clobbering frame fill', async () => {
        const destroy = vi.fn();
        const mockView = { width: 100, height: 100 };
        const child = { visible: true };
        const frame = {
            width: 400,
            height: 300,
            fill: 'initial-fill',
            stroke: 'initial-stroke',
            children: [child],
            export: vi.fn(async (_fmt, opts) => {
                opts?.onCanvas?.({ view: mockView, destroy });
                // Simulate concurrent edit changing fill during export before failing
                frame.fill = 'concurrent-new-fill';
                throw new Error('simulated-export-failure');
            }),
        };
        const stores = {
            option: { frameConf: { width: 400, height: 300 }, background: 'solid', waterImg: null, waterIndex: 1, frame: 'none' },
            editor: { app: { tree: { children: [frame] }, editor: { cancel: vi.fn() } } },
            renderTaskTracker: {
                stamp: () => ({ content: 1, paint: 1, project: 1 }),
                waitForExport: async (_t, s) => s,
                matches: () => true,
                withCapture: (fn) => fn(),
            },
            deviceLicense: { request: async () => {} },
        };
        const mockDocument = {
            createElement: () => ({ width: 0, height: 0, getContext: () => ({ clearRect: vi.fn(), drawImage: vi.fn() }) }),
        };

        await expect(captureLayeredMotionSnapshot(stores, { documentRef: mockDocument }))
            .rejects.toThrow(/simulated-export-failure/);
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(mockView.width).toBe(0);
        expect(mockView.height).toBe(0);
        // Must preserve the concurrent edit rather than overwriting with 'initial-fill'
        expect(frame.fill).toBe('concurrent-new-fill');
        expect(child.visible).toBe(true);
    });

    it('rejects capture with export-stale when document version changes between waitForExport and capture', async () => {
        let valid = true;
        const frame = { width: 400, height: 300, fill: 'bg', stroke: null, children: [], export: vi.fn() };
        const stores = {
            option: { frameConf: { width: 400, height: 300 }, background: 'solid', waterImg: null, waterIndex: 1, frame: 'none' },
            editor: { app: { tree: { children: [frame] }, editor: { cancel: vi.fn() } } },
            renderTaskTracker: {
                stamp: () => ({ content: 1, paint: 1, project: 1 }),
                waitForExport: async (_t, s) => s,
                matches: () => valid,
                withCapture: (fn) => fn(),
            },
            deviceLicense: {
                request: async () => { valid = false; },
            },
        };
        const mockDocument = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
        await expect(captureLayeredMotionSnapshot(stores, { documentRef: mockDocument }))
            .rejects.toMatchObject({ code: 'export-stale' });
        expect(frame.export).not.toHaveBeenCalled();
    });

    it('error-diffuses GIF GCE centisecond delays to match exact target duration across all presets', async () => {
        for (const durationSec of MOTION_DURATIONS) {
            for (const fps of MOTION_FPS_OPTIONS) {
                const plan = computeMotionFramePlan({ durationSec, fps });
                expect(plan.frameDelaysMs).toHaveLength(plan.totalFrames);
                for (const d of plan.frameDelaysMs) {
                    expect(d).toBeGreaterThanOrEqual(20);
                    expect(d % 10).toBe(0);
                }
                const sumMs = plan.frameDelaysMs.reduce((acc, value) => acc + value, 0);
                expect(sumMs).toBe(durationSec * 1000);
            }
        }

        // 对实际编码出的 GIF89a 校验 GCE 厘秒表，验证无 3s@24fps 或 4s@30fps 累计漂移
        const plan = computeMotionFramePlan({ durationSec: 3, fps: 24 });
        const frameBuf = new Uint8ClampedArray(4 * 4 * 4).fill(255);
        const blob = encodeGifDirect({
            width: 4,
            height: 4,
            frameDelaysMs: plan.frameDelaysMs,
            frames: Array.from({ length: plan.totalFrames }, () => frameBuf),
        });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const gceDelaysCs = parseGifGceDelaysCs(bytes);
        expect(gceDelaysCs).toHaveLength(plan.totalFrames);
        expect(gceDelaysCs.reduce((sum, cs) => sum + cs * 10, 0)).toBe(3000);

        // 非法 frameDelaysMs 必须 fail-closed
        expect(() => encodeGifDirect({
            width: 4,
            height: 4,
            frameDelaysMs: [40],
            frames: [frameBuf, frameBuf],
        })).toThrow(/gif-delay-mismatch/);
        expect(() => encodeGifDirect({
            width: 4,
            height: 4,
            frameDelaysMs: [35, 35],
            frames: [frameBuf, frameBuf],
        })).toThrow(/gif-delay-mismatch/);
        expect(buildGifFrameDelaysMs(4000, 90).reduce((a, b) => a + b, 0)).toBe(4000);
    });

    it('schedules WebM recording against monotonic target duration, supports fast abort, and rejects empty output', async () => {
        const captureStreamFps = [];
        let emitChunks = true;
        class FakeMediaRecorder {
            static isTypeSupported(mime) { return mime === 'video/webm;codecs=vp9'; }
            constructor(stream, opts) {
                this.stream = stream;
                this.opts = opts;
                this.state = 'inactive';
            }
            start() { this.state = 'recording'; }
            stop() {
                this.state = 'inactive';
                if (emitChunks) {
                    this.ondataavailable?.({ data: new Blob(['webm-bytes'], { type: 'video/webm' }) });
                }
                this.onstop?.();
            }
        }
        vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

        const makeMockDoc = () => ({
            createElement: () => ({
                width: 0,
                height: 0,
                captureStream: (fps) => {
                    captureStreamFps.push(fps);
                    return { getTracks: () => [{ stop: vi.fn() }] };
                },
                getContext: () => ({ clearRect: vi.fn(), drawImage: vi.fn() }),
            }),
        });

        // 1. 4s@30fps 触发 90 帧上限：总时长应严格对齐 4000ms，captureStream 使用 effectiveFps = 22.5
        vi.useFakeTimers();
        let clock = 1000;
        const now = () => clock;
        const originalSetTimeout = globalThis.setTimeout;
        vi.stubGlobal('setTimeout', (fn, ms) => originalSetTimeout(() => {
            clock += ms;
            fn();
        }, ms));

        const plan = computeMotionFramePlan({ durationSec: 4, fps: 30 });
        const recordedPromise = encodeWebmFromCanvas({
            width: 64,
            height: 64,
            fps: plan.effectiveFps,
            durationMs: plan.durationMs,
            totalFrames: plan.totalFrames,
            drawFrame: (_ctx, index) => {
                // 模拟偶发慢帧（15ms 渲染耗时），单调调度器应自动追齐而不叠加漂移
                if (index % 10 === 0) clock += 15;
            },
            documentRef: makeMockDoc(),
            now,
        });
        await vi.runAllTimersAsync();
        const webm = await recordedPromise;
        expect(webm.size).toBeGreaterThan(0);
        expect(captureStreamFps[0]).toBeCloseTo(22.5, 4);
        expect(clock - 1000).toBeCloseTo(4000, 0);

        // 2. 中途 abort 立即清理定时器并拒绝为 export-cancelled
        const controller = new AbortController();
        const abortedPromise = encodeWebmFromCanvas({
            width: 64,
            height: 64,
            fps: 24,
            durationMs: 2000,
            totalFrames: 48,
            drawFrame: (_ctx, index) => {
                if (index === 2) controller.abort();
            },
            signal: controller.signal,
            documentRef: makeMockDoc(),
            now,
        });
        const abortAssertion = expect(abortedPromise).rejects.toMatchObject({ code: 'export-cancelled' });
        await vi.runAllTimersAsync();
        await abortAssertion;

        // 3. 0 字节输出必须拒绝为 webm-encode-failed
        emitChunks = false;
        const emptyPromise = encodeWebmFromCanvas({
            width: 64,
            height: 64,
            fps: 24,
            durationMs: 200,
            totalFrames: 4,
            drawFrame: () => {},
            documentRef: makeMockDoc(),
            now,
        });
        const emptyAssertion = expect(emptyPromise).rejects.toMatchObject({ code: 'webm-encode-failed' });
        await vi.runAllTimersAsync();
        await emptyAssertion;
    });

    it('isolates pan-reveal sheen on a reusable offscreen foreground buffer without mutating main composite mode', () => {
        const sheenGradientStops = [];
        const sheenCtx = {
            save: vi.fn(),
            restore: vi.fn(),
            clearRect: vi.fn(),
            drawImage: vi.fn(),
            fillRect: vi.fn(),
            createLinearGradient: vi.fn(() => ({
                addColorStop: (offset, color) => sheenGradientStops.push([offset, color]),
            })),
            globalCompositeOperation: 'source-over',
            fillStyle: '',
        };
        let createdCanvases = 0;
        const sheenCanvas = {
            tag: 'sheen-buffer',
            width: 0,
            height: 0,
            getContext: vi.fn(() => sheenCtx),
        };
        const mockDocument = {
            createElement: vi.fn(() => {
                createdCanvases += 1;
                return sheenCanvas;
            }),
        };

        const mainDrawSources = [];
        const mainCompositeOps = [];
        const mainCtx = {
            save: vi.fn(),
            restore: vi.fn(),
            clearRect: vi.fn(),
            fillRect: vi.fn(),
            translate: vi.fn(),
            rotate: vi.fn(),
            scale: vi.fn(),
            drawImage: vi.fn((source) => mainDrawSources.push(source.tag)),
            fillStyle: '',
            globalAlpha: 1,
            _gco: 'source-over',
            get globalCompositeOperation() { return this._gco; },
            set globalCompositeOperation(v) {
                mainCompositeOps.push(v);
                this._gco = v;
            },
        };

        const snapshot = {
            width: 400,
            height: 300,
            hasTransparentBackground: false,
            backgroundCanvas: { tag: 'bg-band', width: 400, height: 300 },
            foregroundCanvas: { tag: 'fg-band', width: 400, height: 300 },
            topWatermarkCanvas: null,
            sheenCanvas: null,
            documentRef: mockDocument,
        };

        // 连续渲染两帧：sheenCanvas 仅按需创建一次并复用，主画布绝不使用 source-atop
        composeMotionFrame(mainCtx, snapshot, { presetId: 'pan-reveal', progress: 0.25 });
        composeMotionFrame(mainCtx, snapshot, { presetId: 'pan-reveal', progress: 0.5 });

        expect(createdCanvases).toBe(1);
        expect(sheenCanvas.width).toBe(400);
        expect(sheenCanvas.height).toBe(300);
        expect(mainDrawSources).toEqual(['bg-band', 'sheen-buffer', 'bg-band', 'sheen-buffer']);
        expect(mainCompositeOps).toEqual([]);
        expect(sheenCtx.drawImage).toHaveBeenCalledWith(snapshot.foregroundCanvas, 0, 0, 400, 300);
        expect(sheenCtx.globalCompositeOperation).toBe('source-atop');
        expect(sheenGradientStops.length).toBeGreaterThanOrEqual(6);

        // disposeMotionSnapshot 必须清零并释放 sheenCanvas
        disposeMotionSnapshot(snapshot);
        expect(sheenCanvas.width).toBe(0);
        expect(sheenCanvas.height).toBe(0);
        expect(snapshot.sheenCanvas).toBeNull();
    });
});
