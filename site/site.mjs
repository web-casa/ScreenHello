import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';

export const SITE_LANGUAGES = ['en', 'zh-cn', 'zh-tw', 'de', 'ko', 'es', 'pt-pt'];
export const SITE_TOPICS = ['', 'beautify', 'frames', 'compression', 'guide', 'privacy'];
export const PUBLIC_SOURCE = 'https://github.com/web-casa/ScreenHello';
export const UPSTREAM_SOURCE = 'https://github.com/ricocc/shoteasy';
export const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
export const jsonLd = value => JSON.stringify(value).replace(/</g, '\\u003c');

export function siteOptions({ base = '/', origin = 'https://screenhello.com', indexable = true } = {}) {
    if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) throw new Error('site-invalid-base');
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
        throw new Error('site-invalid-origin');
    }
    if (typeof indexable !== 'boolean') throw new Error('site-invalid-indexability');
    return { base, origin: parsed.origin, indexable };
}

export function loadSiteContent() {
    return Object.fromEntries(SITE_LANGUAGES.map(slug => {
        const content = JSON.parse(readFileSync(new URL(`./content/${slug}.json`, import.meta.url), 'utf8'));
        const keys = ['lang', 'name', 'open', 'skip', 'nav', 'languages', 'before', 'after', 'example', 'related', 'source', 'upstream', 'browser', 'updated', 'reviewed'];
        if (keys.some(key => typeof content[key] !== 'string' || !content[key].trim())
            || !/^\d{4}-\d{2}-\d{2}$/.test(content.reviewed)
            || content.lang.toLowerCase() !== slug || content.labels?.length !== 6 || content.pages?.length !== 6) {
            throw new Error(`site-incomplete-locale:${slug}`);
        }
        for (const page of content.pages) {
            // 每个 section 的前两个元素固定为 [标题, 正文]；
            // 第三个元素是可选的子块数组（H3 / 表格 / 引用），由 docs 渲染。
            if (!page.title || !page.description || typeof page.seoTitle !== 'string' || !page.seoTitle.trim() || page.sections?.length < 3
                || page.sections.some(section => section.length < 2 || section.length > 3
                    || typeof section[0] !== 'string' || !section[0].trim()
                    || typeof section[1] !== 'string' || !section[1].trim()
                    || (section.length === 3 && !Array.isArray(section[2])))) {
                throw new Error(`site-incomplete-page:${slug}`);
            }
        }
        return [slug, content];
    }));
}

/** 公开文档站由 Fumadocs 生成，URL 为 /docs/{locale}/{topic}/。 */
export const DOCS_BASE = 'docs/';
export const pagePath = (base, slug, topic = '') => `${base}${DOCS_BASE}${slug}/${topic ? `${topic}/` : ''}`;
/** 旧内容站 URL：/{locale}/{topic}/ —— 迁移后全部 301 到 pagePath。 */
export const legacyPagePath = (base, slug, topic = '') => `${base}${slug}/${topic ? `${topic}/` : ''}`;
const absolute = (options, route) => `${options.origin}${route}`;
const link = (href, text, attrs = '') => `<a href="${escapeHtml(href)}"${attrs}>${escapeHtml(text)}</a>`;

function metadata({ title, description, url, lang, options, alternates = '' }) {
    const social = absolute(options, `${options.base}site/social.png`);
    const ogLocale = { en: 'en_US', 'zh-CN': 'zh_CN', 'zh-TW': 'zh_TW', de: 'de_DE', ko: 'ko_KR', es: 'es_ES', 'pt-PT': 'pt_PT' }[lang];
    return `<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="${options.indexable ? 'index,follow,max-image-preview:large' : 'noindex,follow'}">
<link rel="canonical" href="${escapeHtml(url)}">
${alternates}
<meta property="og:type" content="website"><meta property="og:site_name" content="ScreenHello">
<meta property="og:locale" content="${escapeHtml(ogLocale)}">
<meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(url)}"><meta property="og:image" content="${escapeHtml(social)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escapeHtml(title)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${escapeHtml(social)}">
<meta name="twitter:image:alt" content="${escapeHtml(title)}">`;
}

function siteSchema(options, content, page, url, home) {
    const root = absolute(options, options.base);
    const app = {
        '@type': 'WebApplication', '@id': `${root}#application`, name: 'ScreenHello', url: root,
        description: content.pages[0].description, applicationCategory: 'MultimediaApplication',
        operatingSystem: 'Web browser', browserRequirements: content.browser,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        sameAs: [PUBLIC_SOURCE],
    };
    return { '@context': 'https://schema.org', '@graph': [app,
        { '@type': 'WebSite', '@id': `${root}#website`, name: 'ScreenHello', url: root },
        { '@type': 'WebPage', '@id': `${url}#webpage`, url, name: page.title, description: page.description,
            dateModified: content.reviewed,
            inLanguage: content.lang, isPartOf: { '@id': `${root}#website` }, about: { '@id': `${root}#application` } },
        { '@type': 'BreadcrumbList', itemListElement: [
            { '@type': 'ListItem', position: 1, name: content.labels[0], item: home },
            ...(url === home ? [] : [{ '@type': 'ListItem', position: 2, name: page.title, item: url }]),
        ] },
    ] };
}

export function renderSitePage(slug, topic, options, catalog) {
    const topicIndex = SITE_TOPICS.indexOf(topic);
    if (!SITE_LANGUAGES.includes(slug) || topicIndex < 0) throw new Error('site-unknown-page');
    const content = catalog[slug];
    const page = content.pages[topicIndex];
    const url = absolute(options, pagePath(options.base, slug, topic));
    const alternates = SITE_LANGUAGES.map(language => `<link rel="alternate" hreflang="${catalog[language].lang}" href="${escapeHtml(absolute(options, pagePath(options.base, language, topic)))}">`).join('\n')
        + `\n<link rel="alternate" hreflang="x-default" href="${escapeHtml(absolute(options, pagePath(options.base, 'en', topic)))}">`;
    const nav = SITE_TOPICS.map((item, index) => link(pagePath(options.base, slug, item), content.labels[index], item === topic ? ' aria-current="page"' : '')).join('');
    const languageLinks = SITE_LANGUAGES.map(language => link(pagePath(options.base, language, topic), catalog[language].name,
        ` lang="${catalog[language].lang}" hreflang="${catalog[language].lang}"${language === slug ? ' aria-current="true"' : ''}`)).join('');
    const sections = page.sections.map(([heading, body], index) => `<section class="section" id="section-${index + 1}"><span class="section-number" aria-hidden="true">0${index + 1}</span><div><h2>${escapeHtml(heading)}</h2><p>${escapeHtml(body)}</p></div></section>`).join('\n');
    const example = topic === '' || topic === 'beautify' || topic === 'frames' ? `<figure class="comparison"><div><span>${escapeHtml(content.before)}</span><img src="${options.base}site/before.svg" width="640" height="400" alt="${escapeHtml(content.before)}"></div><div><span>${escapeHtml(content.after)}</span><img src="${options.base}site/after.svg" width="640" height="400" alt="${escapeHtml(content.after)}"></div><figcaption>${escapeHtml(content.example)}</figcaption></figure>` : '';
    return `<!doctype html>
<html lang="${content.lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${metadata({ title: `${page.seoTitle ?? page.title} — ScreenHello`, description: page.description, url, lang: content.lang, options, alternates })}
<link rel="icon" type="image/svg+xml" href="${options.base}favicon.svg"><link rel="icon" href="${options.base}favicon.ico">
<link rel="stylesheet" href="${options.base}site/site.css">
<script type="application/ld+json">${jsonLd(siteSchema(options, content, page, url, absolute(options, pagePath(options.base, slug))))}</script>
</head><body>
${link('#content', content.skip, ' class="skip"')}
<header class="masthead"><a class="brand" href="${pagePath(options.base, slug)}"><img src="${options.base}favicon.svg" width="34" height="34" alt="">ScreenHello<span aria-hidden="true"> / </span></a>${link(`${options.base}?lang=${content.lang}`, content.open, ' class="button"')}</header>
<nav class="topics" aria-label="${escapeHtml(content.nav)}">${nav}</nav>
<main id="content"><header class="hero"><p class="eyebrow">ScreenHello / ${escapeHtml(content.labels[topicIndex])}</p><h1>${escapeHtml(page.title)}</h1><p class="lead">${escapeHtml(page.description)}</p></header>
${example}<div class="sections">${sections}</div>
<aside class="compatibility"><p>${escapeHtml(content.browser)}</p><p>${escapeHtml(content.updated)} <time datetime="${content.reviewed}">${content.reviewed}</time></p></aside>
<section class="related"><h2>${escapeHtml(content.related)}</h2><nav aria-label="${escapeHtml(content.related)}">${nav}</nav>${link(`${options.base}?lang=${content.lang}`, content.open, ' class="button"')}</section></main>
<footer><nav class="languages" aria-label="${escapeHtml(content.languages)}">${languageLinks}</nav><p>${link(PUBLIC_SOURCE, content.source)} · ${link(UPSTREAM_SOURCE, 'Shoteasy')}</p><p>${escapeHtml(content.upstream)}</p><p>ScreenHello · screenhello.com</p></footer>
</body></html>`;
}

export function renderRootSeo(html, options, catalog) {
    const content = catalog['zh-cn'];
    const rootTitle = '免费在线截图美化工具 — ScreenHello';
    const meta = metadata({ title: rootTitle, description: content.pages[0].description,
        url: absolute(options, options.base), lang: 'zh-CN', options });
    const fallback = `<noscript><main style="max-width:52rem;margin:3rem auto;padding:1rem;color:#f5f5f5;font-family:sans-serif"><h1>${rootTitle}</h1><p>${escapeHtml(content.pages[0].description)}</p><p>编辑器需要 JavaScript；产品介绍与指南无需 JavaScript 即可阅读。</p><nav aria-label="Language">${SITE_LANGUAGES.map(slug => link(pagePath(options.base, slug), catalog[slug].name, ' style="color:#99f6e4;margin-right:1rem"')).join('')}</nav>${link(pagePath(options.base, 'zh-cn', 'privacy'), content.labels[5], ' style="color:#99f6e4"')}</main></noscript>`;
    const schema = siteSchema(options, content, { title: rootTitle, description: content.pages[0].description }, absolute(options, options.base), absolute(options, options.base));
    return html.replace('<!-- SCREENHELLO_SEO_HEAD -->', `${meta}\n<script type="application/ld+json">${jsonLd(schema)}</script>`)
        .replace('<!-- SCREENHELLO_SEO_FALLBACK -->', fallback);
}

/* 页面本身由 docs/（Fumadocs + Astro）生成，因此这里只负责与页面渲染无关的
   根级产物；/docs/* 的 _headers、_redirects、sitemap、robots、llms.txt、404
   统一由 docs/scripts/post-process.mjs 写入，避免两处各自覆盖同一文件。
   sitemap 仍覆盖全部 43 个公开 URL（根 + 42 个主题页）。 */
export function createSiteArtifacts(input = {}) {
    const options = siteOptions(input);
    const catalog = loadSiteContent();
    const artifacts = new Map();
    const rootModified = Object.values(catalog).map(content => content.reviewed).sort().at(-1);
    const urls = [{ loc: absolute(options, options.base), lastmod: rootModified }];
    for (const slug of SITE_LANGUAGES) for (const topic of SITE_TOPICS) {
        urls.push({ loc: absolute(options, pagePath(options.base, slug, topic)), lastmod: catalog[slug].reviewed });
    }
    artifacts.set('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${(options.indexable ? urls : []).map(({ loc, lastmod }) => `<url><loc>${escapeHtml(loc)}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}</urlset>\n`);
    // Let crawlers read noindex on preview pages; robots.txt is not authentication.
    artifacts.set('robots.txt', `User-agent: *\nAllow: /\n${options.indexable ? `Sitemap: ${absolute(options, `${options.base}sitemap.xml`)}\n` : '# Preview: HTML and X-Robots-Tag use noindex. Restrict private deployments with authentication.\n'}`);
    for (const [name, source] of artifacts) {
        if (name.endsWith('.html') && Buffer.byteLength(source) > 40_000) throw new Error(`site-page-budget:${name}`);
    }
    return { artifacts, options, catalog };
}
