import {
    CODE_CARD_MAX_EXPORT_PIXELS,
    CODE_CARD_MAX_LOGICAL_HEIGHT,
    CODE_CARD_PIXEL_RATIO,
    normalizeCodeCard,
    parseHighlightLines,
} from '@utils/codeCardSchema';
import { getCodeThemePalette, tokenizeCode } from '@utils/codeHighlighter';

export const CODE_CARD_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
const CARD_BORDER_RADIUS = 16;

const expandTabs = (text, tabSize) => (
    text.includes('\t') ? text.replace(/\t/g, ' '.repeat(tabSize)) : text
);

const wrapLineTokens = (tokens, maxWidth, measureText, tabSize) => {
    const wrapped = [];
    let current = [];
    let currentWidth = 0;

    const pushRow = () => {
        wrapped.push(current);
        current = [];
        currentWidth = 0;
    };

    const appendPiece = (type, value, width) => {
        const last = current[current.length - 1];
        if (last && last.type === type) {
            last.value += value;
            last.width += width;
        } else {
            current.push({ type, value, width });
        }
        currentWidth += width;
    };

    for (const token of tokens) {
        const text = expandTabs(token.value, tabSize);
        if (!text) continue;
        const fullWidth = measureText(text);
        if (currentWidth + fullWidth <= maxWidth || (current.length === 0 && fullWidth <= maxWidth)) {
            appendPiece(token.type, text, fullWidth);
            continue;
        }
        // Split token into characters/graphemes safely when it overflows available line width.
        let chunk = '';
        let chunkWidth = 0;
        for (const char of text) {
            const charWidth = measureText(char);
            if (currentWidth + chunkWidth + charWidth > maxWidth && (current.length > 0 || chunk.length > 0)) {
                if (chunk) {
                    appendPiece(token.type, chunk, chunkWidth);
                    chunk = '';
                    chunkWidth = 0;
                }
                pushRow();
            }
            chunk += char;
            chunkWidth += charWidth;
        }
        if (chunk) appendPiece(token.type, chunk, chunkWidth);
    }

    if (current.length > 0 || wrapped.length === 0) {
        wrapped.push(current);
    }
    return wrapped;
};

export function layoutCodeCard(measureText, rawCard, { pixelRatio = CODE_CARD_PIXEL_RATIO } = {}) {
    const card = normalizeCodeCard(rawCard);
    const palette = getCodeThemePalette(card.theme);
    const { resolvedLanguage, lines } = tokenizeCode(card.code, card.language);

    const headerHeight = card.windowStyle === 'none'
        ? 0
        : card.windowStyle === 'minimal'
            ? (card.title ? 40 : 0)
            : 44;

    const linePx = Math.round(card.fontSize * card.lineHeight * 10) / 10;
    const digits = Math.max(2, String(lines.length).length);
    const digitWidth = Math.max(card.fontSize * 0.62, measureText('0'));
    const gutterWidth = card.showLineNumbers ? Math.ceil(digits * digitWidth + 24) : 0;
    const contentWidth = Math.max(160, card.cardWidth - card.padding * 2 - gutterWidth);

    const rawSourceLines = card.code.split('\n');
    const highlightedSet = parseHighlightLines(card.highlightLines, lines.length);
    const hasHighlightFocus = highlightedSet.size > 0;

    const visualRows = [];
    for (let index = 0; index < lines.length; index += 1) {
        const lineNo = index + 1;
        const sourceLine = rawSourceLines[index] ?? '';
        let diffKind = null;
        if (card.diffMode) {
            if (sourceLine.startsWith('+') && !sourceLine.startsWith('+++')) diffKind = 'add';
            else if (sourceLine.startsWith('-') && !sourceLine.startsWith('---')) diffKind = 'remove';
        }
        const highlighted = highlightedSet.has(lineNo);
        const subRows = wrapLineTokens(lines[index], contentWidth, measureText, card.tabSize);
        for (let subIndex = 0; subIndex < subRows.length; subIndex += 1) {
            visualRows.push({
                lineNumber: subIndex === 0 ? lineNo : null,
                sourceLineNumber: lineNo,
                highlighted,
                diffKind,
                tokens: subRows[subIndex],
            });
        }
    }

    const logicalWidth = card.cardWidth;
    const safeRatio = Math.max(1, Math.min(2, Number(pixelRatio) || CODE_CARD_PIXEL_RATIO));
    const budgetRatio = Math.max(safeRatio, CODE_CARD_PIXEL_RATIO);
    const maxLogicalHeightByPixels = Math.floor(
        CODE_CARD_MAX_EXPORT_PIXELS / (logicalWidth * budgetRatio * budgetRatio),
    );
    const chromeHeight = headerHeight + card.padding * 2;
    const effectiveMaxLogicalHeight = Math.max(
        chromeHeight + Math.ceil(linePx),
        Math.min(CODE_CARD_MAX_LOGICAL_HEIGHT, maxLogicalHeightByPixels),
    );
    const maxVisualRows = Math.max(1, Math.floor((effectiveMaxLogicalHeight - chromeHeight) / linePx));
    let truncatedLines = 0;
    let renderedRows = visualRows;

    if (visualRows.length > maxVisualRows) {
        const keepCount = Math.max(1, maxVisualRows - 1);
        truncatedLines = visualRows.length - keepCount;
        renderedRows = visualRows.slice(0, keepCount);
        renderedRows.push({
            lineNumber: null,
            isTruncationNotice: true,
            tokens: [{
                type: 'comment',
                value: `… (+${truncatedLines} more lines)`,
                width: 0,
            }],
        });
    }

    const logicalHeight = Math.min(
        effectiveMaxLogicalHeight,
        Math.max(120, Math.ceil(chromeHeight + renderedRows.length * linePx)),
    );

    return {
        card,
        palette,
        resolvedLanguage,
        headerHeight,
        gutterWidth,
        contentWidth,
        linePx,
        totalLines: lines.length,
        hasHighlightFocus,
        renderedRows,
        truncatedLines,
        logicalWidth,
        logicalHeight,
        pixelRatio: safeRatio,
        pixelWidth: Math.round(logicalWidth * safeRatio),
        pixelHeight: Math.round(logicalHeight * safeRatio),
    };
}

const traceRoundedRect = (ctx, x, y, width, height, radius) => {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
};

export function drawCodeCardToCanvas(canvas, rawCard, { pixelRatio = CODE_CARD_PIXEL_RATIO } = {}) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw Object.assign(new Error('code-card-context-unavailable'), { code: 'code-card-context-unavailable' });
    }
    const card = normalizeCodeCard(rawCard);
    const codeFont = `${card.fontSize}px ${CODE_CARD_FONT_FAMILY}`;
    ctx.font = codeFont;
    const layout = layoutCodeCard((text) => ctx.measureText(text).width, card, { pixelRatio });

    if (layout.pixelWidth * layout.pixelHeight > CODE_CARD_MAX_EXPORT_PIXELS) {
        throw Object.assign(new Error('code-card-pixel-budget-exceeded'), { code: 'code-card-pixel-budget-exceeded' });
    }

    canvas.width = layout.pixelWidth;
    canvas.height = layout.pixelHeight;

    ctx.save();
    ctx.scale(layout.pixelRatio, layout.pixelRatio);
    ctx.clearRect(0, 0, layout.logicalWidth, layout.logicalHeight);

    // Clip card shape and fill base surface.
    traceRoundedRect(ctx, 0.5, 0.5, layout.logicalWidth - 1, layout.logicalHeight - 1, CARD_BORDER_RADIUS);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = layout.palette.background;
    ctx.fillRect(0, 0, layout.logicalWidth, layout.logicalHeight);

    // Header chrome
    if (layout.headerHeight > 0) {
        ctx.fillStyle = layout.palette.headerBg;
        ctx.fillRect(0, 0, layout.logicalWidth, layout.headerHeight);

        ctx.fillStyle = layout.palette.divider;
        ctx.fillRect(0, layout.headerHeight - 1, layout.logicalWidth, 1);

        if (layout.card.windowStyle === 'mac') {
            const dots = ['#ff5f56', '#ffbd2e', '#27c93f'];
            const dotY = layout.headerHeight / 2;
            dots.forEach((color, idx) => {
                ctx.beginPath();
                ctx.arc(22 + idx * 20, dotY, 6, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
            });
        }

        if (layout.card.title) {
            ctx.font = `500 13px Inter, ui-sans-serif, system-ui, -apple-system, sans-serif`;
            ctx.fillStyle = layout.palette.title;
            ctx.textBaseline = 'middle';
            ctx.textAlign = layout.card.windowStyle === 'mac' ? 'center' : 'left';
            const titleX = layout.card.windowStyle === 'mac' ? layout.logicalWidth / 2 : 20;
            const maxTitleWidth = layout.logicalWidth - (layout.card.windowStyle === 'mac' ? 160 : 40);
            ctx.fillText(layout.card.title, titleX, layout.headerHeight / 2, Math.max(80, maxTitleWidth));
        }
    }

    // Optional gutter separator
    if (layout.card.showLineNumbers) {
        const dividerX = layout.card.padding + layout.gutterWidth - 12;
        ctx.fillStyle = layout.palette.divider;
        ctx.fillRect(dividerX, layout.headerHeight + layout.card.padding - 4, 1, layout.logicalHeight - layout.headerHeight - layout.card.padding * 2 + 8);
    }

    // Render syntax-highlighted code lines
    ctx.font = codeFont;
    ctx.textBaseline = 'middle';
    const startY = layout.headerHeight + layout.card.padding;
    const codeStartX = layout.card.padding + layout.gutterWidth;
    const gutterRightX = layout.card.padding + layout.gutterWidth - 20;

    const isLightTheme = layout.card.theme === 'github-light';
    const highlightBandBg = isLightTheme ? 'rgba(37, 99, 235, 0.10)' : 'rgba(91, 157, 255, 0.16)';
    const highlightBarColor = isLightTheme ? '#2563eb' : '#60a5fa';
    const diffAddBg = isLightTheme ? 'rgba(22, 163, 74, 0.13)' : 'rgba(34, 197, 94, 0.18)';
    const diffAddBar = isLightTheme ? '#16a34a' : '#4ade80';
    const diffRemoveBg = isLightTheme ? 'rgba(220, 38, 38, 0.13)' : 'rgba(248, 113, 113, 0.18)';
    const diffRemoveBar = isLightTheme ? '#dc2626' : '#f87171';

    layout.renderedRows.forEach((row, rowIndex) => {
        const rowTop = startY + rowIndex * layout.linePx;
        const y = rowTop + layout.linePx / 2;

        if (row.diffKind === 'add') {
            ctx.fillStyle = diffAddBg;
            ctx.fillRect(0, rowTop, layout.logicalWidth, layout.linePx);
            ctx.fillStyle = diffAddBar;
            ctx.fillRect(0, rowTop, 4, layout.linePx);
        } else if (row.diffKind === 'remove') {
            ctx.fillStyle = diffRemoveBg;
            ctx.fillRect(0, rowTop, layout.logicalWidth, layout.linePx);
            ctx.fillStyle = diffRemoveBar;
            ctx.fillRect(0, rowTop, 4, layout.linePx);
        } else if (row.highlighted) {
            ctx.fillStyle = highlightBandBg;
            ctx.fillRect(0, rowTop, layout.logicalWidth, layout.linePx);
            ctx.fillStyle = highlightBarColor;
            ctx.fillRect(0, rowTop, 4, layout.linePx);
        }

        const shouldDim = layout.hasHighlightFocus && !row.highlighted && !row.diffKind && !row.isTruncationNotice;
        ctx.save();
        if (shouldDim) ctx.globalAlpha = 0.52;
        if (layout.card.showLineNumbers && row.lineNumber != null) {
            ctx.textAlign = 'right';
            ctx.fillStyle = layout.palette.lineNumber;
            ctx.fillText(String(row.lineNumber), gutterRightX, y);
        }
        ctx.textAlign = 'left';
        let cursorX = codeStartX;
        for (const token of row.tokens) {
            ctx.fillStyle = layout.palette.tokens[token.type] || layout.palette.tokens.plain;
            ctx.fillText(token.value, cursorX, y);
            cursorX += token.width || ctx.measureText(token.value).width;
        }
        ctx.restore();
    });

    ctx.restore();

    // Crisp outer border stroke
    traceRoundedRect(ctx, 0.5, 0.5, layout.logicalWidth - 1, layout.logicalHeight - 1, CARD_BORDER_RADIUS);
    ctx.strokeStyle = layout.palette.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
    return layout;
}

export async function renderCodeCardBlob(
    rawCard,
    {
        pixelRatio = CODE_CARD_PIXEL_RATIO,
        documentRef = typeof document !== 'undefined' ? document : null,
    } = {},
) {
    if (!documentRef) {
        throw Object.assign(new Error('code-card-document-unavailable'), { code: 'code-card-document-unavailable' });
    }
    const canvas = documentRef.createElement('canvas');
    try {
        const layout = drawCodeCardToCanvas(canvas, rawCard, { pixelRatio });
        const blob = await new Promise((resolve, reject) => {
            try {
                canvas.toBlob((result) => {
                    if (result) resolve(result);
                    else reject(Object.assign(new Error('code-card-encode-failed'), { code: 'code-card-encode-failed' }));
                }, 'image/png');
            } catch (error) {
                reject(error);
            }
        });
        return {
            blob,
            width: layout.pixelWidth,
            height: layout.pixelHeight,
            logicalWidth: layout.logicalWidth,
            logicalHeight: layout.logicalHeight,
            resolvedLanguage: layout.resolvedLanguage,
            totalLines: layout.totalLines,
            truncatedLines: layout.truncatedLines,
        };
    } finally {
        canvas.width = 0;
        canvas.height = 0;
    }
}
