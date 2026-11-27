import useI18n from '../../i18n/useI18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Modal, Segmented } from 'antd';
import { NO_CSS_TRANSITION_NAME } from '@components/overlayMotion';
import useStores from '@stores/useStores';
import {
    ANIMATION_PRESETS,
    MOTION_DURATIONS,
    MOTION_FPS_OPTIONS,
    computeMotionFramePlan,
} from '@utils/animationPresets';
import {
    captureLayeredMotionSnapshot,
    composeMotionFrame,
    disposeMotionSnapshot,
} from '@utils/animationFrameRenderer';
import {
    encodeGifInWorker,
    encodeWebmFromCanvas,
    probeWebmMimeType,
} from '@utils/gifEncoder';

const prefersReducedMotion = () => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

export default observer(function MotionExportDialog({ onClose }) {
    const t = useI18n();
    const stores = useStores();

    const [presetId, setPresetId] = useState('float');
    const [format, setFormat] = useState('gif');
    const [durationSec, setDurationSec] = useState(3);
    const [fps, setFps] = useState(24);
    const [playing, setPlaying] = useState(() => !prefersReducedMotion());
    const [progressPos, setProgressPos] = useState(0.25);
    const [snapshotReady, setSnapshotReady] = useState(false);
    const [snapshotDims, setSnapshotDims] = useState(null);
    const [captureError, setCaptureError] = useState(null);
    const [exporting, setExporting] = useState(false);
    const [exportPercent, setExportPercent] = useState(0);

    const previewCanvasRef = useRef(null);
    const snapshotRef = useRef(null);
    const rafRef = useRef(0);
    const progressRef = useRef(0.25);
    const lastTickRef = useRef(0);
    const exportCancelRef = useRef(null);
    const mountedRef = useRef(true);
    const tRef = useRef(t);
    tRef.current = t;

    const webmMime = useMemo(() => probeWebmMimeType(), []);
    const framePlan = useMemo(
        () => computeMotionFramePlan({ durationSec, fps }),
        [durationSec, fps],
    );

    const paintAt = useCallback((nextProgress) => {
        const canvas = previewCanvasRef.current;
        const snapshot = snapshotRef.current;
        if (!canvas || !snapshot) return;
        if (canvas.width !== snapshot.width || canvas.height !== snapshot.height) {
            canvas.width = snapshot.width;
            canvas.height = snapshot.height;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        composeMotionFrame(ctx, snapshot, {
            presetId,
            progress: nextProgress,
            opaqueFallback: format === 'gif',
        });
    }, [format, presetId]);

    useEffect(() => {
        mountedRef.current = true;
        const controller = new AbortController();
        setSnapshotReady(false);
        setCaptureError(null);

        const runCaptureWithRetry = async (attemptsLeft = 2) => {
            try {
                const snapshot = await captureLayeredMotionSnapshot(stores, { signal: controller.signal });
                if (!mountedRef.current || controller.signal.aborted) {
                    disposeMotionSnapshot(snapshot);
                    return;
                }
                snapshotRef.current = snapshot;
                setSnapshotDims({ width: snapshot.width, height: snapshot.height });
                setSnapshotReady(true);
            } catch (error) {
                if (!mountedRef.current || controller.signal.aborted || error?.code === 'export-cancelled') return;
                if (error?.code === 'export-stale' && attemptsLeft > 0) {
                    await runCaptureWithRetry(attemptsLeft - 1);
                    return;
                }
                setCaptureError(tRef.current("无法准备动图画面，请重试"));
            }
        };
        void runCaptureWithRetry();

        const canvasNode = previewCanvasRef.current;
        return () => {
            mountedRef.current = false;
            controller.abort();
            exportCancelRef.current?.();
            exportCancelRef.current = null;
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            disposeMotionSnapshot(snapshotRef.current);
            snapshotRef.current = null;
            if (canvasNode) {
                canvasNode.width = 0;
                canvasNode.height = 0;
            }
        };
    }, [stores]);

    useEffect(() => {
        if (!snapshotReady) return undefined;
        paintAt(progressRef.current);
        if (!playing || exporting) return undefined;

        lastTickRef.current = performance.now();
        const step = (now) => {
            if (!mountedRef.current) return;
            const dt = Math.max(0, Math.min(100, now - lastTickRef.current));
            lastTickRef.current = now;
            const next = (progressRef.current + dt / (durationSec * 1000)) % 1;
            progressRef.current = next;
            paintAt(next);
            rafRef.current = requestAnimationFrame(step);
        };
        rafRef.current = requestAnimationFrame(step);
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = 0;
        };
    }, [durationSec, exporting, paintAt, playing, snapshotReady]);

    const handleStep = () => {
        setPlaying(false);
        const next = (progressRef.current + 1 / Math.max(8, framePlan.totalFrames)) % 1;
        progressRef.current = next;
        setProgressPos(next);
        paintAt(next);
    };

    const handleCancelExport = () => {
        exportCancelRef.current?.();
    };

    const handleExport = async () => {
        const snapshot = snapshotRef.current;
        if (!snapshot || exporting || stores.exportService.isBusy) return;
        setExporting(true);
        setExportPercent(0);

        const offscreen = document.createElement('canvas');
        offscreen.width = snapshot.width;
        offscreen.height = snapshot.height;
        const offCtx = offscreen.getContext('2d', { willReadFrequently: true });

        const task = stores.exportService.exportMotion(async ({ signal, assertCurrent, handoff }) => {
            if (!offCtx) throw Object.assign(new Error('motion-context-unavailable'), { code: 'motion-context-unavailable' });

            let blob;
            if (format === 'webm' && webmMime) {
                blob = await encodeWebmFromCanvas({
                    width: snapshot.width,
                    height: snapshot.height,
                    fps: framePlan.effectiveFps,
                    totalFrames: framePlan.totalFrames,
                    durationMs: framePlan.durationSec * 1000,
                    signal,
                    drawFrame: (ctx, index) => {
                        composeMotionFrame(ctx, snapshot, {
                            presetId,
                            progress: index / framePlan.totalFrames,
                            opaqueFallback: false,
                        });
                    },
                    onProgress: (ratio) => {
                        if (mountedRef.current) setExportPercent(Math.min(99, Math.round(ratio * 100)));
                    },
                });
            } else {
                blob = await encodeGifInWorker({
                    width: snapshot.width,
                    height: snapshot.height,
                    totalFrames: framePlan.totalFrames,
                    delayMs: framePlan.frameDelayMs,
                    frameDelaysMs: framePlan.frameDelaysMs,
                    signal,
                    renderFrameRgba: (index) => {
                        composeMotionFrame(offCtx, snapshot, {
                            presetId,
                            progress: index / framePlan.totalFrames,
                            opaqueFallback: true,
                        });
                        return offCtx.getImageData(0, 0, snapshot.width, snapshot.height).data;
                    },
                    onProgress: (ratio) => {
                        if (mountedRef.current) setExportPercent(Math.min(99, Math.round(ratio * 100)));
                    },
                });
            }

            assertCurrent();
            if (!mountedRef.current) return;
            setExportPercent(100);
            const ext = format === 'webm' && webmMime ? 'webm' : 'gif';
            const filename = `ScreenHello-${presetId}.${ext}`;
            await handoff(() => stores.platform.export.download(blob, filename));
        }, { requireActive: true });

        exportCancelRef.current = task.cancel;
        try {
            await task.promise;
            if (!mountedRef.current) return;
            stores.editor.message?.success?.(tRef.current("动图导出成功"));
            onClose?.();
        } catch (error) {
            if (error?.code === 'export-busy') {
                if (mountedRef.current) {
                    stores.editor.message?.info?.(tRef.current("正在处理其他本地任务"));
                }
            } else if (error?.code !== 'export-cancelled' && error?.code !== 'export-stale' && mountedRef.current) {
                stores.editor.message?.error?.(tRef.current("动图导出失败，请降低时长或帧率后重试"));
            }
        } finally {
            offscreen.width = 0;
            offscreen.height = 0;
            if (exportCancelRef.current === task.cancel) {
                exportCancelRef.current = null;
            }
            if (mountedRef.current) {
                setExporting(false);
            }
        }
    };

    const formatOptions = useMemo(() => ([
        { value: 'gif', label: 'GIF' },
        { value: 'webm', label: 'WebM', disabled: !webmMime },
    ]), [webmMime]);

    const durationOptions = useMemo(() => (
        MOTION_DURATIONS.map((sec) => ({ value: sec, label: `${sec}s` }))
    ), []);

    const fpsOptions = useMemo(() => (
        MOTION_FPS_OPTIONS.map((value) => ({ value, label: `${value} fps` }))
    ), []);

    return (
        <Modal
            rootClassName="shoteasy-motion-modal"
            zIndex={1100}
            width={920}
            transitionName={NO_CSS_TRANSITION_NAME}
            maskTransitionName={NO_CSS_TRANSITION_NAME}
            title={t("微动画与动图导出")}
            open
            onCancel={exporting ? undefined : onClose}
            closable={!exporting}
            maskClosable={!exporting}
            keyboard={!exporting}
            footer={(
                <div className="shoteasy-motion-footer">
                    {exporting ? (
                        <Button onClick={handleCancelExport} data-testid="motion-cancel-export">
                            {t("取消导出")}
                        </Button>
                    ) : (
                        <Button onClick={onClose} data-testid="motion-close">
                            {t("取消")}
                        </Button>
                    )}
                    <Button
                        type="primary"
                        loading={exporting}
                        disabled={!snapshotReady || exporting || stores.exportService.isBusy}
                        onClick={() => { void handleExport(); }}
                        data-testid="motion-export-confirm"
                    >
                        {exporting
                            ? t("正在本地编码 ({0}%)…", { 0: exportPercent })
                            : (format === 'webm' && webmMime ? t("导出 WebM") : t("导出 GIF"))}
                    </Button>
                </div>
            )}
            destroyOnHidden
        >
            <div className="shoteasy-motion-shell" data-mode={stores.editor.isDark ? 'dark' : 'light'}>
                <div className="shoteasy-motion-controls">
                    <div className="shoteasy-motion-section">
                        <span className="shoteasy-motion-label">{t("动画预设")}</span>
                        <div className="shoteasy-motion-preset-list" role="radiogroup" aria-label={t("动画预设")}>
                            {ANIMATION_PRESETS.map((preset) => {
                                const selected = preset.id === presetId;
                                return (
                                    <button
                                        key={preset.id}
                                        type="button"
                                        role="radio"
                                        aria-checked={selected}
                                        disabled={exporting}
                                        data-testid={`motion-preset-${preset.id}`}
                                        className={`shoteasy-motion-preset${selected ? ' is-selected' : ''}`}
                                        onClick={() => setPresetId(preset.id)}
                                    >
                                        <strong>{t(preset.label)}</strong>
                                        <small>{t(preset.description)}</small>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="shoteasy-motion-grid">
                        <div className="shoteasy-motion-field">
                            <span className="shoteasy-motion-label">{t("输出格式")}</span>
                            <Segmented
                                size="small"
                                block
                                value={format}
                                options={formatOptions}
                                disabled={exporting}
                                onChange={setFormat}
                                aria-label={t("输出格式")}
                            />
                        </div>
                        <div className="shoteasy-motion-field">
                            <span className="shoteasy-motion-label">{t("循环时长")}</span>
                            <Segmented
                                size="small"
                                block
                                value={durationSec}
                                options={durationOptions}
                                disabled={exporting}
                                onChange={setDurationSec}
                                aria-label={t("循环时长")}
                            />
                        </div>
                        <div className="shoteasy-motion-field shoteasy-motion-field--full">
                            <span className="shoteasy-motion-label">{t("帧率")}</span>
                            <Segmented
                                size="small"
                                block
                                value={fps}
                                options={fpsOptions}
                                disabled={exporting}
                                onChange={setFps}
                                aria-label={t("帧率")}
                            />
                        </div>
                    </div>

                    {!webmMime && (
                        <p className="shoteasy-motion-note" role="status">
                            {t("当前浏览器不支持本地 WebM 录制，已自动使用本地 GIF 编码。")}
                        </p>
                    )}

                    <div className="shoteasy-motion-summary">
                        <div>
                            <span>{t("最终尺寸")}</span>
                            <strong>{snapshotDims ? `${snapshotDims.width} × ${snapshotDims.height} px` : '…'}</strong>
                        </div>
                        <div>
                            <span>{t("总帧数")}</span>
                            <strong>{framePlan.totalFrames} ({framePlan.effectiveFps} fps)</strong>
                        </div>
                        <div>
                            <span>{t("处理位置")}</span>
                            <strong>{t("仅此设备")}</strong>
                        </div>
                    </div>

                    {exporting && (
                        <div className="shoteasy-motion-progress" role="status" aria-live="polite">
                            <progress
                                className="shoteasy-motion-progress-bar"
                                max={100}
                                value={exportPercent}
                                aria-label={t("正在本地编码 ({0}%)…", { 0: exportPercent })}
                            />
                            <span>{exportPercent}%</span>
                        </div>
                    )}
                </div>

                <div className="shoteasy-motion-preview-pane">
                    <div className="shoteasy-motion-preview-head">
                        <span className="shoteasy-motion-label">{t("实时动效预览")}</span>
                        <div className="shoteasy-motion-playback">
                            <Button
                                size="small"
                                autoInsertSpace={false}
                                disabled={!snapshotReady || exporting}
                                onClick={() => setPlaying((p) => !p)}
                                data-testid="motion-toggle-play"
                            >
                                {playing ? t("暂停") : t("播放")}
                            </Button>
                            <Button
                                size="small"
                                disabled={!snapshotReady || exporting}
                                onClick={handleStep}
                                data-testid="motion-step-frame"
                            >
                                {t("单帧步进")}
                            </Button>
                        </div>
                    </div>
                    <div className="shoteasy-motion-preview-stage" data-testid="motion-preview-stage">
                        <canvas
                            ref={previewCanvasRef}
                            className="shoteasy-motion-preview-canvas"
                            data-testid="motion-preview-canvas"
                            aria-label={t("微动画画布预览")}
                            hidden={!snapshotReady}
                        />
                        {!snapshotReady && (
                            <p className="shoteasy-motion-empty" role="status">
                                {captureError || t("正在准备画布分层预览…")}
                            </p>
                        )}
                    </div>
                    {!playing && snapshotReady && (
                        <div className="shoteasy-motion-scrubber">
                            <input
                                type="range"
                                min="0"
                                max="0.99"
                                step="0.01"
                                value={progressPos}
                                disabled={exporting}
                                aria-label={t("预览时间进度")}
                                onChange={(event) => {
                                    const val = Number(event.target.value);
                                    progressRef.current = val;
                                    setProgressPos(val);
                                    paintAt(val);
                                }}
                            />
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
});
