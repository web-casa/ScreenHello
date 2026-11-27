import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cssPath = path.join(root, 'lib', 'style.css');
const CONDITIONAL_AT_RULE = /^@(media|supports|layer|container|scope|document)\b/i;
const SKIP_AT_RULE = /^@(keyframes|-webkit-keyframes|font-face|property|charset|import|namespace)\b/i;

const splitSelectorList = (prelude) => {
    const parts = [];
    let current = '';
    let paren = 0;
    let bracket = 0;
    let quote = null;
    for (let i = 0; i < prelude.length; i += 1) {
        const ch = prelude[i];
        if (quote) {
            current += ch;
            if (ch === '\\' && i + 1 < prelude.length) { current += prelude[++i]; continue; }
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
        if (ch === '(') paren += 1;
        else if (ch === ')') paren = Math.max(0, paren - 1);
        else if (ch === '[') bracket += 1;
        else if (ch === ']') bracket = Math.max(0, bracket - 1);
        if (ch === ',' && paren === 0 && bracket === 0) {
            const trimmed = current.trim();
            if (trimmed) parts.push(trimmed);
            current = '';
            continue;
        }
        current += ch;
    }
    const trimmed = current.trim();
    if (trimmed) parts.push(trimmed);
    return parts;
};

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const collectRuleSelectors = (css) => {
    const selectors = [];
    const walk = (source) => {
        let index = 0;
        while (index < source.length) {
            let open = -1;
            let semi = -1;
            let quote = null;
            for (let i = index; i < source.length; i += 1) {
                const ch = source[i];
                if (quote) {
                    if (ch === '\\') { i += 1; continue; }
                    if (ch === quote) quote = null;
                    continue;
                }
                if (ch === '"' || ch === "'") { quote = ch; continue; }
                if (ch === ';' && open < 0) { semi = i; break; }
                if (ch === '{') { open = i; break; }
            }
            if (semi >= 0 && (open < 0 || semi < open)) {
                index = semi + 1;
                continue;
            }
            if (open < 0) break;
            let depth = 1;
            let close = open + 1;
            quote = null;
            while (close < source.length && depth > 0) {
                const ch = source[close];
                if (quote) {
                    if (ch === '\\') { close += 2; continue; }
                    if (ch === quote) quote = null;
                    close += 1;
                    continue;
                }
                if (ch === '"' || ch === "'") { quote = ch; close += 1; continue; }
                if (ch === '{') depth += 1;
                else if (ch === '}') depth -= 1;
                close += 1;
            }
            const prelude = source.slice(index, open).trim();
            const body = source.slice(open + 1, close - 1);
            if (CONDITIONAL_AT_RULE.test(prelude)) {
                walk(body);
            } else if (!SKIP_AT_RULE.test(prelude) && !prelude.startsWith('@')) {
                for (const selector of splitSelectorList(prelude)) {
                    selectors.push(selector);
                }
            }
            index = close;
        }
    };
    walk(stripComments(css));
    return selectors;
};

const ALLOWED_SCOPE_PATTERN = /(?:\.shoteasy-|\.radix-themes|\.rt-|\.ant-|\.rc-|\.css-|\.anticon|\.se-|\.polka|\[class\*=["']shoteasy-["']\])/;
const FORBIDDEN_GLOBAL_ROOT = /(?:^|[\s,+>~])(?::root|:host)\b/;
const FORBIDDEN_BARE_THEME = /^(?:\.dark|\.dark-theme|\.light|\.light-theme|:is\(\.(?:dark|light)(?:,\s*\.(?:dark|light)-theme)?\))$/;
const FORBIDDEN_BARE_ELEMENT = /^(?:\*|::before|::after|::backdrop|html|body|h[1-6]|p|a|button|img|svg|input|textarea|select|table|ul|ol|li|hr|blockquote|figure|pre|code|kbd|samp|small|sub|sup)(?:[:.[#]|$)/i;

export function auditLibraryCss(css) {
    const selectors = collectRuleSelectors(css);
    const violations = [];
    for (const selector of selectors) {
        if (FORBIDDEN_GLOBAL_ROOT.test(selector)) {
            violations.push(`global-root:${selector}`);
            continue;
        }
        if (FORBIDDEN_BARE_THEME.test(selector)) {
            violations.push(`unscoped-theme:${selector}`);
            continue;
        }
        if (!ALLOWED_SCOPE_PATTERN.test(selector) && FORBIDDEN_BARE_ELEMENT.test(selector)) {
            violations.push(`unscoped-element:${selector}`);
        }
    }
    return {
        totalSelectors: selectors.length,
        violations: [...new Set(violations)],
    };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const css = readFileSync(cssPath, 'utf8');
    const result = auditLibraryCss(css);
    console.log(JSON.stringify({
        file: path.relative(root, cssPath),
        bytes: Buffer.byteLength(css, 'utf8'),
        ...result,
    }, null, 2));
    if (result.violations.length > 0) {
        process.exitCode = 1;
    }
}
