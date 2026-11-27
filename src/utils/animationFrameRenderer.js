import {
    MOTION_MAX_EDGE,
    computeMotionDimensions,
    sampleAnimationTransform,
} from '@utils/animationPresets';

const cancelError = () => Object.assign(new Error('export-cancelled'), { code: 'export-cancelled' });
const staleError = () => Object.assign(new Error('export-stale'), { code: 'export-stale' });

const isWatermarkNode = (node, waterIndex) => {
    if (!node) return false;
    if (node.name === 'screenhello-watermark') return true;
    return !node.__screenhelloImageId && node.fill?.format === 'svg' && node.zIndex === waterIndex;
};

const releaseWrappers = (wrappers) => {
    for (const wrapper of wrappers) {
        const view = wrapper?.view;
        try { wrapper?.destroy?.(); } catch { /* ignore */ }
        try {
            if (view && typeof view === 'object' && 'width' in view && 'height' in view) {
                view.width = 0;
                view.height = 0;
            }
        } catch { /* ignore */ }
    }
};

const extractCanvasFromExportResult = (result, width, height, documentRef) => {
    const data = result?.data;
    const source = data?.view || data;
    if (!source) return null;
    const out = documentRef.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    if (ctx) {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(source, 0, 0, width, height);
    }
    return out;
};

/**
 * 将当前 Leafer 场景按 3 层 z-order 安全拆分为离屏快照：
 * 1) backgroundCanvas：画布背景 + 底层水印（waterIndex < 0）
 * 2) foregroundCanvas：所有前景图片/卡片/设备框 + 标注（透明底）
 * 3) topWatermarkCanvas：顶层水印（waterIndex >= 0，若有）
 *
 * 全程校验 RenderTaskTracker stamp，并受 try/finally 条件还原保护，
 * 避免覆盖并发编辑产生的新节点状态，也不泄漏任何临时导出 Canvas wrapper。
 */
export async function captureLayeredMotionSnapshot(
    stores,
    {
        maxEdge = MOTION_MAX_EDGE,
        signal,
        documentRef = typeof document !== 'undefined' ? document : null,
    } = {},
) {
    if (signal?.aborted) throw cancelError();
    if (!documentRef) {
        throw Object.assign(new Error('motion-document-unavailable'), { code: 'motion-document-unavailable' });
    }
    const app = stores?.editor?.app;
    const tree = app?.tree;
    const frame = tree?.children?.[0];
    if (!frame || typeof frame.export !== 'function') {
        throw Object.assign(new Error('motion-scene-unavailable'), { code: 'motion-scene-unavailable' });
    }

    const tracker = stores.renderTaskTracker;
    let stamp = null;
    if (tracker?.waitForExport) {
        const initialStamp = tracker.stamp();
        stamp = await tracker.waitForExport(tree, initialStamp, signal);
    }
    const assertFresh = () => {
        if (signal?.aborted) throw cancelError();
        if (tracker && stamp && !tracker.matches(stamp, { paint: false })) {
            throw staleError();
        }
    };

    assertFresh();
    await stores.deviceLicense?.request?.(stores.option?.frame, { signal });
    assertFresh();

    const runCapture = async () => {
        assertFresh();
        // Re-read dimensions & watermark config inside the capture lock after freshness validation.
        const frameWidth = Math.max(2, Number(stores.option?.frameConf?.width) || Number(frame.width) || 800);
        const frameHeight = Math.max(2, Number(stores.option?.frameConf?.height) || Number(frame.height) || 600);
        const dims = computeMotionDimensions(frameWidth, frameHeight, maxEdge);
        const pixelRatio = dims.width / frameWidth;
        const hasWatermark = Boolean(stores.option?.hasActiveWatermark || stores.option?.waterImg);
        const waterIndex = Number(stores.option?.waterIndex ?? 1);
        const watermarkIsBottom = hasWatermark && waterIndex < 0;
        const watermarkIsTop = hasWatermark && waterIndex >= 0;

        // Deselect active Leafer editor box while capturing clean layers.
        app.editor?.cancel?.();

        const children = Array.isArray(frame.children) ? [...frame.children] : [];
        const savedVisibility = children.map((child) => ({ child, visible: child.visible }));
        const appliedVisibility = new Map();
        const savedFill = frame.fill;
        const savedStroke = frame.stroke;
        let appliedFill = savedFill;
        let appliedStroke = savedStroke;
        const watermarkNodes = children.filter((child) => isWatermarkNode(child, waterIndex));
        const watermarkSet = new Set(watermarkNodes);

        const setChildVisible = (child, nextVisible) => {
            child.visible = nextVisible;
            appliedVisibility.set(child, nextVisible);
        };
        const setFrameSurface = (fill, stroke) => {
            frame.fill = fill;
            frame.stroke = stroke;
            appliedFill = fill;
            appliedStroke = stroke;
        };

        let backgroundCanvas = null;
        let foregroundCanvas = null;
        let topWatermarkCanvas = null;

        const exportBand = async () => {
            assertFresh();
            const captured = new Set();
            let result = null;
            try {
                result = await frame.export('canvas', {
                    pixelRatio,
                    onCanvas: (wrapper) => captured.add(wrapper),
                });
                return extractCanvasFromExportResult(result, dims.width, dims.height, documentRef);
            } finally {
                if (result?.data && typeof result.data.destroy === 'function') {
                    captured.add(result.data);
                }
                releaseWrappers(captured);
            }
        };

        try {
            // Band 0: Background + optional bottom watermark
            for (const { child, visible } of savedVisibility) {
                setChildVisible(child, watermarkIsBottom && watermarkSet.has(child) ? visible : false);
            }
            backgroundCanvas = await exportBand();
            assertFresh();

            // Band 1: Foreground layers + annotations on transparent surface
            setFrameSurface('rgba(0,0,0,0)', null);
            for (const { child, visible } of savedVisibility) {
                setChildVisible(child, watermarkSet.has(child) ? false : visible);
            }
            foregroundCanvas = await exportBand();
            assertFresh();

            // Band 2: Optional top watermark
            if (watermarkIsTop && watermarkNodes.length > 0) {
                for (const { child, visible } of savedVisibility) {
                    setChildVisible(child, watermarkSet.has(child) ? visible : false);
                }
                topWatermarkCanvas = await exportBand();
                assertFresh();
            }

            return {
                width: dims.width,
                height: dims.height,
                hasTransparentBackground: stores.option?.background === 'none',
                backgroundCanvas,
                foregroundCanvas,
                topWatermarkCanvas,
                sheenCanvas: null,
                documentRef,
            };
        } catch (error) {
            disposeMotionSnapshot({ backgroundCanvas, foregroundCanvas, topWatermarkCanvas });
            throw error;
        } finally {
            // Only restore properties that still match our temporary capture mutations,
            // so any concurrent store/React edit made during async export is never overwritten.
            if (frame.fill === appliedFill) frame.fill = savedFill;
            if (frame.stroke === appliedStroke) frame.stroke = savedStroke;
            for (const { child, visible } of savedVisibility) {
                if (appliedVisibility.has(child) && child.visible === appliedVisibility.get(child)) {
                    child.visible = visible;
                }
            }
        }
    };

    return tracker?.withCapture ? tracker.withCapture(runCapture) : runCapture();
}

export function disposeMotionSnapshot(snapshot) {
    if (!snapshot) return;
    for (const key of ['backgroundCanvas', 'foregroundCanvas', 'topWatermarkCanvas', 'sheenCanvas']) {
        const node = snapshot[key];
        if (node) {
            node.width = 0;
            node.height = 0;
        }
    }
    if ('sheenCanvas' in snapshot) {
        snapshot.sheenCanvas = null;
    }
}

const getSheenBuffer = (snapshot, width, height) => {
    const doc = snapshot.documentRef || (typeof document !== 'undefined' ? document : null);
    if (!doc || typeof doc.createElement !== 'function') return null;
    if (!snapshot.sheenCanvas) {
        snapshot.sheenCanvas = doc.createElement('canvas');
    }
    const canvas = snapshot.sheenCanvas;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const sheenCtx = canvas.getContext('2d');
    if (!sheenCtx) return null;
    return { canvas, ctx: sheenCtx };
};

/**
 * 将 3 层静态快照合成到目标 2D Context，严格保持 z-order：
 * [可选白底] -> Band 0 (背景 + 底水印) -> Band 1 (带动画变换的前景 + 标注 + 可选独立离屏扫光) -> Band 2 (顶水印)
 */
export function composeMotionFrame(
    ctx,
    snapshot,
    {
        presetId = 'float',
        progress = 0,
        opaqueFallback = true,
    } = {},
) {
    if (!ctx || !snapshot) return;
    const { width, height, backgroundCanvas, foregroundCanvas, topWatermarkCanvas, hasTransparentBackground } = snapshot;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    if (opaqueFallback && hasTransparentBackground) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
    }

    // Band 0: Static background & optional bottom watermark
    if (backgroundCanvas && backgroundCanvas.width > 0) {
        ctx.drawImage(backgroundCanvas, 0, 0, width, height);
    }

    // Band 1: Animated foreground + annotations
    if (foregroundCanvas && foregroundCanvas.width > 0) {
        const tf = sampleAnimationTransform(presetId, progress, width, height);
        let drawSource = foregroundCanvas;

        // 扫光在独立离屏前景缓冲上以 source-atop 合成，绝不污染下层背景或底层水印。
        if (tf.sheenProgress != null) {
            const buffer = getSheenBuffer(snapshot, width, height);
            if (buffer) {
                const { canvas: sheenCanvas, ctx: sheenCtx } = buffer;
                sheenCtx.save();
                sheenCtx.globalCompositeOperation = 'source-over';
                sheenCtx.clearRect(0, 0, width, height);
                sheenCtx.drawImage(foregroundCanvas, 0, 0, width, height);

                const sweepX = width * (-0.35 + tf.sheenProgress * 1.7);
                const bandW = Math.max(80, width * 0.24);
                const sheen = sheenCtx.createLinearGradient(sweepX - bandW, 0, sweepX + bandW, height);
                sheen.addColorStop(0, 'rgba(255, 255, 255, 0)');
                sheen.addColorStop(0.5, 'rgba(255, 255, 255, 0.16)');
                sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
                sheenCtx.globalCompositeOperation = 'source-atop';
                sheenCtx.fillStyle = sheen;
                sheenCtx.fillRect(0, 0, width, height);
                sheenCtx.restore();
                drawSource = sheenCanvas;
            }
        }

        ctx.save();
        ctx.globalAlpha = tf.opacity;
        ctx.translate(width / 2 + tf.translateX, height / 2 + tf.translateY);
        if (tf.rotationDeg) {
            ctx.rotate((tf.rotationDeg * Math.PI) / 180);
        }
        ctx.scale(tf.scaleX, tf.scaleY);
        ctx.drawImage(drawSource, -width / 2, -height / 2, width, height);
        ctx.restore();
    }

    // Band 2: Static top watermark
    if (topWatermarkCanvas && topWatermarkCanvas.width > 0) {
        ctx.drawImage(topWatermarkCanvas, 0, 0, width, height);
    }

    ctx.restore();
}
