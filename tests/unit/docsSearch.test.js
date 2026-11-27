import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { plainText, searchDocs } from '../../docs-site/src/lib/search.mjs';
import { DOCS_LOCALES } from '../../docs-site/src/lib/content.mjs';

describe('static documentation search', () => {
    const entries = [
        { id: 'guide', title: '入门', text: '保存 PNG 或项目文件', url: '/docs/zh-cn/guide/' },
        { id: 'export', title: 'PNG 导出', text: '压缩后下载', url: '/docs/zh-cn/compression/' },
    ];
    it('handles CJK, case and full-width input, ranks titles and requires all terms', () => {
        expect(searchDocs(entries, 'ｐｎｇ').map(item => item.id)).toEqual(['export', 'guide']);
        expect(searchDocs(entries, 'PNG 项目').map(item => item.id)).toEqual(['guide']);
        expect(searchDocs(entries, '不存在')).toEqual([]);
        expect(searchDocs(entries, '  ')).toEqual([]);
    });
    it('keeps component source and markdown syntax out of snippets', () => {
        const text = plainText('import GuideImage from "a";\n\n## Heading\nBody\n<GuideImage src="private.png" caption="x" />');
        expect(text).toBe('Heading Body');
    });
    for (const locale of DOCS_LOCALES) {
        it(`${locale} has complete UI copy and no AVIF quality presets`, () => {
            const catalog = JSON.parse(readFileSync(new URL(`../../site/content/${locale}.json`, import.meta.url), 'utf8'));
            const reference = JSON.parse(readFileSync(new URL('../../site/content/en.json', import.meta.url), 'utf8'));
            expect(Object.keys(catalog.docsUi)).toEqual(Object.keys(reference.docsUi));
            expect(Object.values(catalog.docsUi).every(value => value.trim())).toBe(true);
            const rows = catalog.pages[3].sections[0][2].find(block => block.table).table.rows;
            expect(rows[4][1]).not.toContain('AVIF');
            const mdx = readFileSync(new URL(`../../docs-site/content/docs/${locale}/guide.mdx`, import.meta.url), 'utf8');
            expect((mdx.match(/<GuideImage /g) || []).length).toBe(2);
        });
    }
});
