import useI18n from '../../i18n/useI18n';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button, Drawer, Segmented } from 'antd';
import { observer } from 'mobx-react-lite';
import Icon from '@components/Icon';
import useStores from '@stores/useStores';
import { EXPORT_FORMATS, EXPORT_RATIOS, normalizeExportSettings } from '@utils/stylePreset';
import { LOSSY_QUALITY_PRESETS, MAX_PREVIEW_PIXELS, PNG_PALETTE_COLORS, exportSettingsKey, validateExportSettings, WEB_AVIF_LIMIT_MESSAGE } from '@utils/exportSettings';
import { exportFailureMessage } from '@stores/commandService';
import useExportPreview from '@hooks/useExportPreview';
import ExportPreviewResult from './ExportPreviewResult';
import { canPreviewAvif } from '@utils/exportPreview';

const formatOptions = EXPORT_FORMATS.map((value) => ({ value, label: value.toUpperCase() }));
const ratioOptions = EXPORT_RATIOS.map((value) => ({ value, label: `${value}x` }));

export default observer(function ExportPanel() {
    const t = useI18n();
    const stores = useStores();
    const [open, setOpen] = useState(false);
    const openRef = useRef(false);
    const [draft, setDraft] = useState(() => normalizeExportSettings(stores.workspace.exportSettings));
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);
    const generation = useRef(0);
    const preview = useExportPreview(stores);
    const qualityId = useId();
    const downloadLimitId = useId();
    const previewSupportId = useId();
    const [avifPreviewState, setAvifPreviewState] = useState('checking');
    const returnFocusRef = useRef(null);
    const focusFrame = useRef(null);
    const busy = submitting || stores.exportService.isBusy;
    const handingOff = stores.exportService.isHandingOff;
    const ready = preview.prepared && stores.exportService.isPreparedCurrent(preview.prepared.token);

    useEffect(() => () => {
        openRef.current = false;
        generation.current += 1;
        if (submittingRef.current) stores.commands.cancelExport();
        cancelAnimationFrame(focusFrame.current);
    }, [stores]);

    const restoreReturnFocus = () => {
        const target = returnFocusRef.current;
        returnFocusRef.current = null;
        if (target?.isConnected) target.focus({ preventScroll: true });
    };

    useLayoutEffect(() => stores.commands.registerUiAction('file.openExport', (options = {}) => {
        if (submittingRef.current || stores.exportService.isBusy) return false;
        if (openRef.current) return true;
        openRef.current = true;
        generation.current += 1;
        cancelAnimationFrame(focusFrame.current);
        const HTMLElementConstructor = globalThis.HTMLElement;
        returnFocusRef.current = typeof HTMLElementConstructor === 'function'
            && options.returnFocus instanceof HTMLElementConstructor
            ? options.returnFocus
            : (typeof HTMLElementConstructor === 'function' && document.activeElement instanceof HTMLElementConstructor
                ? document.activeElement
                : null);
        setDraft(normalizeExportSettings(stores.workspace.exportSettings));
        setOpen(true);
        return true;
    }), [stores]);

    const close = () => {
        if (stores.exportService.isHandingOff) return;
        generation.current += 1;
        preview.clear();
        if (submittingRef.current) stores.commands.cancelExport();
        submittingRef.current = false;
        setSubmitting(false);
        openRef.current = false;
        setOpen(false);
        focusFrame.current = requestAnimationFrame(restoreReturnFocus);
    };

    const confirm = async () => {
        if (submittingRef.current || stores.exportService.isBusy) return;
        const currentGeneration = generation.current;
        submittingRef.current = true;
        setSubmitting(true);
        const exported = ready
            ? await stores.commands.downloadPreparedImage(preview.prepared.token, draft)
            : await stores.commands.execute('file.quickExport', { confirmedSettings: draft });
        if (generation.current !== currentGeneration) return;
        submittingRef.current = false;
        setSubmitting(false);
        if (exported) {
            preview.clear();
            openRef.current = false;
            setOpen(false);
            focusFrame.current = requestAnimationFrame(restoreReturnFocus);
        }
    };

    const updateDraft = settings => {
        if (submittingRef.current || stores.exportService.isBusy || exportSettingsKey(settings) === exportSettingsKey(draft)) return;
        preview.clear(preview.state === 'idle' ? 'idle' : 'stale');
        setDraft(validateExportSettings(settings));
    };

    const width = Number(stores.option.frameConf.width) || 0;
    const height = Number(stores.option.frameConf.height) || 0;
    const outputWidth = Math.ceil(width * draft.ratio);
    const outputHeight = Math.ceil(height * draft.ratio);
    const previewTooLarge = outputWidth * outputHeight > MAX_PREVIEW_PIXELS || Math.max(outputWidth, outputHeight) > 8192;
    const probeAvif = open && draft.format === 'avif' && !previewTooLarge;
    useEffect(() => {
        setAvifPreviewState('checking');
        if (!probeAvif) return;
        const controller = new AbortController();
        void canPreviewAvif({ signal: controller.signal }).then(supported => {
            if (!controller.signal.aborted) setAvifPreviewState(supported ? 'supported' : 'unavailable');
        }).catch(() => {
            if (!controller.signal.aborted) setAvifPreviewState('unavailable');
        });
        return () => controller.abort();
    }, [probeAvif]);
    const previewCapabilityBlocked = draft.format === 'avif' && avifPreviewState !== 'supported';
    const mode = draft.compression || 'standard';
    const compressedPixelLimit = stores.exportService.compressedPixelLimit(draft.format);
    const webAvifLimit = draft.format === 'avif' && compressedPixelLimit === MAX_PREVIEW_PIXELS;
    const downloadTooLarge = mode !== 'standard' && (outputWidth * outputHeight > compressedPixelLimit || Math.max(outputWidth, outputHeight) > 8192);
    const downloadLabel = ready ? t('下载此结果') : ['stale', 'failed'].includes(preview.state) ? t('按当前设置直接导出') : t('下载图片');

    if (!open) return null;

    return (
        <Drawer
            title={t("导出图片")}
            placement="right"
            size={460}
            open
            onClose={close}
            keyboard={!handingOff}
            focusable={{ trap: true, focusTriggerAfterClose: false }}
            closable={{ disabled: handingOff }}
            mask={{ closable: !handingOff }}
            className="shoteasy-export-drawer"
            rootClassName={`shoteasy-components shoteasy-overlay-drawer shoteasy-export-overlay${stores.editor.isDark ? ' dark-mode' : ''}`}
            styles={{ body: { padding: 20 } }}
            footer={(
                <>
                    {downloadTooLarge ? <p id={downloadLimitId} className="shoteasy-export-warning" role="status">{t(webAvifLimit ? WEB_AVIF_LIMIT_MESSAGE : '压缩下载最多支持约 419 万像素，最长边为 8192 像素。请降低倍率或画布尺寸，或改用 PNG/JPG/WebP 标准导出。')}</p> : null}
                    <div className="shoteasy-export-actions">
                        <Button data-testid="export-cancel" disabled={handingOff} onClick={close}>{busy ? t("取消导出") : t("取消")}</Button>
                        <Button
                            type="primary"
                            icon={<Icon.Download size={16} />}
                            loading={busy}
                            disabled={busy || downloadTooLarge}
                            onClick={() => { void confirm(); }}
                            aria-label={downloadLabel}
                            aria-describedby={downloadTooLarge ? downloadLimitId : undefined}
                            data-testid="export-download"
                        >
                            {handingOff ? t('正在保存…') : busy ? t("正在生成…") : downloadLabel}
                        </Button>
                    </div>
                </>
            )}
        >
            <div className="shoteasy-export-panel">
                <section>
                    <div className="shoteasy-export-panel__heading">
                        <strong>{t("文件格式")}</strong>
                        <span>{t("按用途选择清晰度、透明度和体积")}</span>
                    </div>
                    <Segmented
                        block
                        options={formatOptions}
                        value={draft.format}
                        disabled={busy}
                        onChange={(format) => updateDraft({ format, ratio: draft.ratio })}
                    />
                </section>
                <section>
                    <div className="shoteasy-export-panel__heading">
                        <strong>{t("像素倍率")}</strong>
                        <span>{t("高倍率会增加生成时间和文件体积")}</span>
                    </div>
                    <Segmented
                        block
                        options={ratioOptions}
                        value={draft.ratio}
                        disabled={busy}
                        onChange={(ratio) => updateDraft({ ...draft, ratio })}
                    />
                </section>
                <section className="shoteasy-compression-settings" aria-label={t('压缩设置')}>
                    <div className="shoteasy-export-panel__heading"><strong>{t('压缩方式')}</strong><span>{t('切换格式会重置为标准导出。')}</span></div>
                    <div className="shoteasy-compression-modes" role="group" aria-label={t('压缩方式')}>
                        {['standard', ...(['png', 'webp'].includes(draft.format) ? ['lossless'] : []), 'lossy'].map(value => (
                            <Button key={value} disabled={busy} aria-pressed={mode === value} data-testid={`compression-${value}`}
                                onClick={() => { if (mode !== value) updateDraft({ format: draft.format, ratio: draft.ratio, compression: value }); }}>
                                {value === 'standard' ? t('标准导出') : value === 'lossless' ? t('无损优化') : draft.format === 'png' ? t('有损减色') : t('有损压缩')}
                            </Button>
                        ))}
                    </div>
                    {mode === 'lossless' ? <p className="shoteasy-export-note">{t('不改变渲染后像素，不保证文件一定更小。')}</p> : null}
                    {mode === 'lossy' && draft.format === 'png' ? (
                        <>
                            <div className="shoteasy-compression-modes" role="group" aria-label={t('颜色数量上限')}>
                                {PNG_PALETTE_COLORS.map(colors => <Button key={colors} disabled={busy} aria-pressed={draft.paletteColors === colors}
                                    onClick={() => updateDraft({ ...draft, paletteColors: colors })} data-testid={`palette-${colors}`}>{t('最多 {0} 色', { 0: colors })}</Button>)}
                            </div>
                            <p className="shoteasy-export-note">{t('减少颜色，渐变和半透明阴影可能改变。')}</p>
                        </>
                    ) : mode === 'lossy' ? (
                        <>
                            <div className="shoteasy-compression-modes" role="group" aria-label={t('质量预设')}>
                                {LOSSY_QUALITY_PRESETS[draft.format].map((quality, index) => <Button key={quality} disabled={busy} aria-pressed={draft.quality === quality}
                                    aria-label={index === 0 ? t('高清') : index === 1 ? t('均衡') : t('更小')}
                                    onClick={() => updateDraft({ ...draft, quality })}>{index === 0 ? t('高清') : index === 1 ? t('均衡') : t('更小')}</Button>)}
                            </div>
                            <div className="shoteasy-export-quality">
                                <label htmlFor={qualityId}>{t('质量')} <output htmlFor={qualityId}>{draft.quality}</output></label>
                                <input id={qualityId} type="range" min="1" max="100" step="1" value={draft.quality} disabled={busy}
                                    onChange={event => updateDraft({ ...draft, quality: Number(event.target.value) })} />
                            </div>
                            <p className="shoteasy-export-note">{t('质量 100 仍为有损；不同格式的数字不可直接比较。')}</p>
                        </>
                    ) : null}
                </section>
                <section className="shoteasy-export-summary" aria-label={t("导出摘要")}>
                    <div><span>{t("格式")}</span><strong>{draft.format.toUpperCase()}</strong></div>
                    <div><span>{t("最终尺寸")}</span><strong>{outputWidth} × {outputHeight} px</strong></div>
                    <div><span>{t('透明处理')}</span><strong>{['jpg', 'webp'].includes(draft.format) ? t('透明区域填白') : mode === 'lossy' && draft.format === 'png' ? t('保留透明，半透明可能近似') : t('保留透明')}</strong></div>
                    <div><span>{t("处理位置")}</span><strong>{t("仅此设备")}</strong></div>
                </section>
                <section className="shoteasy-preview-control" aria-label={t('压缩预览')}>
                    <div className="shoteasy-export-panel__heading"><strong>{t('压缩预览')}</strong><span>{t('可选；调整参数后不会自动重新生成。')}</span></div>
                    <Button block disabled={busy || previewTooLarge || previewCapabilityBlocked} loading={preview.state === 'preparing'}
                        aria-describedby={probeAvif && previewCapabilityBlocked ? previewSupportId : undefined}
                        onClick={() => { if (!previewCapabilityBlocked) void preview.generate(draft); }} data-testid="export-preview">
                        {preview.state === 'idle' ? t('生成预览') : t('重新生成预览')}
                    </Button>
                    {probeAvif && previewCapabilityBlocked ? <p id={previewSupportId} className="shoteasy-export-warning" role="status" data-testid="avif-preview-support">
                        {avifPreviewState === 'checking'
                            ? t('正在检查 AVIF 预览能力；你仍可直接下载。')
                            : t('当前浏览器无法预览 AVIF，但仍可直接下载 AVIF 文件。需要预览时，请选择 PNG、JPG 或 WebP。')}
                    </p> : null}
                    {previewTooLarge ? <p className="shoteasy-export-warning" role="status">{t('完整预览最多支持约 105 万像素。预览不可用时，仍可在下载尺寸限制内直接导出。')}</p> : null}
                    {preview.state === 'stale' ? <p className="shoteasy-export-warning" role="status">{t('预览已失效。请重新生成，或按当前设置直接导出。')}</p> : null}
                    {preview.error ? <p className="shoteasy-export-warning" role="alert">{exportFailureMessage(preview.error, t('预览'), draft.format, t)}</p> : null}
                </section>
                {ready ? <ExportPreviewResult prepared={preview.prepared} disabled={busy} onFailure={preview.fail} /> : null}
                <p className="shoteasy-export-note" role="status" aria-live="polite">
                    {handingOff ? t('文件已交给系统保存，请等待完成；此时无法撤回写入。') : busy
                        ? t("正在本机生成文件。你可以取消；没有可靠进度数据时不会显示虚假百分比。")
                        : t('成功交给系统保存后才会记住本次设置；取消或失败不会改变快速导出设置。')}
                </p>
            </div>
        </Drawer>
    );
});
