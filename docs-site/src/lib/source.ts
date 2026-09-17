import { getCollection } from 'astro:content';
import { loader } from 'fumadocs-core/source';
import type { Root } from 'fumadocs-core/page-tree';
import { DOCS_LOCALES, DOCS_READING_ORDER, docsPagePath } from './content.mjs';

/* 仅服务端使用：astro:content 不能在客户端 island 里导入。
 *
 * 这里刻意不使用 fumadocs 的 i18n：它的内容存储以 `{locale}.{slug}` 为键，
 * 且 i18n 模式下会忽略显式提供的 slugs（实测得到 `debeautify` 这类合并 slug，
 * locale 全被判为 en，getPages(locale) 过滤失效）。
 * 因此路由与 pageTree 由本模块显式构建，结构与 site/content/*.json 一一对应，
 * 不依赖框架对目录/点号布局的推断。 */
const pages = await getCollection('docs');
const metas = await getCollection('meta');

const files = [
    ...pages.map(page => ({
        type: 'page' as const,
        path: page.id,
        data: { ...page.data, getText: () => page.body ?? '' },
    })),
    ...metas.map(meta => ({
        type: 'meta' as const,
        path: meta.id,
        data: meta.data,
    })),
];

export const source = loader({
    baseUrl: `${import.meta.env.BASE_URL}docs`,
    url: (slugs: string[]) => `${import.meta.env.BASE_URL}docs/${slugs.join('/')}`,
    source: { files },
});

/* Astro 的 collection entry 用 id（如 `en/beautify`），不是 path。
   meta.json 落在 meta collection，不会混进 docs。 */
export function pagesForLocale(locale: string) {
    return pages
        // 必须按整段比较：否则 'pt-pt/' 这类前缀会误匹配到别的语种。
        .filter(page => page.id.split('/')[0] === locale)
        .map(page => ({ page, topic: page.id.split('/').slice(1).join('/').replace(/\.mdx?$/, '') }))
        // 侧边栏按阅读顺序排（不是 URL 顺序）。
        .sort((a, b) => DOCS_READING_ORDER.indexOf(a.topic) - DOCS_READING_ORDER.indexOf(b.topic));
}

/* Astro 的 glob loader 会把 `{locale}/meta.json` 的 id 归一成 `{locale}`
   （去掉 /meta.json 后缀），所以这里按目录段匹配，不能比较完整文件名。 */
export function catalogForLocale(locale: string) {
    return metas.find(meta => meta.id.split('/')[0] === locale)?.data;
}

/* index.mdx 的 topic 是 'index'，但内容顺序里用 '' 表示首页；
   meta.json 的条目也用 'index'，两处必须统一，否则第 01 步查不到。 */
const pageSlug = (topic: string) => topic || 'index';

/** 侧边栏/页脚显示名：优先取 meta.json 的纯名称，回退到页面标题。 */
function sidebarLabel(labels: string[], topic: string, fallback: string) {
    const key = pageSlug(topic);
    const labelled = labels.find(item => item.startsWith(`${key}~`));
    return labelled ? labelled.slice(labelled.indexOf('~') + 1) : fallback;
}

/** 侧边栏按主题展示，教程中的操作步骤由正文表达。 */
export function treeForLocale(locale: string): Root {
    const catalog = catalogForLocale(locale);
    const labels = catalog?.pages ?? [];
    const bySlug = new Map(pagesForLocale(locale).map(entry => [entry.topic, entry.page]));
    const children = DOCS_READING_ORDER.map(topic => {
        const page = bySlug.get(pageSlug(topic));
        if (!page) return null;
        return {
            type: 'page' as const,
            name: sidebarLabel(labels, topic, page.data.title),
            url: docsPagePath(locale, topic),
        };
    }).filter(Boolean) as Root['children'];
    return {
        type: 'root',
        name: catalog?.title ?? locale,
        children,
    };
}

export { DOCS_LOCALES };
