import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Icon from '@components/Icon';
import { Button, Tooltip, Popover, Segmented, ConfigProvider, Popconfirm } from 'antd';
import useStores from '@stores/useStores';
import { supportImg, modKey } from '@utils/utils';
import ExportPanel from './ExportPanel';

const BatchExportPanel = lazy(() => import('@components/batch/BatchExportPanel'));

export default observer(function DownloadBar() {
    const stores = useStores();
    const [libraryOptionsOpen, setLibraryOptionsOpen] = useState(false);
    const [batchOpen, setBatchOpen] = useState(false);
    const replacementInput = useRef(null);
    const { format, ratio } = stores.workspace.exportSettings;
    const hasImage = Boolean(stores.editor.img?.src);
    const loading = stores.exportService.isBusy || stores.commands.imageBusy;
    const replaceCommand = stores.commands.get('file.replaceActiveImage');
    const downloadCommand = stores.commands.get('file.quickExport');
    const exportCommand = stores.commands.get('file.openExport');
    const copyCommand = stores.commands.get('file.copyFinalImage');
    const newProjectCommand = stores.commands.get('file.newProject');

    useEffect(() => {
        const cleanups = [
            stores.commands.registerUiAction('file.openBatch', () => { setBatchOpen(true); return true; }),
            stores.commands.registerUiAction('file.selectReplacementImage', () => { replacementInput.current?.click(); return true; }),
        ];
        return () => cleanups.forEach((cleanup) => cleanup());
    }, [stores]);

    const replaceImage = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (stores.workspace.enabled) await stores.commands.execute('file.replaceActiveImage', { file });
        else await stores.commands.replaceAllImage(file);
    };

    const clearLibraryImage = () => {
        stores.editor.destroy();
        stores.editor.clearImg();
        stores.workspace.resetProject();
        stores.editor.clearFun && stores.editor.clearFun();
    };

    const libraryExportOptions = (
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

    const themeProvider = {
        components: {
            Button: {
                colorPrimary: stores.editor.isDark ? '#0066ff' : '#2563eb',
                algorithm: true,
            },
        },
    };

    if (stores.workspace.enabled) return (
        <div className="shoteasy-top-actions">
            <input
                ref={replacementInput}
                hidden
                type="file"
                accept={supportImg.join(',')}
                onChange={replaceImage}
                data-testid="replace-image-input"
            />
            <ConfigProvider theme={themeProvider}>
                <div className="shoteasy-workspace-mobile-only">
                    <Tooltip placement="bottom" arrow={false} title="批量套用同一风格并导出 ZIP">
                        <Button
                            type="text"
                            className="shoteasy-batch-trigger"
                            icon={<Icon.ImageDown size={16} />}
                            onClick={() => { void stores.commands.execute('file.openBatch'); }}
                            aria-label="打开批量处理"
                        >批量</Button>
                    </Tooltip>
                    <Tooltip placement="bottom" arrow={false} title={replaceCommand.disabledReason || '替换当前图片'}>
                        <Button
                            type="default"
                            size="middle"
                            className="shoteasy-top-action"
                            disabled={!replaceCommand.enabled}
                            icon={<Icon.ImagePlus size={17} />}
                            aria-label="更换图片"
                            onClick={() => { void replaceCommand.execute(); }}
                        />
                    </Tooltip>
                    <Tooltip placement="bottom" arrow={false} title={downloadCommand.disabledReason || `使用当前设置快速导出 · ${ratio}x ${format.toUpperCase()}`}>
                        <Button
                            type="default"
                            size="middle"
                            className="shoteasy-top-action"
                            loading={loading}
                            disabled={!downloadCommand.enabled}
                            icon={<Icon.Download size={17} />}
                            aria-label="使用当前设置快速导出"
                            onClick={() => { void downloadCommand.execute(); }}
                        />
                    </Tooltip>
                    {hasImage && (
                        <Tooltip placement="bottom" arrow={false} title={newProjectCommand.disabledReason || '清空当前项目'}>
                            <Button
                                size="middle"
                                danger
                                className="shoteasy-top-action"
                                icon={<Icon.Trash2 size={17} />}
                                disabled={!newProjectCommand.enabled}
                                aria-label="删除截图"
                                onClick={() => { void newProjectCommand.execute(); }}
                            />
                        </Tooltip>
                    )}
                </div>
                {batchOpen && (
                    <Suspense fallback={null}>
                        <BatchExportPanel open onClose={() => setBatchOpen(false)} />
                    </Suspense>
                )}
                <Tooltip placement="bottom" arrow={false} title={`复制 ${modKey} + C`}>
                    <Button
                        type="default"
                        size="middle"
                        className="shoteasy-top-action shoteasy-copy-action"
                        icon={<Icon.Copy size={17} />}
                        loading={loading}
                        disabled={!copyCommand.enabled}
                        aria-label="复制图片"
                        onClick={() => { void copyCommand.execute(); }}
                    />
                </Tooltip>
                <Tooltip placement="bottom" arrow={false} title={exportCommand.disabledReason || '选择格式与倍率并导出'}>
                    <Button
                        type="primary"
                        size="middle"
                        className="shoteasy-export-primary"
                        disabled={!exportCommand.enabled}
                        icon={<Icon.Download size={17} />}
                        aria-label="导出图片"
                        onClick={() => { void exportCommand.execute(); }}
                    >导出</Button>
                </Tooltip>
                <ExportPanel />
            </ConfigProvider>
        </div>
    );

    return (
        <div className="shoteasy-top-actions">
            <input
                ref={replacementInput}
                hidden
                type="file"
                accept={supportImg.join(',')}
                onChange={replaceImage}
                data-testid="replace-image-input"
            />
            <ConfigProvider theme={themeProvider}>
                <Tooltip placement="bottom" arrow={false} title="更换图片">
                    <Button
                        type="default"
                        size="middle"
                        className="shoteasy-top-action shoteasy-copy-action"
                        disabled={!hasImage || loading}
                        icon={<Icon.ImagePlus size={17} />}
                        aria-label="更换图片"
                        onClick={() => replacementInput.current?.click()}
                    />
                </Tooltip>
                <Tooltip placement="bottom" arrow={false} title={`下载 ${modKey} + S · ${ratio}x ${format.toUpperCase()}`}>
                    <Button
                        type="primary"
                        size="middle"
                        className="shoteasy-top-action shoteasy-top-action--primary"
                        loading={loading}
                        disabled={!hasImage}
                        icon={<Icon.Download size={17} />}
                        aria-label="下载图片"
                        onClick={() => { void stores.commands.downloadCurrentImage(); }}
                    />
                </Tooltip>
                <Tooltip placement="bottom" arrow={false} title={`复制 ${modKey} + C`}>
                    <Button
                        type="default"
                        size="middle"
                        className="shoteasy-top-action"
                        icon={<Icon.Copy size={17} />}
                        loading={loading}
                        disabled={!copyCommand.enabled}
                        aria-label="复制图片"
                        onClick={() => { void copyCommand.execute(); }}
                    />
                </Tooltip>
                <Popover
                    content={libraryExportOptions}
                    trigger="click"
                    arrow={false}
                    placement="bottomRight"
                    open={libraryOptionsOpen}
                    styles={{ root: { width: '320px' } }}
                    onOpenChange={setLibraryOptionsOpen}
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
                        onConfirm={clearLibraryImage}
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
