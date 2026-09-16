/**
 * Radix Themes 样式按需裁剪（背景与实测数据见
 * 已审阅的 Radix 体积与 library contract 测量记录）。
 *
 * 站点与库都自带 `@radix-ui/themes` 的 tokens + components 两份样式表，但界面只渲染
 * 6 个控件（Button/IconButton/Switch/TextField/SegmentedControl/Slider），且 Theme 固定
 * `accentColor="indigo"`、`grayColor="slate"`。整包带来的其它调色板与未使用组件规则
 * 是纯负担：实测 tokens.css 里 19.7% 的字节、components.css 里约 1/3 的字节可以去掉。
 *
 * 原则是**拿不准就保留**，只丢弃两类规则：
 *   1) 调色板规则：选择器显式点名了保留集之外的调色板；
 *   2) 组件规则：选择器里的 `.rt-*` 类全部不属于保留集（含共享基类与工具类）。
 * 不含 `.rt-*` 类的规则（`:root` 变量、`@keyframes`、`:where(.radix-themes)` 基础块）
 * 一律保留；`@media`/`@supports` 等条件规则递归处理，内部清空时整体丢弃。
 *
 * 上游升级后如果 Radix 改了选择器结构，最坏结果是“少丢一点”，不会误删我们没识别的样式。
 */

/** Theme 的 accentColor 实际取值（`gray` 是 Radix 自带的灰阶 accent，被 `.rt-Text` 使用）。 */
export const KEEP_ACCENTS = Object.freeze(['indigo', 'gray']);
/** Theme 的 grayColor 实际取值。 */
export const KEEP_GRAYS = Object.freeze(['slate']);
/**
 * Radix 的原始调色板变量（`--tomato-9` / `--slate-a3` 这类）。
 * 不在保留集里的会在声明级别被剔除；语义别名（`--accent-*`、`--gray-*`、`--color-*`、
 * `--space-*`、`--radius-*`…）不在这个名单里，因此一定保留。
 */
export const RADIX_PALETTES = Object.freeze([
    'tomato', 'red', 'ruby', 'crimson', 'pink', 'plum', 'purple', 'violet', 'iris', 'indigo',
    'blue', 'cyan', 'teal', 'jade', 'green', 'grass', 'bronze', 'gold', 'brown', 'orange',
    'amber', 'yellow', 'lime', 'mint', 'sky',
    'gray', 'mauve', 'slate', 'sage', 'olive', 'sand',
]);
/** 界面里真实渲染的 Radix 组件族；其余组件的规则不进入产物。 */
export const KEEP_COMPONENTS = Object.freeze([
    'Button',
    'IconButton',
    'BaseButton',
    'Switch',
    'TextField',
    'SegmentedControl',
    'Slider',
    'Text',
    'reset',
]);

/**
 * 共享修饰类（尺寸/变体/响应式工具）。它们通常挂在组件类后面
 * （`.rt-TableRoot:where(.rt-r-size-1)`），单独出现时按“共享规则”保留，
 * 避免上游新增独立工具类时被误删。
 */
const SHARED_MODIFIER = /^(?:r-|variant-)/;

const CONDITIONAL_AT_RULE = /^@(media|supports|layer|container|scope|document)\b/;

/** 跳过注释与字符串，找到 `from` 之后第一个顶层 `{` 的下标；没有则返回 -1。 */
const findOpenBrace = (css, from) => {
    let index = from;
    let quote = null;
    let comment = false;
    while (index < css.length) {
        const char = css[index];
        const next = css[index + 1];
        if (comment) {
            if (char === '*' && next === '/') { comment = false; index += 2; continue; }
            index += 1;
            continue;
        }
        if (quote) {
            if (char === '\\') { index += 2; continue; }
            if (char === quote) quote = null;
            index += 1;
            continue;
        }
        if (char === '/' && next === '*') { comment = true; index += 2; continue; }
        if (char === '"' || char === "'") { quote = char; index += 1; continue; }
        if (char === '{') return index;
        index += 1;
    }
    return -1;
};

/** 返回与 `openIndex` 处 `{` 配对的 `}` 下标；找不到抛错，避免静默产出坏 CSS。 */
const matchCloseBrace = (css, openIndex) => {
    let depth = 0;
    let index = openIndex;
    let quote = null;
    let comment = false;
    while (index < css.length) {
        const char = css[index];
        const next = css[index + 1];
        if (comment) {
            if (char === '*' && next === '/') { comment = false; index += 2; continue; }
            index += 1;
            continue;
        }
        if (quote) {
            if (char === '\\') { index += 2; continue; }
            if (char === quote) quote = null;
            index += 1;
            continue;
        }
        if (char === '/' && next === '*') { comment = true; index += 2; continue; }
        if (char === '"' || char === "'") { quote = char; index += 1; continue; }
        if (char === '{') depth += 1;
        else if (char === '}') {
            depth -= 1;
            if (depth === 0) return index;
        }
        index += 1;
    }
    throw new Error('radix-css-filter:unbalanced-braces');
};

const paletteNames = (prelude) => ({
    accents: [...prelude.matchAll(/\[data-accent-color\s*=\s*['"]?([a-z-]+)['"]?\]/g)].map((match) => match[1]),
    grays: [...prelude.matchAll(/\[data-gray-color\s*=\s*['"]?([a-z-]+)['"]?\]/g)].map((match) => match[1]),
});

/** 只丢弃“显式点名了保留集之外调色板”的规则；未点名或点名保留调色板的一律保留。 */
export const shouldDropPaletteRule = (prelude, {
    keepAccents = KEEP_ACCENTS,
    keepGrays = KEEP_GRAYS,
} = {}) => {
    const { accents, grays } = paletteNames(prelude);
    if (!accents.length && !grays.length) return false;
    if (accents.some((name) => !keepAccents.includes(name))) return true;
    if (grays.some((name) => !keepGrays.includes(name))) return true;
    return false;
};

/** 只丢弃“选择器里的 .rt-* 类全部不属于保留组件、且不是共享修饰类”的规则。 */
export const shouldDropComponentRule = (prelude, { keepComponents = KEEP_COMPONENTS } = {}) => {
    const tokens = [...new Set([...prelude.matchAll(/\.rt-([A-Za-z0-9_-]+)/g)].map((match) => match[1]))];
    if (!tokens.length) return false;
    if (tokens.every((token) => SHARED_MODIFIER.test(token))) return false;
    return !tokens.some((token) => keepComponents.some((prefix) => token.startsWith(prefix)));
};

const KEEP_PALETTES = new Set([...KEEP_ACCENTS, ...KEEP_GRAYS, 'black', 'white']);
const PALETTE_DECLARATION = new RegExp(`^--(${RADIX_PALETTES.join('|')})(?:-a)?-\\d{1,2}$`);

/**
 * 逐条声明过滤：Radix 把某个调色板的 12 级色阶写在同一个大块里
 * （`:root, .light, .light-theme { --gray-1: …; --tomato-1: …; }`），
 * 所以调色板级裁剪必须在声明粒度做，而不是整块丢。
 */
const filterDeclarations = (body) => {
    const parts = body.split(';');
    const kept = parts.filter((part) => {
        const match = /^\s*(--[A-Za-z0-9_-]+)\s*:/.exec(part);
        if (!match) return true;
        const palette = PALETTE_DECLARATION.exec(match[1]);
        return !palette || KEEP_PALETTES.has(palette[1]);
    });
    return kept.join(';');
};

const filterRules = (css, shouldDrop, { filterBody } = {}) => {
    let out = '';
    let index = 0;
    while (index < css.length) {
        const open = findOpenBrace(css, index);
        if (open < 0) {
            out += css.slice(index);
            break;
        }
        const close = matchCloseBrace(css, open);
        const prelude = css.slice(index, open);
        const body = css.slice(open + 1, close);
        const trimmed = prelude.trim();
        if (CONDITIONAL_AT_RULE.test(trimmed)) {
            const inner = filterRules(body, shouldDrop, { filterBody });
            if (inner.trim()) out += `${prelude}{${inner}}`;
        } else if (!shouldDrop(trimmed, body)) {
            out += `${prelude}{${filterBody ? filterBody(body) : body}}`;
        }
        index = close + 1;
    }
    return out;
};

/** 裁剪 tokens.css：丢掉未使用调色板的规则与声明。 */
export const filterRadixTokens = (css, options) => filterRules(
    css,
    (prelude) => shouldDropPaletteRule(prelude, options),
    { filterBody: filterDeclarations },
);

/** 裁剪 components.css：丢掉未渲染组件的规则。 */
export const filterRadixComponents = (css, options) => filterRules(css, (prelude) => shouldDropComponentRule(prelude, options));

/** Vite 插件：在 Vite/Tailwind 处理之前替换两份 Radix 样式表。 */
export const radixCssPlugin = (options = {}) => ({
    name: 'screenhello-radix-css',
    enforce: 'pre',
    transform(code, id) {
        const file = id.split('?')[0];
        if (!file.includes('@radix-ui/themes/')) return null;
        if (file.endsWith('/tokens.css')) return { code: filterRadixTokens(code, options), map: null };
        if (file.endsWith('/components.css')) return { code: filterRadixComponents(code, options), map: null };
        return null;
    },
});
