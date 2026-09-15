import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSiteArtifacts, escapeHtml, jsonLd, loadSiteContent, pagePath, renderRootSeo, renderSitePage, SITE_LANGUAGES, SITE_TOPICS, siteOptions } from '../../site/site.mjs';
import { createPwaOptions, isCorePrecacheEntry } from '../../config/pwaConfig.js';
import { entryLocale, publicGuidePath } from '../../src/utils/publicSite.js';
import { appShellHeaders, renderHeaders } from '../../docs-site/src/lib/headers.mjs';
import { DOCS_BASE_PATH, docsPagePath, legacyRedirects } from '../../docs-site/src/lib/content.mjs';

describe('SEO content contract', () => {
    const catalog = loadSiteContent();
    it('publishes complete, different copy for all seven locales and all six topics', () => {
        expect(Object.keys(catalog)).toEqual(SITE_LANGUAGES);
        for (let index = 0; index < 6; index++) {
            expect(new Set(SITE_LANGUAGES.map(slug => catalog[slug].pages[index].title)).size).toBe(7);
            expect(new Set(SITE_LANGUAGES.map(slug => catalog[slug].pages[index].description)).size).toBe(7);
            for (const slug of SITE_LANGUAGES) {
                expect(catalog[slug].pages[index].sections.length).toBeGreaterThanOrEqual(3);
                expect(catalog[slug].pages[index].sections.every(([, text]) => text.length > 50)).toBe(true);
                expect(catalog[slug].reviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
                expect(catalog[slug].pages[index].seoTitle).toBeTruthy();
                expect(catalog[slug].pages[index].seoTitle.length).toBeLessThanOrEqual(65);
            }
        }
    });
    it.each(['/', '/tools/screenhello/'])('routes every locale and topic into the /docs/ site under %s', base => {
        // 页面由 docs/（Fumadocs）生成，这里只校验根级契约与 URL 形状。
        for (const slug of SITE_LANGUAGES) for (const topic of SITE_TOPICS) {
            const route = pagePath(base, slug, topic);
            expect(route.startsWith(`${base}docs/`)).toBe(true);
            expect(route).toBe(`${base}docs/${slug}/${topic ? `${topic}/` : ''}`);
            // 公开文档页不得进入编辑器壳的预缓存清单。
            expect(isCorePrecacheEntry({ url: route.replace(base, '') + 'index.html', size: 20_000 })).toBe(false);
        }
        // sitemap 仍覆盖 43 个公开 URL：根 + 7 语种 × 6 主题。
        const { artifacts } = createSiteArtifacts({ base });
        expect(artifacts.get('sitemap.xml').match(/<loc>/g)).toHaveLength(1 + SITE_LANGUAGES.length * SITE_TOPICS.length);
        expect(artifacts.get('sitemap.xml').match(/<lastmod>/g)).toHaveLength(1 + SITE_LANGUAGES.length * SITE_TOPICS.length);
        expect(artifacts.get('sitemap.xml')).toContain(`<lastmod>${catalog.en.reviewed}</lastmod>`);
        expect(artifacts.get('sitemap.xml')).toContain(`<loc>https://screenhello.com${base}docs/${SITE_LANGUAGES[0]}/</loc>`);
    });
    it('keeps the legacy URL shape distinct from the new docs route', () => {
        // 旧地址 /{locale}/{topic}/ 与新的 /docs/{locale}/{topic}/ 必须可区分，
        // 否则 301 会自指。
        const legacy = legacyRedirects('/');
        // 每页三种历史形式（无斜杠、带斜杠、index.html），不含根路径。
        expect(legacy).toHaveLength(SITE_LANGUAGES.length * SITE_TOPICS.length * 3);
        for (const [from, to] of legacy) {
            expect(to.startsWith(`${DOCS_BASE_PATH}/`)).toBe(true);
            expect(from).not.toBe(to);
        }
        expect(legacy).toContainEqual(['/en/beautify', docsPagePath('en', 'beautify')]);
        // 编辑器根入口不得被重定向到文档站。
        expect(legacy.some(([from]) => from === '/' || from === '/index.html')).toBe(false);
    });
    it('makes preview HTML nonindexable without preventing crawlers from reading noindex', () => {
        const { artifacts, options } = createSiteArtifacts({ indexable: false });
        expect(artifacts.get('sitemap.xml')).not.toContain('<loc>');
        expect(artifacts.get('robots.txt')).not.toContain('Disallow: /');
        const root = renderRootSeo(readFileSync(new URL('../../index.html', import.meta.url), 'utf8'), options, catalog);
        expect(root).toContain('content="noindex,follow"');
        expect(root).toContain('<noscript>');
    });
    it('escapes content and script closing tags', () => {
        expect(escapeHtml('<img src=x onerror="x">&\'')).toBe('&lt;img src=x onerror=&quot;x&quot;&gt;&amp;&#39;');
        expect(jsonLd({ title: '</script><script>alert(1)</script>' })).not.toContain('<');
        const unsafe = structuredClone(catalog);
        unsafe.en.pages[0].title = '</h1><img src=x onerror="alert(1)">';
        const html = renderSitePage('en', '', siteOptions(), unsafe);
        expect(html).not.toContain('<img src=x');
        expect(html.match(/<h1>/g)).toHaveLength(1);
    });
    it.each(['/', '/tools/screenhello/'])('revalidates PWA entrypoints and keeps Pages aliases nonindexable under %s', base => {
        // _headers 由 docs-site 站后处理统一写出（docs-site/src/lib/headers.mjs），
        // 这里校验同一份规则源，避免两处各写一份而互相覆盖。
        for (const indexable of [true, false]) {
            const headers = renderHeaders(appShellHeaders({ base, indexable }));
            for (const filename of ['sw.js', 'manifest.webmanifest']) {
                expect(headers).toContain(`${base}${filename}\n  Cache-Control: public, no-cache, max-age=0, must-revalidate`);
            }
            expect(headers).toContain('https://:project.pages.dev/*\n  X-Robots-Tag: noindex, follow');
            expect(headers).toContain('https://:version.:project.pages.dev/*\n  X-Robots-Tag: noindex, follow');
            expect(headers.split('\n\n')[0].includes('noindex')).toBe(!indexable);
        }
    });
    it('keeps /docs/ out of the editor service-worker navigation fallback', () => {
        const [allow] = createPwaOptions('/').workbox.navigateFallbackAllowlist;
        expect(allow.test('/docs/')).toBe(false);
        expect(allow.test('/docs/en/beautify/')).toBe(false);
    });
    it.each(['/../', '//evil/', '/a?b/', '/a b/', '/%2e/'])('rejects unsafe base %s', base => {
        expect(() => siteOptions({ base })).toThrow('site-invalid-base');
    });
    it.each(['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?x=1'])('rejects unsafe origin %s', origin => {
        expect(() => siteOptions({ origin })).toThrow('site-invalid-origin');
    });
    it('does not invent ratings or FAQ rich results', () => {
        for (const source of createSiteArtifacts().artifacts.values()) {
            expect(source).not.toMatch(/aggregateRating|reviewCount|application\/ld\+json[^]*"@type":"FAQPage"/);
        }
    });
});

describe('editor and navigation boundaries', () => {
    it.each(['/', '/tools/screenhello/'])('only lets Workbox navigate to the editor under %s', base => {
        const [allow] = createPwaOptions(base).workbox.navigateFallbackAllowlist;
        for (const suffix of ['', '?lang=en', 'index.html', 'index.html?lang=de']) expect(allow.test(base + suffix)).toBe(true);
        for (const suffix of ['en/', 'en/guide/', 'fake/', '404.html', 'assets/file.png', 'robots.txt']) expect(allow.test(base + suffix)).toBe(false);
        expect(allow.test('/different/')).toBe(false);
    });
    it('normalizes only explicitly supported URL languages and preserves preferences otherwise', () => {
        expect(entryLocale('?lang=de', 'zh-CN')).toBe('de-DE');
        expect(entryLocale('?lang=ko', 'zh-CN')).toBe('ko-KR');
        expect(entryLocale('?lang=es', 'zh-CN')).toBe('es-ES');
        expect(entryLocale('?lang=en', 'zh-CN')).toBe('en-US');
        expect(entryLocale('?lang=en-US', 'zh-CN')).toBe('en-US');
        expect(entryLocale('?lang=constructor', 'zh-CN')).toBe('zh-CN');
        expect(entryLocale('', 'zh-TW')).toBe('zh-TW');
        expect(publicGuidePath('de-DE', '/nested/')).toBe('/nested/docs/de/guide/');
    });
});
