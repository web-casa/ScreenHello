/* 部署期响应头与跳转的唯一来源。
 *
 * 由 docs 站的后处理脚本写入最终 dist/_headers 与 dist/_redirects：
 *   - 应用壳（/、/sw.js、manifest、静态资源、Pages 别名）规则来自这里
 *   - /docs/* 的 CSP 由 csp.mjs 逐块 hash 生成后注入
 *   - 旧内容站 URL -> /docs/{locale}/{topic}/ 的 301 来自 content.mjs
 * 这样两份产物不会各自写一份 _headers/_redirects 互相覆盖。 */

import { buildEditorCsp } from './csp.mjs';

/** 与 cloudflare Pages 无关、始终生效的应用壳规则。 */
export const appShellHeaders = ({ base = '/', indexable = true, editorCsp = buildEditorCsp() } = {}) => {
    const rules = [
        ['/*', ['X-Content-Type-Options: nosniff', 'Referrer-Policy: strict-origin-when-cross-origin']],
        // 编辑器壳页面精确匹配路由的 CSP（严禁挂在 /* 上，避免与 /docs/* 形成双头交集）。
        [base, [`Content-Security-Policy: ${editorCsp}`]],
        [`${base}index.html`, [`Content-Security-Policy: ${editorCsp}`]],
        // 更新入口必须重新校验；带 hash 的应用资源另有缓存策略。
        [`${base}sw.js`, ['Cache-Control: public, no-cache, max-age=0, must-revalidate']],
        [`${base}manifest.webmanifest`, ['Cache-Control: public, no-cache, max-age=0, must-revalidate']],
        // Preview/生产别名不得与正式域名竞争索引。
        ['https://:project.pages.dev/*', ['X-Robots-Tag: noindex, follow']],
        ['https://:version.:project.pages.dev/*', ['X-Robots-Tag: noindex, follow']],
        [`${base}site/*`, ['Cache-Control: public, max-age=0, must-revalidate']],
        [`${base}404.html`, ['X-Robots-Tag: noindex, follow', `Content-Security-Policy: ${editorCsp}`]],
    ];
    if (!indexable) rules.unshift(['/*', ['X-Robots-Tag: noindex, follow']]);
    return rules;
};

/** 把 Cloudflare Pages 风格的 `_headers` 路由模式匹配到具体路径（仅路径规则，忽略带主机名规则）。 */
const matchesRoutePattern = (pattern, pathname) => {
    if (/^https?:\/\//i.test(pattern)) return false;
    if (pattern === '/*') return true;
    if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -1);
        return pathname.startsWith(prefix);
    }
    return pattern === pathname;
};

/** 收集给定 pathname 在 `_headers` 规则集中命中的全部响应头。 */
export const matchHeaderRules = (rules, pathname) => {
    const matched = [];
    for (const [pattern, values] of rules) {
        if (!matchesRoutePattern(pattern, pathname)) continue;
        for (const entry of values) {
            const separator = entry.indexOf(':');
            if (separator <= 0) continue;
            matched.push([entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()]);
        }
    }
    return matched;
};

/** 解析渲染后的 `_headers` 文本为 `[route, values[]]` 数组。 */
export const parseHeadersText = (text) => {
    const rules = [];
    let current = null;
    for (const rawLine of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
        if (!rawLine.trim() || rawLine.trim().startsWith('#')) {
            current = null;
            continue;
        }
        if (/^\s+/.test(rawLine)) {
            if (current) current[1].push(rawLine.trim());
        } else {
            current = [rawLine.trim(), []];
            rules.push(current);
        }
    }
    return rules;
};

/** 断言每个关键路由只命中 1 条 Content-Security-Policy，杜绝双 CSP 交集。 */
export const assertNoDuplicateCsp = (rules, samplePaths) => {
    for (const pathname of samplePaths) {
        const csps = matchHeaderRules(rules, pathname)
            .filter(([name]) => name.toLowerCase() === 'content-security-policy');
        if (csps.length !== 1) {
            throw new Error(`headers-csp-count-invalid:${pathname}:${csps.length}`);
        }
    }
};

/** 把规则数组渲染成 Cloudflare Pages 的 _headers 文本。 */
export const renderHeaders = (rules) => `${rules
    .map(([route, values]) => `${route}\n${values.map(value => `  ${value}`).join('\n')}`)
    .join('\n\n')}\n`;

/** 把规则数组渲染成 _redirects 文本（每条 `from to status`）。 */
export const renderRedirects = (rules) => `${rules.map(([from, to, status = 301]) => `${from} ${to} ${status}`).join('\n')}\n`;
