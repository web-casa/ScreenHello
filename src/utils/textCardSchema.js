import { truncateUtf8, utf8ByteLength } from '@utils/codeCardSchema';

export const TEXT_CARD_MAX_BODY_CHARS = 4_000;
export const TEXT_CARD_MAX_BODY_BYTES = 16 * 1024;
export const TEXT_CARD_AVATAR_MAX_BYTES = 32 * 1024;
export const TEXT_CARD_MAX_CHANGELOG_ITEMS = 12;
export const TEXT_CARD_MAX_LOGICAL_HEIGHT = 4096;
export const TEXT_CARD_MAX_EXPORT_PIXELS = 16_777_216;
export const TEXT_CARD_PIXEL_RATIO = 2;
export const PROJECT_MANIFEST_SOFT_LIMIT_BYTES = 480 * 1024;

export const TEXT_CARD_KINDS = Object.freeze(['social', 'quote', 'changelog']);
export const TEXT_CARD_PLATFORMS = Object.freeze(['x', 'bluesky', 'minimal']);
export const TEXT_CARD_THEMES = Object.freeze([
    'paper-light',
    'graphite-dark',
    'glass-light',
    'glass-dark',
    'warm-editorial',
    'twilight',
]);
export const CHANGELOG_TAGS = Object.freeze(['new', 'improved', 'fix']);

const AVATAR_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export const DEFAULT_CHANGELOG_ITEMS = Object.freeze([
    Object.freeze({ tag: 'new', text: '新增 3D 透视引擎与场景模板库，一键生成产品展示图。' }),
    Object.freeze({ tag: 'improved', text: '优化画布尺寸选择器与代码卡片行高亮、Diff 展示。' }),
    Object.freeze({ tag: 'fix', text: '修复高倍率导出时的边缘抗锯齿细节问题。' }),
]);

export const DEFAULT_TEXT_CARD = Object.freeze({
    kind: 'social',
    theme: 'paper-light',
    platform: 'x',
    authorName: 'ScreenHello',
    authorHandle: '@screenhello',
    verified: true,
    avatarDataUrl: null,
    body: '刚刚把产品截图美化工作流全部迁到纯本地浏览器运行：3D 透视、场景模板、代码与社交卡片，以及本地 GIF 动图导出，零上传也能做出发布级视觉。',
    timestamp: '10:24 AM · Today',
    showMetrics: true,
    replies: 42,
    reposts: 128,
    likes: 864,
    quoteAuthor: 'ScreenHello Design',
    quoteRole: 'Local-first Visual Studio',
    changelogTitle: 'ScreenHello 2.0 发布说明',
    changelogVersion: 'v2.0.0',
    changelogDate: '2026-11-26',
    changelogItems: DEFAULT_CHANGELOG_ITEMS.map((item) => ({ ...item })),
    cardWidth: 640,
    padding: 36,
    fontSize: 18,
});

const clampNumber = (value, min, max, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.round(Math.min(Math.max(parsed, min), max));
};

const sanitizeSingleLine = (value, maxChars, fallback = '') => {
    if (typeof value !== 'string') return fallback;
    return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxChars);
};

const sanitizeMultiLine = (value, maxChars, maxBytes) => {
    if (typeof value !== 'string') return '';
    let text = value.replace(/\r\n?/g, '\n');
    if (text.length > maxChars) text = text.slice(0, maxChars);
    return truncateUtf8(text, maxBytes);
};

export const isValidAvatarDataUrl = (value) => {
    if (typeof value !== 'string' || !value) return false;
    if (!AVATAR_DATA_URL_PATTERN.test(value)) return false;
    return utf8ByteLength(value) <= TEXT_CARD_AVATAR_MAX_BYTES;
};

export function normalizeChangelogItems(rawItems) {
    if (!Array.isArray(rawItems)) {
        return DEFAULT_CHANGELOG_ITEMS.map((item) => ({ ...item }));
    }
    return rawItems
        .slice(0, TEXT_CARD_MAX_CHANGELOG_ITEMS)
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
            tag: typeof item.tag === 'string' && CHANGELOG_TAGS.includes(item.tag) ? item.tag : 'new',
            text: sanitizeSingleLine(item.text, 240, ''),
        }));
}

export function normalizeTextCard(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {
            ...DEFAULT_TEXT_CARD,
            changelogItems: DEFAULT_CHANGELOG_ITEMS.map((item) => ({ ...item })),
        };
    }

    const kind = typeof raw.kind === 'string' && TEXT_CARD_KINDS.includes(raw.kind)
        ? raw.kind
        : DEFAULT_TEXT_CARD.kind;
    const theme = typeof raw.theme === 'string' && TEXT_CARD_THEMES.includes(raw.theme)
        ? raw.theme
        : DEFAULT_TEXT_CARD.theme;
    const platform = typeof raw.platform === 'string' && TEXT_CARD_PLATFORMS.includes(raw.platform)
        ? raw.platform
        : DEFAULT_TEXT_CARD.platform;

    const rawHandle = sanitizeSingleLine(raw.authorHandle, 60, '');
    const authorHandle = rawHandle && !rawHandle.startsWith('@') ? `@${rawHandle}` : rawHandle;
    const avatarDataUrl = isValidAvatarDataUrl(raw.avatarDataUrl) ? raw.avatarDataUrl : null;
    const body = typeof raw.body === 'string'
        ? sanitizeMultiLine(raw.body, TEXT_CARD_MAX_BODY_CHARS, TEXT_CARD_MAX_BODY_BYTES)
        : '';

    return {
        kind,
        theme,
        platform,
        authorName: sanitizeSingleLine(raw.authorName, 80, ''),
        authorHandle,
        verified: raw.verified === true,
        avatarDataUrl,
        body,
        timestamp: sanitizeSingleLine(raw.timestamp, 60, ''),
        showMetrics: raw.showMetrics !== false,
        replies: clampNumber(raw.replies, 0, 99_999_999, 0),
        reposts: clampNumber(raw.reposts, 0, 99_999_999, 0),
        likes: clampNumber(raw.likes, 0, 99_999_999, 0),
        quoteAuthor: sanitizeSingleLine(raw.quoteAuthor, 80, ''),
        quoteRole: sanitizeSingleLine(raw.quoteRole, 100, ''),
        changelogTitle: sanitizeSingleLine(raw.changelogTitle, 100, ''),
        changelogVersion: sanitizeSingleLine(raw.changelogVersion, 32, ''),
        changelogDate: sanitizeSingleLine(raw.changelogDate, 40, ''),
        changelogItems: normalizeChangelogItems(raw.changelogItems),
        cardWidth: clampNumber(raw.cardWidth, 420, 1080, DEFAULT_TEXT_CARD.cardWidth),
        padding: clampNumber(raw.padding, 20, 64, DEFAULT_TEXT_CARD.padding),
        fontSize: clampNumber(raw.fontSize, 14, 26, DEFAULT_TEXT_CARD.fontSize),
    };
}

export function hasRenderableTextCard(raw) {
    const card = normalizeTextCard(raw);
    if (card.kind === 'changelog') {
        return Boolean(
            card.changelogTitle.trim()
            || card.changelogItems.some((item) => item.text.trim().length > 0),
        );
    }
    return card.body.trim().length > 0;
}

export function estimateSerializedManifestBytes(document) {
    if (!document || typeof document !== 'object') return 0;
    return utf8ByteLength(JSON.stringify(document));
}
