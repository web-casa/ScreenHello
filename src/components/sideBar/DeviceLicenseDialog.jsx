import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Modal } from 'antd';
import useStores from '@stores/useStores';
import useI18n from '../../i18n/useI18n';
import { NO_CSS_TRANSITION_NAME } from '@components/overlayMotion';

export default observer(function DeviceLicenseDialog() {
    const stores = useStores();
    const t = useI18n();
    const device = stores.deviceLicense.pending;
    const cancel = useRef(null);
    useEffect(() => stores.deviceLicense.mount(), [stores]);
    return <Modal
        open={Boolean(device)}
        title={t('素材许可说明')}
        zIndex={1200}
        onCancel={() => stores.deviceLicense.resolve(false)}
        mask={{ closable: false }}
        transitionName={NO_CSS_TRANSITION_NAME}
        maskTransitionName={NO_CSS_TRANSITION_NAME}
        afterOpenChange={open => { if (open) cancel.current?.focus(); }}
        rootClassName={`shoteasy-components${stores.editor.isDark ? ' dark-mode' : ''}`}
        footer={<>
            <Button ref={cancel} onClick={() => stores.deviceLicense.resolve(false)}>{t('取消')}</Button>
            <Button type="primary" onClick={() => stores.deviceLicense.resolve(true)}>{t('了解并继续')}</Button>
        </>}
    >
        {device ? <div className="shoteasy-device-license">
            <p><strong>{device.title}</strong></p>
            {device.colorTitle && <p>{t(device.colorTitle)}</p>}
            <p>{device.author}</p>
            {device.licenseStatus !== 'unverified' && <p>{t('此设备素材使用独立许可，要求署名并限制素材再分发。')}</p>}
            <p><a href={device.source} target="_blank" rel="noopener noreferrer">{t('素材来源')}</a>
                {device.license && <>{' · '}<a href={device.license} target="_blank" rel="noopener noreferrer">{t('完整许可')}</a></>}</p>
            <p>{t('导出图片不附加署名文字。使用或发布时请遵守原作者许可；此提示不替代授权。')}</p>
        </div> : null}
    </Modal>;
});
