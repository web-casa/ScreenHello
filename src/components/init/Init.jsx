import useI18n from '../../i18n/useI18n';
import { useEffect, useId, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Icon from '@components/Icon';
import { Button } from 'antd';
import { supportImg, cn, modKey } from '@utils/utils';
import useStores from '@stores/useStores';
import usePaste from '@hooks/usePaste';
import useSetImg from '@hooks/useSetImg';
import useImageDrop from '@hooks/useImageDrop';
import useStageMotion from '@hooks/useStageMotion';
import usePressedKeys from '@hooks/usePressedKeys';
import Zoom from '@components/editor/Zoom';
import logoUrl from '@assets/logo.png?no-inline';
import ambientUrl from '@assets/ambient-import.webp?no-inline';
import { publicGuidePath } from '@utils/publicSite';

const EXPORT_FORMATS = 'PNG · JPG · WEBP · AVIF';

function PasteHint({ id }) {
    const t = useI18n();
    const pressed = usePressedKeys();
    return (
        <p className="shoteasy-init-hint" id={id}>
            {t("拖入图片，或按")} <kbd data-pressed={pressed.mod || undefined}>{modKey}</kbd><kbd data-pressed={pressed.v || undefined}>V</kbd> {t("粘贴")}
        </p>
    );
}

export default observer(function Init() {
    const t = useI18n();
    const stores = useStores();
    const inputRef = useRef(null);
    const stageRef = useRef(null);
    const frameRef = useRef(null);
    const coordRef = useRef(null);
    const sizeRef = useRef(null);
    useStageMotion({ stageRef, frameRef, coordRef, sizeRef });
    const demoTicketRef = useRef(null);
    const [demoLoading, setDemoLoading] = useState(false);
    const headingId = useId();
    const hintId = useId();
    const getFile = useSetImg(stores);
    const openImagePicker = () => inputRef.current?.click();
    const onSelectFile = async (event) => {
        const file = event.currentTarget.files?.[0];
        // Clear before awaiting so an invalid file can be selected again.
        event.currentTarget.value = '';
        if (!file) return;
        try {
            await getFile(file, 'blob', { initial: true });
        } catch {
            stores.editor.message?.error?.(t("图片加载失败，请选择有效图片"));
        }
    };
    const handleDropFile = async (file) => getFile(file, 'blob', { initial: true });
    const showImageError = () => stores.editor.message?.error?.(t("图片加载失败，请选择有效图片"));
    const { isDragging, dragProps } = useImageDrop(handleDropFile, showImageError);
    const onCapture = async () => {
        await stores.commands.execute('file.captureScreen');
    };
    const onDemo = async () => {
        if (demoTicketRef.current) return;
        const ticket = stores.editor.beginInitialImageLoad();
        demoTicketRef.current = ticket;
        setDemoLoading(true);
        try {
            // Choose at activation, not mount; resizing later never changes the project.
            const mobile = globalThis.matchMedia?.('(max-width: 767px)')?.matches === true;
            const { default: demoImage } = await (mobile
                ? import('@assets/demo-mobile.webp?no-inline')
                : import('@assets/demo-desktop.webp?no-inline'));
            const response = await fetch(demoImage, { signal: ticket.signal });
            if (!response.ok) throw new Error('demo-image-unavailable');
            const blob = await response.blob();
            if (!ticket.isCurrent()) return;
            const file = new File([blob], `ScreenHello-demo-${mobile ? 'mobile' : 'desktop'}.webp`, { type: 'image/webp' });
            if (await getFile(file, 'blob', { initial: true, initialTicket: ticket, signal: ticket.signal }) === false) return;
            stores.workspace.setProjectName(t("ScreenHello 示例"));
        } catch {
            if (!ticket.signal.aborted) stores.editor.message?.error?.(t("示例图片加载失败，请选择本地图片"));
        } finally {
            ticket.finish();
            if (demoTicketRef.current === ticket) {
                demoTicketRef.current = null;
                setDemoLoading(false);
            }
        }
    };
    useEffect(() => () => {
        demoTicketRef.current = null;
        stores.editor.cancelInitialImageLoad();
    }, [stores.editor]);
    usePaste(async (file) => {
        try {
            await getFile(file, 'blob', { initial: true });
        } catch {
            showImageError();
        }
    }, stores);
    // Preserve the existing initial-view zoom reset without changing project options.
    useEffect(() => {
        stores.editor.setScale(1);
    }, [stores.editor]);

    return (
        <div
            ref={stageRef}
            className={cn('shoteasy-empty-state shoteasy-drop-surface', isDragging && 'is-dragging')}
            onDragEnter={dragProps.onDragEnter}
            onDragOver={dragProps.onDragOver}
            onDragLeave={dragProps.onDragLeave}
            onDrop={dragProps.onDrop}
        >
            {isDragging && (
                <div className="shoteasy-drop-overlay" aria-hidden="true">
                    <Icon.ImagePlus size={30} />
                    <span>{t("释放以添加图片")}</span>
                </div>
            )}
            <div className="shoteasy-stage-light" aria-hidden="true" />
            <div className="shoteasy-empty-scroll">
                <section
                    className={cn('shoteasy-init-canvas', stores.editor.invalid && 'invalid')}
                    aria-labelledby={headingId}
                    style={{ transform: `scale(${stores.editor.scale / 100})` }}
                >
                    <header className="shoteasy-init-heading">
                        <div className="shoteasy-init-brand">
                            <img src={logoUrl} alt="" width="22" height="22" />
                            <span>ScreenHello</span>
                        </div>
                        <h2 id={headingId}>{t("为好图片，留一个位置")}</h2>
                    </header>
                    <div className="shoteasy-init-art-slot">
                        <button ref={frameRef} type="button" className="shoteasy-init-art-button"
                            aria-label={t("点击或拖拽图片到这里")} aria-describedby={hintId}
                            title={t("点击或拖拽图片到这里")} onClick={openImagePicker}>
                            <span className="shoteasy-vf" aria-hidden="true">
                                <i data-corner="tl" /><i data-corner="tr" /><i data-corner="bl" /><i data-corner="br" />
                            </span>
                            <span className="shoteasy-vf__plate">
                                <span className="shoteasy-vf__aura" aria-hidden="true" />
                                <span className="shoteasy-vf__grid" aria-hidden="true" />
                                <span className="shoteasy-vf__scan" aria-hidden="true" />
                                <img className="shoteasy-init-art" src={ambientUrl} alt="" draggable={false} width="768" height="512" />
                            </span>
                        </button>
                        <div className="shoteasy-vf__readouts" aria-hidden="true">
                            <span className="shoteasy-vf__readout" data-at="tl" ref={coordRef}>X 0000  Y 0000</span>
                            <span className="shoteasy-vf__readout" data-at="bl">{EXPORT_FORMATS}</span>
                            <span className="shoteasy-vf__readout" data-at="br" ref={sizeRef} />
                        </div>
                    </div>
                    <div className="shoteasy-init-shelf">
                        <div className="shoteasy-init-actions">
                            <div className="shoteasy-upload-card">
                                <input ref={inputRef} type="file" accept={supportImg.join(',')} hidden onChange={onSelectFile} />
                                <Button type="primary" icon={<Icon.ImagePlus size={20} />} aria-describedby={hintId}
                                    onClick={openImagePicker}>{t("选择图片")}</Button>
                            </div>
                            <Button icon={<Icon.Camera size={20} />}
                                disabled={!stores.commands.get('file.captureScreen').enabled}
                                onClick={onCapture}>{t("截取屏幕")}</Button>
                            {stores.workspace.enabled && (
                                <Button className="shoteasy-demo-button" icon={<Icon.ImagePlay size={20} />}
                                    loading={demoLoading} aria-busy={demoLoading} onClick={onDemo}>{t("试用示例")}</Button>
                            )}
                        </div>
                        <PasteHint id={hintId} />
                        <div className="shoteasy-init-quick-create" role="group" aria-label={t("快捷创作入口")}>
                            <button
                                type="button"
                                className="shoteasy-init-quick-btn"
                                disabled={!stores.commands.get('file.createCodeCard').enabled}
                                data-testid="init-create-code-card"
                                onClick={() => { void stores.commands.execute('file.createCodeCard'); }}
                            >
                                <Icon.CodeXml size={15} aria-hidden="true" />
                                <span>{t("代码卡片")}</span>
                            </button>
                            <button
                                type="button"
                                className="shoteasy-init-quick-btn"
                                disabled={!stores.commands.get('file.createTextCard').enabled}
                                data-testid="init-create-text-card"
                                onClick={() => { void stores.commands.execute('file.createTextCard'); }}
                            >
                                <Icon.Type size={15} aria-hidden="true" />
                                <span>{t("文本卡片")}</span>
                            </button>
                            <button
                                type="button"
                                className="shoteasy-init-quick-btn"
                                disabled={!stores.commands.get('file.openTemplates').enabled}
                                data-testid="init-open-templates"
                                onClick={() => { void stores.commands.execute('file.openTemplates'); }}
                            >
                                <Icon.LayoutGrid size={15} aria-hidden="true" />
                                <span>{t("场景模板")}</span>
                            </button>
                        </div>
                    </div>
                    {stores.workspace.enabled && (
                        <footer className="shoteasy-init-footer">
                            <p><Icon.Check size={16} aria-hidden="true" /><span>{t("图片仅在此设备处理，不会上传")}</span>
                                <span className="shoteasy-init-privacy-count">{t("公网发送 {0}", { 0: stores.privacy.formattedUploadedBytes })}</span>
                            </p>
                            <Button type="text" aria-label={t("打开快速入门")}
                                onClick={() => { void stores.commands.execute('help.quickStart'); }}>
                                {t("快速入门")}<Icon.ChevronRight size={14} />
                            </Button>
                            {import.meta.env.SCREENHELLO_PUBLIC_SITE && (
                                <Button type="link" href={publicGuidePath(stores.i18n.locale, import.meta.env.BASE_URL)}
                                    target="_blank" rel="noopener noreferrer">{t("帮助")}</Button>
                            )}
                        </footer>
                    )}
                </section>
            </div>
            <Zoom />
        </div>
    );
});
