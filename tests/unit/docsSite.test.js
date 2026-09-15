import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    assertCovered, buildDocsCsp, cspHash, extractInlineBlocks,
} from '../../docs/src/lib/csp.mjs';
import { appShellHeaders, renderHeaders, renderRedirects } from '../../docs/src/lib/headers.mjs';
import {
    DOCS_BASE_PATH, DOCS_LOCALES, DOCS_READING_ORDER, DOCS_TOPICS,
    docsPagePath, docsUrls, legacyRedirects,
} from '../../docs/src/lib/content.mjs';

const distHeaders = new URL('../../dist/_headers', import.meta.url);
const docsDist = new URL('../../dist/docs/', import.meta.url);

describe('docs CSP hash contract', () => {
    it('keeps navigation, redirects and deployment headers under a nested base', () => {
        const base = '/tools/editor/';
        expect(docsPagePath('zh-cn', 'guide', base)).toBe('/tools/editor/docs/zh-cn/guide/');
        expect(docsUrls(base)).toHaveLength(42);
        expect(docsUrls(base).every(url => url.startsWith(`${base}docs/`))).toBe(true);
        for (const [from, to] of legacyRedirects(base)) {
            expect(from.startsWith(base)).toBe(true);
            expect(to.startsWith(`${base}docs/`)).toBe(true);
        }
        const headers = renderHeaders(appShellHeaders({ base, indexable: false }));
        expect(headers).toContain('/tools/editor/sw.js');
        expect(headers).toContain('/*\n  X-Robots-Tag: noindex, follow');
    });

    it('treats JSON-LD as a data block, not an executable script', () => {
        const html = '<script type="application/ld+json">{"a":1}</script>'
            + '<script>window.x=1</script>'
            + '<style>.a{color:red}</style>'
            + '<div style="color:red"></div>';
        const blocks = extractInlineBlocks(html);
        expect(blocks.scripts).toEqual(['window.x=1']);
        expect(blocks.styles).toEqual(['.a{color:red}']);
        expect(blocks.attributes).toEqual(['color:red']);
    });

    it('ignores external scripts, which script-src self already covers', () => {
        const blocks = extractInlineBlocks('<script src="/a.js"></script>');
        expect(blocks.scripts).toEqual([]);
    });

    it('emits no unsafe-inline and hashes every directive it needs', () => {
        const hashes = {
            scripts: new Set([cspHash('a')]),
            styles: new Set([cspHash('b')]),
            attributes: new Set([cspHash('c')]),
        };
        const csp = buildDocsCsp(hashes);
        expect(csp).not.toContain('unsafe-inline');
        expect(csp).toContain("default-src 'none'");
        expect(csp).toContain("script-src 'self' 'sha256-");
        expect(csp).toContain("style-src 'self' 'sha256-");
        // style 属性也必须覆盖，否则 CSP3 下会被 style-src-attr 拦掉。
        expect(csp).toContain(cspHash('c'));
        expect(csp).toContain("base-uri 'none'");
        expect(csp).toContain("frame-ancestors 'none'");
    });

    it('fails closed when a page contains an inline block outside the hash set', () => {
        const hashes = { scripts: new Set([cspHash('other')]), styles: new Set(), attributes: new Set() };
        const scratch = mkdtempSync(path.join(tmpdir(), 'sh-csp-'));
        try {
            writeFileSync(path.join(scratch, 'index.html'), '<script>evil()</script>');
            expect(() => assertCovered(scratch, hashes)).toThrow('csp-unhashed-script:index.html');
        } finally {
            rmSync(scratch, { recursive: true, force: true });
        }
    });

    it('keeps the docs entry in the editor service-worker navigation fallback out', () => {
        const headers = renderHeaders(appShellHeaders({ indexable: true }));
        expect(headers).toContain('/sw.js\n  Cache-Control: public, no-cache, max-age=0, must-revalidate');
        expect(headers).toContain('X-Content-Type-Options: nosniff');
        expect(headers).not.toContain('Content-Security-Policy');
    });

    it('renders one 301 per legacy URL form and never redirects the editor root', () => {
        const text = renderRedirects(legacyRedirects('/'));
        expect(text).toContain('/en/beautify /docs/en/beautify/ 301');
        expect(text).toContain('/en/beautify/ /docs/en/beautify/ 301');
        expect(text).toContain('/en/beautify/index.html /docs/en/beautify/ 301');
        // 根 `/` 是编辑器壳，必须保持 200，不能被文档站接管。
        expect(text).not.toContain('/ /docs/ 301');
    });

    it('ships a self-hosted-only visual system', () => {
        const css = readFileSync(new URL('../../docs/src/styles/global.css', import.meta.url), 'utf8');
        // 产品主张"本地优先、不上传"：站点不得请求字体 CDN。
        expect(css).not.toMatch(/fonts\.googleapis|fonts\.gstatic|@import\s+url\(/);
        expect(css).not.toContain('@font-face');
        // 深色为基准，背景对齐应用与 PWA 的 theme-color。
        expect(css).toContain('--color-fd-background: #111318');
        // 单一强调色，全站共用同一变量。
        expect(css).toContain('--sh-accent');
        for (const token of ['--sh-sans', '--sh-serif', '--sh-mono', '--sh-radius']) {
            expect(css, `${token} 应定义`).toContain(`${token}:`);
        }
        // 本站在 MOTION 1：不做动画，只保留 reduced-motion 兜底。
        expect(css).toContain('prefers-reduced-motion');
        expect(css).not.toMatch(/@keyframes/);
    });

    it('keeps enriched sub-blocks well-formed in every locale', () => {
        // section 的第三元素是可选的子块数组：{h,p} / {table} / {note}。
        // 事实数值必须跨语种一致，否则会出现"某个语言写了另一个上限"的漂移。
        const limits = new Set();
        for (const locale of DOCS_LOCALES) {
            const catalog = JSON.parse(readFileSync(
                new URL(`../../site/content/${locale}.json`, import.meta.url), 'utf8'));
            for (const page of catalog.pages) {
                for (const section of page.sections) {
                    expect(typeof section[0]).toBe('string');
                    expect(typeof section[1]).toBe('string');
                    if (section.length < 3) continue;
                    expect(Array.isArray(section[2])).toBe(true);
                    for (const block of section[2]) {
                        const kinds = ['h', 'table', 'note'].filter(key => key in block);
                        expect(kinds).toHaveLength(1);
                        if (block.table) {
                            expect(block.table.head).toHaveLength(2);
                            for (const row of block.table.rows) expect(row).toHaveLength(2);
                        } else if (block.note) {
                            expect(block.note.trim().length).toBeGreaterThan(20);
                        } else {
                            expect(block.h.trim()).toBeTruthy();
                            expect(block.p.trim()).toBeTruthy();
                        }
                    }
                }
            }
            // 像素上限是产品事实：所有语种必须基于同一组数字。
            // 措辞随语言本地化（小数点/千分位/单位不同），因此只比较数字序列。
            const compression = catalog.pages[3].sections[0][2] ?? [];
            const table = compression.find(block => block.table)?.table;
            expect(table, `${locale} 应有上限表`).toBeDefined();
            // 千分位分隔符随语言不同（1,048,576 / 1.048.576 / 1 048 576），
            // 因此去掉所有非数字字符后再比较。
            const digits = JSON.stringify(table.rows.map(row => String(row[1]).replace(/\D/g, '')));
            limits.add(digits);
        }
        expect(limits.size).toBe(1);
        // 抽查：419 万像素与 30 秒这两个上限不得在翻译中丢失。
        const canonical = JSON.parse([...limits][0]).join(' ');
        expect(canonical).toContain('4194304');
        expect(canonical).toContain('1048576');
        expect(canonical).toContain('8192');
    });

    it('renders sub-blocks as real heading levels, tables and quotes', () => {
        const mdx = readFileSync(new URL('../../docs/content/docs/en/compression.mdx', import.meta.url), 'utf8');
        // H1 由 DocsPage 渲染，正文从 H2 起，子小节下探到 H3。
        expect(mdx).toContain('\n## ');
        expect(mdx).toContain('\n### ');
        // 表格必须是合法 GFM：表头 + 分隔行。
        expect(mdx).toMatch(/\| Operation \| Limit \|\n\| --- \| --- \|/);
        // 引用块用于提示，不用来承载正文。
        expect(mdx).toMatch(/\n> \S/);
    });

    it('adds contextual related links with deployment-safe relative URLs', () => {
        const mdx = readFileSync(new URL('../../docs/content/docs/en/guide.mdx', import.meta.url), 'utf8');
        expect(mdx).toContain('\n## Keep exploring\n');
        expect(mdx).toContain('[Screenshot beautification: backgrounds, padding and shadows](../beautify/)');
        expect(mdx).toContain('[PNG, JPG and WebP compression and export guide](../compression/)');
    });

    it('keeps sidebar topics ordered without changing public URLs', () => {
        expect(DOCS_READING_ORDER).toEqual(['guide', 'beautify', 'frames', 'compression', 'privacy']);
        expect(new Set(DOCS_READING_ORDER).size).toBe(5);
        for (const topic of DOCS_READING_ORDER) expect(DOCS_TOPICS).toContain(topic);
    });

    // 组装产物存在时，直接校验真实构建结果（pnpm build 之后运行）。
    it.runIf(existsSync(distHeaders))('ships hash CSP for /docs/* in the assembled build', () => {
        const headers = readFileSync(distHeaders, 'utf8');
        const docsRule = headers.split('\n\n').find(block => block.startsWith(`${DOCS_BASE_PATH}/*`));
        expect(docsRule).toBeDefined();
        expect(docsRule).not.toContain('unsafe-inline');
        expect(docsRule).toContain('Content-Security-Policy:');
        expect(docsRule).toContain("script-src 'self' 'sha256-");
        expect(docsRule).toContain("default-src 'none'");
    });

    it.runIf(existsSync(new URL('../../dist/_redirects', import.meta.url)))('ships legacy 301s without self-redirects', () => {
        const redirects = readFileSync(new URL('../../dist/_redirects', import.meta.url), 'utf8');
        expect(redirects).toContain('/zh-cn/privacy /docs/zh-cn/privacy/ 301');
        for (const line of redirects.trim().split('\n')) {
            const [from, to] = line.split(' ');
            expect(from).not.toBe(to);
        }
    });

    it.runIf(existsSync(docsDist))('ships topic navigation, a real table of contents and an editor entry', () => {
        const html = readFileSync(new URL('en/beautify/index.html', docsDist), 'utf8');
        expect(html).not.toContain('class="sh-steps');
        expect(html).not.toContain('aria-current="step"');
        expect(html).toContain(`href="${docsPagePath('en', 'frames')}"`);
        expect(html).toContain('id="nd-toc"');
        expect(html).toContain('href="/?lang=en"');
    });

    it.runIf(existsSync(docsDist))('links the landing page to the guide without a second pagination', () => {
        const html = readFileSync(new URL('en/index.html', docsDist), 'utf8');
        expect(html).not.toContain('class="sh-steps');
        expect(html).toContain(`href="${docsPagePath('en', 'guide')}"`);
    });

    it.runIf(existsSync(docsDist))('ships every locale and topic page under /docs/', () => {

        for (const locale of DOCS_LOCALES) {
            for (const topic of DOCS_TOPICS) {
                const file = new URL(`${locale}/${topic ? `${topic}/` : ''}index.html`, docsDist);
                expect(existsSync(file), `${locale}/${topic} 应存在`).toBe(true);
                const html = readFileSync(file, 'utf8');
                expect(html).toContain('application/ld+json');
                expect((html.match(/hreflang=/g) || []).length).toBe(DOCS_LOCALES.length + 1);
                expect(html).toContain('property="og:title"');
                expect(html).toContain('property="og:image"');
                expect(html).toContain('name="twitter:card"');
                const schema = JSON.parse(html.match(/<script type="application\/ld\+json">([^]*?)<\/script>/)[1]);
                expect(schema['@graph'].find(item => item['@type'] === 'WebApplication')['@id'])
                    .toBe('https://screenhello.com/#application');
                expect(schema['@graph'].find(item => item['@type'] === 'WebPage').dateModified)
                    .toMatch(/^\d{4}-\d{2}-\d{2}$/);
            }
        }
    });
});
