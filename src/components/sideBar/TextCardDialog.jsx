import useI18n from '../../i18n/useI18n';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Input, InputNumber, Modal, Segmented, Select, Switch } from 'antd';
import { NO_CSS_TRANSITION_NAME } from '@components/overlayMotion';
import useStores from '@stores/useStores';
import {
    CHANGELOG_TAGS,
    DEFAULT_TEXT_CARD,
    TEXT_CARD_MAX_CHANGELOG_ITEMS,
    TEXT_CARD_PIXEL_RATIO,
    TEXT_CARD_THEMES,
    hasRenderableTextCard,
    normalizeTextCard,
} from '@utils/textCardSchema';
import {
    compressAvatarFileToDataUrl,
    drawTextCardToCanvas,
    loadAvatarImageElement,
    renderTextCardBlob,
} from '@utils/textCardRenderer';
import { debounce } from '@utils/timing';
import { supportImg } from '@utils/utils';

const THEME_LABELS = Object.freeze({
    'paper-light': '纸感浅色',
    'graphite-dark': '石墨深色',
    'glass-light': '浅色磨砂',
    'glass-dark': '深色磨砂',
    'warm-editorial': '暖纸杂志',
    twilight: '暮色紫蓝',
});

const TAG_LABELS = Object.freeze({
    new: '新增',
    improved: '优化',
    fix: '修复',
});

export default observer(function TextCardDialog({ mode = 'create', targetId = null, initialCard = null, onClose }) {
    const t = useI18n();
    const stores = useStores();
    const baseId = useId();
    const isEdit = mode === 'edit';

    const [card, setCard] = useState(() => normalizeTextCard(initialCard || DEFAULT_TEXT_CARD));
    const [avatarImage, setAvatarImage] = useState(null);
    const [metrics, setMetrics] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    const canvasRef = useRef(null);
    const avatarInputRef = useRef(null);
    const renderSeqRef = useRef(0);
    const hasPaintedRef = useRef(false);
    const mountedRef = useRef(true);

    const canSubmit = hasRenderableTextCard(card);

    const updateCard = useCallback((patch) => {
        setCard((previous) => ({ ...previous, ...patch }));
    }, []);

    useEffect(() => {
        let cancelled = false;
        if (!card.avatarDataUrl) {
            setAvatarImage(null);
            return () => { cancelled = true; };
        }
        loadAvatarImageElement(card.avatarDataUrl).then((img) => {
            if (!cancelled) setAvatarImage(img);
        });
        return () => { cancelled = true; };
    }, [card.avatarDataUrl]);

    const kindOptions = useMemo(() => ([
        { value: 'social', label: t("社交动态") },
        { value: 'quote', label: t("引文海报") },
        { value: 'changelog', label: t("更新日志") },
    ]), [t]);

    const platformOptions = useMemo(() => ([
        { value: 'x', label: 'X' },
        { value: 'bluesky', label: 'Bluesky' },
        { value: 'minimal', label: t("极简") },
    ]), [t]);

    const themeOptions = useMemo(() => (
        TEXT_CARD_THEMES.map((id) => ({
            value: id,
            label: t(THEME_LABELS[id] || id),
        }))
    ), [t]);

    const tagOptions = useMemo(() => (
        CHANGELOG_TAGS.map((tag) => ({
            value: tag,
            label: t(TAG_LABELS[tag] || tag),
        }))
    ), [t]);

    const paintPreview = useCallback((nextCard, nextAvatarImage) => {
        const seq = renderSeqRef.current + 1;
        renderSeqRef.current = seq;
        const canvas = canvasRef.current;
        if (!canvas) return;
        if (!hasRenderableTextCard(nextCard)) {
            canvas.width = 0;
            canvas.height = 0;
            setMetrics(null);
            return;
        }
        try {
            const previewRatio = typeof window !== 'undefined'
                ? Math.min(Math.max(window.devicePixelRatio || 1, 1), 2)
                : 1;
            const layout = drawTextCardToCanvas(canvas, nextCard, {
                pixelRatio: previewRatio,
                avatarImage: nextAvatarImage,
            });
            if (seq !== renderSeqRef.current || !mountedRef.current) return;
            setMetrics({
                logicalWidth: layout.logicalWidth,
                logicalHeight: layout.logicalHeight,
                exportWidth: Math.round(layout.logicalWidth * TEXT_CARD_PIXEL_RATIO),
                exportHeight: Math.round(layout.logicalHeight * TEXT_CARD_PIXEL_RATIO),
            });
        } catch {
            if (seq === renderSeqRef.current && mountedRef.current) {
                setMetrics(null);
            }
        }
    }, []);

    const debouncedPaint = useMemo(() => debounce(paintPreview, 120), [paintPreview]);

    useEffect(() => {
        mountedRef.current = true;
        const canvasNode = canvasRef.current;
        return () => {
            mountedRef.current = false;
            debouncedPaint.cancel();
            if (canvasNode) {
                canvasNode.width = 0;
                canvasNode.height = 0;
            }
        };
    }, [debouncedPaint]);

    useEffect(() => {
        if (!hasPaintedRef.current) {
            hasPaintedRef.current = true;
            paintPreview(card, avatarImage);
            return;
        }
        debouncedPaint(card, avatarImage);
    }, [avatarImage, card, debouncedPaint, paintPreview]);

    const handleAvatarChange = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        try {
            const dataUrl = await compressAvatarFileToDataUrl(file);
            if (!mountedRef.current) return;
            updateCard({ avatarDataUrl: dataUrl });
        } catch {
            stores.editor.message?.error?.(t("头像处理失败，请选择有效图片"));
        }
    };

    const updateChangelogItem = (index, patch) => {
        setCard((previous) => {
            const items = previous.changelogItems.map((item, idx) => (idx === index ? { ...item, ...patch } : item));
            return { ...previous, changelogItems: items };
        });
    };

    const addChangelogItem = () => {
        setCard((previous) => {
            if (previous.changelogItems.length >= TEXT_CARD_MAX_CHANGELOG_ITEMS) return previous;
            return {
                ...previous,
                changelogItems: [...previous.changelogItems, { tag: 'new', text: '' }],
            };
        });
    };

    const removeChangelogItem = (index) => {
        setCard((previous) => ({
            ...previous,
            changelogItems: previous.changelogItems.filter((_, idx) => idx !== index),
        }));
    };

    const handleConfirm = useCallback(async () => {
        if (!canSubmit || submitting) return;
        setSubmitting(true);
        try {
            const normalized = normalizeTextCard(card);
            const rendered = await renderTextCardBlob(normalized, { pixelRatio: TEXT_CARD_PIXEL_RATIO });
            if (!mountedRef.current) return;
            const applied = await stores.commands.applyTextCard(rendered.blob, normalized, {
                mode: isEdit ? 'edit' : 'create',
                targetId,
            });
            if (applied && mountedRef.current) {
                onClose?.();
            }
        } catch {
            stores.editor.message?.error?.(t("文本卡片生成失败，请重试"));
        } finally {
            if (mountedRef.current) setSubmitting(false);
        }
    }, [canSubmit, card, isEdit, onClose, stores.commands, stores.editor.message, submitting, t, targetId]);

    const bodyInputId = `${baseId}-body`;
    const authorNameId = `${baseId}-author`;
    const handleId = `${baseId}-handle`;
    const verifiedId = `${baseId}-verified`;
    const timestampId = `${baseId}-timestamp`;
    const showMetricsId = `${baseId}-metrics`;
    const quoteAuthorId = `${baseId}-quote-author`;
    const quoteRoleId = `${baseId}-quote-role`;
    const changelogTitleId = `${baseId}-changelog-title`;
    const changelogVersionId = `${baseId}-changelog-version`;
    const changelogDateId = `${baseId}-changelog-date`;
    const themeSelectId = `${baseId}-theme`;
    const fontSizeId = `${baseId}-font-size`;
    const paddingId = `${baseId}-padding`;
    const cardWidthId = `${baseId}-card-width`;

    return (
        <Modal
            rootClassName="shoteasy-text-card-modal"
            zIndex={1100}
            width={940}
            transitionName={NO_CSS_TRANSITION_NAME}
            maskTransitionName={NO_CSS_TRANSITION_NAME}
            title={isEdit ? t("编辑文本卡片") : t("新建文本卡片")}
            open
            onOk={handleConfirm}
            onCancel={submitting ? undefined : onClose}
            closable={!submitting}
            maskClosable={!submitting}
            keyboard={!submitting}
            okText={isEdit ? t("更新卡片") : t("生成卡片")}
            cancelText={t("取消")}
            confirmLoading={submitting}
            okButtonProps={{ disabled: !canSubmit || submitting }}
            cancelButtonProps={{ disabled: submitting }}
            destroyOnHidden
        >
            <div className="shoteasy-text-card-shell" data-mode={stores.editor.isDark ? 'dark' : 'light'}>
                <div className="shoteasy-text-card-controls">
                    <div className="shoteasy-text-card-field shoteasy-text-card-field--full">
                        <span className="shoteasy-text-card-label">{t("卡片类型")}</span>
                        <Segmented
                            size="small"
                            block
                            value={card.kind}
                            options={kindOptions}
                            onChange={(value) => updateCard({ kind: value })}
                            aria-label={t("卡片类型")}
                        />
                    </div>

                    {card.kind === 'social' && (
                        <>
                            <div className="shoteasy-text-card-grid">
                                <div className="shoteasy-text-card-field">
                                    <label htmlFor={authorNameId} className="shoteasy-text-card-label">{t("作者名称")}</label>
                                    <Input
                                        id={authorNameId}
                                        size="small"
                                        maxLength={80}
                                        value={card.authorName}
                                        data-testid="text-card-author"
                                        onChange={(event) => updateCard({ authorName: event.target.value })}
                                    />
                                </div>
                                <div className="shoteasy-text-card-field">
                                    <label htmlFor={handleId} className="shoteasy-text-card-label">{t("账号标识")}</label>
                                    <Input
                                        id={handleId}
                                        size="small"
                                        maxLength={60}
                                        value={card.authorHandle}
                                        placeholder="@screenhello"
                                        data-testid="text-card-handle"
                                        onChange={(event) => updateCard({ authorHandle: event.target.value })}
                                    />
                                </div>
                                <div className="shoteasy-text-card-field">
                                    <span className="shoteasy-text-card-label">{t("平台样式")}</span>
                                    <Segmented
                                        size="small"
                                        block
                                        value={card.platform}
                                        options={platformOptions}
                                        onChange={(value) => updateCard({ platform: value })}
                                        aria-label={t("平台样式")}
                                    />
                                </div>
                                <div className="shoteasy-text-card-field shoteasy-text-card-field--switch">
                                    <label htmlFor={verifiedId} className="shoteasy-text-card-label">{t("认证徽标")}</label>
                                    <Switch
                                        id={verifiedId}
                                        size="small"
                                        checked={card.verified}
                                        onChange={(checked) => updateCard({ verified: checked })}
                                    />
                                </div>
                            </div>

                            <div className="shoteasy-text-card-avatar-row">
                                <input
                                    ref={avatarInputRef}
                                    type="file"
                                    hidden
                                    accept={supportImg.join(',')}
                                    onChange={handleAvatarChange}
                                    data-testid="text-card-avatar-input"
                                />
                                <Button size="small" onClick={() => avatarInputRef.current?.click()}>
                                    {card.avatarDataUrl ? t("更换头像") : t("上传头像")}
                                </Button>
                                {card.avatarDataUrl && (
                                    <Button size="small" onClick={() => updateCard({ avatarDataUrl: null })}>
                                        {t("清除头像")}
                                    </Button>
                                )}
                                <span className="shoteasy-text-card-hint">{t("本地压缩保存，不上传网络")}</span>
                            </div>

                            <div className="shoteasy-text-card-field shoteasy-text-card-field--full">
                                <label htmlFor={bodyInputId} className="shoteasy-text-card-label">{t("正文内容")}</label>
                                <textarea
                                    id={bodyInputId}
                                    className="shoteasy-text-card-textarea"
                                    data-testid="text-card-body"
                                    value={card.body}
                                    onChange={(event) => updateCard({ body: event.target.value })}
                                />
                            </div>

                            <div className="shoteasy-text-card-grid">
                                <div className="shoteasy-text-card-field">
                                    <label htmlFor={timestampId} className="shoteasy-text-card-label">{t("时间标注")}</label>
                                    <Input
                                        id={timestampId}
                                        size="small"
                                        maxLength={60}
                                        value={card.timestamp}
                                        onChange={(event) => updateCard({ timestamp: event.target.value })}
                                    />
                                </div>
                                <div className="shoteasy-text-card-field shoteasy-text-card-field--switch">
                                    <label htmlFor={showMetricsId} className="shoteasy-text-card-label">{t("显示互动数")}</label>
                                    <Switch
                                        id={showMetricsId}
                                        size="small"
                                        checked={card.showMetrics}
                                        onChange={(checked) => updateCard({ showMetrics: checked })}
                                    />
                                </div>
                            </div>
                        </>
                    )}

                    {card.kind === 'quote' && (
                        <>
                            <div className="shoteasy-text-card-field shoteasy-text-card-field--full">
                                <label htmlFor={bodyInputId} className="shoteasy-text-card-label">{t("引文内容")}</label>
                                <textarea
                                    id={bodyInputId}
                                    className="shoteasy-text-card-textarea"
                                    data-testid="text-card-body"
                                    value={card.body}
                                    onChange={(event) => updateCard({ body: event.target.value })}
                                />
                            </div>
                            <div className="shoteasy-text-card-grid">
                                <div className="shoteasy-text-card-field">
                                    <label htmlFor={quoteAuthorId} className="shoteasy-text-card-label">{t("署名")}</label>
                                    <Input
                                        id={quoteAuthorId}
                                        size="small"
                                        maxLength={80}
                                        value={card.quoteAuthor}
                                        onChange={(event) => updateCard({ quoteAuthor: event.target.value })}
                                    />
                                </div>
                                <div className="shoteasy-text-card-field">
                                    <label htmlFor={quoteRoleId} className="shoteasy-text-card-label">{t("出处 / 头衔")}</label>
                                    <Input
                                        id={quoteRoleId}
                                        size="small"
                                        maxLength={100}
                                        value={card.quoteRole}
                                        onChange={(event) => updateCard({ quoteRole: event.target.value })}
                                    />
                                </div>
                            </div>
                        </>
                    )}

                    {card.kind === 'changelog' && (
                        <>
                            <div className="shoteasy-text-card-grid">
                                <div className="shoteasy-text-card-field shoteasy-text-card-field--full">
                                    <label htmlFor={changelogTitleId} className="shoteasy-text-card-label">{t("更新标题")}</label>
                                    <Input
                                        id={changelogTitleId}
                                        size="small"
                                        maxLength={100}
                                        value={card.changelogTitle}
                                        data-testid="text-card-changelog-title"
                                        onChange={(event) => updateCard({ changelogTitle: event.target.value })}
                                    />
                                </div>
                                <div className="shoteasy-text-card-field">
                                    <label htmlFor={changelogVersionId} className="shoteasy-text-card-label">{t("版本号")}</label>
                                    <Input
                                        id={changelogVersionId}
                                        size="small"
                                        maxLength={32}
                                        value={card.changelogVersion}
                                        onChange={(event) => updateCard({ changelogVersion: event.target.value })}
                                    />
                                </div>
                                <div className="shoteasy-text-card-field">
                                    <label htmlFor={changelogDateId} className="shoteasy-text-card-label">{t("发布日期")}</label>
                                    <Input
                                        id={changelogDateId}
                                        size="small"
                                        maxLength={40}
                                        value={card.changelogDate}
                                        onChange={(event) => updateCard({ changelogDate: event.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="shoteasy-text-card-changelog-list">
                                <div className="shoteasy-text-card-changelog-head">
                                    <span className="shoteasy-text-card-label">{t("更新条目")}</span>
                                    <Button
                                        size="small"
                                        disabled={card.changelogItems.length >= TEXT_CARD_MAX_CHANGELOG_ITEMS}
                                        onClick={addChangelogItem}
                                    >
                                        {t("添加条目")}
                                    </Button>
                                </div>
                                {card.changelogItems.map((item, idx) => (
                                    <div key={`cl-${idx}`} className="shoteasy-text-card-changelog-row">
                                        <Select
                                            size="small"
                                            value={item.tag}
                                            options={tagOptions}
                                            onChange={(value) => updateChangelogItem(idx, { tag: value })}
                                            style={{ width: 88 }}
                                            aria-label={t("条目标签")}
                                        />
                                        <Input
                                            size="small"
                                            maxLength={240}
                                            value={item.text}
                                            onChange={(event) => updateChangelogItem(idx, { text: event.target.value })}
                                            aria-label={t("条目内容")}
                                        />
                                        <Button
                                            size="small"
                                            disabled={card.changelogItems.length <= 1}
                                            onClick={() => removeChangelogItem(idx)}
                                            aria-label={t("删除条目")}
                                        >
                                            ×
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}

                    <div className="shoteasy-text-card-grid">
                        <div className="shoteasy-text-card-field">
                            <label htmlFor={themeSelectId} className="shoteasy-text-card-label">{t("配色主题")}</label>
                            <Select
                                id={themeSelectId}
                                size="small"
                                value={card.theme}
                                options={themeOptions}
                                onChange={(value) => updateCard({ theme: value })}
                                aria-label={t("配色主题")}
                                data-testid="text-card-theme"
                            />
                        </div>
                        <div className="shoteasy-text-card-field">
                            <label htmlFor={fontSizeId} className="shoteasy-text-card-label">{t("字号")}</label>
                            <InputNumber
                                id={fontSizeId}
                                size="small"
                                min={14}
                                max={26}
                                value={card.fontSize}
                                onChange={(value) => {
                                    if (typeof value === 'number' && Number.isFinite(value)) {
                                        updateCard({ fontSize: value });
                                    }
                                }}
                                style={{ width: '100%' }}
                            />
                        </div>
                        <div className="shoteasy-text-card-field">
                            <label htmlFor={paddingId} className="shoteasy-text-card-label">{t("内边距")}</label>
                            <InputNumber
                                id={paddingId}
                                size="small"
                                min={20}
                                max={64}
                                value={card.padding}
                                onChange={(value) => {
                                    if (typeof value === 'number' && Number.isFinite(value)) {
                                        updateCard({ padding: value });
                                    }
                                }}
                                style={{ width: '100%' }}
                            />
                        </div>
                        <div className="shoteasy-text-card-field">
                            <label htmlFor={cardWidthId} className="shoteasy-text-card-label">{t("卡片宽度")}</label>
                            <InputNumber
                                id={cardWidthId}
                                size="small"
                                min={420}
                                max={1080}
                                step={20}
                                value={card.cardWidth}
                                onChange={(value) => {
                                    if (typeof value === 'number' && Number.isFinite(value)) {
                                        updateCard({ cardWidth: value });
                                    }
                                }}
                                style={{ width: '100%' }}
                            />
                        </div>
                    </div>
                </div>

                <div className="shoteasy-text-card-preview-pane">
                    <div className="shoteasy-text-card-preview-head">
                        <span className="shoteasy-text-card-label">{t("实时预览")}</span>
                        <span className="shoteasy-text-card-preview-meta" data-testid="text-card-meta">
                            {metrics && (
                                <span>{metrics.exportWidth} × {metrics.exportHeight} px</span>
                            )}
                        </span>
                    </div>
                    <div className="shoteasy-text-card-preview-stage" data-testid="text-card-preview-stage">
                        <canvas
                            ref={canvasRef}
                            className="shoteasy-text-card-preview-canvas"
                            data-testid="text-card-preview-canvas"
                            aria-label={t("文本卡片预览")}
                            hidden={!canSubmit}
                        />
                        {!canSubmit && (
                            <p className="shoteasy-text-card-empty" role="status">
                                {t("输入正文或更新条目以预览卡片")}
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </Modal>
    );
});
