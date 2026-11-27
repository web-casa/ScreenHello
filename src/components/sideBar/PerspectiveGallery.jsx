import useI18n from '../../i18n/useI18n';
import { useId, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Slider } from 'antd';
import Icon from '@components/Icon';
import useStores from '@stores/useStores';
import { cn } from '@utils/utils';
import { getBackgroundDefinition } from '@utils/backgroundConfig';
import {
    PERSPECTIVE_DISTANCE_MAX,
    PERSPECTIVE_DISTANCE_MIN,
    PERSPECTIVE_PRESETS,
    PERSPECTIVE_ROTATE_X_MAX,
    PERSPECTIVE_ROTATE_X_MIN,
    PERSPECTIVE_ROTATE_Y_MAX,
    PERSPECTIVE_ROTATE_Y_MIN,
    PERSPECTIVE_ROTATE_Z_MAX,
    PERSPECTIVE_ROTATE_Z_MIN,
    getPerspectivePreset,
    isPerspectiveActive,
    isPerspectiveBlockedFrame,
} from '@utils/perspectiveSchema';

const previewBackdropStyle = (option) => {
    const bg = option.frameConf?.background;
    if (!bg) return { background: 'linear-gradient(135deg, #1f2937, #111827)' };
    if (bg.type === 'image' && bg.url) {
        return {
            backgroundImage: `url("${bg.url}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
        };
    }
    if (bg.type === 'solid' && bg.color) {
        return { background: bg.color };
    }
    const definition = getBackgroundDefinition(option.background);
    if (definition?.previewStyle) return definition.previewStyle;
    if (Array.isArray(bg.stops) && bg.stops.length >= 2) {
        const colors = bg.stops.map((s) => (typeof s === 'string' ? s : s.color)).filter(Boolean);
        if (colors.length >= 2) {
            return { background: `linear-gradient(${option.backgroundGradientAngle ?? 135}deg, ${colors.join(', ')})` };
        }
    }
    return { background: 'linear-gradient(135deg, #2563eb, #7c3aed)' };
};

export default observer(function PerspectiveGallery() {
    const t = useI18n();
    const stores = useStores();
    const sectionId = useId();
    const [customOpen, setCustomOpen] = useState(false);

    const perspective = stores.option.perspective3d;
    const active = isPerspectiveActive(perspective);
    const blockedByDevice = isPerspectiveBlockedFrame(stores.option.frame);
    const currentPreset = getPerspectivePreset(perspective.preset);
    const currentTitle = blockedByDevice
        ? t("平面居中")
        : (currentPreset ? t(currentPreset.title) : t("自定义 3D 角度"));
    const thumbSrc = stores.editor.img?.src || null;
    const backdropStyle = previewBackdropStyle(stores.option);

    return (
        <section className="shoteasy-perspective-panel" aria-labelledby={`${sectionId}-title`}>
            <div className="shoteasy-perspective-panel__heading">
                <div>
                    <h2 id={`${sectionId}-title`}>{t("3D 视角")}</h2>
                    <span>{t('当前：{0}', { 0: currentTitle })}</span>
                </div>
                {active && (
                    <Button
                        size="small"
                        type="text"
                        onClick={() => stores.option.applyPerspectivePreset('flat')}
                    >{t("重置平面")}</Button>
                )}
            </div>

            {blockedByDevice && (
                <p className="shoteasy-perspective-note">
                    {t("选择设备外框时将自动切回平面；点击 3D 视角将自动切换为极简浏览器外框。")}
                </p>
            )}

            <div className="shoteasy-perspective-grid" role="radiogroup" aria-label={t("3D 视角")}>
                {PERSPECTIVE_PRESETS.map((preset) => {
                    const selected = !blockedByDevice && perspective.preset === preset.id;
                    const cardTransform = preset.id === 'flat'
                        ? 'none'
                        : `perspective(260px) rotateY(${preset.rotateY}deg) rotateX(${preset.rotateX}deg) rotateZ(${preset.rotateZ}deg) scale(${preset.id === 'hero-closeup' ? 1.08 : 0.9})`;
                    return (
                        <button
                            key={preset.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            data-perspective-preset={preset.id}
                            className={cn('shoteasy-perspective-card', selected && 'is-selected')}
                            onClick={() => stores.option.applyPerspectivePreset(preset.id)}
                        >
                            <span className="shoteasy-perspective-card__stage" style={backdropStyle} aria-hidden="true">
                                <span
                                    className="shoteasy-perspective-card__plate"
                                    style={{ transform: cardTransform }}
                                >
                                    {thumbSrc ? (
                                        <img src={thumbSrc} alt="" draggable={false} />
                                    ) : (
                                        <span className="shoteasy-perspective-card__skeleton">
                                            <i /><i /><i />
                                        </span>
                                    )}
                                </span>
                            </span>
                            <span className="shoteasy-perspective-card__label">{t(preset.title)}</span>
                        </button>
                    );
                })}
            </div>

            <button
                type="button"
                className="shoteasy-perspective-custom-toggle"
                aria-expanded={customOpen}
                onClick={() => setCustomOpen((prev) => !prev)}
            >
                <span>{t("自定义 3D 角度")}</span>
                <Icon.ChevronDown size={14} className={cn('transition-transform', !customOpen && '-rotate-90')} />
            </button>

            <Button
                block
                size="small"
                className="shoteasy-template-trigger"
                disabled={!stores.commands.get('file.openTemplates').enabled}
                onClick={() => { void stores.commands.execute('file.openTemplates'); }}
            >
                {t("浏览全部场景模板")}
            </Button>

            {customOpen && (
                <div className="shoteasy-perspective-sliders">
                    <div className="shoteasy-perspective-slider-row">
                        <div className="shoteasy-perspective-slider-head">
                            <span>{t("俯仰角 X")}</span>
                            <output>{perspective.rotateX}°</output>
                        </div>
                        <Slider
                            min={PERSPECTIVE_ROTATE_X_MIN}
                            max={PERSPECTIVE_ROTATE_X_MAX}
                            value={perspective.rotateX}
                            onChange={(value) => stores.option.setPerspective({ rotateX: value }, { commit: false })}
                            onChangeComplete={(value) => stores.option.setPerspective({ rotateX: value }, { commit: true })}
                            ariaLabelForHandle={t("俯仰角 X")}
                        />
                    </div>
                    <div className="shoteasy-perspective-slider-row">
                        <div className="shoteasy-perspective-slider-head">
                            <span>{t("偏航角 Y")}</span>
                            <output>{perspective.rotateY}°</output>
                        </div>
                        <Slider
                            min={PERSPECTIVE_ROTATE_Y_MIN}
                            max={PERSPECTIVE_ROTATE_Y_MAX}
                            value={perspective.rotateY}
                            onChange={(value) => stores.option.setPerspective({ rotateY: value }, { commit: false })}
                            onChangeComplete={(value) => stores.option.setPerspective({ rotateY: value }, { commit: true })}
                            ariaLabelForHandle={t("偏航角 Y")}
                        />
                    </div>
                    <div className="shoteasy-perspective-slider-row">
                        <div className="shoteasy-perspective-slider-head">
                            <span>{t("平面倾角 Z")}</span>
                            <output>{perspective.rotateZ}°</output>
                        </div>
                        <Slider
                            min={PERSPECTIVE_ROTATE_Z_MIN}
                            max={PERSPECTIVE_ROTATE_Z_MAX}
                            value={perspective.rotateZ}
                            onChange={(value) => stores.option.setPerspective({ rotateZ: value }, { commit: false })}
                            onChangeComplete={(value) => stores.option.setPerspective({ rotateZ: value }, { commit: true })}
                            ariaLabelForHandle={t("平面倾角 Z")}
                        />
                    </div>
                    <div className="shoteasy-perspective-slider-row">
                        <div className="shoteasy-perspective-slider-head">
                            <span>{t("透视距离")}</span>
                            <output>{perspective.distance}</output>
                        </div>
                        <Slider
                            min={PERSPECTIVE_DISTANCE_MIN}
                            max={PERSPECTIVE_DISTANCE_MAX}
                            step={50}
                            value={perspective.distance}
                            onChange={(value) => stores.option.setPerspective({ distance: value }, { commit: false })}
                            onChangeComplete={(value) => stores.option.setPerspective({ distance: value }, { commit: true })}
                            ariaLabelForHandle={t("透视距离")}
                        />
                    </div>
                </div>
            )}
        </section>
    );
});
