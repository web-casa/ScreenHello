import useI18n from '../../i18n/useI18n';
import { lazy, Suspense, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Icon from '@components/Icon';
import { Button, Tooltip } from 'antd';
import useStores from '@stores/useStores';

const CropperDialog = lazy(() => import('./CropperDialog'));

export default observer(function CropperImage() {
    const t = useI18n();
    const stores = useStores();
    const buttonRef = useRef(null);
    const [activeTargetId, setActiveTargetId] = useState(null);
    const availableTargetId = stores.commands.getCropTargetId();
    const hasImage = Boolean(stores.editor.img?.src);
    const disabled = !hasImage || !availableTargetId;

    const handleCrop = () => {
        const targetId = stores.commands.getCropTargetId();
        if (!targetId) return;
        setActiveTargetId(targetId);
    };

    const handleClose = () => {
        setActiveTargetId(null);
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => buttonRef.current?.focus?.());
        }
    };

    const tooltipTitle = !hasImage || availableTargetId
        ? t("裁剪图片")
        : t("请只选择一个未锁定图片图层");

    return (
        <>
            <Tooltip title={tooltipTitle}>
                <Button
                    ref={buttonRef}
                    type="text"
                    shape="circle"
                    aria-label={t("裁剪图片")}
                    icon={<Icon.Crop size={18} />}
                    disabled={disabled}
                    onClick={handleCrop}
                />
            </Tooltip>
            {activeTargetId && (
                <Suspense fallback={<span role="status" className="text-xs">{t("正在加载裁剪器…")}</span>}>
                    <CropperDialog targetId={activeTargetId} onClose={handleClose} />
                </Suspense>
            )}
        </>
    );
});
