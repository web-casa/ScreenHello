import { useEffect, useRef, useState } from 'react';
import { Button, Drawer, Segmented } from 'antd';
import { observer } from 'mobx-react-lite';
import Icon from '@components/Icon';
import useStores from '@stores/useStores';
import { EXPORT_FORMATS, EXPORT_RATIOS, normalizeExportSettings } from '@utils/stylePreset';

const formatOptions = EXPORT_FORMATS.map((value) => ({ value, label: value.toUpperCase() }));
const ratioOptions = EXPORT_RATIOS.map((value) => ({ value, label: `${value}x` }));

export default observer(function ExportPanel() {
    const stores = useStores();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(() => normalizeExportSettings(stores.workspace.exportSettings));
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);
    const returnFocusRef = useRef(null);
    const busy = submitting || stores.exportService.isBusy;

    const restoreReturnFocus = () => {
        const target = returnFocusRef.current;
        returnFocusRef.current = null;
        if (target?.isConnected) target.focus({ preventScroll: true });
    };

    useEffect(() => stores.commands.registerUiAction('file.openExport', (options = {}) => {
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
        if (busy) stores.commands.cancelExport();
        submittingRef.current = false;
        setSubmitting(false);
        setOpen(false);
        requestAnimationFrame(restoreReturnFocus);
    };

    const confirm = async () => {
        if (submittingRef.current || stores.exportService.isBusy) return;
        submittingRef.current = true;
        setSubmitting(true);
        const exported = await stores.commands.execute('file.quickExport', { confirmedSettings: draft });
        submittingRef.current = false;
        setSubmitting(false);
        if (exported) {
            setOpen(false);
            requestAnimationFrame(restoreReturnFocus);
        }
    };

    const width = Number(stores.option.frameConf.width) || 0;
    const height = Number(stores.option.frameConf.height) || 0;

    return (
        <Drawer
            title="导出图片"
            placement="right"
            size={420}
            open={open}
            onClose={close}
            afterOpenChange={(nextOpen) => {
                if (!nextOpen) restoreReturnFocus();
            }}
            destroyOnHidden
            keyboard={!busy}
            focusable={{ trap: true, focusTriggerAfterClose: false }}
            closable={{ disabled: busy }}
            mask={{ closable: !busy }}
            className="shoteasy-export-drawer"
            rootClassName="shoteasy-overlay-drawer"
            styles={{ body: { padding: 20 } }}
            footer={(
                <div className="shoteasy-export-actions">
                    <Button data-testid="export-cancel" onClick={close}>{busy ? '取消导出' : '取消'}</Button>
                    <Button
                        type="primary"
                        icon={<Icon.Download size={16} />}
                        loading={busy}
                        disabled={busy}
                        onClick={() => { void confirm(); }}
                        aria-label="下载图片"
                        data-testid="export-download"
                    >
                        {busy ? '正在生成…' : '下载图片'}
                    </Button>
                </div>
            )}
        >
            <div className="shoteasy-export-panel">
                <section>
                    <div className="shoteasy-export-panel__heading">
                        <strong>文件格式</strong>
                        <span>按用途选择清晰度、透明度和体积</span>
                    </div>
                    <Segmented
                        block
                        options={formatOptions}
                        value={draft.format}
                        disabled={busy}
                        onChange={(format) => setDraft((current) => ({ ...current, format }))}
                    />
                </section>
                <section>
                    <div className="shoteasy-export-panel__heading">
                        <strong>像素倍率</strong>
                        <span>高倍率会增加生成时间和文件体积</span>
                    </div>
                    <Segmented
                        block
                        options={ratioOptions}
                        value={draft.ratio}
                        disabled={busy}
                        onChange={(ratio) => setDraft((current) => ({ ...current, ratio }))}
                    />
                </section>
                <section className="shoteasy-export-summary" aria-label="导出摘要">
                    <div><span>格式</span><strong>{draft.format.toUpperCase()}</strong></div>
                    <div><span>最终尺寸</span><strong>{width * draft.ratio} × {height * draft.ratio} px</strong></div>
                    <div><span>处理位置</span><strong>仅此设备</strong></div>
                </section>
                <p className="shoteasy-export-note" role="status" aria-live="polite">
                    {busy
                        ? '正在本机生成文件。你可以取消；没有可靠进度数据时不会显示虚假百分比。'
                        : '只有点击“下载图片”才会保存本次格式和倍率；关闭或取消不会改变快速导出设置。'}
                </p>
            </div>
        </Drawer>
    );
});
