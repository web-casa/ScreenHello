export const CODE_THEME_PALETTES = Object.freeze({
    'one-dark': {
        id: 'one-dark',
        isDark: true,
        background: '#1e222a',
        headerBg: '#252a34',
        border: 'rgba(255, 255, 255, 0.12)',
        divider: 'rgba(255, 255, 255, 0.08)',
        title: '#abb2bf',
        lineNumber: '#5c6370',
        tokens: {
            plain: '#abb2bf',
            keyword: '#c678dd',
            string: '#98c379',
            number: '#d19a66',
            comment: '#7f848e',
            function: '#61afef',
            type: '#e5c07b',
            operator: '#56b6c2',
            punctuation: '#9da5b4',
            property: '#e06c75',
            tag: '#e06c75',
            attribute: '#d19a66',
            variable: '#e5c07b',
        },
    },
    'github-light': {
        id: 'github-light',
        isDark: false,
        background: '#ffffff',
        headerBg: '#f6f8fa',
        border: 'rgba(31, 35, 40, 0.14)',
        divider: 'rgba(31, 35, 40, 0.10)',
        title: '#57606a',
        lineNumber: '#8c959f',
        tokens: {
            plain: '#1f2328',
            keyword: '#cf222e',
            string: '#0a3069',
            number: '#0550ae',
            comment: '#6e7781',
            function: '#8250df',
            type: '#953800',
            operator: '#0550ae',
            punctuation: '#57606a',
            property: '#0550ae',
            tag: '#116329',
            attribute: '#0550ae',
            variable: '#953800',
        },
    },
    dracula: {
        id: 'dracula',
        isDark: true,
        background: '#282a36',
        headerBg: '#21222c',
        border: 'rgba(248, 248, 242, 0.12)',
        divider: 'rgba(248, 248, 242, 0.08)',
        title: '#bd93f9',
        lineNumber: '#6272a4',
        tokens: {
            plain: '#f8f8f2',
            keyword: '#ff79c6',
            string: '#f1fa8c',
            number: '#bd93f9',
            comment: '#6272a4',
            function: '#50fa7b',
            type: '#8be9fd',
            operator: '#ff79c6',
            punctuation: '#f8f8f2',
            property: '#8be9fd',
            tag: '#ff79c6',
            attribute: '#50fa7b',
            variable: '#ffb86c',
        },
    },
    'tokyo-night': {
        id: 'tokyo-night',
        isDark: true,
        background: '#1a1b26',
        headerBg: '#16161e',
        border: 'rgba(169, 177, 214, 0.14)',
        divider: 'rgba(169, 177, 214, 0.08)',
        title: '#a9b1d6',
        lineNumber: '#565f89',
        tokens: {
            plain: '#c0caf5',
            keyword: '#bb9af7',
            string: '#9ece6a',
            number: '#ff9e64',
            comment: '#565f89',
            function: '#7aa2f7',
            type: '#2ac3de',
            operator: '#89ddff',
            punctuation: '#9aa5ce',
            property: '#73daca',
            tag: '#f7768e',
            attribute: '#e0af68',
            variable: '#e0af68',
        },
    },
    nord: {
        id: 'nord',
        isDark: true,
        background: '#2e3440',
        headerBg: '#272c36',
        border: 'rgba(216, 222, 233, 0.12)',
        divider: 'rgba(216, 222, 233, 0.08)',
        title: '#d8dee9',
        lineNumber: '#616e88',
        tokens: {
            plain: '#eceff4',
            keyword: '#81a1c1',
            string: '#a3be8c',
            number: '#b48ead',
            comment: '#7b88a1',
            function: '#88c0d0',
            type: '#8fbcbb',
            operator: '#81a1c1',
            punctuation: '#d8dee9',
            property: '#88c0d0',
            tag: '#81a1c1',
            attribute: '#8fbcbb',
            variable: '#ebcb8b',
        },
    },
    monokai: {
        id: 'monokai',
        isDark: true,
        background: '#272822',
        headerBg: '#1e1f1c',
        border: 'rgba(248, 248, 242, 0.12)',
        divider: 'rgba(248, 248, 242, 0.08)',
        title: '#cfcfc2',
        lineNumber: '#75715e',
        tokens: {
            plain: '#f8f8f2',
            keyword: '#f92672',
            string: '#e6db74',
            number: '#ae81ff',
            comment: '#88846f',
            function: '#a6e22e',
            type: '#66d9ef',
            operator: '#f92672',
            punctuation: '#f8f8f2',
            property: '#66d9ef',
            tag: '#f92672',
            attribute: '#a6e22e',
            variable: '#fd971f',
        },
    },
});

export const getCodeThemePalette = (themeId) => CODE_THEME_PALETTES[themeId] || CODE_THEME_PALETTES['one-dark'];

const wordSet = (words) => new Set(words.split(' '));

const JS_KEYWORDS = wordSet('as async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield true false null undefined');
const TS_KEYWORDS = wordSet('as async await break case catch class const continue debugger default delete do else enum export extends finally for from function if implements import in instanceof interface keyof let namespace new of private protected public readonly return satisfies static super switch this throw try type typeof var void while with yield true false null undefined');
const PY_KEYWORDS = wordSet('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda match case None nonlocal not or pass raise return True try while with yield');
const RUST_KEYWORDS = wordSet('as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while');
const GO_KEYWORDS = wordSet('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil iota');
const SQL_KEYWORDS = wordSet('select from where join left right inner outer full on as and or not in is null like between order by group having limit offset insert into values update set delete create table alter drop index view distinct union all case when then else end asc desc count sum avg min max');
const BASH_KEYWORDS = wordSet('if then else elif fi for while until do done case esac in function return export local readonly declare unset shift exit true false echo cd pwd ls cat grep sed awk curl git pnpm npm node cargo');
const JAVA_KEYWORDS = wordSet('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try var void volatile while record sealed permits true false null');
const CPP_KEYWORDS = wordSet('alignas alignof auto bool break case catch char char8_t char16_t char32_t class concept const consteval constexpr constinit continue decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept nullptr operator private protected public register reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch template this throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while include define pragma ifdef ifndef endif');

const COMMON_TYPES = wordSet('Array BigInt Boolean Date Error Function Map Number Object Promise Record RegExp Set String Symbol WeakMap WeakSet HTMLElement CanvasRenderingContext2D Blob File URL Option Result Vec Box Arc Rc String str usize isize i8 i16 i32 i64 u8 u16 u32 u64 f32 f64 bool error int int32 int64 float32 float64 byte rune string any unknown never void dict list tuple set float bytes std vector map unordered_map unique_ptr shared_ptr size_t uint8_t uint32_t List Integer Double Optional Stream');

const LANGUAGE_SPEC = {
    javascript: { keywords: JS_KEYWORDS, lineComment: '//', blockComment: true, template: true },
    typescript: { keywords: TS_KEYWORDS, lineComment: '//', blockComment: true, template: true },
    jsx: { keywords: TS_KEYWORDS, lineComment: '//', blockComment: true, template: true, jsx: true },
    python: { keywords: PY_KEYWORDS, lineComment: '#', tripleQuote: true, decorator: true },
    rust: { keywords: RUST_KEYWORDS, lineComment: '//', blockComment: true, macroBang: true },
    go: { keywords: GO_KEYWORDS, lineComment: '//', blockComment: true, backtickRaw: true },
    sql: { keywords: SQL_KEYWORDS, lineComment: '--', blockComment: true, caseInsensitive: true },
    bash: { keywords: BASH_KEYWORDS, lineComment: '#', dollarVar: true },
    java: { keywords: JAVA_KEYWORDS, lineComment: '//', blockComment: true, decorator: true },
    cpp: { keywords: CPP_KEYWORDS, lineComment: '//', blockComment: true, preprocessor: true },
};

export function detectCodeLanguage(code) {
    const source = String(code || '').trim();
    if (!source) return 'plaintext';

    if ((source.startsWith('{') && source.endsWith('}')) || (source.startsWith('[') && source.endsWith(']'))) {
        try {
            JSON.parse(source);
            return 'json';
        } catch {
            // Fall through to heuristic language detection.
        }
    }

    if (/^#!\/(?:usr\/bin\/env\s+)?(?:ba|z|da)?sh\b/m.test(source)) return 'bash';
    if (/^\s*<!DOCTYPE\s+html/i.test(source) || /<\/(?:html|head|body|div|section|main|span|button|script|style)>/i.test(source)) {
        if (/\b(?:import|export|const|function)\b/.test(source) && /(?:return|=>)\s*\(?\s*</.test(source)) return 'jsx';
        return 'html';
    }
    if (/\b(?:fn\s+\w+\s*\(|let\s+mut\b|impl(?:<[^>]+>)?\s+\w+|println!\s*\(|#\[derive\()/m.test(source)) return 'rust';
    if (/^\s*package\s+\w+/m.test(source) && /\bfunc\s+(?:\([^)]+\)\s*)?\w+\s*\(/m.test(source)) return 'go';
    if (/^\s*#include\s*[<"]/m.test(source) || /\bstd::\w+/.test(source)) return 'cpp';
    if (/\bpublic\s+(?:static\s+)?(?:class|interface|record|enum)\s+\w+/.test(source) || /\bSystem\.out\.print/.test(source)) return 'java';
    if (/^\s*(?:def\s+\w+\s*\(|from\s+[\w.]+\s+import\s+|class\s+\w+\([^)]*\):)/m.test(source) || /\belif\b/.test(source)) return 'python';
    if (/\b(?:SELECT\b[\s\S]{1,120}\bFROM\b|CREATE\s+TABLE\b|INSERT\s+INTO\b|UPDATE\s+\w+\s+SET\b)/i.test(source)) return 'sql';
    if (/^\s*(?:@media|@keyframes|@layer|:root|[.#]?[a-zA-Z][\w-]*\s*\{[\s\S]*?[a-z-]+\s*:\s*[^;]+;)/m.test(source)
        && !/\b(?:function|const|let|var|import|return)\b/.test(source)) {
        return 'css';
    }
    if (/\b(?:interface\s+\w+|type\s+\w+\s*=|:\s*(?:string|number|boolean|void|unknown|never|Promise<|Record<))/.test(source)) {
        return /<[A-Z][A-Za-z0-9]*[\s/>]/.test(source) ? 'jsx' : 'typescript';
    }
    if (/\b(?:const|let|var|function|import|export|async|await)\b/.test(source) || /=>/.test(source)) {
        return /<[A-Za-z][A-Za-z0-9]*[\s/>]/.test(source) && /<\/[A-Za-z]/.test(source) ? 'jsx' : 'javascript';
    }
    if (/^\s*(?:export\s+[A-Z_]+=|echo\s+|curl\s+|pnpm\s+|npm\s+|git\s+)/m.test(source)) return 'bash';
    return 'plaintext';
}

const isIdentStart = (ch) => (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
const isIdentPart = (ch) => isIdentStart(ch) || (ch >= '0' && ch <= '9');
const isDigit = (ch) => ch >= '0' && ch <= '9';
const isHexDigit = (ch) => isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
const isOperatorChar = (ch) => '+-*/%=!<>&|^~?:'.includes(ch);
const isPunctuationChar = (ch) => '()[]{},.;'.includes(ch);

const pushToken = (lineTokens, type, value) => {
    if (!value) return;
    const prev = lineTokens[lineTokens.length - 1];
    if (prev && prev.type === type) {
        prev.value += value;
    } else {
        lineTokens.push({ type, value });
    }
};

const readQuoted = (line, start, quote, allowEscape = true) => {
    let i = start + 1;
    while (i < line.length) {
        const ch = line[i];
        if (allowEscape && ch === '\\') {
            i += 2;
            continue;
        }
        if (ch === quote) return i + 1;
        i += 1;
    }
    return line.length;
};

const readNumber = (line, start) => {
    let i = start;
    if (line[i] === '0' && (line[i + 1] === 'x' || line[i + 1] === 'X')) {
        i += 2;
        while (i < line.length && (isHexDigit(line[i]) || line[i] === '_')) i += 1;
        return i;
    }
    while (i < line.length && (isDigit(line[i]) || line[i] === '_')) i += 1;
    if (line[i] === '.' && isDigit(line[i + 1] || '')) {
        i += 1;
        while (i < line.length && (isDigit(line[i]) || line[i] === '_')) i += 1;
    }
    if ((line[i] === 'e' || line[i] === 'E') && (isDigit(line[i + 1] || '') || ((line[i + 1] === '+' || line[i + 1] === '-') && isDigit(line[i + 2] || '')))) {
        i += 1;
        if (line[i] === '+' || line[i] === '-') i += 1;
        while (i < line.length && (isDigit(line[i]) || line[i] === '_')) i += 1;
    }
    return i;
};

const tokenizeJsonLine = (line) => {
    const tokens = [];
    let i = 0;
    while (i < line.length) {
        const ch = line[i];
        if (ch === '"') {
            const end = readQuoted(line, i, '"', true);
            let look = end;
            while (look < line.length && (line[look] === ' ' || line[look] === '\t')) look += 1;
            const type = line[look] === ':' ? 'property' : 'string';
            pushToken(tokens, type, line.slice(i, end));
            i = end;
            continue;
        }
        if ((ch === '-' && isDigit(line[i + 1] || '')) || isDigit(ch)) {
            const end = readNumber(line, ch === '-' ? i + 1 : i);
            pushToken(tokens, 'number', line.slice(i, end));
            i = end;
            continue;
        }
        if (isIdentStart(ch)) {
            let end = i + 1;
            while (end < line.length && isIdentPart(line[end])) end += 1;
            const word = line.slice(i, end);
            pushToken(tokens, word === 'true' || word === 'false' || word === 'null' ? 'keyword' : 'plain', word);
            i = end;
            continue;
        }
        if ('{}[],:'.includes(ch)) {
            pushToken(tokens, 'punctuation', ch);
            i += 1;
            continue;
        }
        pushToken(tokens, 'plain', ch);
        i += 1;
    }
    return tokens;
};

const tokenizeHtmlLine = (line, state) => {
    const tokens = [];
    let i = 0;
    while (i < line.length) {
        if (state.mode === 'htmlComment') {
            const close = line.indexOf('-->', i);
            if (close === -1) {
                pushToken(tokens, 'comment', line.slice(i));
                return tokens;
            }
            pushToken(tokens, 'comment', line.slice(i, close + 3));
            state.mode = null;
            i = close + 3;
            continue;
        }
        if (line.startsWith('<!--', i)) {
            state.mode = 'htmlComment';
            const close = line.indexOf('-->', i + 4);
            if (close === -1) {
                pushToken(tokens, 'comment', line.slice(i));
                return tokens;
            }
            pushToken(tokens, 'comment', line.slice(i, close + 3));
            state.mode = null;
            i = close + 3;
            continue;
        }
        if (line[i] === '<') {
            let j = i + 1;
            const isClosing = line[j] === '/' || line[j] === '!';
            if (isClosing) j += 1;
            const nameStart = j;
            while (j < line.length && /[A-Za-z0-9:_-]/.test(line[j])) j += 1;
            if (j > nameStart) {
                pushToken(tokens, 'punctuation', line.slice(i, nameStart));
                pushToken(tokens, 'tag', line.slice(nameStart, j));
                i = j;
                while (i < line.length && line[i] !== '>') {
                    const ch = line[i];
                    if (ch === '"' || ch === "'") {
                        const end = readQuoted(line, i, ch, true);
                        pushToken(tokens, 'string', line.slice(i, end));
                        i = end;
                    } else if (ch === '/' && line[i + 1] === '>') {
                        pushToken(tokens, 'punctuation', '/>');
                        i += 2;
                        break;
                    } else if (ch === '=') {
                        pushToken(tokens, 'operator', '=');
                        i += 1;
                    } else if (/[A-Za-z_:@-]/.test(ch)) {
                        let attrEnd = i + 1;
                        while (attrEnd < line.length && /[A-Za-z0-9_:@.-]/.test(line[attrEnd])) attrEnd += 1;
                        pushToken(tokens, 'attribute', line.slice(i, attrEnd));
                        i = attrEnd;
                    } else {
                        pushToken(tokens, 'plain', ch);
                        i += 1;
                    }
                }
                if (i < line.length && line[i] === '>') {
                    pushToken(tokens, 'punctuation', '>');
                    i += 1;
                }
                continue;
            }
        }
        const nextLt = line.indexOf('<', i + 1);
        const end = nextLt === -1 ? line.length : nextLt;
        pushToken(tokens, 'plain', line.slice(i, end));
        i = end;
    }
    return tokens;
};

const tokenizeCssLine = (line, state) => {
    const tokens = [];
    let i = 0;
    while (i < line.length) {
        if (state.mode === 'blockComment') {
            const close = line.indexOf('*/', i);
            if (close === -1) {
                pushToken(tokens, 'comment', line.slice(i));
                return tokens;
            }
            pushToken(tokens, 'comment', line.slice(i, close + 2));
            state.mode = null;
            i = close + 2;
            continue;
        }
        const ch = line[i];
        if (ch === '/' && line[i + 1] === '*') {
            state.mode = 'blockComment';
            const close = line.indexOf('*/', i + 2);
            if (close === -1) {
                pushToken(tokens, 'comment', line.slice(i));
                return tokens;
            }
            pushToken(tokens, 'comment', line.slice(i, close + 2));
            state.mode = null;
            i = close + 2;
            continue;
        }
        if (ch === '"' || ch === "'") {
            const end = readQuoted(line, i, ch, true);
            pushToken(tokens, 'string', line.slice(i, end));
            i = end;
            continue;
        }
        if (ch === '@' && /[a-zA-Z-]/.test(line[i + 1] || '')) {
            let end = i + 1;
            while (end < line.length && /[a-zA-Z0-9_-]/.test(line[end])) end += 1;
            pushToken(tokens, 'keyword', line.slice(i, end));
            i = end;
            continue;
        }
        if (ch === '#' && isHexDigit(line[i + 1] || '')) {
            let end = i + 1;
            while (end < line.length && isHexDigit(line[end])) end += 1;
            pushToken(tokens, 'number', line.slice(i, end));
            i = end;
            continue;
        }
        if (isDigit(ch) || (ch === '.' && isDigit(line[i + 1] || ''))) {
            let end = readNumber(line, i);
            while (end < line.length && (/[a-zA-Z%]/.test(line[end]))) end += 1;
            pushToken(tokens, 'number', line.slice(i, end));
            i = end;
            continue;
        }
        if (/[a-zA-Z_-]/.test(ch)) {
            let end = i + 1;
            while (end < line.length && /[a-zA-Z0-9_-]/.test(line[end])) end += 1;
            const word = line.slice(i, end);
            let look = end;
            while (look < line.length && line[look] === ' ') look += 1;
            if (line[look] === ':') pushToken(tokens, 'property', word);
            else if (line[look] === '(') pushToken(tokens, 'function', word);
            else if (word.startsWith('--')) pushToken(tokens, 'variable', word);
            else pushToken(tokens, 'tag', word);
            i = end;
            continue;
        }
        if ('{}:;(),.'.includes(ch)) {
            pushToken(tokens, 'punctuation', ch);
            i += 1;
            continue;
        }
        pushToken(tokens, 'plain', ch);
        i += 1;
    }
    return tokens;
};

const tokenizeGenericLine = (line, spec, state) => {
    const tokens = [];
    let i = 0;

    while (i < line.length) {
        if (state.mode === 'blockComment') {
            const close = line.indexOf('*/', i);
            if (close === -1) {
                pushToken(tokens, 'comment', line.slice(i));
                return tokens;
            }
            pushToken(tokens, 'comment', line.slice(i, close + 2));
            state.mode = null;
            i = close + 2;
            continue;
        }
        if (state.mode === 'tripleDouble' || state.mode === 'tripleSingle') {
            const delim = state.mode === 'tripleDouble' ? '"""' : "'''";
            const close = line.indexOf(delim, i);
            if (close === -1) {
                pushToken(tokens, 'string', line.slice(i));
                return tokens;
            }
            pushToken(tokens, 'string', line.slice(i, close + 3));
            state.mode = null;
            i = close + 3;
            continue;
        }
        if (state.mode === 'template') {
            let j = i;
            let closed = false;
            while (j < line.length) {
                if (line[j] === '\\') { j += 2; continue; }
                if (line[j] === '`') { j += 1; closed = true; break; }
                j += 1;
            }
            pushToken(tokens, 'string', line.slice(i, j));
            if (closed) state.mode = null;
            i = j;
            continue;
        }

        const ch = line[i];

        if (spec.lineComment && line.startsWith(spec.lineComment, i)) {
            pushToken(tokens, 'comment', line.slice(i));
            return tokens;
        }
        if (spec.blockComment && ch === '/' && line[i + 1] === '*') {
            state.mode = 'blockComment';
            const close = line.indexOf('*/', i + 2);
            if (close === -1) {
                pushToken(tokens, 'comment', line.slice(i));
                return tokens;
            }
            pushToken(tokens, 'comment', line.slice(i, close + 2));
            state.mode = null;
            i = close + 2;
            continue;
        }
        if (spec.tripleQuote && (line.startsWith('"""', i) || line.startsWith("'''", i))) {
            const delim = line.slice(i, i + 3);
            const close = line.indexOf(delim, i + 3);
            if (close === -1) {
                state.mode = delim === '"""' ? 'tripleDouble' : 'tripleSingle';
                pushToken(tokens, 'string', line.slice(i));
                return tokens;
            }
            pushToken(tokens, 'string', line.slice(i, close + 3));
            i = close + 3;
            continue;
        }
        if ((spec.template || spec.backtickRaw) && ch === '`') {
            let j = i + 1;
            let closed = false;
            while (j < line.length) {
                if (!spec.backtickRaw && line[j] === '\\') { j += 2; continue; }
                if (line[j] === '`') { j += 1; closed = true; break; }
                j += 1;
            }
            pushToken(tokens, 'string', line.slice(i, j));
            if (!closed) state.mode = 'template';
            i = j;
            continue;
        }
        if (ch === '"' || ch === "'") {
            const end = readQuoted(line, i, ch, true);
            pushToken(tokens, 'string', line.slice(i, end));
            i = end;
            continue;
        }
        if (spec.preprocessor && ch === '#' && line.slice(0, i).trim() === '') {
            let end = i + 1;
            while (end < line.length && isIdentPart(line[end])) end += 1;
            pushToken(tokens, 'keyword', line.slice(i, end));
            i = end;
            continue;
        }
        if (spec.decorator && ch === '@' && isIdentStart(line[i + 1] || '')) {
            let end = i + 1;
            while (end < line.length && (isIdentPart(line[end]) || line[end] === '.')) end += 1;
            pushToken(tokens, 'attribute', line.slice(i, end));
            i = end;
            continue;
        }
        if (spec.dollarVar && ch === '$') {
            let end = i + 1;
            if (line[end] === '{') {
                const close = line.indexOf('}', end + 1);
                end = close === -1 ? line.length : close + 1;
            } else {
                while (end < line.length && isIdentPart(line[end])) end += 1;
            }
            pushToken(tokens, 'variable', line.slice(i, end));
            i = end;
            continue;
        }
        if (isDigit(ch)) {
            const end = readNumber(line, i);
            pushToken(tokens, 'number', line.slice(i, end));
            i = end;
            continue;
        }
        if (isIdentStart(ch)) {
            let end = i + 1;
            while (end < line.length && isIdentPart(line[end])) end += 1;
            const word = line.slice(i, end);
            const lookup = spec.caseInsensitive ? word.toLowerCase() : word;
            let look = end;
            while (look < line.length && line[look] === ' ') look += 1;

            if (spec.macroBang && line[end] === '!') {
                pushToken(tokens, 'function', `${word}!`);
                i = end + 1;
                continue;
            }
            if (spec.keywords.has(lookup)) {
                pushToken(tokens, 'keyword', word);
            } else if (line[look] === '(') {
                pushToken(tokens, 'function', word);
            } else if (COMMON_TYPES.has(word) || (word[0] >= 'A' && word[0] <= 'Z' && /[a-z]/.test(word))) {
                pushToken(tokens, 'type', word);
            } else {
                pushToken(tokens, 'plain', word);
            }
            i = end;
            continue;
        }
        if (isOperatorChar(ch)) {
            pushToken(tokens, 'operator', ch);
            i += 1;
            continue;
        }
        if (isPunctuationChar(ch)) {
            pushToken(tokens, 'punctuation', ch);
            i += 1;
            continue;
        }
        pushToken(tokens, 'plain', ch);
        i += 1;
    }

    return tokens;
};

export function tokenizeCode(code, language = 'auto') {
    const normalized = String(code || '').replace(/\r\n?/g, '\n');
    const resolvedLanguage = language === 'auto' ? detectCodeLanguage(normalized) : language;
    const rawLines = normalized.split('\n');

    if (resolvedLanguage === 'plaintext') {
        return {
            resolvedLanguage,
            lines: rawLines.map((line) => (line ? [{ type: 'plain', value: line }] : [])),
        };
    }

    if (resolvedLanguage === 'json') {
        return {
            resolvedLanguage,
            lines: rawLines.map(tokenizeJsonLine),
        };
    }

    const state = { mode: null };
    if (resolvedLanguage === 'html') {
        return {
            resolvedLanguage,
            lines: rawLines.map((line) => tokenizeHtmlLine(line, state)),
        };
    }
    if (resolvedLanguage === 'css') {
        return {
            resolvedLanguage,
            lines: rawLines.map((line) => tokenizeCssLine(line, state)),
        };
    }

    const spec = LANGUAGE_SPEC[resolvedLanguage] || LANGUAGE_SPEC.javascript;
    return {
        resolvedLanguage,
        lines: rawLines.map((line) => tokenizeGenericLine(line, spec, state)),
    };
}
