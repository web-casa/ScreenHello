import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Icon from '@components/Icon';
import { Button, Tooltip, Popover, Segmented, ConfigProvider, Popconfirm, Upload } from 'antd';
import useStores from '@stores/useStores';
import { isExportCancelled } from '@stores/exportService';
import { supportImg, nanoid, modKey } from '@utils/utils';
import useKeyboardShortcuts from '@hooks/useKeyboardShortcuts';
import useSetImg from '@hooks/useSetImg';

const BatchExportPanel = lazy(() => import('@components/batch/BatchExportPanel'));

export default observer(function DownloadBar() {
    const stores = useStores();
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [batchOpen, setBatchOpen] = useState(false);
    const mounted = useRef(true);
    const operation = useRef(null);
    const { format, ratio } = stores.workspace.exportSettings;
    const hasImage = Boolean(stores.editor.img?.src);
    const getFile = useSetImg(stores);
    const failureMessage = (error, action, effectiveFormat = format) => {
        if (error?.code === 'export-avif-size-too-large') return 'AVIF 最多导出约 420 万像素，请降低倍率或画布尺寸';
        if (effectiveFormat === 'avif') return `AVIF ${action}失败，请改用 PNG 或 WebP`;
        if (error?.code === 'export-size-too-large') return `${action}尺寸过大，请降低像素倍率或画布尺寸`;
        return `${action}失败`;
    };

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            operation.current?.abort();
            operation.current = null;
        };
    }, []);

    const replaceImage = async (file) => {
        try {
            await getFile(file, 'blob', { replace: true });
        } catch {
            stores.editor.message?.error?.('图片加载失败，请选择有效图片');
        }
        return Upload.LIST_IGNORE;
    };

    const toDownload = async () => {
        if (!stores.editor.ensureEditing() || operation.current) return;
        const controller = new AbortController();
        operation.current = controller;
        const key = nanoid();
        setLoading(true);
        stores.editor.message.open({ key, type: 'loading', content: '正在下载…' });
        try {
            await stores.exportService.downloadImage({ format, ratio, signal: controller.signal });
            if (mounted.current && !controller.signal.aborted) {
                stores.editor.message.open({ key, type: 'success', content: '下载成功' });
            }
        } catch (error) {
            if (mounted.current && !isExportCancelled(error)) {
                stores.editor.message?.open?.({
                    key,
                    type: 'error',
                    content: failureMessage(error, '导出'),
                });
            }
        } finally {
            if (operation.current === controller) operation.current = null;
            if (mounted.current) setLoading(false);
        }
    };

    const toCopy = async () => {
        if (!stores.editor.ensureEditing() || operation.current) return;
        const controller = new AbortController();
        operation.current = controller;
        const key = nanoid();
        setLoading(true);
        stores.editor.message.open({ key, type: 'loading', content: '正在复制…' });
        try {
            await stores.exportService.copyImage({ ratio, signal: controller.signal });
            if (mounted.current && !controller.signal.aborted) {
                stores.editor.message.open({ key, type: 'success', content: '复制成功' });
            }
        } catch (error) {
            if (mounted.current && !isExportCancelled(error)) {
                stores.editor.message?.open?.({
                    key,
                    type: 'error',
                    content: failureMessage(error, '复制', 'png'),
                });
            }
        } finally {
            if (operation.current === controller) operation.current = null;
            if (mounted.current) setLoading(false);
        }
    };

    const confirm = () => {
        stores.editor.destroy();
        stores.editor.clearImg();
        stores.workspace.resetProject();
        stores.editor.clearFun && stores.editor.clearFun();
    };

    useKeyboardShortcuts(() => toDownload(), () => toCopy(), stores);

    const content = (
        <div className="shoteasy-export-popover">
            <div className="p-3 [&_.ant-segmented]:w-full [&_.ant-segmented-item]:flex-1">
                <div className="text-xs font-medium text-[var(--se-muted)] mb-2">格式</div>
                <Segmented
                    options={['png', 'jpg', 'webp', 'avif']}
                    size="middle"
                    value={format}
                    onChange={(value) => stores.workspace.setExportSettings({ format: value })}
                />
                <div className="text-xs font-medium text-[var(--se-muted)] mt-4 mb-2">像素倍率</div>
                <Segmented
                    options={[{ value: 1, label: '1x' }, { value: 2, label: '2x' }, { value: 3, label: '3x' }]}
                    size="middle"
                    value={ratio}
                    onChange={(value) => stores.workspace.setExportSettings({ ratio: value })}
                />
                {stores.option.frameConf.width && (
                    <div className="text-xs p-3 mt-4 flex justify-between bg-[var(--se-panel-muted)] rounded-lg">
                        <span className="text-[var(--se-muted)]">导出尺寸</span>
                        <span className="font-medium text-[var(--se-ink)]" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                            {stores.option.frameConf.width * ratio} × {stores.option.frameConf.height * ratio}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="shoteasy-top-actions">
            <ConfigProvider
                theme={{
                    components: {
                        Button: {
                            colorPrimary: stores.editor.isDark ? '#0066ff' : '#2563eb',
                            algorithm: true,
                        },
                    },
                }}
            >
                {stores.workspace.enabled && (
                    <Tooltip placement="bottom" arrow={false} title="批量套用同一风格并导出 ZIP">
                        <Button
                            type="text"
                            className="shoteasy-batch-trigger"
                            icon={<Icon.ImageDown size={16} />}
                            onClick={() => setBatchOpen(true)}
                            aria-label="打开批量处理"
                        >批量</Button>
                    </Tooltip>
                )}
                {batchOpen && (
                    <Suspense fallback={null}>
                        <BatchExportPanel open onClose={() => setBatchOpen(false)} />
                    </Suspense>
                )}
                <Upload
                    accept={supportImg.join(',')}
                    showUploadList={false}
                    beforeUpload={replaceImage}
                    disabled={!hasImage || loading}
                >
                    <Tooltip placement="bottom" arrow={false} title="更换图片">
                        <Button
                            type="default"
                            size="middle"
                            className="shoteasy-top-action"
                            disabled={!hasImage || loading}
                            icon={<Icon.ImagePlus size={17} />}
                            aria-label="更换图片"
                        />
                    </Tooltip>
                </Upload>
                <Tooltip placement="bottom" arrow={false} title={`下载 ${modKey} + S · ${ratio}x ${format.toUpperCase()}`}>
                    <Button
                        type="primary"
                        size="middle"
                        className="shoteasy-top-action shoteasy-top-action--primary"
                        loading={loading}
                        disabled={!hasImage}
                        icon={<Icon.Download size={17} />}
                        aria-label="下载图片"
                        onClick={toDownload}
                    />
                </Tooltip>
                <Tooltip placement="bottom" arrow={false} title={`复制 ${modKey} + C`}>
                    <Button
                        type="default"
                        size="middle"
                        className="shoteasy-top-action"
                        icon={<Icon.Copy size={17} />}
                        loading={loading}
                        disabled={!hasImage}
                        aria-label="复制图片"
                        onClick={toCopy}
                    />
                </Tooltip>
                <Popover
                    content={content}
                    trigger="click"
                    arrow={false}
                    placement="bottomRight"
                    open={open}
                    styles={{ root: { width: '320px' } }}
                    onOpenChange={setOpen}
                >
                    <Tooltip placement="bottom" arrow={false} title="导出格式与倍率">
                        <Button
                            size="middle"
                            className="shoteasy-top-action shoteasy-top-action--export"
                            disabled={!hasImage}
                            aria-label={`导出格式与倍率（当前 ${ratio}x ${format.toUpperCase()}）`}
                        >
                            {ratio}x · {format.toUpperCase()}
                        </Button>
                    </Tooltip>
                </Popover>
                {hasImage && (
                    <Popconfirm
                        title="删除截图"
                        description="确定要删除当前截图吗？"
                        placement="bottomRight"
                        onConfirm={confirm}
                        okText="确定"
                        cancelText="取消"
                    >
                        <Button
                            size="middle"
                            danger
                            className="shoteasy-top-action"
                            icon={<Icon.Trash2 size={17} />}
                            aria-label="删除截图"
                        />
                    </Popconfirm>
                )}
            </ConfigProvider>
        </div>
    );
});
