/* 部署期响应头与跳转的唯一来源。
 *
 * 由 docs 站的后处理脚本写入最终 dist/_headers 与 dist/_redirects：
 *   - 应用壳（/、/sw.js、manifest、静态资源、Pages 别名）规则来自这里
 *   - /docs/* 的 CSP 由 csp.mjs 逐块 hash 生成后注入
 *   - 旧内容站 URL -> /docs/{locale}/{topic}/ 的 301 来自 content.mjs
 * 这样两份产物不会各自写一份 _headers/_redirects 互相覆盖。 */

/** 与 cloudflare Pages 无关、始终生效的应用壳规则。 */
export const appShellHeaders = ({ base = '/', indexable = true } = {}) => {
    const rules = [
        ['/*', ['X-Content-Type-Options: nosniff', 'Referrer-Policy: strict-origin-when-cross-origin']],
        // 更新入口必须重新校验；带 hash 的应用资源另有缓存策略。
        [`${base}sw.js`, ['Cache-Control: public, no-cache, max-age=0, must-revalidate']],
        [`${base}manifest.webmanifest`, ['Cache-Control: public, no-cache, max-age=0, must-revalidate']],
        // Preview/生产别名不得与正式域名竞争索引。
        ['https://:project.pages.dev/*', ['X-Robots-Tag: noindex, follow']],
        ['https://:version.:project.pages.dev/*', ['X-Robots-Tag: noindex, follow']],
        [`${base}site/*`, ['Cache-Control: public, max-age=0, must-revalidate']],
        [`${base}404.html`, ['X-Robots-Tag: noindex, follow']],
    ];
    if (!indexable) rules.unshift(['/*', ['X-Robots-Tag: noindex, follow']]);
    return rules;
};

/** 把规则数组渲染成 Cloudflare Pages 的 _headers 文本。 */
export const renderHeaders = (rules) => `${rules
    .map(([route, values]) => `${route}\n${values.map(value => `  ${value}`).join('\n')}`)
    .join('\n\n')}\n`;

/** 把规则数组渲染成 _redirects 文本（每条 `from to status`）。 */
export const renderRedirects = (rules) => `${rules.map(([from, to, status = 301]) => `${from} ${to} ${status}`).join('\n')}\n`;
