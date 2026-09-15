import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { createSiteArtifacts, SITE_LANGUAGES, SITE_TOPICS } from '../site/site.mjs';
import { docsPagePath, legacyRedirects } from '../docs-site/src/lib/content.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.resolve(root, process.env.SCREENHELLO_SEO_OUT_DIR || 'dist');
const site = createSiteArtifacts({ base: process.env.SCREENHELLO_BASE_PATH || '/',
    origin: process.env.SCREENHELLO_SITE_ORIGIN || 'https://screenhello.com',
    indexable: process.env.SCREENHELLO_SITE_INDEXABLE !== 'false' });
const failures = [];
const check = (condition, code) => { if (!condition) failures.push(code); };
const read = filename => readFile(path.join(output, filename), 'utf8');
const attributes = (html, name) => [...html.matchAll(new RegExp(`\\b${name}="([^"]*)"`, 'g'))].map(match => match[1].replaceAll('&amp;', '&'));
let pageBytes = 0;
// 页面由 docs-site/（Fumadocs + Astro）生成：/docs/{locale}/{topic}/index.html。
// site.artifacts 只含根级文件（sitemap/robots），因此这里直接扫描 dist/docs。
const headers = await read('_headers');
const docsRule = headers.split('\n\n').find(block => block.startsWith(`${site.options.base}docs/*`)) ?? '';
check(!docsRule.includes('unsafe-inline'), 'docs-csp-unsafe-inline');
check(docsRule.includes('Content-Security-Policy:'), 'docs-csp-missing');
if (!site.options.indexable) {
    check(headers.startsWith('/*\n  X-Robots-Tag: noindex, follow'), 'preview-global-noindex');
    check(docsRule.includes('X-Robots-Tag: noindex, follow'), 'preview-docs-noindex');
}
const redirects = await read('_redirects');
for (const [from, to] of legacyRedirects(site.options.base)) {
    check(redirects.includes(`${from} ${to} 301`), `redirect-deployment:${from}`);
}
for (const [index, topic] of SITE_TOPICS.entries()) {
    for (const slug of SITE_LANGUAGES) {
        const filename = `docs/${slug}/${topic ? `${topic}/` : ''}index.html`;
        const actual = await read(filename).catch(() => null);
        check(actual !== null, `missing-page:${filename}`);
        if (actual === null) continue;
        pageBytes += Buffer.byteLength(actual);
        check((actual.match(/<h1/g) || []).length === 1, `h1:${filename}`);
        check((actual.match(/rel="canonical"/g) || []).length === 1, `canonical:${filename}`);
        const canonical = `${site.options.origin}${docsPagePath(slug, topic, site.options.base)}`;
        check(actual.includes(`<link rel="canonical" href="${canonical}"`), `canonical-deployment:${filename}`);
        if (!site.options.indexable) check(actual.includes('name="robots" content="noindex,follow"'), `docs-noindex:${filename}`);
        check((actual.match(/rel="alternate"/g) || []).length === 8, `hreflang:${filename}`);
        const expectedTitle = `${site.catalog[slug].pages[index].seoTitle ?? site.catalog[slug].pages[index].title} — ScreenHello`;
        check(actual.includes(`<title>${expectedTitle}</title>`), `seo-title:${filename}`);
        for (const metadata of ['property="og:title"', 'property="og:description"', 'property="og:url"',
            'property="og:image"', 'name="twitter:card"']) {
            check(actual.includes(metadata), `social-metadata:${metadata}:${filename}`);
        }
        check(!/googletagmanager|google-analytics|fonts.googleapis|\/home\/|__shoteasy/.test(actual), `private-or-tracking:${filename}`);
        const raw = actual.match(/<script type="application\/ld\+json">([^]*?)<\/script>/);
        check(Boolean(raw), `jsonld:${filename}`);
        if (!raw) continue;
        const schema = JSON.parse(raw[1].replaceAll('\\u003c', '<'));
        check(schema['@graph'].some(item => item['@type'] === 'WebApplication'
            && item.name === 'ScreenHello' && item['@id'] === `${site.options.origin}${site.options.base}#application`), `schema:${filename}`);
        check(schema['@graph'].some(item => item['@type'] === 'WebPage'
            && item.dateModified === site.catalog[slug].reviewed), `schema-modified:${filename}`);
        // 每个可执行内联 script 都必须在 CSP hash 里出现，否则浏览器会拒绝执行。
        for (const match of actual.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
            const [, attrs, body] = match;
            if (/\bsrc\s*=/i.test(attrs) || /application\/ld\+json/i.test(attrs)) continue;
            const digest = createHash('sha256').update(body, 'utf8').digest('base64');
            check(docsRule.includes(`'sha256-${digest}'`), `inline-script-not-hashed:${filename}`);
        }
        check(index >= 0, 'topic-index');
        for (const reference of [...attributes(actual, 'href'), ...attributes(actual, 'src')]) {
            if (reference.startsWith('/') && !reference.startsWith('//')) {
                check(reference.startsWith(site.options.base), `link-outside-base:${filename}:${reference}`);
            }
            if (!reference.startsWith(site.options.base)) continue;
            const url = new URL(reference, site.options.origin);
            let local = url.pathname.slice(site.options.base.length);
            if (!local || local.endsWith('/')) local += 'index.html';
            check(Boolean(await stat(path.join(output, local)).catch(() => null)), `broken-link:${filename}:${reference}`);
        }
    }
}
// 根 HTML：SEO 占位符必须已被注入，canonical/索引策略正确，并列出全部语种入口。
const index = await read('index.html');
check(!index.includes('SCREENHELLO_SEO_'), 'root-unprocessed-markers');
check((index.match(/rel="canonical"/g) || []).length === 1, 'root-canonical');
check(index.includes(`<link rel="canonical" href="${site.options.origin}${site.options.base}">`), 'root-canonical-base');
check(index.includes(site.options.indexable ? 'index,follow,max-image-preview:large' : 'noindex,follow'), 'root-indexability');
for (const slug of SITE_LANGUAGES) check(index.includes(`href="${site.options.base}docs/${slug}/"`), `root-discovery:${slug}`);
const sitemap = await read('sitemap.xml');
check((sitemap.match(/<loc>/g) || []).length === (site.options.indexable ? 43 : 0), 'sitemap-count');
check((sitemap.match(/<lastmod>/g) || []).length === (site.options.indexable ? 43 : 0), 'sitemap-lastmod-count');
if (site.options.indexable) check(sitemap.includes(`${site.options.base}docs/`), 'sitemap-docs-base');
const social = PNG.sync.read(await readFile(path.join(output, 'site/social.png')));
check(social.width === 1200 && social.height === 630, 'social-dimensions');
const css = await stat(path.join(output, 'site/site.css'));
check(css.size < 12_000, 'content-css-budget');
const images = await Promise.all(['before.svg', 'after.svg', 'social.png'].map(name => stat(path.join(output, 'site', name))));
check(images.every(file => file.size < 250_000), 'content-image-budget');
console.log(JSON.stringify({ output, pages: SITE_LANGUAGES.length * SITE_TOPICS.length, pageBytes, cssBytes: css.size,
    indexable: site.options.indexable, failures }, null, 2));
if (failures.length) process.exitCode = 1;
