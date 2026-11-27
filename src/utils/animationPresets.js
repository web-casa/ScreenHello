export const MOTION_MAX_EDGE = 1280;
export const MOTION_MAX_FRAMES = 90;
export const MOTION_DURATIONS = Object.freeze([2, 3, 4]);
export const MOTION_FPS_OPTIONS = Object.freeze([15, 24, 30]);
export const MOTION_FORMATS = Object.freeze(['gif', 'webm']);

export const ANIMATION_PRESETS = Object.freeze([
    Object.freeze({
        id: 'float',
        label: '悬浮呼吸',
        description: '柔和上下漂浮与微幅呼吸缩放，无缝循环',
    }),
    Object.freeze({
        id: 'slide-in',
        label: '轻盈滑入',
        description: '从下方优雅浮现并停留展示后平滑复位',
    }),
    Object.freeze({
        id: 'tilt-3d',
        label: '微幅摆动',
        description: '优雅左右摇摆与微幅景深视差，突出立体感',
    }),
    Object.freeze({
        id: 'zoom-pulse',
        label: '缓慢推近',
        description: '电影镜头式平滑推拉聚焦核心内容',
    }),
    Object.freeze({
        id: 'pan-reveal',
        label: '轻扫光泽',
        description: '轻柔水平漂移叠加高光扫过，适合产品发布',
    }),
]);

export const getAnimationPreset = (id) => (
    ANIMATION_PRESETS.find((preset) => preset.id === id) || ANIMATION_PRESETS[0]
);

/**
 * 计算导出动图的规范尺寸：等比约束最长边 <= maxEdge，并对齐为偶数像素（兼容 VP8/VP9 编解码器）。
 */
export function computeMotionDimensions(sourceWidth, sourceHeight, maxEdge = MOTION_MAX_EDGE) {
    const w = Math.max(2, Math.round(Number(sourceWidth) || 800));
    const h = Math.max(2, Math.round(Number(sourceHeight) || 600));
    const cap = Math.max(64, Math.round(Number(maxEdge) || MOTION_MAX_EDGE));
    const longest = Math.max(w, h);
    const scale = longest > cap ? cap / longest : 1;
    const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
    return {
        width: even(Math.round(w * scale)),
        height: even(Math.round(h * scale)),
        scale,
    };
}

/**
 * 为 GIF89a 生成误差扩散后的逐帧延时表（单位毫秒，每帧均为 >= 20ms 的 10ms 整数倍），
 * 避免 gifenc 按厘秒（10ms）四舍五入产生长循环累计漂移。
 */
export function buildGifFrameDelaysMs(durationMs, totalFrames) {
    const count = Math.max(1, Math.round(Number(totalFrames) || 1));
    const minTotalCs = count * 2;
    const targetCs = Math.max(minTotalCs, Math.round((Number(durationMs) || count * 40) / 10));
    const delays = new Array(count);
    let emittedCs = 0;
    for (let index = 0; index < count; index += 1) {
        const remaining = count - index;
        const idealCumulativeCs = Math.round(((index + 1) * targetCs) / count);
        const minAllowed = emittedCs + 2;
        const maxAllowed = targetCs - (remaining - 1) * 2;
        const nextCumulative = Math.min(maxAllowed, Math.max(minAllowed, idealCumulativeCs));
        delays[index] = (nextCumulative - emittedCs) * 10;
        emittedCs = nextCumulative;
    }
    return delays;
}

/**
 * 计算动图帧预算：保证总帧数不超过 MOTION_MAX_FRAMES（90 帧）。
 */
export function computeMotionFramePlan({ durationSec = 3, fps = 24 } = {}) {
    const duration = MOTION_DURATIONS.includes(Number(durationSec)) ? Number(durationSec) : 3;
    const durationMs = duration * 1000;
    const targetFps = MOTION_FPS_OPTIONS.includes(Number(fps)) ? Number(fps) : 24;
    const rawFrames = Math.round(duration * targetFps);
    const totalFrames = Math.min(MOTION_MAX_FRAMES, Math.max(2, rawFrames));
    const effectiveFps = Math.round((totalFrames / duration) * 10) / 10;
    const frameDelaysMs = buildGifFrameDelaysMs(durationMs, totalFrames);
    const frameDelayMs = Math.max(20, Math.round(durationMs / totalFrames));
    return {
        durationSec: duration,
        durationMs,
        targetFps,
        totalFrames,
        effectiveFps,
        frameDelayMs,
        frameDelaysMs,
        capped: rawFrames > MOTION_MAX_FRAMES,
    };
}

const easeInOutCubic = (x) => (
    x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2
);

/**
 * 采样指定动画在归一化循环进度 progress ∈ [0, 1) 下的 2D 变换与高光状态。
 * 所有预设在 progress = 0 与 progress → 1 处连续衔接，保证 GIF 无缝循环。
 */
export function sampleAnimationTransform(presetId, rawProgress, width = 800, height = 600) {
    const t = ((Number(rawProgress) || 0) % 1 + 1) % 1;
    const theta = t * Math.PI * 2;
    const minSide = Math.max(100, Math.min(Number(width) || 800, Number(height) || 600));

    switch (presetId) {
        case 'slide-in': {
            // 0..0.28 smooth rise-in, 0.28..0.76 gentle float hold, 0.76..1.0 smooth glide back
            let enter = 1;
            if (t < 0.28) {
                enter = easeInOutCubic(t / 0.28);
            } else if (t > 0.76) {
                enter = 1 - easeInOutCubic((t - 0.76) / 0.24);
            }
            const travel = minSide * 0.075;
            const microBob = Math.sin(theta) * (minSide * 0.008) * enter;
            return {
                translateX: 0,
                translateY: (1 - enter) * travel + microBob,
                scaleX: 0.94 + 0.06 * enter,
                scaleY: 0.94 + 0.06 * enter,
                rotationDeg: 0,
                opacity: 0.18 + 0.82 * enter,
                sheenProgress: null,
            };
        }
        case 'tilt-3d': {
            const swing = Math.sin(theta);
            const depth = Math.cos(theta);
            return {
                translateX: swing * (minSide * 0.022),
                translateY: (1 - depth) * (minSide * 0.012) - minSide * 0.006,
                scaleX: 1 - Math.abs(swing) * 0.045,
                scaleY: 1 + depth * 0.012,
                rotationDeg: swing * 2.4,
                opacity: 1,
                sheenProgress: null,
            };
        }
        case 'zoom-pulse': {
            const wave = (1 - Math.cos(theta)) / 2; // 0 -> 1 -> 0
            const scale = 0.985 + wave * 0.055;
            return {
                translateX: 0,
                translateY: -wave * (minSide * 0.008),
                scaleX: scale,
                scaleY: scale,
                rotationDeg: 0,
                opacity: 1,
                sheenProgress: null,
            };
        }
        case 'pan-reveal': {
            const drift = Math.sin(theta);
            return {
                translateX: drift * (minSide * 0.024),
                translateY: Math.cos(theta) * (minSide * 0.008),
                scaleX: 1.01,
                scaleY: 1.01,
                rotationDeg: drift * 0.6,
                opacity: 1,
                sheenProgress: t,
            };
        }
        case 'float':
        default: {
            const bob = Math.sin(theta);
            const breath = (1 - Math.cos(theta)) / 2;
            const scale = 0.992 + breath * 0.02;
            return {
                translateX: 0,
                translateY: -bob * (minSide * 0.024),
                scaleX: scale,
                scaleY: scale,
                rotationDeg: Math.cos(theta) * 0.7,
                opacity: 1,
                sheenProgress: null,
            };
        }
    }
}
