export const CODE_CARD_MAX_CHARS = 16_000;
export const CODE_CARD_MAX_LINES = 200;
export const CODE_CARD_MAX_UTF8_BYTES = 24 * 1024;
export const PROJECT_CODE_CARDS_MAX_BYTES = 360 * 1024;
export const CODE_CARD_MAX_LOGICAL_HEIGHT = 4096;
export const CODE_CARD_MAX_EXPORT_PIXELS = 16_777_216;
export const CODE_CARD_PIXEL_RATIO = 2;

export const CODE_LANGUAGES = Object.freeze([
    'auto',
    'javascript',
    'typescript',
    'jsx',
    'python',
    'rust',
    'go',
    'html',
    'css',
    'json',
    'sql',
    'bash',
    'java',
    'cpp',
    'plaintext',
]);

export const CODE_THEMES = Object.freeze([
    'one-dark',
    'github-light',
    'dracula',
    'tokyo-night',
    'nord',
    'monokai',
]);

export const CODE_WINDOW_STYLES = Object.freeze(['mac', 'minimal', 'none']);

export const DEFAULT_CODE_SAMPLE = [
    'export function greet(name: string): string {',
    '  const label = name.trim() || "ScreenHello";',
    '  return `Hello, ${label}!`;',
    '}',
].join('\n');

export const DEFAULT_CODE_CARD = Object.freeze({
    code: DEFAULT_CODE_SAMPLE,
    language: 'auto',
    theme: 'one-dark',
    title: 'hello.ts',
    windowStyle: 'mac',
    fontSize: 15,
    lineHeight: 1.6,
    padding: 28,
    cardWidth: 680,
    tabSize: 2,
    showLineNumbers: true,
    highlightLines: '',
    diffMode: false,
});

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

export const utf8ByteLength = (text) => {
    const value = String(text || '');
    if (encoder) return encoder.encode(value).byteLength;
    return value.length * 3;
};

export const truncateUtf8 = (text, maxBytes = CODE_CARD_MAX_UTF8_BYTES) => {
    const value = String(text || '');
    if (utf8ByteLength(value) <= maxBytes) return value;
    let bytes = 0;
    let end = 0;
    for (let index = 0; index < value.length; index += 1) {
        const codePoint = value.codePointAt(index);
        const charLen = codePoint > 0xffff ? 2 : 1;
        const byteLen = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
        if (bytes + byteLen > maxBytes) break;
        bytes += byteLen;
        end = index + charLen;
        if (charLen === 2) index += 1;
    }
    return value.slice(0, end);
};

const clampNumber = (value, min, max, fallback, precision = 0) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const clamped = Math.min(Math.max(parsed, min), max);
    if (precision <= 0) return Math.round(clamped);
    const factor = 10 ** precision;
    return Math.round(clamped * factor) / factor;
};

export const hasRenderableCode = (code) => typeof code === 'string' && code.trim().length > 0;

export function parseHighlightLines(spec, maxLine = CODE_CARD_MAX_LINES) {
    const result = new Set();
    if (typeof spec !== 'string' || !spec.trim()) return result;
    const cap = Math.max(1, Math.min(CODE_CARD_MAX_LINES, Math.round(Number(maxLine) || CODE_CARD_MAX_LINES)));
    const parts = spec.split(/[,，\s]+/);
    for (const part of parts) {
        if (!part) continue;
        const rangeMatch = part.match(/^(\d+)-(\d+)$/);
        if (rangeMatch) {
            const rawStart = Number(rangeMatch[1]);
            const rawEnd = Number(rangeMatch[2]);
            const start = Math.max(1, Math.min(rawStart, rawEnd));
            const end = Math.min(cap, Math.max(rawStart, rawEnd));
            for (let line = start; line <= end; line += 1) {
                result.add(line);
            }
            continue;
        }
        if (/^\d+$/.test(part)) {
            const line = Number(part);
            if (line >= 1 && line <= cap) result.add(line);
        }
    }
    return result;
}

export function normalizeCodeCard(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ...DEFAULT_CODE_CARD };
    }
    let code = typeof raw.code === 'string' ? raw.code : '';
    code = code.replace(/\r\n?/g, '\n');
    if (code.length > CODE_CARD_MAX_CHARS) {
        code = code.slice(0, CODE_CARD_MAX_CHARS);
    }
    const lines = code.split('\n');
    if (lines.length > CODE_CARD_MAX_LINES) {
        code = lines.slice(0, CODE_CARD_MAX_LINES).join('\n');
    }
    code = truncateUtf8(code, CODE_CARD_MAX_UTF8_BYTES);

    const language = typeof raw.language === 'string' && CODE_LANGUAGES.includes(raw.language)
        ? raw.language
        : DEFAULT_CODE_CARD.language;
    const theme = typeof raw.theme === 'string' && CODE_THEMES.includes(raw.theme)
        ? raw.theme
        : DEFAULT_CODE_CARD.theme;
    const windowStyle = typeof raw.windowStyle === 'string' && CODE_WINDOW_STYLES.includes(raw.windowStyle)
        ? raw.windowStyle
        : DEFAULT_CODE_CARD.windowStyle;
    const title = typeof raw.title === 'string'
        ? raw.title.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80)
        : '';
    const tabSize = Number(raw.tabSize) === 4 ? 4 : 2;
    const highlightLines = typeof raw.highlightLines === 'string'
        ? raw.highlightLines.replace(/[^0-9,\-\s，]/g, '').trim().slice(0, 120)
        : '';

    return {
        code,
        language,
        theme,
        title,
        windowStyle,
        fontSize: clampNumber(raw.fontSize, 12, 24, DEFAULT_CODE_CARD.fontSize, 0),
        lineHeight: clampNumber(raw.lineHeight, 1.3, 2.0, DEFAULT_CODE_CARD.lineHeight, 2),
        padding: clampNumber(raw.padding, 16, 64, DEFAULT_CODE_CARD.padding, 0),
        cardWidth: clampNumber(raw.cardWidth, 420, 1200, DEFAULT_CODE_CARD.cardWidth, 0),
        tabSize,
        showLineNumbers: raw.showLineNumbers !== false,
        highlightLines,
        diffMode: raw.diffMode === true,
    };
}

export const estimateCodeCardJsonBytes = (card) => (
    card ? utf8ByteLength(JSON.stringify(normalizeCodeCard(card))) : 0
);

export const estimateProjectCodeCardBytes = (layers) => {
    if (!Array.isArray(layers)) return 0;
    let total = 0;
    for (const layer of layers) {
        if (layer?.codeCard) total += estimateCodeCardJsonBytes(layer.codeCard);
    }
    return total;
};
