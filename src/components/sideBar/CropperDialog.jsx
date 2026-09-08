import useI18n from '../../i18n/useI18n';
import { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { Modal } from 'antd';
import Cropper from 'react-cropper';
import 'cropperjs/dist/cropper.css';
import useStores from '@stores/useStores';
import { getDefaultFrameSize } from '@utils/utils';

export default observer(function CropperDialog({ onClose }) {
    const t = useI18n();
    const stores = useStores();
    const cropperRef = useRef(null);
    const handleReady = (event) => event.currentTarget.cropper.zoomTo(0.5);
    const handleOk = () => {
        const canvas = cropperRef.current?.cropper?.getCroppedCanvas();
        if (canvas) {
            const { width, height } = canvas;
            stores.editor.setImg({
                ...stores.editor.img,
                src: canvas.toDataURL(),
                width,
                height,
                _ownsObjectUrl: false,
            });
            if (stores.option.size.type === 'auto') {
                const frameSize = getDefaultFrameSize(width, height);
                stores.option.setFrameSize(frameSize.width, frameSize.height);
            }
        }
        onClose();
    };

    return (
        <Modal
            rootClassName="shoteasy-cropper-modal"
            zIndex={1100}
            title={t("裁剪")}
            open
            onOk={handleOk}
            onCancel={onClose}
            okText={t("确定")}
            cancelText={t("取消")}
            destroyOnHidden
        >
            <Cropper
                ref={cropperRef}
                style={{ height: 400, width: '100%' }}
                ready={handleReady}
                initialAspectRatio={stores.editor.img.width / stores.editor.img.height}
                src={stores.editor.img.src}
                dragMode="move"
                viewMode={1}
                minCropBoxHeight={10}
                minCropBoxWidth={10}
                background={false}
                responsive
                autoCropArea={1}
                checkOrientation={false}
                guides
            />
        </Modal>
    );
});
