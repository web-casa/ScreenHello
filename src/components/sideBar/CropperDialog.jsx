import useI18n from '../../i18n/useI18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Modal } from 'antd';
import { NO_CSS_TRANSITION_NAME } from '@components/overlayMotion';
import useStores from '@stores/useStores';
import {
    CROP_ASPECT_PRESETS,
    CROP_HANDLES,
    CROP_MAX_ZOOM,
    CROP_MIN_ZOOM,
    CROP_ZOOM_STEP,
    applyCropInteraction,
    clampCropRect,
    clampZoom,
    computeViewportLayout,
    createInitialCropRect,
    finalizeCropPixels,
    fitCropToAspectRatio,
    naturalRectToStageRect,
    nudgeCropRect,
    renderCroppedBlob,
    resolveAspectRatio,
} from '@utils/cropGeometry';

const DEFAULT_STAGE_SIZE = { width: 480, height: 360 };

export default observer(function CropperDialog({ targetId, onClose }) {
    const t = useI18n();
    const stores = useStores();
    const resolved = (targetId ? stores.imageStore.resolve(targetId) : null) || stores.editor.img;
    const sourceSrc = resolved?.src || '';
    const initialWidth = Math.max(1, Math.round(Number(resolved?.width) || 1));
    const initialHeight = Math.max(1, Math.round(Number(resolved?.height) || 1));

    const stageRef = useRef(null);
    const imageRef = useRef(null);
    const interactionRef = useRef(null);
    const mountedRef = useRef(true);

    const [naturalSize, setNaturalSize] = useState({ width: initialWidth, height: initialHeight });
    const [stageSize, setStageSize] = useState(DEFAULT_STAGE_SIZE);
    const [aspectPreset, setAspectPreset] = useState('free');
    const [zoom, setZoom] = useState(CROP_MIN_ZOOM);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [cropRect, setCropRect] = useState(() => createInitialCropRect(initialWidth, initialHeight, null));
    const [imageReady, setImageReady] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            interactionRef.current = null;
        };
    }, []);

    useEffect(() => {
        const element = stageRef.current;
        if (!element) return undefined;
        const measure = () => {
            const width = Math.round(element.clientWidth);
            const height = Math.round(element.clientHeight);
            if (width > 0 && height > 0) {
                setStageSize((previous) => (
                    previous.width === width && previous.height === height
                        ? previous
                        : { width, height }
                ));
            }
        };
        measure();
        if (typeof ResizeObserver !== 'undefined') {
            const observerInstance = new ResizeObserver(measure);
            observerInstance.observe(element);
            return () => observerInstance.disconnect();
        }
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, []);

    const activeRatio = useMemo(
        () => resolveAspectRatio(aspectPreset, naturalSize.width, naturalSize.height),
        [aspectPreset, naturalSize.height, naturalSize.width],
    );

    const layout = useMemo(() => computeViewportLayout({
        naturalWidth: naturalSize.width,
        naturalHeight: naturalSize.height,
        stageWidth: stageSize.width,
        stageHeight: stageSize.height,
        zoom,
        panX: pan.x,
        panY: pan.y,
    }), [naturalSize.height, naturalSize.width, pan.x, pan.y, stageSize.height, stageSize.width, zoom]);

    const stageCrop = useMemo(
        () => naturalRectToStageRect(cropRect, layout),
        [cropRect, layout],
    );

    const outputPixels = useMemo(
        () => finalizeCropPixels(cropRect, naturalSize.width, naturalSize.height),
        [cropRect, naturalSize.height, naturalSize.width],
    );

    const handleImageLoad = useCallback((event) => {
        const element = event.currentTarget;
        const nw = Math.max(1, Math.round(element.naturalWidth || initialWidth));
        const nh = Math.max(1, Math.round(element.naturalHeight || initialHeight));
        setNaturalSize((previous) => (previous.width === nw && previous.height === nh ? previous : { width: nw, height: nh }));
        setCropRect((previous) => (
            previous.width === initialWidth && previous.height === initialHeight && previous.x === 0 && previous.y === 0
                ? createInitialCropRect(nw, nh, null)
                : clampCropRect(previous, nw, nh)
        ));
        setImageReady(true);
        setLoadFailed(false);
    }, [initialHeight, initialWidth]);

    const handleImageError = useCallback(() => {
        setImageReady(false);
        setLoadFailed(true);
    }, []);

    const handlePresetChange = useCallback((presetId) => {
        setAspectPreset(presetId);
        const ratio = resolveAspectRatio(presetId, naturalSize.width, naturalSize.height);
        if (ratio != null) {
            setCropRect((current) => fitCropToAspectRatio(current, ratio, naturalSize.width, naturalSize.height));
        }
    }, [naturalSize.height, naturalSize.width]);

    const handleZoomDelta = useCallback((delta) => {
        setZoom((current) => {
            const next = clampZoom(current + delta);
            if (next <= CROP_MIN_ZOOM) setPan({ x: 0, y: 0 });
            return next;
        });
    }, []);

    const handleReset = useCallback(() => {
        setAspectPreset('free');
        setZoom(CROP_MIN_ZOOM);
        setPan({ x: 0, y: 0 });
        setCropRect(createInitialCropRect(naturalSize.width, naturalSize.height, null));
    }, [naturalSize.height, naturalSize.width]);

    const beginInteraction = useCallback((event, type, handle = null) => {
        if (submitting || loadFailed) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (interactionRef.current !== null) return;
        event.preventDefault();
        event.stopPropagation();
        const captureTarget = stageRef.current || event.currentTarget;
        try {
            captureTarget.setPointerCapture?.(event.pointerId);
        } catch {
            // Pointer capture can throw on synthetic events in tests.
        }
        interactionRef.current = {
            pointerId: event.pointerId,
            captureTarget,
            type,
            handle,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startRect: cropRect,
            startPanX: layout.panX,
            startPanY: layout.panY,
            scale: layout.scale,
        };
    }, [cropRect, layout.panX, layout.panY, layout.scale, loadFailed, submitting]);

    const endInteraction = useCallback((event) => {
        const active = interactionRef.current;
        if (!active) return;
        if (event && event.pointerId != null && active.pointerId !== event.pointerId) return;
        try {
            if (active.captureTarget?.hasPointerCapture?.(active.pointerId)) {
                active.captureTarget.releasePointerCapture(active.pointerId);
            }
        } catch {
            // Ignore capture release errors on detached elements.
        }
        interactionRef.current = null;
    }, []);

    const handleStagePointerMove = useCallback((event) => {
        const active = interactionRef.current;
        if (!active || active.pointerId !== event.pointerId) return;
        const dxStage = event.clientX - active.startClientX;
        const dyStage = event.clientY - active.startClientY;
        if (active.type === 'pan') {
            setPan({
                x: active.startPanX + dxStage,
                y: active.startPanY + dyStage,
            });
            return;
        }
        const safeScale = active.scale > 0 ? active.scale : 1;
        setCropRect(applyCropInteraction({
            startRect: active.startRect,
            handle: active.handle,
            dxNatural: dxStage / safeScale,
            dyNatural: dyStage / safeScale,
            naturalWidth: naturalSize.width,
            naturalHeight: naturalSize.height,
            ratio: activeRatio,
        }));
    }, [activeRatio, naturalSize.height, naturalSize.width]);

    const handleSelectionKeyDown = useCallback((event) => {
        if (submitting || loadFailed) return;
        const step = event.shiftKey ? 10 : 1;
        let dx = 0;
        let dy = 0;
        if (event.key === 'ArrowLeft') dx = -step;
        else if (event.key === 'ArrowRight') dx = step;
        else if (event.key === 'ArrowUp') dy = -step;
        else if (event.key === 'ArrowDown') dy = step;
        else return;
        event.preventDefault();
        setCropRect((current) => nudgeCropRect(current, {
            dx,
            dy,
            naturalWidth: naturalSize.width,
            naturalHeight: naturalSize.height,
        }));
    }, [loadFailed, naturalSize.height, naturalSize.width, submitting]);

    const handleOk = useCallback(async () => {
        if (submitting || loadFailed || !imageRef.current) return;
        setSubmitting(true);
        try {
            const { blob } = await renderCroppedBlob(imageRef.current, cropRect);
            const applied = await stores.commands.cropActiveImage(blob, { targetId });
            if (applied && mountedRef.current) {
                onClose();
            }
        } catch {
            stores.editor.message?.error?.(t("裁剪失败，请重试"));
        } finally {
            if (mountedRef.current) setSubmitting(false);
        }
    }, [cropRect, loadFailed, onClose, stores.commands, stores.editor.message, submitting, t, targetId]);

    const presetLabel = (id) => {
        if (id === 'free') return t("自由");
        if (id === 'original') return t("原图");
        return id;
    };

    const maskTop = Math.max(0, stageCrop.y);
    const maskLeft = Math.max(0, stageCrop.x);
    const maskRight = Math.max(0, stageSize.width - (stageCrop.x + stageCrop.width));
    const maskBottom = Math.max(0, stageSize.height - (stageCrop.y + stageCrop.height));

    return (
        <Modal
            rootClassName="shoteasy-cropper-modal"
            zIndex={1100}
            width={620}
            transitionName={NO_CSS_TRANSITION_NAME}
            maskTransitionName={NO_CSS_TRANSITION_NAME}
            title={t("裁剪")}
            open
            onOk={handleOk}
            onCancel={onClose}
            okText={t("确定")}
            cancelText={t("取消")}
            confirmLoading={submitting}
            okButtonProps={{ disabled: loadFailed || !imageReady || !sourceSrc }}
            destroyOnHidden
        >
            <div className="shoteasy-cropper-shell">
                <div className="shoteasy-cropper-toolbar">
                    <div
                        className="shoteasy-cropper-presets"
                        role="group"
                        aria-label={t("裁剪比例")}
                    >
                        {CROP_ASPECT_PRESETS.map((preset) => (
                            <Button
                                key={preset.id}
                                size="small"
                                type={aspectPreset === preset.id ? 'primary' : 'default'}
                                aria-pressed={aspectPreset === preset.id}
                                data-crop-preset={preset.id}
                                onClick={() => handlePresetChange(preset.id)}
                            >
                                {presetLabel(preset.id)}
                            </Button>
                        ))}
                    </div>
                    <div className="shoteasy-cropper-controls">
                        <Button
                            size="small"
                            aria-label={t("缩小")}
                            disabled={zoom <= CROP_MIN_ZOOM}
                            onClick={() => handleZoomDelta(-CROP_ZOOM_STEP)}
                        >
                            −
                        </Button>
                        <span className="shoteasy-cropper-zoom-label" data-testid="cropper-zoom">
                            {Math.round(zoom * 100)}%
                        </span>
                        <Button
                            size="small"
                            aria-label={t("放大")}
                            disabled={zoom >= CROP_MAX_ZOOM}
                            onClick={() => handleZoomDelta(CROP_ZOOM_STEP)}
                        >
                            +
                        </Button>
                        <Button
                            size="small"
                            data-testid="cropper-reset"
                            onClick={handleReset}
                        >
                            {t("重置裁剪")}
                        </Button>
                    </div>
                </div>

                <div
                    ref={stageRef}
                    className={`shoteasy-cropper-stage${zoom > CROP_MIN_ZOOM ? ' is-pannable' : ''}`}
                    data-testid="cropper-stage"
                    onPointerDown={(event) => {
                        if (zoom > CROP_MIN_ZOOM) beginInteraction(event, 'pan', null);
                    }}
                    onPointerMove={handleStagePointerMove}
                    onPointerUp={endInteraction}
                    onPointerCancel={endInteraction}
                    onLostPointerCapture={endInteraction}
                >
                    {sourceSrc && !loadFailed ? (
                        <>
                            <img
                                ref={imageRef}
                                src={sourceSrc}
                                alt=""
                                draggable={false}
                                onLoad={handleImageLoad}
                                onError={handleImageError}
                                className="shoteasy-cropper-image"
                                style={{
                                    left: `${layout.imageRect.x}px`,
                                    top: `${layout.imageRect.y}px`,
                                    width: `${layout.imageRect.width}px`,
                                    height: `${layout.imageRect.height}px`,
                                }}
                            />
                            <div className="shoteasy-cropper-mask shoteasy-cropper-mask--top" style={{ height: `${maskTop}px` }} />
                            <div
                                className="shoteasy-cropper-mask shoteasy-cropper-mask--left"
                                style={{ top: `${maskTop}px`, width: `${maskLeft}px`, height: `${stageCrop.height}px` }}
                            />
                            <div
                                className="shoteasy-cropper-mask shoteasy-cropper-mask--right"
                                style={{ top: `${maskTop}px`, width: `${maskRight}px`, height: `${stageCrop.height}px` }}
                            />
                            <div className="shoteasy-cropper-mask shoteasy-cropper-mask--bottom" style={{ height: `${maskBottom}px` }} />

                            <div
                                role="group"
                                tabIndex={0}
                                aria-label={t("裁剪选区，使用方向键微调位置")}
                                className="shoteasy-cropper-selection"
                                data-testid="cropper-selection"
                                style={{
                                    left: `${stageCrop.x}px`,
                                    top: `${stageCrop.y}px`,
                                    width: `${stageCrop.width}px`,
                                    height: `${stageCrop.height}px`,
                                }}
                                onPointerDown={(event) => beginInteraction(event, 'crop', 'move')}
                                onKeyDown={handleSelectionKeyDown}
                            >
                                <span className="shoteasy-cropper-grid shoteasy-cropper-grid--v1" aria-hidden="true" />
                                <span className="shoteasy-cropper-grid shoteasy-cropper-grid--v2" aria-hidden="true" />
                                <span className="shoteasy-cropper-grid shoteasy-cropper-grid--h1" aria-hidden="true" />
                                <span className="shoteasy-cropper-grid shoteasy-cropper-grid--h2" aria-hidden="true" />
                                {CROP_HANDLES.map((handle) => (
                                    <span
                                        key={handle}
                                        data-crop-handle={handle}
                                        aria-hidden="true"
                                        className={`shoteasy-cropper-handle shoteasy-cropper-handle--${handle}`}
                                        onPointerDown={(event) => beginInteraction(event, 'crop', handle)}
                                    />
                                ))}
                            </div>
                        </>
                    ) : (
                        <div className="shoteasy-cropper-error" role="alert">
                            {t("图片加载失败，请选择有效图片")}
                        </div>
                    )}
                </div>

                <div className="shoteasy-cropper-meta">
                    <span data-testid="cropper-dimensions">
                        {outputPixels.width} × {outputPixels.height} px
                    </span>
                </div>
            </div>
        </Modal>
    );
});
