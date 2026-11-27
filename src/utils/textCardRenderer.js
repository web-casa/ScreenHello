import { utf8ByteLength } from '@utils/codeCardSchema';
import {
    TEXT_CARD_AVATAR_MAX_BYTES,
    TEXT_CARD_MAX_EXPORT_PIXELS,
    TEXT_CARD_MAX_LOGICAL_HEIGHT,
    TEXT_CARD_PIXEL_RATIO,
    isValidAvatarDataUrl,
    normalizeTextCard,
} from '@utils/textCardSchema';

export const TEXT_CARD_FONT_FAMILY = 'Inter, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
export const TEXT_CARD_SERIF_FAMILY = '"Iowan Old Style", "Georgia", "Songti SC", "Noto Serif SC", serif';
export const TEXT_CARD_MONO_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

const CARD_RADIUS = 20;

export const TEXT_CARD_THEME_PALETTES = Object.freeze({
    'paper-light': Object.freeze({
        bg: '#ffffff',
        bgGradientEnd: '#f8fafc',
        border: 'rgba(15, 23, 42, 0.12)',
        ink: '#0f172a',
        muted: '#475569',
        subtle: '#64748b',
        divider: 'rgba(15, 23, 42, 0.10)',
        accent: '#2563eb',
        badgeBg: 'rgba(37, 99, 235, 0.10)',
        badgeInk: '#1d4ed8',
        avatarBg: '#2563eb',
        avatarInk: '#ffffff',
        tags: {
            new: { bg: 'rgba(37, 99, 235, 0.12)', ink: '#1d4ed8', label: 'NEW' },
            improved: { bg: 'rgba(16, 185, 129, 0.14)', ink: '#047857', label: 'IMPROVED' },
            fix: { bg: 'rgba(245, 158, 11, 0.16)', ink: '#b45309', label: 'FIX' },
        },
    }),
    'graphite-dark': Object.freeze({
        bg: '#14171f',
        bgGradientEnd: '#0f1218',
        border: 'rgba(255, 255, 255, 0.14)',
        ink: '#f8fafc',
        muted: '#cbd5e1',
        subtle: '#94a3b8',
        divider: 'rgba(255, 255, 255, 0.11)',
        accent: '#60a5fa',
        badgeBg: 'rgba(96, 165, 250, 0.16)',
        badgeInk: '#93c5fd',
        avatarBg: '#3b82f6',
        avatarInk: '#ffffff',
        tags: {
            new: { bg: 'rgba(96, 165, 250, 0.20)', ink: '#93c5fd', label: 'NEW' },
            improved: { bg: 'rgba(52, 211, 153, 0.18)', ink: '#6ee7b7', label: 'IMPROVED' },
            fix: { bg: 'rgba(251, 191, 36, 0.18)', ink: '#fcd34d', label: 'FIX' },
        },
    }),
    'glass-light': Object.freeze({
        bg: 'rgba(255, 255, 255, 0.90)',
        bgGradientEnd: 'rgba(241, 245, 249, 0.86)',
        border: 'rgba(255, 255, 255, 0.72)',
        ink: '#0f172a',
        muted: '#334155',
        subtle: '#64748b',
        divider: 'rgba(15, 23, 42, 0.10)',
        accent: '#4f46e5',
        badgeBg: 'rgba(79, 70, 229, 0.12)',
        badgeInk: '#4338ca',
        avatarBg: '#4f46e5',
        avatarInk: '#ffffff',
        tags: {
            new: { bg: 'rgba(79, 70, 229, 0.13)', ink: '#4338ca', label: 'NEW' },
            improved: { bg: 'rgba(13, 148, 136, 0.13)', ink: '#0f766e', label: 'IMPROVED' },
            fix: { bg: 'rgba(217, 119, 6, 0.15)', ink: '#b45309', label: 'FIX' },
        },
    }),
    'glass-dark': Object.freeze({
        bg: 'rgba(17, 24, 39, 0.88)',
        bgGradientEnd: 'rgba(15, 23, 42, 0.94)',
        border: 'rgba(255, 255, 255, 0.22)',
        ink: '#f8fafc',
        muted: '#cbd5e1',
        subtle: '#94a3b8',
        divider: 'rgba(255, 255, 255, 0.14)',
        accent: '#38bdf8',
        badgeBg: 'rgba(56, 189, 248, 0.18)',
        badgeInk: '#7dd3fc',
        avatarBg: '#0284c7',
        avatarInk: '#ffffff',
        tags: {
            new: { bg: 'rgba(56, 189, 248, 0.20)', ink: '#7dd3fc', label: 'NEW' },
            improved: { bg: 'rgba(52, 211, 153, 0.20)', ink: '#6ee7b7', label: 'IMPROVED' },
            fix: { bg: 'rgba(251, 191, 36, 0.20)', ink: '#fcd34d', label: 'FIX' },
        },
    }),
    'warm-editorial': Object.freeze({
        bg: '#fdf8f1',
        bgGradientEnd: '#f6ecdc',
        border: 'rgba(120, 53, 15, 0.16)',
        ink: '#292017',
        muted: '#5c4936',
        subtle: '#78624a',
        divider: 'rgba(120, 53, 15, 0.12)',
        accent: '#b45309',
        badgeBg: 'rgba(180, 83, 9, 0.12)',
        badgeInk: '#92400e',
        avatarBg: '#b45309',
        avatarInk: '#ffffff',
        tags: {
            new: { bg: 'rgba(180, 83, 9, 0.14)', ink: '#92400e', label: 'NEW' },
            improved: { bg: 'rgba(21, 128, 61, 0.14)', ink: '#166534', label: 'IMPROVED' },
            fix: { bg: 'rgba(185, 28, 28, 0.12)', ink: '#991b1b', label: 'FIX' },
        },
    }),
    twilight: Object.freeze({
        bg: '#1b1633',
        bgGradientEnd: '#10182b',
        border: 'rgba(196, 181, 253, 0.24)',
        ink: '#f8fafc',
        muted: '#ddd6fe',
        subtle: '#a5b4fc',
        divider: 'rgba(196, 181, 253, 0.18)',
        accent: '#a78bfa',
        badgeBg: 'rgba(167, 139, 250, 0.20)',
        badgeInk: '#ddd6fe',
        avatarBg: '#7c3aed',
        avatarInk: '#ffffff',
        tags: {
            new: { bg: 'rgba(167, 139, 250, 0.24)', ink: '#ddd6fe', label: 'NEW' },
            improved: { bg: 'rgba(45, 212, 191, 0.20)', ink: '#5eead4', label: 'IMPROVED' },
            fix: { bg: 'rgba(251, 146, 60, 0.22)', ink: '#fdba74', label: 'FIX' },
        },
    }),
});

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

const formatMetricCount = (value) => {
    const num = Math.max(0, Math.round(Number(value) || 0));
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
    return String(num);
};

export function wrapRichParagraphs(text, maxWidth, measureText) {
    const paragraphs = String(text || '').split('\n');
    const lines = [];
    for (let pIndex = 0; pIndex < paragraphs.length; pIndex += 1) {
        const para = paragraphs[pIndex];
        if (!para) {
            lines.push('');
            continue;
        }
        // Tokenize preserving spaces and breaking CJK characters cleanly.
        const tokens = para.match(/(\s+|[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]|[^\s\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+)/g) || [];
        let current = '';
        for (const token of tokens) {
            const candidate = current + token;
            if (!current || measureText(candidate) <= maxWidth) {
                current = candidate;
                continue;
            }
            if (current.trimEnd()) {
                lines.push(current.trimEnd());
            }
            const trimmedToken = token.trimStart();
            if (!trimmedToken) {
                current = '';
                continue;
            }
            if (measureText(trimmedToken) <= maxWidth) {
                current = trimmedToken;
                continue;
            }
            // Fallback character split for long unspaced URLs or tokens.
            let piece = '';
            for (const ch of trimmedToken) {
                if (piece && measureText(piece + ch) > maxWidth) {
                    lines.push(piece);
                    piece = ch;
                } else {
                    piece += ch;
                }
            }
            current = piece;
        }
        if (current || lines.length === 0) {
            lines.push(current.trimEnd());
        }
    }
    return lines;
}

export function layoutTextCard(measureText, rawCard, { pixelRatio = TEXT_CARD_PIXEL_RATIO } = {}) {
    const card = normalizeTextCard(rawCard);
    const palette = TEXT_CARD_THEME_PALETTES[card.theme] || TEXT_CARD_THEME_PALETTES['paper-light'];
    const logicalWidth = card.cardWidth;
    const contentWidth = Math.max(240, logicalWidth - card.padding * 2);
    const safeRatio = Math.max(1, Math.min(2, Number(pixelRatio) || TEXT_CARD_PIXEL_RATIO));
    const budgetRatio = Math.max(safeRatio, TEXT_CARD_PIXEL_RATIO);
    const maxLogicalHeightByPixels = Math.floor(
        TEXT_CARD_MAX_EXPORT_PIXELS / (logicalWidth * budgetRatio * budgetRatio),
    );
    const maxLogicalHeight = Math.max(240, Math.min(TEXT_CARD_MAX_LOGICAL_HEIGHT, maxLogicalHeightByPixels));

    if (card.kind === 'quote') {
        const quoteFontSize = Math.min(34, card.fontSize + 6);
        const linePx = Math.round(quoteFontSize * 1.55);
        const bodyLines = wrapRichParagraphs(card.body, contentWidth, (text) => measureText(text, `600 ${quoteFontSize}px ${TEXT_CARD_SERIF_FAMILY}`));
        const footerHeight = card.quoteAuthor || card.quoteRole ? 58 : 0;
        const headerDecorHeight = 46;
        const maxLines = Math.max(1, Math.floor((maxLogicalHeight - card.padding * 2 - headerDecorHeight - footerHeight) / linePx));
        const truncated = bodyLines.length > maxLines;
        const renderedLines = truncated ? [...bodyLines.slice(0, Math.max(1, maxLines - 1)), '…'] : bodyLines;
        const logicalHeight = Math.min(
            maxLogicalHeight,
            Math.max(200, Math.ceil(card.padding * 2 + headerDecorHeight + renderedLines.length * linePx + footerHeight)),
        );
        return {
            card,
            palette,
            contentWidth,
            quoteFontSize,
            linePx,
            bodyLines: renderedLines,
            truncated,
            logicalWidth,
            logicalHeight,
            pixelRatio: safeRatio,
            pixelWidth: Math.round(logicalWidth * safeRatio),
            pixelHeight: Math.round(logicalHeight * safeRatio),
        };
    }

    if (card.kind === 'changelog') {
        const titleFontSize = Math.min(30, card.fontSize + 6);
        const itemFontSize = Math.max(13, card.fontSize - 2);
        const itemLinePx = Math.round(itemFontSize * 1.55);
        const titleLines = wrapRichParagraphs(
            card.changelogTitle || 'Release Notes',
            contentWidth,
            (text) => measureText(text, `700 ${titleFontSize}px ${TEXT_CARD_FONT_FAMILY}`),
        );
        const titleLinePx = Math.round(titleFontSize * 1.32);
        const headerMetaHeight = (card.changelogVersion || card.changelogDate) ? 34 : 0;
        const headerHeight = headerMetaHeight + titleLines.length * titleLinePx + 20;
        const badgeSlotWidth = 92;
        const itemTextWidth = Math.max(150, contentWidth - badgeSlotWidth);
        const activeItems = card.changelogItems.filter((item) => item.text.trim().length > 0);
        const itemLayouts = activeItems.map((item) => {
            const lines = wrapRichParagraphs(
                item.text,
                itemTextWidth,
                (text) => measureText(text, `400 ${itemFontSize}px ${TEXT_CARD_FONT_FAMILY}`),
            );
            return {
                tag: item.tag,
                lines,
                height: Math.max(28, lines.length * itemLinePx) + 12,
            };
        });
        const itemsHeight = itemLayouts.reduce((sum, item) => sum + item.height, 0);
        const logicalHeight = Math.min(
            maxLogicalHeight,
            Math.max(200, Math.ceil(card.padding * 2 + headerHeight + Math.max(28, itemsHeight))),
        );
        return {
            card,
            palette,
            contentWidth,
            titleFontSize,
            titleLinePx,
            titleLines,
            headerMetaHeight,
            headerHeight,
            itemFontSize,
            itemLinePx,
            badgeSlotWidth,
            itemLayouts,
            logicalWidth,
            logicalHeight,
            pixelRatio: safeRatio,
            pixelWidth: Math.round(logicalWidth * safeRatio),
            pixelHeight: Math.round(logicalHeight * safeRatio),
        };
    }

    // Default: 'social' post card
    const linePx = Math.round(card.fontSize * 1.56);
    const bodyLines = wrapRichParagraphs(card.body, contentWidth, (text) => measureText(text, `400 ${card.fontSize}px ${TEXT_CARD_FONT_FAMILY}`));
    const headerHeight = 64;
    const timestampHeight = card.timestamp ? 34 : 10;
    const metricsHeight = card.showMetrics ? 44 : 0;
    const maxLines = Math.max(1, Math.floor((maxLogicalHeight - card.padding * 2 - headerHeight - timestampHeight - metricsHeight) / linePx));
    const truncated = bodyLines.length > maxLines;
    const renderedLines = truncated ? [...bodyLines.slice(0, Math.max(1, maxLines - 1)), '…'] : bodyLines;
    const logicalHeight = Math.min(
        maxLogicalHeight,
        Math.max(200, Math.ceil(card.padding * 2 + headerHeight + renderedLines.length * linePx + timestampHeight + metricsHeight)),
    );

    return {
        card,
        palette,
        contentWidth,
        linePx,
        headerHeight,
        timestampHeight,
        metricsHeight,
        bodyLines: renderedLines,
        truncated,
        logicalWidth,
        logicalHeight,
        pixelRatio: safeRatio,
        pixelWidth: Math.round(logicalWidth * safeRatio),
        pixelHeight: Math.round(logicalHeight * safeRatio),
    };
}

const drawVerifiedBadge = (ctx, cx, cy, accent) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 3.4, cy + 0.2);
    ctx.lineTo(cx - 0.8, cy + 2.8);
    ctx.lineTo(cx + 3.8, cy - 2.4);
    ctx.stroke();
    ctx.restore();
};

const drawPlatformMark = (ctx, platform, x, y, color) => {
    if (platform === 'minimal') return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    if (platform === 'x') {
        ctx.beginPath();
        ctx.moveTo(x - 7, y - 7);
        ctx.lineTo(x + 7, y + 7);
        ctx.moveTo(x + 7, y - 7);
        ctx.lineTo(x - 7, y + 7);
        ctx.stroke();
    } else if (platform === 'bluesky') {
        // Minimal butterfly silhouette
        ctx.beginPath();
        ctx.ellipse(x - 4.5, y - 2, 5.2, 3.6, -0.45, 0, Math.PI * 2);
        ctx.ellipse(x + 4.5, y - 2, 5.2, 3.6, 0.45, 0, Math.PI * 2);
        ctx.ellipse(x - 3.2, y + 3.8, 3.6, 2.4, 0.35, 0, Math.PI * 2);
        ctx.ellipse(x + 3.2, y + 3.8, 3.6, 2.4, -0.35, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
};

const drawAvatar = (ctx, cx, cy, radius, avatarImage, authorName, palette) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (avatarImage && avatarImage.width > 0 && avatarImage.height > 0) {
        const size = radius * 2;
        const scale = Math.max(size / avatarImage.width, size / avatarImage.height);
        const drawW = avatarImage.width * scale;
        const drawH = avatarImage.height * scale;
        ctx.drawImage(avatarImage, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
    } else {
        ctx.fillStyle = palette.avatarBg;
        ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
        const initial = (authorName || 'S').trim().charAt(0).toUpperCase() || 'S';
        ctx.fillStyle = palette.avatarInk;
        ctx.font = `700 ${Math.round(radius * 0.92)}px ${TEXT_CARD_FONT_FAMILY}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initial, cx, cy + 1);
    }
    ctx.restore();
};

export function drawTextCardToCanvas(
    canvas,
    rawCard,
    { pixelRatio = TEXT_CARD_PIXEL_RATIO, avatarImage = null } = {},
) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw Object.assign(new Error('text-card-context-unavailable'), { code: 'text-card-context-unavailable' });
    }
    const card = normalizeTextCard(rawCard);
    const measureText = (text, font) => {
        ctx.font = font;
        return ctx.measureText(text).width;
    };
    const layout = layoutTextCard(measureText, card, { pixelRatio });
    if (layout.pixelWidth * layout.pixelHeight > TEXT_CARD_MAX_EXPORT_PIXELS) {
        throw Object.assign(new Error('text-card-pixel-budget-exceeded'), { code: 'text-card-pixel-budget-exceeded' });
    }

    canvas.width = layout.pixelWidth;
    canvas.height = layout.pixelHeight;

    ctx.save();
    ctx.scale(layout.pixelRatio, layout.pixelRatio);
    ctx.clearRect(0, 0, layout.logicalWidth, layout.logicalHeight);

    traceRoundedRect(ctx, 0.5, 0.5, layout.logicalWidth - 1, layout.logicalHeight - 1, CARD_RADIUS);
    ctx.save();
    ctx.clip();

    const grad = ctx.createLinearGradient(0, 0, layout.logicalWidth, layout.logicalHeight);
    grad.addColorStop(0, layout.palette.bg);
    grad.addColorStop(1, layout.palette.bgGradientEnd);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, layout.logicalWidth, layout.logicalHeight);

    const pad = layout.card.padding;

    if (layout.card.kind === 'quote') {
        ctx.fillStyle = layout.palette.accent;
        ctx.font = `700 54px ${TEXT_CARD_SERIF_FAMILY}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.globalAlpha = 0.35;
        ctx.fillText('“', pad - 4, pad - 12);
        ctx.globalAlpha = 1;

        ctx.fillStyle = layout.palette.ink;
        ctx.font = `600 ${layout.quoteFontSize}px ${TEXT_CARD_SERIF_FAMILY}`;
        ctx.textBaseline = 'middle';
        let cursorY = pad + 42;
        for (const line of layout.bodyLines) {
            if (line) ctx.fillText(line, pad, cursorY + layout.linePx / 2);
            cursorY += layout.linePx;
        }

        if (layout.card.quoteAuthor || layout.card.quoteRole) {
            cursorY += 16;
            ctx.fillStyle = layout.palette.accent;
            ctx.fillRect(pad, cursorY, 36, 3);
            cursorY += 16;
            if (layout.card.quoteAuthor) {
                ctx.fillStyle = layout.palette.ink;
                ctx.font = `700 15px ${TEXT_CARD_FONT_FAMILY}`;
                ctx.textBaseline = 'top';
                ctx.fillText(layout.card.quoteAuthor, pad, cursorY);
                cursorY += 20;
            }
            if (layout.card.quoteRole) {
                ctx.fillStyle = layout.palette.subtle;
                ctx.font = `400 13px ${TEXT_CARD_FONT_FAMILY}`;
                ctx.textBaseline = 'top';
                ctx.fillText(layout.card.quoteRole, pad, cursorY);
            }
        }
    } else if (layout.card.kind === 'changelog') {
        let cursorY = pad;
        if (layout.card.changelogVersion || layout.card.changelogDate) {
            let metaX = pad;
            if (layout.card.changelogVersion) {
                ctx.font = `700 12px ${TEXT_CARD_MONO_FAMILY}`;
                const badgeText = layout.card.changelogVersion;
                const badgeWidth = Math.ceil(ctx.measureText(badgeText).width + 20);
                traceRoundedRect(ctx, metaX, cursorY, badgeWidth, 24, 12);
                ctx.fillStyle = layout.palette.badgeBg;
                ctx.fill();
                ctx.fillStyle = layout.palette.badgeInk;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(badgeText, metaX + badgeWidth / 2, cursorY + 12);
                metaX += badgeWidth + 12;
            }
            if (layout.card.changelogDate) {
                ctx.font = `500 13px ${TEXT_CARD_FONT_FAMILY}`;
                ctx.fillStyle = layout.palette.subtle;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(layout.card.changelogDate, metaX, cursorY + 12);
            }
            cursorY += layout.headerMetaHeight;
        }

        ctx.fillStyle = layout.palette.ink;
        ctx.font = `700 ${layout.titleFontSize}px ${TEXT_CARD_FONT_FAMILY}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (const line of layout.titleLines) {
            ctx.fillText(line, pad, cursorY + layout.titleLinePx / 2);
            cursorY += layout.titleLinePx;
        }

        cursorY += 8;
        ctx.fillStyle = layout.palette.divider;
        ctx.fillRect(pad, cursorY, layout.contentWidth, 1);
        cursorY += 14;

        for (const item of layout.itemLayouts) {
            const tagSpec = layout.palette.tags[item.tag] || layout.palette.tags.new;
            const pillW = 78;
            const pillH = 22;
            traceRoundedRect(ctx, pad, cursorY + 2, pillW, pillH, 6);
            ctx.fillStyle = tagSpec.bg;
            ctx.fill();
            ctx.fillStyle = tagSpec.ink;
            ctx.font = `700 10px ${TEXT_CARD_MONO_FAMILY}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(tagSpec.label, pad + pillW / 2, cursorY + 2 + pillH / 2);

            ctx.fillStyle = layout.palette.ink;
            ctx.font = `400 ${layout.itemFontSize}px ${TEXT_CARD_FONT_FAMILY}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            let lineY = cursorY;
            for (const line of item.lines) {
                ctx.fillText(line, pad + layout.badgeSlotWidth, lineY + layout.itemLinePx / 2);
                lineY += layout.itemLinePx;
            }
            cursorY += item.height;
        }
    } else {
        // Social card
        const avatarRadius = 23;
        const avatarCx = pad + avatarRadius;
        const avatarCy = pad + avatarRadius;
        drawAvatar(ctx, avatarCx, avatarCy, avatarRadius, avatarImage, layout.card.authorName, layout.palette);

        const nameX = pad + avatarRadius * 2 + 14;
        const authorName = layout.card.authorName || 'ScreenHello';
        ctx.font = `700 16px ${TEXT_CARD_FONT_FAMILY}`;
        ctx.fillStyle = layout.palette.ink;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(authorName, nameX, pad + 3, Math.max(100, layout.contentWidth - 110));

        if (layout.card.verified) {
            const measuredName = Math.min(ctx.measureText(authorName).width, Math.max(100, layout.contentWidth - 110));
            drawVerifiedBadge(ctx, nameX + measuredName + 14, pad + 12, layout.palette.accent);
        }

        if (layout.card.authorHandle) {
            ctx.font = `400 14px ${TEXT_CARD_FONT_FAMILY}`;
            ctx.fillStyle = layout.palette.subtle;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(layout.card.authorHandle, nameX, pad + 25, Math.max(100, layout.contentWidth - 110));
        }

        drawPlatformMark(ctx, layout.card.platform, layout.logicalWidth - pad - 12, pad + 18, layout.palette.subtle);

        let cursorY = pad + layout.headerHeight;
        ctx.font = `400 ${layout.card.fontSize}px ${TEXT_CARD_FONT_FAMILY}`;
        ctx.fillStyle = layout.palette.ink;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (const line of layout.bodyLines) {
            if (line) ctx.fillText(line, pad, cursorY + layout.linePx / 2);
            cursorY += layout.linePx;
        }

        if (layout.card.timestamp) {
            cursorY += 12;
            ctx.font = `400 13px ${TEXT_CARD_FONT_FAMILY}`;
            ctx.fillStyle = layout.palette.subtle;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(layout.card.timestamp, pad, cursorY);
            cursorY += 22;
        } else {
            cursorY += 10;
        }

        if (layout.card.showMetrics) {
            ctx.fillStyle = layout.palette.divider;
            ctx.fillRect(pad, cursorY, layout.contentWidth, 1);
            cursorY += 14;
            const metrics = [
                { label: 'Replies', value: formatMetricCount(layout.card.replies) },
                { label: 'Reposts', value: formatMetricCount(layout.card.reposts) },
                { label: 'Likes', value: formatMetricCount(layout.card.likes) },
            ];
            let metricX = pad;
            ctx.textBaseline = 'top';
            for (const item of metrics) {
                ctx.font = `700 14px ${TEXT_CARD_FONT_FAMILY}`;
                ctx.fillStyle = layout.palette.ink;
                ctx.fillText(item.value, metricX, cursorY);
                metricX += ctx.measureText(item.value).width + 5;
                ctx.font = `400 13px ${TEXT_CARD_FONT_FAMILY}`;
                ctx.fillStyle = layout.palette.subtle;
                ctx.fillText(item.label, metricX, cursorY + 1);
                metricX += ctx.measureText(item.label).width + 24;
            }
        }
    }

    ctx.restore();

    traceRoundedRect(ctx, 0.5, 0.5, layout.logicalWidth - 1, layout.logicalHeight - 1, CARD_RADIUS);
    ctx.strokeStyle = layout.palette.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
    return layout;
}

export async function loadAvatarImageElement(dataUrl) {
    if (!isValidAvatarDataUrl(dataUrl) || typeof Image === 'undefined') return null;
    return new Promise((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = dataUrl;
    });
}

export async function compressAvatarFileToDataUrl(
    file,
    { documentRef = typeof document !== 'undefined' ? document : null } = {},
) {
    if (!file || !documentRef) {
        throw Object.assign(new Error('avatar-unavailable'), { code: 'avatar-unavailable' });
    }
    let bitmap = null;
    let objectUrl = null;
    let source = null;
    try {
        if (typeof createImageBitmap === 'function') {
            bitmap = await createImageBitmap(file);
            source = bitmap;
        } else if (typeof URL !== 'undefined' && typeof Image !== 'undefined') {
            objectUrl = URL.createObjectURL(file);
            source = await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('avatar-decode-failed'));
                img.src = objectUrl;
            });
        }
        if (!source || !source.width || !source.height) {
            throw Object.assign(new Error('avatar-decode-failed'), { code: 'avatar-decode-failed' });
        }

        const attempts = [
            { size: 128, mime: 'image/webp', quality: 0.82 },
            { size: 128, mime: 'image/webp', quality: 0.65 },
            { size: 128, mime: 'image/jpeg', quality: 0.82 },
            { size: 128, mime: 'image/jpeg', quality: 0.62 },
            { size: 96, mime: 'image/jpeg', quality: 0.7 },
            { size: 64, mime: 'image/jpeg', quality: 0.65 },
        ];

        const canvas = documentRef.createElement('canvas');
        try {
            const ctx = canvas.getContext('2d');
            if (!ctx) throw Object.assign(new Error('avatar-context-unavailable'), { code: 'avatar-context-unavailable' });
            const side = Math.min(source.width, source.height);
            const sx = Math.floor((source.width - side) / 2);
            const sy = Math.floor((source.height - side) / 2);

            for (const attempt of attempts) {
                canvas.width = attempt.size;
                canvas.height = attempt.size;
                ctx.clearRect(0, 0, attempt.size, attempt.size);
                ctx.drawImage(source, sx, sy, side, side, 0, 0, attempt.size, attempt.size);
                const dataUrl = canvas.toDataURL(attempt.mime, attempt.quality);
                if (isValidAvatarDataUrl(dataUrl) && utf8ByteLength(dataUrl) <= TEXT_CARD_AVATAR_MAX_BYTES) {
                    return dataUrl;
                }
            }
            throw Object.assign(new Error('avatar-too-large'), { code: 'avatar-too-large' });
        } finally {
            canvas.width = 0;
            canvas.height = 0;
        }
    } finally {
        bitmap?.close?.();
        if (objectUrl && typeof URL !== 'undefined') URL.revokeObjectURL(objectUrl);
    }
}

export async function renderTextCardBlob(
    rawCard,
    {
        pixelRatio = TEXT_CARD_PIXEL_RATIO,
        documentRef = typeof document !== 'undefined' ? document : null,
    } = {},
) {
    if (!documentRef) {
        throw Object.assign(new Error('text-card-document-unavailable'), { code: 'text-card-document-unavailable' });
    }
    const card = normalizeTextCard(rawCard);
    const avatarImage = card.kind === 'social' && card.avatarDataUrl
        ? await loadAvatarImageElement(card.avatarDataUrl)
        : null;

    const canvas = documentRef.createElement('canvas');
    try {
        const layout = drawTextCardToCanvas(canvas, card, { pixelRatio, avatarImage });
        const blob = await new Promise((resolve, reject) => {
            try {
                canvas.toBlob((result) => {
                    if (result) resolve(result);
                    else reject(Object.assign(new Error('text-card-encode-failed'), { code: 'text-card-encode-failed' }));
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
        };
    } finally {
        canvas.width = 0;
        canvas.height = 0;
    }
}
