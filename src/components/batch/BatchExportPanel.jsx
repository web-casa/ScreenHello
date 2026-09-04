import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Drawer, Empty, Select, Tag } from 'antd';
import Icon from '@components/Icon';
import useStores from '@stores/useStores';
import { MAX_BATCH_FILES } from '@utils/batchContract';
import { supportImg } from '@utils/utils';

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
    if (code === 'batch-output-budget-exceeded') return '累计输出达到 96 MiB 安全上限';
    if (code === 'batch-budget-stopped') return '因累计输出上限停止';
    if (code === 'export-size-too-large') return '导出像素超过安全上限';
    if (code === 'export-avif-size-too-large') return 'AVIF 最多导出约 420 万像素';
    if (code.startsWith('export-avif')) return 'AVIF 编码失败，请改用 PNG 或 WebP';
    if (/type-unsupported/.test(code)) return '图片格式不支持';
    if (/decode|dimensions|invalid/.test(code)) return '图片无效或无法解码';
    if (code === 'batch-cancelled') return '任务已取消';
    return '处理失败';
};

const formatBytes = (value) => {
    if (!Number.isFinite(value)) return '';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
};

export default observer(function BatchExportPanel({ open, onClose }) {
    const stores = useStores();
    const batch = stores.batch;
    const input = useRef(null);

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
            stores.editor.message?.error?.(`一次最多选择 ${MAX_BATCH_FILES} 张图片`);
        }
    };

    const start = async () => {
        const ok = await batch.start();
        if (!ok) {
            if (batch.state !== 'cancelled') stores.editor.message?.error?.('批量处理无法启动或意外中止');
            return;
        }
        if (batch.state === 'cancelled') return;
        if (batch.summary?.successCount > 0) {
            stores.editor.message?.[batch.summary.failedCount > 0 || batch.summary.cancelledCount > 0 ? 'warning' : 'success']?.(
                `批量处理完成：${batch.summary.successCount} 张成功`
            );
        } else {
            stores.editor.message?.warning?.('没有可下载的成功结果');
        }
    };

    const retry = async () => {
        const ok = await batch.retryFailed();
        if (ok && batch.state !== 'cancelled') {
            stores.editor.message?.[batch.summary?.successCount ? 'success' : 'warning']?.(
                batch.summary?.successCount ? '重试任务已完成' : '重试后仍没有成功结果'
            );
        }
    };

    const download = async () => {
        const ok = await batch.download();
        stores.editor.message?.[ok ? 'success' : 'error']?.(ok ? 'ZIP 下载已开始' : 'ZIP 下载失败');
    };

    const presetOptions = [
        { value: '', label: `当前风格 · ${stores.workspace.exportSettings.ratio}x ${stores.workspace.exportSettings.format.toUpperCase()}` },
        ...stores.workspace.presets.map((preset) => ({ value: preset.id, label: preset.name })),
    ];
    const completed = batch.jobs.filter((job) => job.status === 'completed').length;
    const terminal = batch.jobs.filter((job) => ['completed', 'failed', 'cancelled'].includes(job.status)).length;

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
                title="批量处理"
                placement="right"
                size={520}
                open={open}
                onClose={onClose}
                className="shoteasy-batch-drawer"
                rootClassName="shoteasy-overlay-drawer"
                styles={{ body: { padding: 0 } }}
                extra={<Tag>{batch.jobs.length}/{MAX_BATCH_FILES}</Tag>}
            >
                <div className="shoteasy-batch">
                    <section className="shoteasy-batch-section">
                        <div className="shoteasy-batch-heading">
                            <div>
                                <strong>输入图片</strong>
                                <small>JPEG、PNG、BMP、GIF、WebP · 文件只在本机处理</small>
                            </div>
                            <Button disabled={batch.isRunning} onClick={() => input.current?.click()}>
                                选择 1～{MAX_BATCH_FILES} 张
                            </Button>
                        </div>
                        <label className="shoteasy-batch-label" htmlFor="screenhello-batch-style">风格来源</label>
                        <Select
                            id="screenhello-batch-style"
                            aria-label="批量风格来源"
                            value={batch.presetId || ''}
                            options={presetOptions}
                            disabled={batch.isRunning}
                            onChange={(value) => batch.setPreset(value)}
                        />
                        <p className="shoteasy-batch-note">开始时会冻结所选风格；批处理不会替换当前图片、历史或草稿。</p>
                    </section>

                    <section className="shoteasy-batch-section is-jobs" aria-live="polite" aria-atomic="false">
                        <div className="shoteasy-batch-heading">
                            <div>
                                <strong>任务</strong>
                                <small>{batch.jobs.length ? `${terminal}/${batch.jobs.length} 已结束 · ${completed} 成功` : '尚未选择图片'}</small>
                            </div>
                        </div>
                        {batch.jobs.length === 0 ? (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择图片后会按顺序逐张处理" />
                        ) : (
                            <ol className="shoteasy-batch-jobs" aria-label="批量任务列表">
                                {batch.jobs.map((job) => (
                                    <li key={job.id}>
                                        <div>
                                            <strong title={job.name}>{job.name}</strong>
                                            <small>
                                                {job.filename || errorMessage(job.errorCode) || formatBytes(job.inputBytes)}
                                                {job.releaseErrorCode ? ' · 资源清理异常' : ''}
                                            </small>
                                        </div>
                                        <Tag color={STATUS_COLORS[job.status]}>{STATUS_LABELS[job.status] || job.status}</Tag>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </section>

                    {batch.summary && (
                        <section className="shoteasy-batch-summary" role="status">
                            <strong>{batch.summary.successCount} 张成功</strong>
                            <span>{batch.summary.failedCount} 失败 · {batch.summary.cancelledCount} 取消</span>
                            {batch.archive && <span>ZIP {formatBytes(batch.summary.archiveBytes)}</span>}
                        </section>
                    )}
                    {batch.errorCode && <p className="shoteasy-batch-error" role="alert">{errorMessage(batch.errorCode)}</p>}

                    <div className="shoteasy-batch-actions">
                        {!batch.isRunning ? (
                            <Button
                                type="primary"
                                disabled={batch.jobs.length === 0}
                                onClick={start}
                            >开始批量处理</Button>
                        ) : (
                            <>
                                <Button onClick={() => batch.cancelCurrent()}>取消当前</Button>
                                <Button danger onClick={() => batch.cancelAll()}>取消全部</Button>
                            </>
                        )}
                        <Button disabled={!batch.archive || batch.isRunning} icon={<Icon.Download size={16} />} onClick={download}>下载 ZIP</Button>
                        <Button disabled={!batch.canRetry} onClick={retry}>重试失败项</Button>
                        <Button disabled={batch.isRunning || batch.jobs.length === 0} onClick={() => batch.clear()}>清空</Button>
                    </div>
                </div>
            </Drawer>
        </>
    );
});
