import useI18n from '../../i18n/useI18n';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Input, InputNumber, Modal, Segmented, Select, Switch } from 'antd';
import { NO_CSS_TRANSITION_NAME } from '@components/overlayMotion';
import useStores from '@stores/useStores';
import {
    CODE_CARD_PIXEL_RATIO,
    CODE_LANGUAGES,
    CODE_THEMES,
    DEFAULT_CODE_CARD,
    hasRenderableCode,
    normalizeCodeCard,
} from '@utils/codeCardSchema';
import { drawCodeCardToCanvas, renderCodeCardBlob } from '@utils/codeCardRenderer';
import { debounce } from '@utils/timing';

const LANGUAGE_DISPLAY_NAMES = Object.freeze({
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    jsx: 'JSX / TSX',
    python: 'Python',
    rust: 'Rust',
    go: 'Go',
    html: 'HTML',
    css: 'CSS',
    json: 'JSON',
    sql: 'SQL',
    bash: 'Bash / Shell',
    java: 'Java',
    cpp: 'C / C++',
});

const THEME_DISPLAY_NAMES = Object.freeze({
    'one-dark': 'One Dark',
    'github-light': 'GitHub Light',
    dracula: 'Dracula',
    'tokyo-night': 'Tokyo Night',
    nord: 'Nord',
    monokai: 'Monokai',
});

export default observer(function CodeCardDialog({ mode = 'create', targetId = null, initialCard = null, onClose }) {
    const t = useI18n();
    const stores = useStores();
    const baseId = useId();
    const isEdit = mode === 'edit';

    const [card, setCard] = useState(() => normalizeCodeCard(initialCard || DEFAULT_CODE_CARD));
    const [metrics, setMetrics] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    const canvasRef = useRef(null);
    const textareaRef = useRef(null);
    const renderSeqRef = useRef(0);
    const hasPaintedRef = useRef(false);
    const mountedRef = useRef(true);

    const canSubmit = hasRenderableCode(card.code);
    const inputTruncated = useMemo(() => {
        const canonicalRaw = String(card.code ?? '').replace(/\r\n?/g, '\n');
        return canonicalRaw !== normalizeCodeCard({ code: canonicalRaw }).code;
    }, [card.code]);

    const updateCard = useCallback((patch) => {
        setCard((previous) => ({ ...previous, ...patch }));
    }, []);

    const formatLanguageLabel = useCallback((langId) => {
        if (langId === 'auto') return t("自动识别");
        if (langId === 'plaintext') return t("纯文本");
        return LANGUAGE_DISPLAY_NAMES[langId] || langId;
    }, [t]);

    const languageOptions = useMemo(() => (
        CODE_LANGUAGES.map((langId) => ({
            value: langId,
            label: formatLanguageLabel(langId),
        }))
    ), [formatLanguageLabel]);

    const themeOptions = useMemo(() => (
        CODE_THEMES.map((themeId) => ({
            value: themeId,
            label: THEME_DISPLAY_NAMES[themeId] || themeId,
        }))
    ), []);

    const windowStyleOptions = useMemo(() => ([
        { value: 'mac', label: t("macOS 窗口") },
        { value: 'minimal', label: t("极简标题栏") },
        { value: 'none', label: t("无标题栏") },
    ]), [t]);

    const paintPreview = useCallback((nextCard) => {
        const seq = renderSeqRef.current + 1;
        renderSeqRef.current = seq;
        const canvas = canvasRef.current;
        if (!canvas) return;
        if (!hasRenderableCode(nextCard.code)) {
            canvas.width = 0;
            canvas.height = 0;
            setMetrics(null);
            return;
        }
        try {
            const previewRatio = typeof window !== 'undefined'
                ? Math.min(Math.max(window.devicePixelRatio || 1, 1), 2)
                : 1;
            const layout = drawCodeCardToCanvas(canvas, nextCard, { pixelRatio: previewRatio });
            if (seq !== renderSeqRef.current || !mountedRef.current) return;
            setMetrics({
                logicalWidth: layout.logicalWidth,
                logicalHeight: layout.logicalHeight,
                exportWidth: Math.round(layout.logicalWidth * CODE_CARD_PIXEL_RATIO),
                exportHeight: Math.round(layout.logicalHeight * CODE_CARD_PIXEL_RATIO),
                resolvedLanguage: layout.resolvedLanguage,
                truncatedLines: layout.truncatedLines,
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
            paintPreview(card);
            return;
        }
        debouncedPaint(card);
    }, [card, debouncedPaint, paintPreview]);

    const handleInsertIndent = useCallback(() => {
        const el = textareaRef.current;
        const indent = ' '.repeat(card.tabSize === 4 ? 4 : 2);
        if (!el) {
            updateCard({ code: `${card.code}${indent}` });
            return;
        }
        const start = el.selectionStart ?? card.code.length;
        const end = el.selectionEnd ?? start;
        const nextCode = `${card.code.slice(0, start)}${indent}${card.code.slice(end)}`;
        updateCard({ code: nextCode });
        const nextCaret = start + indent.length;
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => {
                if (textareaRef.current) {
                    textareaRef.current.focus();
                    textareaRef.current.setSelectionRange(nextCaret, nextCaret);
                }
            });
        }
    }, [card.code, card.tabSize, updateCard]);

    const handleConfirm = useCallback(async () => {
        if (!canSubmit || submitting) return;
        setSubmitting(true);
        try {
            const normalized = normalizeCodeCard(card);
            const rendered = await renderCodeCardBlob(normalized, { pixelRatio: CODE_CARD_PIXEL_RATIO });
            if (!mountedRef.current) return;
            const applied = await stores.commands.applyCodeCard(rendered.blob, normalized, {
                mode: isEdit ? 'edit' : 'create',
                targetId,
            });
            if (applied && mountedRef.current) {
                onClose?.();
            }
        } catch {
            stores.editor.message?.error?.(t("代码卡片生成失败，请重试"));
        } finally {
            if (mountedRef.current) setSubmitting(false);
        }
    }, [canSubmit, card, isEdit, onClose, stores.commands, stores.editor.message, submitting, t, targetId]);

    const codeInputId = `${baseId}-code`;
    const titleInputId = `${baseId}-title`;
    const languageSelectId = `${baseId}-language`;
    const themeSelectId = `${baseId}-theme`;
    const fontSizeId = `${baseId}-font-size`;
    const paddingId = `${baseId}-padding`;
    const cardWidthId = `${baseId}-card-width`;
    const lineNumbersId = `${baseId}-line-numbers`;
    const highlightLinesId = `${baseId}-highlight-lines`;
    const diffModeId = `${baseId}-diff-mode`;

    const resolvedLangLabel = metrics?.resolvedLanguage
        ? formatLanguageLabel(metrics.resolvedLanguage)
        : formatLanguageLabel(card.language);

    return (
        <Modal
            rootClassName="shoteasy-code-card-modal"
            zIndex={1100}
            width={920}
            transitionName={NO_CSS_TRANSITION_NAME}
            maskTransitionName={NO_CSS_TRANSITION_NAME}
            title={isEdit ? t("编辑代码卡片") : t("新建代码卡片")}
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
            <div className="shoteasy-code-card-shell" data-mode={stores.editor.isDark ? 'dark' : 'light'}>
                <div className="shoteasy-code-card-controls">
                    <div className="shoteasy-code-card-editor-head">
                        <label htmlFor={codeInputId} className="shoteasy-code-card-label">
                            {t("代码内容")}
                        </label>
                        <div className="shoteasy-code-card-editor-actions">
                            <Button
                                size="small"
                                onClick={handleInsertIndent}
                                data-testid="code-card-indent"
                            >
                                {t("插入缩进")}
                            </Button>
                            <Button
                                size="small"
                                onClick={() => updateCard({ code: '' })}
                                disabled={!card.code}
                                data-testid="code-card-clear"
                            >
                                {t("清空")}
                            </Button>
                        </div>
                    </div>

                    <textarea
                        id={codeInputId}
                        ref={textareaRef}
                        className="shoteasy-code-card-textarea"
                        data-testid="code-card-textarea"
                        value={card.code}
                        onChange={(event) => updateCard({ code: event.target.value })}
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        style={{ tabSize: card.tabSize }}
                    />

                    <div className="shoteasy-code-card-grid">
                        <div className="shoteasy-code-card-field">
                            <label htmlFor={titleInputId} className="shoteasy-code-card-label">
                                {t("标题")}
                            </label>
                            <Input
                                id={titleInputId}
                                size="small"
                                maxLength={80}
                                value={card.title}
                                placeholder="snippet.ts"
                                data-testid="code-card-title"
                                onChange={(event) => updateCard({ title: event.target.value })}
                            />
                        </div>

                        <div className="shoteasy-code-card-field">
                            <label htmlFor={languageSelectId} className="shoteasy-code-card-label">
                                {t("编程语言")}
                            </label>
                            <Select
                                id={languageSelectId}
                                size="small"
                                value={card.language}
                                options={languageOptions}
                                onChange={(value) => updateCard({ language: value })}
                                aria-label={t("编程语言")}
                                data-testid="code-card-language"
                            />
                        </div>

                        <div className="shoteasy-code-card-field">
                            <label htmlFor={themeSelectId} className="shoteasy-code-card-label">
                                {t("配色主题")}
                            </label>
                            <Select
                                id={themeSelectId}
                                size="small"
                                value={card.theme}
                                options={themeOptions}
                                onChange={(value) => updateCard({ theme: value })}
                                aria-label={t("配色主题")}
                                data-testid="code-card-theme"
                            />
                        </div>

                        <div className="shoteasy-code-card-field">
                            <span className="shoteasy-code-card-label">{t("缩进空格")}</span>
                            <Segmented
                                size="small"
                                block
                                value={card.tabSize}
                                options={[
                                    { value: 2, label: '2' },
                                    { value: 4, label: '4' },
                                ]}
                                onChange={(value) => updateCard({ tabSize: Number(value) === 4 ? 4 : 2 })}
                                aria-label={t("缩进空格")}
                            />
                        </div>

                        <div className="shoteasy-code-card-field shoteasy-code-card-field--full">
                            <span className="shoteasy-code-card-label">{t("窗口样式")}</span>
                            <Segmented
                                size="small"
                                block
                                value={card.windowStyle}
                                options={windowStyleOptions}
                                onChange={(value) => updateCard({ windowStyle: value })}
                                aria-label={t("窗口样式")}
                            />
                        </div>

                        <div className="shoteasy-code-card-field">
                            <label htmlFor={fontSizeId} className="shoteasy-code-card-label">
                                {t("字号")}
                            </label>
                            <InputNumber
                                id={fontSizeId}
                                size="small"
                                min={12}
                                max={24}
                                value={card.fontSize}
                                onChange={(value) => {
                                    if (typeof value === 'number' && Number.isFinite(value)) {
                                        updateCard({ fontSize: value });
                                    }
                                }}
                                style={{ width: '100%' }}
                            />
                        </div>

                        <div className="shoteasy-code-card-field">
                            <label htmlFor={paddingId} className="shoteasy-code-card-label">
                                {t("内边距")}
                            </label>
                            <InputNumber
                                id={paddingId}
                                size="small"
                                min={16}
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

                        <div className="shoteasy-code-card-field">
                            <label htmlFor={cardWidthId} className="shoteasy-code-card-label">
                                {t("卡片宽度")}
                            </label>
                            <InputNumber
                                id={cardWidthId}
                                size="small"
                                min={420}
                                max={1200}
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

                        <div className="shoteasy-code-card-field shoteasy-code-card-field--switch">
                            <label htmlFor={lineNumbersId} className="shoteasy-code-card-label">
                                {t("显示行号")}
                            </label>
                            <Switch
                                id={lineNumbersId}
                                size="small"
                                checked={card.showLineNumbers}
                                onChange={(checked) => updateCard({ showLineNumbers: checked })}
                                data-testid="code-card-line-numbers"
                            />
                        </div>

                        <div className="shoteasy-code-card-field">
                            <label htmlFor={highlightLinesId} className="shoteasy-code-card-label">
                                {t("高亮行")}
                            </label>
                            <Input
                                id={highlightLinesId}
                                size="small"
                                maxLength={120}
                                value={card.highlightLines}
                                placeholder="1, 3-5"
                                data-testid="code-card-highlight-lines"
                                onChange={(event) => updateCard({ highlightLines: event.target.value })}
                            />
                        </div>

                        <div className="shoteasy-code-card-field shoteasy-code-card-field--switch">
                            <label htmlFor={diffModeId} className="shoteasy-code-card-label">
                                {t("Diff 高亮")}
                            </label>
                            <Switch
                                id={diffModeId}
                                size="small"
                                checked={card.diffMode}
                                onChange={(checked) => updateCard({ diffMode: checked })}
                                data-testid="code-card-diff-mode"
                            />
                        </div>
                    </div>
                </div>

                <div className="shoteasy-code-card-preview-pane">
                    <div className="shoteasy-code-card-preview-head">
                        <span className="shoteasy-code-card-label">{t("实时预览")}</span>
                        <span className="shoteasy-code-card-preview-meta" data-testid="code-card-meta">
                            <span>
                                {card.language === 'auto'
                                    ? t("自动识别 · {0}", { 0: resolvedLangLabel })
                                    : resolvedLangLabel}
                            </span>
                            {metrics && (
                                <span>
                                    {metrics.exportWidth} × {metrics.exportHeight} px
                                </span>
                            )}
                        </span>
                    </div>

                    <div className="shoteasy-code-card-preview-stage" data-testid="code-card-preview-stage">
                        <canvas
                            ref={canvasRef}
                            className="shoteasy-code-card-preview-canvas"
                            data-testid="code-card-preview-canvas"
                            aria-label={t("代码卡片预览")}
                            hidden={!canSubmit}
                        />
                        {!canSubmit && (
                            <p className="shoteasy-code-card-empty" role="status">
                                {t("输入或粘贴代码以预览卡片")}
                            </p>
                        )}
                    </div>

                    {inputTruncated && (
                        <p className="shoteasy-code-card-notice" role="status">
                            {t("代码超出保存上限（200 行 / 24 KB），超出部分将在生成时自动截断")}
                        </p>
                    )}

                    {metrics?.truncatedLines > 0 && (
                        <p className="shoteasy-code-card-notice" role="status">
                            {t("已超出最大高度，末尾 {0} 行已折叠", { 0: metrics.truncatedLines })}
                        </p>
                    )}
                </div>
            </div>
        </Modal>
    );
});
