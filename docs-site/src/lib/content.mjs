/* docs 应用与构建后处理共享的内容契约。纯 ESM，可被 Astro 与 Node 脚本同时导入。 */

export const DOCS_BASE_PATH = '/docs';
// Astro 在 server/client 构建中注入相同的 BASE_URL；纯 Node 调用显式传 base。
const deploymentBase = () => import.meta.env?.BASE_URL || '/';

/** 与 site/content/*.json 的 7 个 locale 目录一一对应。 */
export const DOCS_LOCALES = ['en', 'zh-cn', 'zh-tw', 'de', 'ko', 'es', 'pt-pt'];

/** '' 是站点首页；其余 5 个主题与旧站 SITE_TOPICS 顺序一致（URL 顺序，保持稳定）。 */
export const DOCS_TOPICS = ['', 'beautify', 'frames', 'compression', 'guide', 'privacy'];

/* 侧栏主题顺序，与 URL 顺序解耦；首页通过品牌链接访问。 */
export const DOCS_READING_ORDER = ['guide', 'beautify', 'frames', 'compression', 'privacy'];

export const DOCS_DEFAULT_LOCALE = 'en';

/** 旧站 URL：/{locale}/{topic}/ —— 迁移后全部 301 到新地址。 */
export const legacyPagePath = (base, locale, topic) => `${base}${locale}/${topic ? `${topic}/` : ''}`;

/** 新站 URL：/docs/{locale}/{topic}/ */
export const docsPagePath = (locale, topic, base = deploymentBase()) => `${base}docs/${locale}/${topic ? `${topic}/` : ''}`;

/** 42 个主题页 URL（不含作为跳转入口的 /docs/ 本身）。 */
export const docsUrls = (base = deploymentBase()) => DOCS_LOCALES.flatMap(
    locale => DOCS_TOPICS.map(topic => docsPagePath(locale, topic, base)),
);

/* 旧内容站 URL -> 新文档地址的 301。
   注意：根 `/` 是编辑器壳，必须保持 200，不能重定向到文档站；
   `/docs/` 有自己的入口页。因此这里不含根路径规则。 */
export const legacyRedirects = (base = '/') => {
    const rules = [];
    for (const locale of DOCS_LOCALES) {
        for (const topic of DOCS_TOPICS) {
            const from = legacyPagePath(base, locale, topic);
            const to = docsPagePath(locale, topic, base);
            // Cloudflare Pages 会做尾斜杠归一，但本地 Vite 中间件是精确匹配，
            // 浏览器请求的又是带尾斜杠的形式，因此三种写法都显式列出。
            rules.push([from.slice(0, -1), to]);
            rules.push([from, to]);
            rules.push([`${from}index.html`, to]);
        }
    }
    return rules;
};
