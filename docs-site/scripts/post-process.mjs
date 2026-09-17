/* docs 站构建后处理：把纯静态产物补齐为可上线的 Cloudflare Pages 输出。
 *
 * 负责旧站 site/site.mjs 里与页面渲染无关的那部分契约：
 *   - /docs/* 的 CSP（逐块 SHA-256，不用 unsafe-inline）
 *   - 每页 hreflang 矩阵与 JSON-LD（数据块，不可执行）
 *   - sitemap.xml / robots.txt / llms.txt / 404.html / _headers / _redirects
 *   - 旧 URL /{locale}/{topic}/ -> /docs/{locale}/{topic}/ 的 301
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    DOCS_LOCALES, DOCS_TOPICS, docsPagePath, legacyRedirects,
} from '../src/lib/content.mjs';
import { collectCspInventory, buildDocsCsp, assertCovered } from '../src/lib/csp.mjs';
import { appShellHeaders, renderHeaders, renderRedirects } from '../src/lib/headers.mjs';
import { siteOptions } from '../../site/site.mjs';

const distRoot = fileURLToPath(new URL('../dist', import.meta.url));
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const docsRoot = path.join(distRoot, 'docs');

const { base: BASE, origin: ORIGIN, indexable: INDEXABLE } = siteOptions({
    base: process.env.SCREENHELLO_BASE_PATH || '/',
    origin: process.env.SCREENHELLO_SITE_ORIGIN || 'https://screenhello.com',
    indexable: process.env.SCREENHELLO_SITE_INDEXABLE !== 'false',
});
const DOCS_BASE_PATH = `${BASE}docs`;
const pagePath = (locale, topic) => docsPagePath(locale, topic, BASE);

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const jsonLd = value => JSON.stringify(value).replace(/</g, '\\u003c');
const absolute = route => `${ORIGIN}${route}`;

const readCatalog = (locale) => JSON.parse(
    readFileSync(path.join(repoRoot, 'site', 'content', `${locale}.json`), 'utf8'),
);

const catalogs = Object.fromEntries(DOCS_LOCALES.map(locale => [locale, readCatalog(locale)]));

/** 从产物路径反推 locale 与 topic：docs/{locale}/{topic}/index.html 或 docs/{locale}/index.html。 */
function pageLocation(file) {
    const relative = path.relative(docsRoot, file);
    const segments = relative.split(path.sep);
    const locale = segments[0];
    const topic = segments.length >= 3 ? segments[1] : '';
    return { locale, topic };
}

function alternates(locale, topic) {
    const links = DOCS_LOCALES.map(other => (
        `<link rel="alternate" hreflang="${catalogs[other].lang}" href="${escapeHtml(absolute(pagePath(other, topic)))}">`
    ));
    // x-default 指向英文版本，与旧站一致。
    links.push(`<link rel="alternate" hreflang="x-default" href="${escapeHtml(absolute(pagePath('en', topic)))}">`);
    void locale;
    return links.join('\n');
}

function pageSchema(locale, topic) {
    const catalog = catalogs[locale];
    const url = absolute(pagePath(locale, topic));
    const home = absolute(pagePath(locale, ''));
    const topicIndex = DOCS_TOPICS.indexOf(topic);
    const page = catalog.pages[topicIndex];
    const appRoot = absolute(BASE);
    return {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'WebApplication', '@id': `${appRoot}#application`, name: 'ScreenHello', url: appRoot,
                description: catalogs.en.pages[0].description, applicationCategory: 'MultimediaApplication',
                operatingSystem: 'Web browser', browserRequirements: catalog.browser,
                offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
                sameAs: ['https://github.com/web-casa/ScreenHello'],
            },
            { '@type': 'WebSite', '@id': `${appRoot}#website`, name: 'ScreenHello', url: appRoot },
            {
                '@type': 'WebPage', '@id': `${url}#webpage`, url, name: page.title, description: page.description,
                dateModified: catalog.reviewed, inLanguage: catalog.lang,
                isPartOf: { '@id': `${appRoot}#website` }, about: { '@id': `${appRoot}#application` },
            },
            {
                '@type': 'BreadcrumbList',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: catalog.labels[0], item: home },
                    ...(topicIndex <= 0 ? [] : [{ '@type': 'ListItem', position: 2, name: page.title, item: url }]),
                ],
            },
        ],
    };
}

const walk = (directory) => readdirSync(directory).flatMap((name) => {
    const target = path.join(directory, name);
    return statSync(target).isDirectory() ? walk(target) : [target];
});

const htmlFiles = walk(docsRoot).filter(file => file.endsWith('.html'));

// ---------- 1. 注入 hreflang 与 JSON-LD ----------
let injected = 0;
for (const file of htmlFiles) {
    const { locale, topic } = pageLocation(file);
    if (!DOCS_LOCALES.includes(locale)) throw new Error(`docs-unknown-locale:${locale}`);
    let html = readFileSync(file, 'utf8');
    if (html.includes('hreflang=')) continue;
    const schema = pageSchema(locale, topic);
    const block = `<meta name="robots" content="${INDEXABLE ? 'index,follow,max-image-preview:large' : 'noindex,follow'}">\n${alternates(locale, topic)}\n<script type="application/ld+json">${jsonLd(schema)}</script>\n`;
    html = html.replace('</head>', `${block}</head>`);
    writeFileSync(file, html);
    injected++;
}

// ---------- 2. /docs/ 入口页 ----------
// 只是跳转入口，不算内容页，因此不进 sitemap（保持 43 条：根 + 42 主题页）。
// 必须在 CSP 扫描之前写入，这样它同样受 hash 覆盖校验。
writeFileSync(path.join(docsRoot, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ScreenHello docs</title>`
    + `<meta name="robots" content="noindex,follow"><link rel="canonical" href="${escapeHtml(absolute(pagePath('en', '')))}">`
    + `<meta http-equiv="refresh" content="0; url=${DOCS_BASE_PATH}/en/"></head>`
    + `<body><p>Redirecting to <a href="${DOCS_BASE_PATH}/en/">ScreenHello docs</a>.</p></body></html>`);

// ---------- 3. CSP：逐块 hash，失败即阻断 ----------
const inventory = collectCspInventory(docsRoot);
assertCovered(docsRoot, inventory.hashes);
const docsCsp = buildDocsCsp(inventory.hashes);

// ---------- 4. _headers：应用壳规则 + /docs/* 的 hash CSP ----------
const docsHeaderValues = [
    `Content-Security-Policy: ${docsCsp}`,
    'Cache-Control: public, max-age=0, must-revalidate',
];
if (!INDEXABLE) docsHeaderValues.push('X-Robots-Tag: noindex, follow');
const headerRules = [
    ...appShellHeaders({ base: BASE, indexable: INDEXABLE }),
    [`${DOCS_BASE_PATH}/*`, docsHeaderValues],
    // Astro 产物带内容 hash，可长期缓存。
    [`${BASE}_astro/*`, ['Cache-Control: public, max-age=31536000, immutable']],
];
writeFileSync(path.join(distRoot, '_headers'), renderHeaders(headerRules));

// ---------- 5. _redirects：旧 URL -> /docs/{locale}/{topic}/ ----------
const redirects = legacyRedirects(BASE);
writeFileSync(path.join(distRoot, '_redirects'), renderRedirects(redirects));

// ---------- 6. sitemap / robots / llms.txt / 404 ----------
const rootModified = Object.values(catalogs).map(catalog => catalog.reviewed).sort().at(-1);
const urls = [
    { loc: absolute(BASE), lastmod: rootModified },
    ...DOCS_LOCALES.flatMap(locale => DOCS_TOPICS.map(topic => ({
        loc: absolute(pagePath(locale, topic)), lastmod: catalogs[locale].reviewed,
    }))),
];
writeFileSync(path.join(distRoot, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${(INDEXABLE ? urls : []).map(({ loc, lastmod }) => `<url><loc>${escapeHtml(loc)}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}</urlset>\n`);
writeFileSync(path.join(distRoot, 'robots.txt'),
    `User-agent: *\nAllow: /\n${INDEXABLE ? `Sitemap: ${absolute(`${BASE}sitemap.xml`)}\n` : '# Preview: HTML and X-Robots-Tag use noindex. Restrict private deployments with authentication.\n'}`);
writeFileSync(path.join(distRoot, 'llms.txt'),
    `# ScreenHello\n\n> Local-first screenshot editing. Images are processed on the user's device. No cloud account or cloud sync.\n\nLast reviewed: ${rootModified}. This optional directory links to public product information, not private projects or development notes. Code and optional artwork have separate licences. Desktop candidates and browser extensions are not advertised as released products.\n\n## Canonical product facts\n\n- ScreenHello is a browser-based screenshot editor with no backend account or cloud project sync.\n- It exports PNG, JPG, WebP and standard AVIF. Adjustable compression preview is available for PNG, JPG and WebP; AVIF has no quality control or compression preview.\n- Portable .screenhello project files are user-saved backups. Browser drafts remain local and may be removed when site data is cleared.\n\n## English canonical pages\n${DOCS_TOPICS.map((topic, index) => `- [${catalogs.en.pages[index].seoTitle ?? catalogs.en.pages[index].title}](${absolute(pagePath('en', topic))}): ${catalogs.en.pages[index].description}`).join('\n')}\n\n## Localized pages\n${DOCS_LOCALES.filter(locale => locale !== 'en').flatMap(locale => DOCS_TOPICS.map((topic, index) => `- [${catalogs[locale].labels[index]} (${catalogs[locale].name})](${absolute(pagePath(locale, topic))}): ${catalogs[locale].pages[index].description}`)).join('\n')}\n`);
writeFileSync(path.join(distRoot, '404.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>Page not found — ScreenHello</title></head><body><main><h1>Page not found</h1><p>This address does not exist. Your local projects have not been changed.</p><p><a href="${BASE}">Open editor</a> · <a href="${DOCS_BASE_PATH}/en/">Product &amp; help</a></p></main></body></html>`);

// ---------- 7. 自检 ----------
for (const required of ['_headers', '_redirects', 'sitemap.xml', 'robots.txt', 'llms.txt', '404.html']) {
    if (!existsSync(path.join(distRoot, required))) throw new Error(`docs-output-missing:${required}`);
}
if (docsCsp.includes('unsafe-inline')) throw new Error('docs-csp-unsafe-inline');
for (const file of htmlFiles) {
    const html = readFileSync(file, 'utf8');
    if ((html.match(/rel="alternate" hreflang=/g) || []).length !== DOCS_LOCALES.length + 1) {
        throw new Error(`docs-hreflang-count:${path.relative(distRoot, file)}`);
    }
    if (!html.includes('application/ld+json')) throw new Error(`docs-jsonld-missing:${path.relative(distRoot, file)}`);
    for (const metadata of ['property="og:title"', 'property="og:description"', 'property="og:url"', 'property="og:image"', 'name="twitter:card"']) {
        if (!html.includes(metadata)) throw new Error(`docs-social-metadata:${metadata}:${path.relative(distRoot, file)}`);
    }
}

console.log(JSON.stringify({
    pages: htmlFiles.length,
    injected,
    hreflangPerPage: DOCS_LOCALES.length + 1,
    sitemapUrls: urls.length,
    redirects: redirects.length,
    cspHashes: {
        scripts: inventory.hashes.scripts.size,
        styles: inventory.hashes.styles.size,
        styleAttributes: inventory.hashes.attributes.size,
    },
    indexable: INDEXABLE,
    contentReviewDate: rootModified,
}, null, 2));
