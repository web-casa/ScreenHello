export const CROP_MIN_SIZE = 10;
export const CROP_MIN_ZOOM = 1;
export const CROP_MAX_ZOOM = 4;
export const CROP_ZOOM_STEP = 0.25;
export const CROP_MAX_EXPORT_PIXELS = 120_000_000;

export const CROP_ASPECT_PRESETS = Object.freeze([
    { id: 'free', ratio: null },
    { id: 'original', ratio: 'original' },
    { id: '1:1', ratio: 1 },
    { id: '16:9', ratio: 16 / 9 },
    { id: '4:3', ratio: 4 / 3 },
]);

export const CROP_HANDLES = Object.freeze(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const positiveDimension = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

export const effectiveMinSize = (naturalWidth, naturalHeight, minSize = CROP_MIN_SIZE) => {
    const nw = positiveDimension(naturalWidth);
    const nh = positiveDimension(naturalHeight);
    const floor = Math.max(1, Number(minSize) || CROP_MIN_SIZE);
    return {
        minWidth: Math.min(floor, nw),
        minHeight: Math.min(floor, nh),
    };
};

export const resolveAspectRatio = (presetId, naturalWidth, naturalHeight) => {
    const preset = CROP_ASPECT_PRESETS.find((item) => item.id === presetId);
    if (!preset || preset.ratio == null) return null;
    if (preset.ratio === 'original') {
        return positiveDimension(naturalWidth) / positiveDimension(naturalHeight);
    }
    return Number.isFinite(preset.ratio) && preset.ratio > 0 ? preset.ratio : null;
};

export const clampZoom = (zoom) => {
    const parsed = Number(zoom);
    if (!Number.isFinite(parsed)) return CROP_MIN_ZOOM;
    return clamp(Math.round(parsed * 100) / 100, CROP_MIN_ZOOM, CROP_MAX_ZOOM);
};

export const computeViewportLayout = ({
    naturalWidth,
    naturalHeight,
    stageWidth,
    stageHeight,
    zoom = 1,
    panX = 0,
    panY = 0,
    padding = 16,
}) => {
    const nw = positiveDimension(naturalWidth);
    const nh = positiveDimension(naturalHeight);
    const sw = Math.max(1, Number(stageWidth) || 1);
    const sh = Math.max(1, Number(stageHeight) || 1);
    const pad = Math.max(0, Math.min(Number(padding) || 0, Math.min(sw, sh) / 4));
    const innerW = Math.max(1, sw - pad * 2);
    const innerH = Math.max(1, sh - pad * 2);
    const baseScale = Math.min(innerW / nw, innerH / nh);
    const clampedZoom = clampZoom(zoom);
    const scale = baseScale * clampedZoom;
    const width = nw * scale;
    const height = nh * scale;
    const maxPanX = Math.max(0, (width - innerW) / 2);
    const maxPanY = Math.max(0, (height - innerH) / 2);
    const clampedPanX = clampedZoom <= CROP_MIN_ZOOM ? 0 : clamp(Number(panX) || 0, -maxPanX, maxPanX);
    const clampedPanY = clampedZoom <= CROP_MIN_ZOOM ? 0 : clamp(Number(panY) || 0, -maxPanY, maxPanY);
    return {
        scale,
        baseScale,
        zoom: clampedZoom,
        panX: clampedPanX,
        panY: clampedPanY,
        maxPanX,
        maxPanY,
        imageRect: {
            x: (sw - width) / 2 + clampedPanX,
            y: (sh - height) / 2 + clampedPanY,
            width,
            height,
        },
    };
};

export const naturalRectToStageRect = (rect, layout) => ({
    x: layout.imageRect.x + rect.x * layout.scale,
    y: layout.imageRect.y + rect.y * layout.scale,
    width: rect.width * layout.scale,
    height: rect.height * layout.scale,
});

export const clampCropRect = (rect, naturalWidth, naturalHeight, minSize = CROP_MIN_SIZE) => {
    const nw = positiveDimension(naturalWidth);
    const nh = positiveDimension(naturalHeight);
    const { minWidth, minHeight } = effectiveMinSize(nw, nh, minSize);
    const width = clamp(Number(rect?.width) || nw, minWidth, nw);
    const height = clamp(Number(rect?.height) || nh, minHeight, nh);
    const x = clamp(Number(rect?.x) || 0, 0, Math.max(0, nw - width));
    const y = clamp(Number(rect?.y) || 0, 0, Math.max(0, nh - height));
    return { x, y, width, height };
};

export const createInitialCropRect = (naturalWidth, naturalHeight, ratio = null, minSize = CROP_MIN_SIZE) => {
    const nw = positiveDimension(naturalWidth);
    const nh = positiveDimension(naturalHeight);
    if (!ratio || !Number.isFinite(ratio) || ratio <= 0) {
        return { x: 0, y: 0, width: nw, height: nh };
    }
    let width = nw;
    let height = width / ratio;
    if (height > nh) {
        height = nh;
        width = height * ratio;
    }
    const { minWidth, minHeight } = effectiveMinSize(nw, nh, minSize);
    if (width < minWidth) {
        width = minWidth;
        height = Math.min(nh, width / ratio);
    }
    if (height < minHeight) {
        height = minHeight;
        width = Math.min(nw, height * ratio);
    }
    return clampCropRect({
        x: (nw - width) / 2,
        y: (nh - height) / 2,
        width,
        height,
    }, nw, nh, minSize);
};

export const fitCropToAspectRatio = (currentRect, ratio, naturalWidth, naturalHeight, minSize = CROP_MIN_SIZE) => {
    const nw = positiveDimension(naturalWidth);
    const nh = positiveDimension(naturalHeight);
    const base = clampCropRect(currentRect, nw, nh, minSize);
    if (!ratio || !Number.isFinite(ratio) || ratio <= 0) return base;
    const cx = base.x + base.width / 2;
    const cy = base.y + base.height / 2;
    const { minWidth, minHeight } = effectiveMinSize(nw, nh, minSize);

    let width = base.width;
    let height = width / ratio;
    if (height > base.height) {
        height = base.height;
        width = height * ratio;
    }

    const minBoundW = Math.max(minWidth, minHeight * ratio);
    const minBoundH = Math.max(minHeight, minWidth / ratio);
    if (width < minBoundW || height < minBoundH) {
        width = Math.min(nw, minBoundW);
        height = width / ratio;
        if (height > nh) {
            height = nh;
            width = height * ratio;
        }
    }

    width = Math.min(width, nw);
    height = Math.min(height, nh);
    const x = clamp(cx - width / 2, 0, Math.max(0, nw - width));
    const y = clamp(cy - height / 2, 0, Math.max(0, nh - height));
    return { x, y, width, height };
};

const minDimensionsForRatio = (ratio, nw, nh, minWidth, minHeight) => {
    let minW = Math.max(minWidth, minHeight * ratio);
    let minH = minW / ratio;
    if (minW > nw || minH > nh) {
        const scale = Math.min(nw / minW, nh / minH);
        minW *= scale;
        minH *= scale;
    }
    return { minW, minH };
};

const resizeCornerLocked = ({ startRect, handle, dxNatural, dyNatural, nw, nh, ratio, minWidth, minHeight }) => {
    const left = startRect.x;
    const top = startRect.y;
    const right = startRect.x + startRect.width;
    const bottom = startRect.y + startRect.height;

    const anchorX = handle.includes('w') ? right : left;
    const anchorY = handle.includes('n') ? bottom : top;
    const dirX = handle.includes('w') ? -1 : 1;
    const dirY = handle.includes('n') ? -1 : 1;

    const candidateW = startRect.width + dirX * dxNatural;
    const candidateH = startRect.height + dirY * dyNatural;
    const maxW = Math.min(dirX < 0 ? anchorX : nw - anchorX, (dirY < 0 ? anchorY : nh - anchorY) * ratio);
    const { minW } = minDimensionsForRatio(ratio, nw, nh, minWidth, minHeight);

    const deltaW = Math.abs(dxNatural);
    const deltaH = Math.abs(dyNatural) * ratio;
    const desiredW = deltaW >= deltaH ? candidateW : candidateH * ratio;
    const width = clamp(desiredW, Math.min(minW, maxW), Math.max(minW, maxW));
    const clampedW = Math.min(width, maxW);
    const clampedH = clampedW / ratio;

    return {
        x: dirX < 0 ? anchorX - clampedW : anchorX,
        y: dirY < 0 ? anchorY - clampedH : anchorY,
        width: clampedW,
        height: clampedH,
    };
};

const resizeEdgeLocked = ({ startRect, handle, dxNatural, dyNatural, nw, nh, ratio, minWidth, minHeight }) => {
    const left = startRect.x;
    const top = startRect.y;
    const right = startRect.x + startRect.width;
    const bottom = startRect.y + startRect.height;
    const cx = left + startRect.width / 2;
    const cy = top + startRect.height / 2;
    const { minW, minH } = minDimensionsForRatio(ratio, nw, nh, minWidth, minHeight);

    if (handle === 'n' || handle === 's') {
        const anchorY = handle === 'n' ? bottom : top;
        const dirY = handle === 'n' ? -1 : 1;
        const maxHFromVertical = dirY < 0 ? anchorY : nh - anchorY;
        const maxHFromWidth = nw / ratio;
        const maxH = Math.min(maxHFromVertical, maxHFromWidth);
        const height = clamp(startRect.height + dirY * dyNatural, Math.min(minH, maxH), maxH);
        const width = height * ratio;
        const x = clamp(cx - width / 2, 0, Math.max(0, nw - width));
        const y = dirY < 0 ? anchorY - height : anchorY;
        return { x, y, width, height };
    }

    const anchorX = handle === 'w' ? right : left;
    const dirX = handle === 'w' ? -1 : 1;
    const maxWFromHorizontal = dirX < 0 ? anchorX : nw - anchorX;
    const maxWFromHeight = nh * ratio;
    const maxW = Math.min(maxWFromHorizontal, maxWFromHeight);
    const width = clamp(startRect.width + dirX * dxNatural, Math.min(minW, maxW), maxW);
    const height = width / ratio;
    const x = dirX < 0 ? anchorX - width : anchorX;
    const y = clamp(cy - height / 2, 0, Math.max(0, nh - height));
    return { x, y, width, height };
};

export const applyCropInteraction = ({
    startRect,
    handle,
    dxNatural = 0,
    dyNatural = 0,
    naturalWidth,
    naturalHeight,
    ratio = null,
    minSize = CROP_MIN_SIZE,
}) => {
    const nw = positiveDimension(naturalWidth);
    const nh = positiveDimension(naturalHeight);
    const base = clampCropRect(startRect, nw, nh, minSize);
    const { minWidth, minHeight } = effectiveMinSize(nw, nh, minSize);

    if (handle === 'move') {
        return {
            x: clamp(base.x + dxNatural, 0, Math.max(0, nw - base.width)),
            y: clamp(base.y + dyNatural, 0, Math.max(0, nh - base.height)),
            width: base.width,
            height: base.height,
        };
    }

    if (ratio && Number.isFinite(ratio) && ratio > 0) {
        if (handle.length === 2) {
            return resizeCornerLocked({ startRect: base, handle, dxNatural, dyNatural, nw, nh, ratio, minWidth, minHeight });
        }
        return resizeEdgeLocked({ startRect: base, handle, dxNatural, dyNatural, nw, nh, ratio, minWidth, minHeight });
    }

    let left = base.x;
    let top = base.y;
    let right = base.x + base.width;
    let bottom = base.y + base.height;

    if (handle.includes('w')) left = clamp(left + dxNatural, 0, right - minWidth);
    if (handle.includes('e')) right = clamp(right + dxNatural, left + minWidth, nw);
    if (handle.includes('n')) top = clamp(top + dyNatural, 0, bottom - minHeight);
    if (handle.includes('s')) bottom = clamp(bottom + dyNatural, top + minHeight, nh);

    return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    };
};

export const nudgeCropRect = (rect, { dx = 0, dy = 0, naturalWidth, naturalHeight, minSize = CROP_MIN_SIZE }) => {
    return applyCropInteraction({
        startRect: rect,
        handle: 'move',
        dxNatural: dx,
        dyNatural: dy,
        naturalWidth,
        naturalHeight,
        minSize,
    });
};

export const finalizeCropPixels = (rect, naturalWidth, naturalHeight) => {
    const nw = Math.max(1, Math.round(positiveDimension(naturalWidth)));
    const nh = Math.max(1, Math.round(positiveDimension(naturalHeight)));
    const clamped = clampCropRect(rect, nw, nh, 1);
    const x = clamp(Math.round(clamped.x), 0, Math.max(0, nw - 1));
    const y = clamp(Math.round(clamped.y), 0, Math.max(0, nh - 1));
    const width = clamp(Math.round(clamped.width), 1, nw - x);
    const height = clamp(Math.round(clamped.height), 1, nh - y);
    return { x, y, width, height };
};

export const renderCroppedBlob = async (
    imageElement,
    rect,
    { maxPixels = CROP_MAX_EXPORT_PIXELS, documentRef = typeof document !== 'undefined' ? document : null } = {},
) => {
    const nw = positiveDimension(imageElement?.naturalWidth || imageElement?.width);
    const nh = positiveDimension(imageElement?.naturalHeight || imageElement?.height);
    const pixels = finalizeCropPixels(rect, nw, nh);
    if (pixels.width * pixels.height > maxPixels) {
        throw Object.assign(new Error('crop-pixel-budget-exceeded'), { code: 'crop-pixel-budget-exceeded' });
    }
    if (!documentRef) {
        throw Object.assign(new Error('crop-document-unavailable'), { code: 'crop-document-unavailable' });
    }
    const canvas = documentRef.createElement('canvas');
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    try {
        const context = canvas.getContext('2d');
        if (!context) {
            throw Object.assign(new Error('crop-context-unavailable'), { code: 'crop-context-unavailable' });
        }
        context.drawImage(
            imageElement,
            pixels.x,
            pixels.y,
            pixels.width,
            pixels.height,
            0,
            0,
            pixels.width,
            pixels.height,
        );
        const blob = await new Promise((resolve, reject) => {
            try {
                canvas.toBlob((result) => {
                    if (result) resolve(result);
                    else reject(Object.assign(new Error('crop-encode-failed'), { code: 'crop-encode-failed' }));
                }, 'image/png');
            } catch (error) {
                reject(error);
            }
        });
        return { blob, ...pixels };
    } finally {
        canvas.width = 0;
        canvas.height = 0;
    }
};
