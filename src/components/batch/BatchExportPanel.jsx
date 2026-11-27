import useI18n from '../../i18n/useI18n';
import { useEffect, useId, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Drawer, Empty, Select, Tag } from 'antd';
import Icon from '@components/Icon';
import useStores from '@stores/useStores';
import { MAX_BATCH_FILES } from '@utils/batchContract';
import { supportImg } from '@utils/utils';
import { formatExportBytes } from '@utils/exportPreview';
import { WEB_AVIF_LIMIT_MESSAGE } from '@utils/exportSettings';

const STATUS_LABELS = {
    queued: '等待中',
    preparing: '校验图片',
    rendering: '渲染中',
    encoding: '编码中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
};

const STATUS_COLORS = {
    preparing: 'processing',
    rendering: 'processing',
    encoding: 'processing',
    completed: 'success',
    failed: 'error',
    cancelled: 'default',
};

const errorMessage = (code) => {
    if (!code) return '';
    if (code === 'desktop-file-exists') return '补全扩展名后的文件已存在，未覆盖原文件；请重新下载并选择其他文件名或明确选择要覆盖的文件';
    if (code === 'batch-output-budget-exceeded') return '累计输出达到 96 MiB 安全上限';
    if (code === 'batch-budget-stopped') return '因累计输出上限停止';
    if (code === 'batch-background-unavailable') return '背景资源不可用，请修复后重新开始批次。';
    if (code === 'batch-preset-invalid' || code === 'batch-style-invalid') return '风格预设不可用，请重新选择并开始批次。';
    if (code === 'batch-style-timeout') return '读取批量风格超时，请重新开始批次。';
    if (code === 'export-web-avif-compression-size-too-large') return WEB_AVIF_LIMIT_MESSAGE;
    if (code === 'export-compression-size-too-large') return '压缩下载最多支持约 419 万像素，最长边为 8192 像素。请降低倍率或画布尺寸，或改用 PNG/JPG/WebP 标准导出。';
    if (code === 'export-size-too-large') return '导出像素超过安全上限';
    if (code === 'export-avif-size-too-large') return 'AVIF 最多导出约 420 万像素';
    if (code.startsWith('export-avif')) return 'AVIF 编码失败，请改用 PNG 或 WebP';
    if (/type-unsupported/.test(code)) return '图片格式不支持';
    if (/decode|dimensions|invalid/.test(code)) return '图片无效或无法解码';
    if (code === 'batch-cancelled') return '任务已取消';
    return '处理失败';
};

export default observer(function BatchExportPanel({ open, onClose }) {
    const t = useI18n();
    const styleSelectId = useId();
    const stores = useStores();
    const batch = stores.batch;
    const input = useRef(null);
    const formatBytes = value => Number.isFinite(value) ? formatExportBytes(value, stores.i18n.locale) : '';

    useEffect(() => {
        if (open) void stores.workspace.refreshLibrary();
    }, [open, stores.workspace]);

    if (!stores.workspace.enabled || !batch) return null;

    const chooseFiles = (event) => {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        if (!files.length) return;
        try {
            batch.selectFiles(files);
        } catch {
            stores.editor.message?.error?.(t("一次最多选择 {0} 张图片", { 0: MAX_BATCH_FILES }));
        }
    };

    const start = async () => {
        const ok = await batch.start();
        if (!ok) {
            if (batch.state !== 'cancelled') stores.editor.message?.error?.(t("批量处理无法启动或意外中止"));
            return;
        }
        if (batch.state === 'cancelled') return;
        if (batch.summary?.successCount > 0) {
            stores.editor.message?.[batch.summary.failedCount > 0 || batch.summary.cancelledCount > 0 ? 'warning' : 'success']?.(
                t("批量处理完成：{0} 张成功", { 0: batch.summary.successCount })
            );
        } else {
            stores.editor.message?.warning?.(t("没有可下载的成功结果"));
        }
    };

    const retry = async () => {
        const ok = await batch.retryFailed();
        if (ok && batch.state !== 'cancelled') {
            stores.editor.message?.[batch.summary?.successCount ? 'success' : 'warning']?.(
                batch.summary?.successCount ? t("重试任务已完成") : t("重试后仍没有成功结果")
            );
        }
    };

    const download = async () => {
        const ok = await batch.download();
        if (ok) stores.editor.message?.success?.(t("ZIP 下载已开始"));
        else if (batch.errorCode) stores.editor.message?.error?.(batch.errorCode === 'desktop-file-exists' ? t(errorMessage(batch.errorCode)) : t("ZIP 下载失败"));
    };

    const presetOptions = [
        { value: '', label: t("当前风格 · {0}x {1}", { 0: stores.workspace.exportSettings.ratio, 1: stores.workspace.exportSettings.format.toUpperCase() }) },
        ...stores.workspace.presets.map((preset) => ({ value: preset.id, label: preset.name })),
    ];
    const completed = batch.jobs.filter((job) => job.status === 'completed').length;
    const terminal = batch.jobs.filter((job) => ['completed', 'failed', 'cancelled'].includes(job.status)).length;
    const frozenSettings = batch.snapshotSettings;

    return (
        <>
            <input
                ref={input}
                data-testid="batch-file-input"
                hidden
                type="file"
                multiple
                accept={supportImg.join(',')}
                onChange={chooseFiles}
            />
            <Drawer
                title={t("批量处理")}
                placement="right"
                size={520}
                open={open}
                onClose={() => { if (!batch.isHandingOff) onClose(); }}
                keyboard={!batch.isHandingOff}
                closable={{ disabled: batch.isHandingOff }}
                mask={{ closable: !batch.isHandingOff }}
                className="shoteasy-batch-drawer"
                rootClassName={`shoteasy-components shoteasy-overlay-drawer${stores.editor.isDark ? ' dark-mode' : ''}`}
                styles={{ body: { padding: 0 } }}
                extra={<Tag>{batch.jobs.length}/{MAX_BATCH_FILES}</Tag>}
            >
                <div className="shoteasy-batch">
                    <section className="shoteasy-batch-section">
                        <div className="shoteasy-batch-heading">
                            <div>
                                <strong>{t("输入图片")}</strong>
                                <small>{t("JPEG、PNG、BMP、GIF、WebP · 文件只在本机处理")}</small>
                            </div>
                            <Button disabled={batch.isBusy} onClick={() => input.current?.click()}>{t('选择 1～{0} 张', { 0: MAX_BATCH_FILES })}</Button>
                        </div>
                        <label className="shoteasy-batch-label" htmlFor={styleSelectId}>{t("风格来源")}</label>
                        <Select
                            id={styleSelectId}
                            aria-label={t("批量风格来源")}
                            value={batch.presetId || ''}
                            options={presetOptions}
                            disabled={batch.isBusy}
                            onChange={(value) => batch.setPreset(value)}
                        />
                        <p className="shoteasy-batch-note">{t("开始时会冻结所选风格；批处理不会替换当前图片、历史或草稿。")}</p>
                        {frozenSettings ? <p className="shoteasy-batch-note" data-testid="batch-frozen-settings">
                            {t('本批次固定设置')} · {frozenSettings.format.toUpperCase()} {frozenSettings.ratio}x · {frozenSettings.compression === 'lossless'
                                ? t('无损优化') : frozenSettings.compression === 'lossy' ? frozenSettings.format === 'png'
                                    ? t('最多 {0} 色', { 0: frozenSettings.paletteColors }) : `${t('质量')} ${frozenSettings.quality}` : t('标准导出')}
                        </p> : null}
                        {batch.hasSettingsWarning ? <p className="shoteasy-batch-note">{t('无法识别的压缩设置已恢复为标准导出；图片和图层未改变。')}</p> : null}
                    </section>

                    <section className="shoteasy-batch-section is-jobs" aria-live="polite" aria-atomic="false">
                        <div className="shoteasy-batch-heading">
                            <div>
                                <strong>{t("任务")}</strong>
                                <small>{batch.jobs.length ? t("{0}/{1} 已结束 · {2} 成功", { 0: terminal, 1: batch.jobs.length, 2: completed }) : t("尚未选择图片")}</small>
                            </div>
                        </div>
                        {batch.jobs.length === 0 ? (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("选择图片后会按顺序逐张处理")} />
                        ) : (
                            <ol className="shoteasy-batch-jobs" aria-label={t("批量任务列表")}>
                                {batch.jobs.map((job) => (
                                    <li key={job.id}>
                                        <div>
                                            <strong title={job.name}>{job.name}</strong>
                                            <small>
                                                {job.filename || t(errorMessage(job.errorCode)) || formatBytes(job.inputBytes)}
                                                {job.status === 'completed' && Number.isFinite(job.bytes) ? ` · ${formatBytes(job.bytes)}` : ''}
                                                {job.releaseErrorCode ? t(" · 资源清理异常") : ''}
                                            </small>
                                        </div>
                                        <Tag color={STATUS_COLORS[job.status]}>{t(STATUS_LABELS[job.status] || job.status)}</Tag>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </section>

                    {batch.summary && (
                        <section className="shoteasy-batch-summary" role="status">
                            <strong>{t('{0} 张成功', { 0: batch.summary.successCount })}</strong>
                            <span>{t('{0} 失败 · {1} 取消', { 0: batch.summary.failedCount, 1: batch.summary.cancelledCount })}</span>
                            <span>{t('图片输出合计')} {formatBytes(batch.summary.outputBytes)}</span>
                            {batch.archive && <span>ZIP {formatBytes(batch.summary.archiveBytes)}</span>}
                        </section>
                    )}
                    {batch.errorCode && <p className="shoteasy-batch-error" role="alert">{t(errorMessage(batch.errorCode))}</p>}
                    {batch.canRetry ? <section className="shoteasy-batch-section"><p className="shoteasy-batch-note" data-testid="batch-retry-notice">{t('重试沿用本批次固定风格，只生成本次成功项的新 ZIP。请先下载需要保留的旧 ZIP；要使用新设置，请重新开始批次。')}</p></section> : null}

                    <div className="shoteasy-batch-actions">
                        {!batch.isRunning ? (
                            <Button
                                type="primary"
                                disabled={batch.isBusy || batch.jobs.length === 0}
                                onClick={start}
                            >{t("开始批量处理")}</Button>
                        ) : (
                            <>
                                <Button onClick={() => batch.cancelCurrent()}>{t("取消当前")}</Button>
                                <Button danger onClick={() => batch.cancelAll()}>{t("取消全部")}</Button>
                            </>
                        )}
                        <Button disabled={!batch.archive || batch.isBusy} loading={batch.isHandingOff} icon={<Icon.Download size={16} />} onClick={download}>{batch.isHandingOff ? t('正在保存…') : t("下载 ZIP")}</Button>
                        <Button disabled={!batch.canRetry} onClick={retry}>{t("重试失败项")}</Button>
                        <Button aria-label={t('清空')} disabled={batch.isBusy || batch.jobs.length === 0} onClick={() => batch.clear()}>{t("清空")}</Button>
                    </div>
                </div>
            </Drawer>
        </>
    );
});
