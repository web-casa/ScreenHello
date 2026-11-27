import { isDeviceFrameId } from './rasterDeviceConfig';

export const PERSPECTIVE_ROTATE_X_MIN = -35;
export const PERSPECTIVE_ROTATE_X_MAX = 35;

const VECTOR_DEVICE_FRAME_IDS = new Set([
    'genericLaptop',
    'genericDesktop',
    'genericTablet',
    'genericPhone',
    'macbookpro16',
    'macbookair',
    'imacpro',
    'ipadpro',
    'iphonepro',
]);

export function isPerspectiveBlockedFrame(frameId) {
    return isDeviceFrameId(frameId) || VECTOR_DEVICE_FRAME_IDS.has(frameId);
}
export const PERSPECTIVE_ROTATE_Y_MIN = -35;
export const PERSPECTIVE_ROTATE_Y_MAX = 35;
export const PERSPECTIVE_ROTATE_Z_MIN = -25;
export const PERSPECTIVE_ROTATE_Z_MAX = 25;
export const PERSPECTIVE_DISTANCE_MIN = 600;
export const PERSPECTIVE_DISTANCE_MAX = 2400;
export const PERSPECTIVE_ELEVATION_MIN = 0;
export const PERSPECTIVE_ELEVATION_MAX = 48;

export const PERSPECTIVE_PRESETS = Object.freeze([
    Object.freeze({
        id: 'flat',
        title: '平面居中',
        rotateX: 0,
        rotateY: 0,
        rotateZ: 0,
        distance: 1100,
        elevation: 0,
    }),
    Object.freeze({
        id: 'tilt-left',
        title: '左仰 3D',
        rotateX: 10,
        rotateY: -16,
        rotateZ: -2,
        distance: 1100,
        elevation: 20,
    }),
    Object.freeze({
        id: 'tilt-right',
        title: '右仰 3D',
        rotateX: 10,
        rotateY: 16,
        rotateZ: 2,
        distance: 1100,
        elevation: 20,
    }),
    Object.freeze({
        id: 'float-up',
        title: '轻仰悬浮',
        rotateX: 15,
        rotateY: 0,
        rotateZ: 0,
        distance: 1050,
        elevation: 26,
    }),
    Object.freeze({
        id: 'isometric-left',
        title: '等距左倾',
        rotateX: 18,
        rotateY: -22,
        rotateZ: -7,
        distance: 1000,
        elevation: 28,
    }),
    Object.freeze({
        id: 'isometric-right',
        title: '等距右倾',
        rotateX: 18,
        rotateY: 22,
        rotateZ: 7,
        distance: 1000,
        elevation: 28,
    }),
    Object.freeze({
        id: 'hero-closeup',
        title: '英雄斜切',
        rotateX: 14,
        rotateY: -18,
        rotateZ: -10,
        distance: 920,
        elevation: 24,
    }),
    Object.freeze({
        id: 'subtle-tilt',
        title: '微倾卡片',
        rotateX: 6,
        rotateY: -9,
        rotateZ: 0,
        distance: 1350,
        elevation: 14,
    }),
]);

export const PERSPECTIVE_PRESET_MAP = Object.freeze(
    Object.fromEntries(PERSPECTIVE_PRESETS.map((item) => [item.id, item])),
);

export const DEFAULT_PERSPECTIVE = Object.freeze({
    preset: 'flat',
    rotateX: 0,
    rotateY: 0,
    rotateZ: 0,
    distance: 1100,
    elevation: 0,
});

const clampNumber = (value, min, max, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
};

export function getPerspectivePreset(id) {
    return PERSPECTIVE_PRESET_MAP[id] || null;
}

export function isPerspectiveActive(raw) {
    if (!raw || typeof raw !== 'object') return false;
    const rx = Number(raw.rotateX) || 0;
    const ry = Number(raw.rotateY) || 0;
    const rz = Number(raw.rotateZ) || 0;
    return rx !== 0 || ry !== 0 || rz !== 0;
}

export function normalizePerspective(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ...DEFAULT_PERSPECTIVE };
    }
    const rotateX = clampNumber(raw.rotateX, PERSPECTIVE_ROTATE_X_MIN, PERSPECTIVE_ROTATE_X_MAX, 0);
    const rotateY = clampNumber(raw.rotateY, PERSPECTIVE_ROTATE_Y_MIN, PERSPECTIVE_ROTATE_Y_MAX, 0);
    const rotateZ = clampNumber(raw.rotateZ, PERSPECTIVE_ROTATE_Z_MIN, PERSPECTIVE_ROTATE_Z_MAX, 0);
    const distance = clampNumber(raw.distance, PERSPECTIVE_DISTANCE_MIN, PERSPECTIVE_DISTANCE_MAX, DEFAULT_PERSPECTIVE.distance);
    const elevation = clampNumber(raw.elevation, PERSPECTIVE_ELEVATION_MIN, PERSPECTIVE_ELEVATION_MAX, 0);

    if (rotateX === 0 && rotateY === 0 && rotateZ === 0) {
        return {
            preset: 'flat',
            rotateX: 0,
            rotateY: 0,
            rotateZ: 0,
            distance,
            elevation: 0,
        };
    }

    const presetCandidate = typeof raw.preset === 'string' && PERSPECTIVE_PRESET_MAP[raw.preset]
        ? PERSPECTIVE_PRESET_MAP[raw.preset]
        : null;
    const matchesPreset = presetCandidate
        && presetCandidate.rotateX === rotateX
        && presetCandidate.rotateY === rotateY
        && presetCandidate.rotateZ === rotateZ
        && presetCandidate.distance === distance;

    return {
        preset: matchesPreset ? presetCandidate.id : 'custom',
        rotateX,
        rotateY,
        rotateZ,
        distance,
        elevation,
    };
}

export function perspectiveFromPreset(presetId) {
    const preset = getPerspectivePreset(presetId);
    if (!preset) return { ...DEFAULT_PERSPECTIVE };
    return {
        preset: preset.id,
        rotateX: preset.rotateX,
        rotateY: preset.rotateY,
        rotateZ: preset.rotateZ,
        distance: preset.distance,
        elevation: preset.elevation,
    };
}

/**
 * 把二维矩形四角经 3D 欧拉旋转 (Ry -> Rx -> Rz) 与针孔透视投影到平面，
 * 并计算包含定向阴影外扩的统一画布包围盒，确保画布布局、选框、命中测试与导出共享唯一几何来源。
 */
export function computePerspectiveGeometry(width, height, rawPerspective, shadow = null) {
    const safeWidth = Math.max(1, Number(width) || 1);
    const safeHeight = Math.max(1, Number(height) || 1);
    const perspective = normalizePerspective(rawPerspective);

    if (!isPerspectiveActive(perspective)) {
        return {
            active: false,
            perspective,
            corners: [[0, 0], [safeWidth, 0], [safeWidth, safeHeight], [0, safeHeight]],
            quadWidth: safeWidth,
            quadHeight: safeHeight,
            padLeft: 0,
            padTop: 0,
            padRight: 0,
            padBottom: 0,
            totalWidth: safeWidth,
            totalHeight: safeHeight,
            originOffsetX: 0,
            originOffsetY: 0,
        };
    }

    const deg = Math.PI / 180;
    const rx = perspective.rotateX * deg;
    const ry = perspective.rotateY * deg;
    const rz = perspective.rotateZ * deg;
    const cosX = Math.cos(rx), sinX = Math.sin(rx);
    const cosY = Math.cos(ry), sinY = Math.sin(ry);
    const cosZ = Math.cos(rz), sinZ = Math.sin(rz);

    // 相机距离随源图长边等比缩放，保证不同分辨率图片呈现一致的透视畸变观感。
    const basis = Math.max(safeWidth, safeHeight);
    const focal = Math.max(basis * 1.15, (perspective.distance / 1000) * basis * 1.45);

    const halfW = safeWidth / 2;
    const halfH = safeHeight / 2;
    const sourcePoints = [
        [-halfW, -halfH],
        [halfW, -halfH],
        [halfW, halfH],
        [-halfW, halfH],
    ];

    const projected = sourcePoints.map(([px, py]) => {
        // Rotate around Y
        const x1 = px * cosY;
        const z1 = -px * sinY;
        const y1 = py;
        // Rotate around X
        const y2 = y1 * cosX - z1 * sinX;
        const z2 = y1 * sinX + z1 * cosX;
        const x2 = x1;
        // Rotate around Z
        const x3 = x2 * cosZ - y2 * sinZ;
        const y3 = x2 * sinZ + y2 * cosZ;
        const z3 = z2;

        const denom = Math.max(focal * 0.25, focal - z3);
        const factor = focal / denom;
        return [x3 * factor, y3 * factor];
    });

    const xs = projected.map(([x]) => x);
    const ys = projected.map(([, y]) => y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const quadWidth = Math.max(1, maxX - minX);
    const quadHeight = Math.max(1, maxY - minY);

    const shadowVisible = shadow ? shadow.visible !== false : true;
    const shadowBlur = shadowVisible ? Math.max(0, Number(shadow?.blur) || 18) : 0;
    const shadowSpread = shadowVisible ? Math.max(0, Number(shadow?.spread) || 0) : 0;
    const shadowX = shadowVisible
        ? (Number(shadow?.x) || 0) + Math.round(-perspective.rotateY * 0.65)
        : 0;
    const shadowY = shadowVisible
        ? (Number(shadow?.y) || 10) + Math.round(perspective.elevation * 0.9)
        : 0;

    const blurMargin = shadowVisible ? Math.ceil(shadowBlur * 1.35 + shadowSpread + 6) : 4;
    const padLeft = Math.max(4, blurMargin + Math.max(0, -shadowX));
    const padRight = Math.max(4, blurMargin + Math.max(0, shadowX));
    const padTop = Math.max(4, blurMargin + Math.max(0, -shadowY));
    const padBottom = Math.max(4, blurMargin + Math.max(0, shadowY));

    const totalWidth = Math.ceil(quadWidth + padLeft + padRight);
    const totalHeight = Math.ceil(quadHeight + padTop + padBottom);

    const corners = projected.map(([x, y]) => [
        x - minX + padLeft,
        y - minY + padTop,
    ]);

    return {
        active: true,
        perspective,
        corners,
        quadWidth,
        quadHeight,
        padLeft,
        padTop,
        padRight,
        padBottom,
        totalWidth,
        totalHeight,
        shadowOffsetX: shadowX,
        shadowOffsetY: shadowY,
        shadowBlur,
        originOffsetX: (totalWidth - safeWidth) / 2,
        originOffsetY: (totalHeight - safeHeight) / 2,
    };
}

/** 精确判断局部点 (px, py) 是否落在凸四边形 corners 内（用于避免透明外角误截获点击）。 */
export function pointInQuad(px, py, corners) {
    if (!Array.isArray(corners) || corners.length !== 4) return true;
    let sign = 0;
    for (let i = 0; i < 4; i += 1) {
        const [x1, y1] = corners[i];
        const [x2, y2] = corners[(i + 1) % 4];
        const cross = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
        if (Math.abs(cross) < 1e-6) continue;
        const nextSign = cross > 0 ? 1 : -1;
        if (sign === 0) sign = nextSign;
        else if (sign !== nextSign) return false;
    }
    return true;
}
