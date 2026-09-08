import useI18n from '../../i18n/useI18n';
import { useId, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Icon from '@components/Icon';
import { Button, Drawer, Input, Segmented, Slider } from 'antd';
import useStores from '@stores/useStores';
import { cn } from '@utils/utils';
import {
    BROWSER_HEADER_SIZE_MAX,
    BROWSER_HEADER_SIZE_MIN,
    getFrameDefinition,
    getFrameGroups,
    getQuickFrameGroups,
    isDeviceFrame,
} from '@utils/frameConfig';
import ContextSuggestion from './ContextSuggestion';
import { getDeviceVariants } from '@utils/rasterDeviceConfig';

const FrameThumb = observer(function FrameThumb({ frame, compact = false }) {
    const { editor } = useStores();
    const definition = getFrameDefinition(frame);
    const browserLike = definition.kind === 'browser' || definition.kind === 'arc';
    const vectorDevice = definition.kind === 'vector-device';
    if (definition.kind === 'raster-device' && definition.available) return (
        <div className={cn('shoteasy-frame-thumb', compact && 'is-compact')} data-kind="raster-device" data-mode={editor.isDark ? 'dark' : 'light'} aria-hidden="true">
            <img src={definition.thumb || definition.image} alt="" loading="lazy" className="shoteasy-raster-device-thumb" />
        </div>
    );
    return (
        <div
            className={cn('shoteasy-frame-thumb', compact && 'is-compact')}
            data-kind={definition.kind}
            data-thumb={definition.thumbnail}
            aria-hidden="true"
        >
            <div className="shoteasy-frame-thumb__surface">
                {browserLike && (
                    <span className="shoteasy-frame-thumb__traffic">
                        <i /><i /><i />
                    </span>
                )}
                {browserLike && <span className="shoteasy-frame-thumb__address" />}
                {vectorDevice && <span className="shoteasy-frame-thumb__device-screen" />}
                {vectorDevice && <span className="shoteasy-frame-thumb__device-detail" />}
            </div>
        </div>
    );
});

const FrameOption = ({ frame, selected, onSelect, compact = false, name }) => {
    const t = useI18n();
    const definition = getFrameDefinition(frame);
    return (
        <label className={cn('shoteasy-frame-option', selected && 'is-selected')}>
            <input
                type="radio"
                name={name}
                value={frame}
                checked={selected}
                onChange={() => onSelect(frame)}
            />
            <div className="shoteasy-frame-option__content">
                <FrameThumb frame={frame} compact={compact} />
                <span>{t(definition.title)}</span>
                {!compact && definition.description && <small>{t(definition.description)}</small>}
            </div>
        </label>
    );
};

const DeviceColors = ({ frame, onSelect, busy }) => {
    const t = useI18n();
    const name = useId();
    const variants = getDeviceVariants(frame);
    if (!variants.length) return null;
    return <fieldset className="shoteasy-device-colors" aria-busy={busy}>
        <legend>{t('机身配色')}</legend>
        <div className="shoteasy-device-colors__choices">
            {variants.map(variant => <label key={variant.id} className={cn('shoteasy-device-color', frame === variant.id && 'is-selected')}>
                <input type="radio" name={`${name}-device-color`} value={variant.id} checked={frame === variant.id} onChange={() => onSelect(variant.id)} />
                <span className="shoteasy-device-color__swatch" style={{ backgroundColor: variant.swatch }} aria-hidden="true" />
                <span>{t(variant.colorTitle)}</span>
            </label>)}
        </div>
        {busy && <p role="status">{t('正在更新设备画面…')}</p>}
    </fieldset>;
};

const DeviceSource = ({ device }) => {
    const t = useI18n();
    return <div className="shoteasy-device-license">
        <p>{device.author}</p>
        <a href={device.source} target="_blank" rel="noopener noreferrer">{t('素材来源')}</a>
        {device.license && <>{' · '}<a href={device.license} target="_blank" rel="noopener noreferrer">{t('完整许可')}</a></>}
        {device.licenseStatus === 'MIT' && <p>{t('机身来自 MIT 许可的 SVG，已去除模拟状态栏；导出图片不附加文字。')}</p>}
        {!device.available && <p role="alert">{t('设备素材缺失或渲染失败，请重新选择设备或改用无外框后导出。')}</p>}
    </div>;
};

const BrowserFrameSettings = ({ url, headerSize }) => {
    const t = useI18n();
    const stores = useStores();
    const urlId = useId();
    const headerSizeId = useId();
    return <div className="shoteasy-browser-frame-settings">
        <div className="shoteasy-browser-frame-settings__title">{t("浏览器设置")}</div>
        <label htmlFor={urlId}>URL</label>
        <Input
            id={urlId}
            value={url}
            maxLength={160}
            placeholder="example.com"
            onChange={(event) => stores.option.setBrowserUrl(event.target.value, { commit: false })}
            onBlur={(event) => stores.option.setBrowserUrl(event.target.value)}
            onPressEnter={(event) => event.currentTarget.blur()}
            aria-label={t("浏览器地址栏 URL")}
        />
        <div className="shoteasy-browser-frame-settings__slider-heading">
            <label htmlFor={headerSizeId}>{t("顶部尺寸")}</label>
            <output htmlFor={headerSizeId}>{headerSize}%</output>
        </div>
        <Slider
            id={headerSizeId}
            min={BROWSER_HEADER_SIZE_MIN}
            max={BROWSER_HEADER_SIZE_MAX}
            value={headerSize}
            onChange={(value) => stores.option.setBrowserHeaderSize(value, { commit: false })}
            onChangeComplete={(value) => stores.option.setBrowserHeaderSize(value)}
            ariaLabelForHandle={t("浏览器顶部尺寸")}
        />
    </div>;
};

export default observer(function FrameBar() {
    const t = useI18n();
    const stores = useStores();
    const frameIdPrefix = useId();
    const [showMore, setShowMore] = useState(false);
    const groups = useMemo(() => {
        const priority = { browser: 0, basic: 1, creative: 2, device: 3, 'simple-device': 4 };
        return getFrameGroups().filter(group => group.items.length).sort((a, b) => priority[a.id] - priority[b.id]);
    }, []);
    const quickFrames = getQuickFrameGroups(stores.option.frame, groups);
    const selectFrame = (value) => {
        stores.option.setFrame(value);
    };
    const device = isDeviceFrame(stores.option.frame);
    const selectedFrame = getFrameDefinition(stores.option.frame);
    const browserSelected = selectedFrame.kind === 'browser' || selectedFrame.kind === 'arc';
    const rasterSelected = selectedFrame.kind === 'raster-device';
    const compatibilitySelected = selectedFrame.kind === 'vector-device' || (selectedFrame.replacedBy && selectedFrame.hidden);
    const colorLabel = selectedFrame.colorTitle ? ` · ${t(selectedFrame.colorTitle)}` : '';
    return (
        <>
            <section className="shoteasy-frame-panel" aria-labelledby={`${frameIdPrefix}-panel-title`}>
                <div className="shoteasy-frame-panel__heading">
                    <div>
                        <h2 id={`${frameIdPrefix}-panel-title`}>{t("外框")}</h2>
                        <span>{t('当前：{0}', { 0: t(selectedFrame.title) + colorLabel })}</span>
                    </div>
                </div>
                <ContextSuggestion kind="frame" />
                <div className="shoteasy-frame-panel__subheading">{t("浏览器外框")}</div>
                <div className="shoteasy-frame-grid is-quick" role="radiogroup" aria-label={t("常用浏览器外框")}>
                    {quickFrames.browser.map((item) => (
                        <FrameOption
                            key={item.id}
                            frame={item.id}
                            name={`${frameIdPrefix}-quick-frame`}
                            compact
                            selected={stores.option.frame === item.id}
                            onSelect={selectFrame}
                        />
                    ))}
                </div>
                {quickFrames.device.length > 0 && <div className="shoteasy-frame-quick-devices">
                    <div className="shoteasy-frame-panel__subheading">{t('设备外框')}</div>
                    <div className="shoteasy-frame-grid is-quick" role="radiogroup" aria-label={t('常用设备外框')}>
                        {quickFrames.device.map(item => <FrameOption
                            key={item.model || item.id}
                            frame={item.id}
                            name={`${frameIdPrefix}-quick-device`}
                            compact
                            selected={stores.option.frame === item.id}
                            onSelect={selectFrame}
                        />)}
                    </div>
                </div>}
                <Button block className="shoteasy-frame-more" onClick={() => setShowMore(true)}
                    aria-haspopup="dialog" aria-expanded={showMore} aria-controls={`${frameIdPrefix}-drawer`}>
                    {t('更多外框')}<Icon.ChevronRight size={16} />
                </Button>
                {browserSelected && (
                    <BrowserFrameSettings
                        url={stores.option.browserUrl}
                        headerSize={stores.option.browserHeaderSize}
                    />
                )}
                {compatibilitySelected && <p className="shoteasy-frame-device-note">{t('旧版设备（兼容）')}{' · '}{t('旧项目外观保持不变，可在设备列表中选择新机型。')}</p>}
                {rasterSelected && <>
                    <DeviceColors frame={stores.option.frame} onSelect={selectFrame} busy={stores.renderTaskTracker.size > 0} />
                    <DeviceSource device={selectedFrame} />
                </>}
            </section>
            <Drawer
                title={
                    <div className="shoteasy-frame-drawer__title">
                        <span>{t("选择外框")}</span>
                        <small>{t(selectedFrame.title)}{colorLabel}</small>
                    </div>
                }
                placement="right"
                closable
                mask={false}
                onClose={() => setShowMore(false)}
                open={showMore}
                getContainer={false}
                size="100%"
                rootClassName="shoteasy-frame-drawer-shell"
                className="[&_.ant-drawer-body]:p-0"
            >
                <div className="shoteasy-frame-drawer" id={`${frameIdPrefix}-drawer`}>
                    {groups.map((group) => (
                        <section key={group.id} className="shoteasy-frame-section" aria-labelledby={`${frameIdPrefix}-group-${group.id}`}>
                            <div className="shoteasy-frame-section__heading">
                                <h3 id={`${frameIdPrefix}-group-${group.id}`}>{t(group.title)}</h3>
                                {group.id === 'device' && (
                                    <Segmented
                                        size="small"
                                        value={stores.option.frameMode}
                                        onChange={(value) => stores.option.setFrameMode(value)}
                                        options={[
                                            { label: t("覆盖"), value: 'cover' },
                                            { label: t("包含"), value: 'fit' },
                                            { label: t("拉伸"), value: 'stretch' },
                                        ]}
                                        aria-label={t("设备图片适配方式")}
                                    />
                                )}
                            </div>
                            <div className="shoteasy-frame-grid" role="radiogroup" aria-label={t(group.title)}>
                                {group.items.map((item) => (
                                    <FrameOption
                                        key={item.id}
                                        frame={item.model && selectedFrame.available && selectedFrame.model === item.model ? selectedFrame.id : item.id}
                                        name={`${frameIdPrefix}-frame-${group.id}`}
                                        selected={stores.option.frame === item.id || Boolean(item.model && selectedFrame.available && selectedFrame.model === item.model)}
                                        onSelect={selectFrame}
                                    />
                                ))}
                            </div>
                            {group.id === 'device' && rasterSelected && <DeviceColors frame={stores.option.frame} onSelect={selectFrame} busy={stores.renderTaskTracker.size > 0} />}
                        </section>
                    ))}
                    {device && <div className="shoteasy-frame-device-note">{t('设备外框当前使用：{0}', { 0: t(selectedFrame.title) })}</div>}
                    {compatibilitySelected && <p className="shoteasy-frame-device-note">{t('旧版设备（兼容）')}{' · '}{t('旧项目外观保持不变，可在设备列表中选择新机型。')}</p>}
                    {rasterSelected && <DeviceSource device={selectedFrame} />}
                </div>
            </Drawer>
        </>
    );
});
