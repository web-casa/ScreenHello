import useI18n from '../../i18n/useI18n';
import { useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Input, Modal } from 'antd';
import Icon from '@components/Icon';
import { NO_CSS_TRANSITION_NAME } from '@components/overlayMotion';
import useStores from '@stores/useStores';
import { cn } from '@utils/utils';
import { getBackgroundDefinition } from '@utils/backgroundConfig';
import { SCENE_TEMPLATES, SCENE_TEMPLATE_CATEGORIES } from '@utils/sceneTemplates';

const normalizeQuery = (value) => String(value || '').trim().toLocaleLowerCase();

const backdropStyleFor = (backgroundKey) => {
    if (backgroundKey === 'none') {
        return {
            backgroundColor: '#1f2937',
            backgroundImage: 'linear-gradient(45deg, rgba(255,255,255,0.1) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.1) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.1) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.1) 75%)',
            backgroundSize: '12px 12px',
            backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0',
        };
    }
    const def = getBackgroundDefinition(backgroundKey);
    if (def?.previewStyle) return def.previewStyle;
    return { background: 'linear-gradient(135deg, #2563eb, #7c3aed)' };
};

export default observer(function SceneTemplateModal({ onClose }) {
    const t = useI18n();
    const stores = useStores();
    const [category, setCategory] = useState('all');
    const [search, setSearch] = useState('');
    const [applyingId, setApplyingId] = useState(null);

    const thumbSrc = stores.editor.img?.src || null;

    const filteredTemplates = useMemo(() => {
        const query = normalizeQuery(search);
        return SCENE_TEMPLATES.filter((tpl) => {
            if (category !== 'all' && tpl.category !== category) return false;
            if (!query) return true;
            const haystack = normalizeQuery(`${t(tpl.title)} ${tpl.title} ${t(tpl.description)} ${tpl.keywords}`);
            return haystack.includes(query);
        });
    }, [category, search, t]);

    const handleApply = async (templateId) => {
        if (applyingId) return;
        setApplyingId(templateId);
        try {
            const ok = await stores.commands.applySceneTemplate(templateId);
            if (ok) onClose?.();
        } finally {
            setApplyingId(null);
        }
    };

    return (
        <Modal
            rootClassName="shoteasy-template-modal"
            zIndex={1100}
            width={880}
            transitionName={NO_CSS_TRANSITION_NAME}
            maskTransitionName={NO_CSS_TRANSITION_NAME}
            title={t("场景模板库")}
            open
            onCancel={applyingId ? undefined : onClose}
            footer={null}
            closable={!applyingId}
            maskClosable={!applyingId}
            keyboard={!applyingId}
            destroyOnHidden
        >
            <div className="shoteasy-template-shell" data-mode={stores.editor.isDark ? 'dark' : 'light'}>
                <div className="shoteasy-template-toolbar">
                    <div className="shoteasy-template-tabs" role="tablist" aria-label={t("模板分类")}>
                        {SCENE_TEMPLATE_CATEGORIES.map((item) => (
                            <Button
                                key={item.id}
                                size="small"
                                type={category === item.id ? 'primary' : 'default'}
                                role="tab"
                                aria-selected={category === item.id}
                                onClick={() => setCategory(item.id)}
                            >
                                {t(item.title)}
                            </Button>
                        ))}
                    </div>
                    <Input
                        size="small"
                        allowClear
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={t("搜索场景模板")}
                        prefix={<Icon.Magnifier size={14} />}
                        aria-label={t("搜索场景模板")}
                        className="shoteasy-template-search"
                    />
                </div>

                <div className="shoteasy-template-grid" data-testid="scene-template-grid">
                    {filteredTemplates.map((tpl) => {
                        const p = tpl.fields.perspective3d;
                        const has3d = p && (p.rotateX || p.rotateY || p.rotateZ);
                        const plateTransform = has3d
                            ? `perspective(320px) rotateY(${p.rotateY}deg) rotateX(${p.rotateX}deg) rotateZ(${p.rotateZ}deg) scale(0.86)`
                            : 'none';
                        const isMulti = Boolean(tpl.multiLayout);
                        const isDarkFrame = tpl.fields.frame === 'macosBarDark' || tpl.fields.frame === 'glassDark';
                        return (
                            <button
                                key={tpl.id}
                                type="button"
                                data-template-id={tpl.id}
                                disabled={Boolean(applyingId)}
                                className={cn('shoteasy-template-card', applyingId === tpl.id && 'is-applying')}
                                onClick={() => { void handleApply(tpl.id); }}
                            >
                                <span
                                    className="shoteasy-template-card__stage"
                                    style={backdropStyleFor(tpl.fields.background)}
                                    aria-hidden="true"
                                >
                                    {isMulti ? (
                                        <span className={cn('shoteasy-template-card__multi', `is-${tpl.multiLayout}`)}>
                                            <span className="shoteasy-template-card__mini-plate">
                                                {thumbSrc && <img src={thumbSrc} alt="" draggable={false} />}
                                            </span>
                                            <span className="shoteasy-template-card__mini-plate">
                                                {thumbSrc && <img src={thumbSrc} alt="" draggable={false} />}
                                            </span>
                                            {tpl.multiLayout === 'trio-fan' && (
                                                <span className="shoteasy-template-card__mini-plate">
                                                    {thumbSrc && <img src={thumbSrc} alt="" draggable={false} />}
                                                </span>
                                            )}
                                        </span>
                                    ) : (
                                        <span
                                            className={cn('shoteasy-template-card__plate', isDarkFrame && 'is-dark')}
                                            style={{ transform: plateTransform }}
                                        >
                                            {thumbSrc ? (
                                                <img src={thumbSrc} alt="" draggable={false} />
                                            ) : (
                                                <span className="shoteasy-perspective-card__skeleton">
                                                    <i /><i /><i />
                                                </span>
                                            )}
                                        </span>
                                    )}
                                </span>
                                <span className="shoteasy-template-card__copy">
                                    <strong>{t(tpl.title)}</strong>
                                    <small>{t(tpl.description)}</small>
                                </span>
                            </button>
                        );
                    })}
                </div>

                {!filteredTemplates.length && (
                    <p className="shoteasy-template-empty" role="status">{t("没有匹配的场景模板")}</p>
                )}
            </div>
        </Modal>
    );
});
