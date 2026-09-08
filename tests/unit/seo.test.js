import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSiteArtifacts, escapeHtml, jsonLd, loadSiteContent, renderRootSeo, renderSitePage, SITE_LANGUAGES, SITE_TOPICS, siteOptions } from '../../site/site.mjs';
import { createPwaOptions, isCorePrecacheEntry } from '../../config/pwaConfig.js';
import { entryLocale, publicGuidePath } from '../../src/utils/publicSite.js';

describe('SEO content contract', () => {
    const catalog = loadSiteContent();
    it('publishes complete, different copy for all seven locales and all six topics', () => {
        expect(Object.keys(catalog)).toEqual(SITE_LANGUAGES);
        for (let index = 0; index < 6; index++) {
            expect(new Set(SITE_LANGUAGES.map(slug => catalog[slug].pages[index].title)).size).toBe(7);
            expect(new Set(SITE_LANGUAGES.map(slug => catalog[slug].pages[index].description)).size).toBe(7);
            for (const slug of SITE_LANGUAGES) {
                expect(catalog[slug].pages[index].sections).toHaveLength(3);
                expect(catalog[slug].pages[index].sections.every(([, text]) => text.length > 50)).toBe(true);
            }
        }
    });
    it.each(['/', '/tools/screenhello/'])('generates self canonical and reciprocal same-topic alternates under %s', base => {
        const { artifacts } = createSiteArtifacts({ base });
        for (const slug of SITE_LANGUAGES) for (const topic of SITE_TOPICS) {
            const route = `${slug}/${topic ? `${topic}/` : ''}`;
            const html = artifacts.get(`${route}index.html`);
            expect(html).toContain(`rel="canonical" href="https://screenhello.com${base}${route}"`);
            for (const alternate of SITE_LANGUAGES) {
                expect(html).toContain(`hreflang="${catalog[alternate].lang}" href="https://screenhello.com${base}${alternate}/${topic ? `${topic}/` : ''}"`);
            }
            expect(html).not.toMatch(/<script (?!type="application\/ld\+json")/);
            expect(isCorePrecacheEntry({ url: `${route}index.html`, size: html.length })).toBe(false);
        }
        expect(artifacts.get('sitemap.xml').match(/<loc>/g)).toHaveLength(43);
    });
    it('makes preview HTML nonindexable without preventing crawlers from reading noindex', () => {
        const { artifacts, options } = createSiteArtifacts({ indexable: false });
        expect(artifacts.get('sitemap.xml')).not.toContain('<loc>');
        expect(artifacts.get('robots.txt')).not.toContain('Disallow: /');
        expect(artifacts.get('_headers')).toContain('X-Robots-Tag: noindex, follow');
        expect(artifacts.get('en/index.html')).toContain('content="noindex,follow"');
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
        for (const indexable of [true, false]) {
            const headers = createSiteArtifacts({ base, indexable }).artifacts.get('_headers');
            for (const filename of ['sw.js', 'manifest.webmanifest']) {
                expect(headers).toContain(`${base}${filename}\n  Cache-Control: public, no-cache, max-age=0, must-revalidate`);
            }
            expect(headers).toContain('https://:project.pages.dev/*\n  X-Robots-Tag: noindex, follow');
            expect(headers).toContain('https://:version.:project.pages.dev/*\n  X-Robots-Tag: noindex, follow');
            expect(headers.split('\n\n')[0].includes('noindex')).toBe(!indexable);
        }
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
        expect(publicGuidePath('de-DE', '/nested/')).toBe('/nested/de/guide/');
    });
});
