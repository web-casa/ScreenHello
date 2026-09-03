import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import Icon from '@components/Icon';
import { Upload, Button, Tooltip } from 'antd';
import { supportImg, cn } from '@utils/utils';
import useStores from '@stores/useStores';
import usePaste from '@hooks/usePaste';
import useSetImg from '@hooks/useSetImg';
import useImageDrop from '@hooks/useImageDrop';
import Zoom from '@components/editor/Zoom';
import { captureScreen } from '@utils/captureScreen';
import { getBackgroundDefinition } from '@utils/backgroundConfig';

const { Dragger } = Upload;

/**
 * 初始画布的背景预览：跟随默认背景令牌走——
 * 默认背景 token 从统一定义中读取预览样式。
 */
const getInitCanvasStyle = (background) => {
    const definition = getBackgroundDefinition(background);
    return definition?.previewStyle || undefined;
};

export default observer(function Init() {
    const stores = useStores();
    const getFile = useSetImg(stores);
    const beforeUpload = async (file) => {
        try {
            await getFile(file);
        } catch {
            stores.editor.message?.error?.('图片加载失败，请选择有效图片');
        }
        return Upload.LIST_IGNORE;
    };
    const handleDropFile = async (file) => getFile(file);
    const showImageError = () => stores.editor.message?.error?.('图片加载失败，请选择有效图片');
    const { isDragging, dragProps } = useImageDrop(handleDropFile, showImageError);
    const onDrop = (event) => {
        if (event.target?.closest?.('.shoteasy-upload-card')) return;
        dragProps.onDrop(event);
    };
    const onCapture = async () => {
        const dataURL = await captureScreen();
        if (!dataURL) {
            // getDisplayMedia 被拒绝或取消时给出可理解反馈（R-06），而不是静默返回。
            stores.editor.message?.error?.('未能获取屏幕内容，请检查浏览器屏幕录制权限');
            return;
        }
        try {
            await getFile(dataURL, 'dataURL');
        } catch {
            showImageError();
        }
    };
    const onDemo = async () => {
        try {
            const { default: demoImage } = await import('@assets/demo.jpg?no-inline');
            const response = await fetch(demoImage);
            if (!response.ok) throw new Error('demo-image-unavailable');
            const blob = await response.blob();
            const file = new File([blob], 'ScreenHello-demo.jpg', { type: blob.type || 'image/jpeg' });
            await getFile(file);
            stores.workspace.setProjectName('ScreenHello 示例');
        } catch {
            stores.editor.message?.error?.('示例图片加载失败，请选择本地图片');
        }
    };
    usePaste(async (file) => {
        try {
            await getFile(file);
        } catch {
            showImageError();
        }
    }, stores);
    // 进入初始页即"适应画布"：初始卡的基础尺寸就是适应尺寸，重置上次编辑遗留的缩放
    useEffect(() => {
        stores.editor.setScale(1);
    }, [stores.editor]);

    return (
        <div
            className={cn('shoteasy-empty-state shoteasy-drop-surface', isDragging && 'is-dragging')}
            onDragEnter={dragProps.onDragEnter}
            onDragOver={dragProps.onDragOver}
            onDragLeave={dragProps.onDragLeave}
            onDrop={onDrop}
        >
            {isDragging && (
                <div className="shoteasy-drop-overlay" aria-hidden="true">
                    <Icon.ImagePlus size={30} />
                    <span>释放以添加图片</span>
                </div>
            )}
            {/* 4:3 初始画布卡：默认背景铺面，中间只保留精简上传 UI（点击/拖拽/粘贴 + 截取屏幕）；
                缩放跟随右下角 Zoom 工具栏（transform，基础尺寸 = 适应画布 = 100%） */}
            <div
                className={cn('shoteasy-init-canvas', stores.editor.invalid && 'invalid')}
                style={{
                    ...getInitCanvasStyle(stores.option.background),
                    transform: `scale(${stores.editor.scale / 100})`,
                }}
            >
                <Dragger
                    accept={supportImg.join(',')}
                    name="file"
                    showUploadList={false}
                    beforeUpload={beforeUpload}
                    rootClassName="shoteasy-upload-card w-full max-w-[440px]"
                >
                    <div className="shoteasy-upload-card__body">
                        <Icon.ImagePlus size={32} />
                        <div>
                            <strong>点击或拖拽图片到这里</strong>
                            <span>也可以直接粘贴剪贴板图片</span>
                        </div>
                    </div>
                </Dragger>
                <div className="shoteasy-quick-actions m-0 justify-center">
                    <Tooltip placement="top" arrow={false} title="截取屏幕窗口">
                        <Button type="default" size="middle" icon={<Icon.Camera size={18} />} onClick={onCapture}>
                            截取屏幕
                        </Button>
                    </Tooltip>
                </div>
                {stores.workspace.enabled && (
                    <button type="button" className="shoteasy-demo-card" onClick={onDemo}>
                        <span className="shoteasy-demo-card__icon" aria-hidden="true"><Icon.ImagePlay size={18} /></span>
                        <span className="shoteasy-demo-card__copy"><strong>第一次使用？</strong><br />用示例图片体验背景、标注、预设与项目保存</span>
                        <Icon.ChevronRight size={16} />
                    </button>
                )}
            </div>
            <Zoom />
        </div>
    );
});
