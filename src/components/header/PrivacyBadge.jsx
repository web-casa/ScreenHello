import useI18n from '../../i18n/useI18n';
import { observer } from 'mobx-react-lite';
import { Button, Popover } from 'antd';
import Icon from '@components/Icon';
import useStores from '@stores/useStores';
import { cn } from '@utils/utils';

/**
 * 顶栏隐私计数器：显示本次会话已知的外部发送字节数。
 *
 * 数字来自运行时出口监控（fetch / XHR / sendBeacon / WebSocket），不是静态文案：
 * 一旦有数据发往非同源、非回环的地址，这里会立刻变化，并在浮层里给出次数与最近地址。
 * 某些请求体无法不消费地精确测量时，字节数会以「≥」标记为下界。
 * 页面级计数，所以同页多实例显示同一个真实数字。
 */
const PrivacyDetails = observer(function PrivacyDetails() {
    const t = useI18n();
    const { privacy } = useStores();
    return (
        <div className="shoteasy-privacy-details">
            <dl>
                <div><dt>{t('已上传 {0}', { 0: privacy.formattedUploadedBytes })}</dt><dd>{t('外部上传数据量')}</dd></div>
                <div><dt>{t('外部请求 {0} 次', { 0: privacy.remoteRequests })}</dt><dd>fetch / XHR / beacon / WebSocket</dd></div>
                {privacy.resourceObserverSupported && (
                    <div><dt>{t('外部资源加载 {0} 个', { 0: privacy.externalResourceLoads })}</dt><dd>{t('图片、脚本、样式，仅接收')}</dd></div>
                )}
            </dl>
            {privacy.unknownBody > 0 && (
                <p role="alert">{t('有 {0} 次外部请求的请求体长度无法确定。', { 0: privacy.unknownBody })}</p>
            )}
            {privacy.remoteRequests > 0 && privacy.lastRemote && (
                <p role="alert">{t('最近一次外部请求：{0}', { 0: privacy.lastRemote })}</p>
            )}
            <p>{t('图片、项目、草稿与预设都在本机处理，这里显示的是运行时统计的真实出口流量。')}</p>
        </div>
    );
});

/** 帮助中心等处的行内版本：同一份计数，文字更完整。 */
export const PrivacyCounter = observer(function PrivacyCounter() {
    const t = useI18n();
    const { privacy } = useStores();
    return (
        <span className="shoteasy-privacy-counter">
            {t('本次会话已上传 {0}、外部请求 {1} 次（运行时统计）。', {
                0: privacy.formattedUploadedBytes,
                1: privacy.remoteRequests,
            })}
        </span>
    );
});

export default observer(function PrivacyBadge() {
    const t = useI18n();
    const { privacy } = useStores();
    const clean = privacy.isClean;
    const label = t('已上传 {0}', { 0: privacy.formattedUploadedBytes });
    return (
        <Popover
            placement="bottomRight"
            arrow={false}
            trigger="click"
            content={<PrivacyDetails />}
            title={t('隐私')}
        >
            <Button
                type="text"
                size="small"
                className={cn('shoteasy-privacy-badge', !clean && 'is-flagged')}
                aria-label={t('隐私：{0}', { 0: label })}
            >
                <Icon.Check size={14} aria-hidden="true" />
                <span className="shoteasy-privacy-badge__label">{label}</span>
            </Button>
        </Popover>
    );
});
