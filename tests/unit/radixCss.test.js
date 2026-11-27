import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
    filterRadixComponents,
    filterRadixTokens,
    KEEP_ACCENTS,
    KEEP_COMPONENTS,
    KEEP_GRAYS,
    scopeLibraryRootSelectors,
    scopeRadixTokens,
    shouldDropComponentRule,
    shouldDropPaletteRule,
} from '../../config/radixCss.mjs';
import { auditLibraryCss } from '../../scripts/audit-library-css.mjs';

const readThemeCss = (name) => readFile(new URL(`../../node_modules/@radix-ui/themes/${name}`, import.meta.url), 'utf8');
const countBraces = (css) => ({
    open: (css.match(/\{/g) || []).length,
    close: (css.match(/\}/g) || []).length,
});

describe('radixCss palette filter', () => {
    it('keeps the palettes the app actually renders', () => {
        expect(KEEP_ACCENTS).toEqual(['indigo', 'gray']);
        expect(KEEP_GRAYS).toEqual(['slate']);
        expect(shouldDropPaletteRule(".radix-themes:where([data-accent-color='indigo'])")).toBe(false);
        expect(shouldDropPaletteRule(".radix-themes:where([data-gray-color='slate'])")).toBe(false);
        expect(shouldDropPaletteRule(".radix-themes:where([data-accent-color='gray'])")).toBe(false);
        expect(shouldDropPaletteRule(".radix-themes:where([data-accent-color='tomato'])")).toBe(true);
        expect(shouldDropPaletteRule(".radix-themes:where([data-gray-color='mauve'])")).toBe(true);
        // 同时点名多个调色板的规则只要含保留项就不能丢
        expect(shouldDropPaletteRule(".a:where([data-accent-color='indigo'], [data-accent-color='blue'])")).toBe(true);
        expect(shouldDropPaletteRule(".radix-themes { --space-1: 4px; }")).toBe(false);
    });

    it('drops only palettes the app never uses from the real tokens.css', async () => {
        const source = await readThemeCss('tokens.css');
        const filtered = filterRadixTokens(source);
        // 保留：我们固定的 indigo/slate 与 Radix 灰阶 accent
        expect(filtered).toContain("--indigo-9:");
        expect(filtered).toContain("--slate-9:");
        expect(filtered).toContain("--gray-9:");
        // 丢弃：其它调色板
        expect(filtered).not.toContain('--tomato-9:');
        expect(filtered).not.toContain('--mauve-9:');
        // 基础 token 与外观块必须完整保留
        expect(filtered).toContain('--space-1:');
        expect(filtered).toContain('--radius-2:');
        expect(filtered).toContain('--shadow-1:');
        expect(filtered).toContain('--black-a1:');
        expect(filtered).toContain("[data-radius='medium']");
        // 产物更小，且结构没有被截断
        expect(filtered.length).toBeLessThan(source.length);
        expect(countBraces(filtered).open).toBe(countBraces(filtered).close);
    });

    it('scopes Radix tokens and Tailwind root variables cleanly for library builds without leaking to host :root', async () => {
        const source = await readThemeCss('tokens.css');
        const scoped = filterRadixTokens(source, { scopeTokens: true });
        expect(scoped).toContain('--indigo-9:');
        expect(scoped).toContain('--slate-9:');
        expect(scoped).not.toContain(':root');
        expect(countBraces(scoped).open).toBe(countBraces(scoped).close);

        const tailwindSample = '@layer theme { :root, :host { --spacing: 0.25rem; } }';
        const scopedTail = scopeLibraryRootSelectors(tailwindSample);
        expect(scopedTail).not.toContain(':root');
        expect(scopedTail).not.toContain(':host');
        expect(scopedTail).toContain('.shoteasy-app');

        const drawerHeaderSample = ':root:has(.shoteasy-app[data-mode]) .ant-drawer .ant-drawer-header { border-color: red; }';
        const scopedDrawer = scopeLibraryRootSelectors(drawerHeaderSample);
        expect(scopedDrawer).toContain('.ant-drawer-header');
        expect(scopedDrawer).not.toContain(')-header');
        expect(scopedDrawer).not.toContain(':root');

        expect(auditLibraryCss(scoped).violations).toEqual([]);
        expect(auditLibraryCss(scopeRadixTokens(':root, .light { --indigo-9: blue; } .dark { --gray-1: black; }')).violations).toEqual([]);
        expect(auditLibraryCss(':root { --x: 1; } h1 { margin: 0; } .dark { color: #fff; }').violations).toEqual([
            'global-root::root',
            'unscoped-element:h1',
            'unscoped-theme:.dark',
        ]);
    });
});

describe('radixCss component filter', () => {
    it('keeps shared bases and drops components the editor never renders', () => {
        expect(KEEP_COMPONENTS).toContain('Button');
        for (const keep of ['.rt-Button', '.rt-IconButton', '.rt-BaseButton', '.rt-SwitchRoot', '.rt-TextFieldInput', '.rt-SegmentedControlItem', '.rt-SliderThumb', '.rt-reset', '.rt-r-size-2', '.rt-variant-solid']) {
            expect(shouldDropComponentRule(`${keep}:hover`), keep).toBe(false);
        }
        for (const drop of ['.rt-Card', '.rt-TableRoot', '.rt-TableRoot:where(.rt-r-size-1)', '.rt-DialogContent', '.rt-SelectTrigger', '.rt-DropdownMenuContent', '.rt-TabsTrigger']) {
            expect(shouldDropComponentRule(drop), drop).toBe(true);
        }
        // 一条规则里只要有一个保留类就整条保留（宁可多留）
        expect(shouldDropComponentRule('.rt-Button .rt-Spinner')).toBe(false);
        // 不含 .rt-* 类的全局规则一律保留
        expect(shouldDropComponentRule(':where(.radix-themes)')).toBe(false);
        expect(shouldDropComponentRule('@keyframes rt-spin')).toBe(false);
    });

    it('keeps every component class the running editor renders', async () => {
        const source = await readThemeCss('components.css');
        const filtered = filterRadixComponents(source);
        // 这几条覆盖 artifacts/style-baseline.json 里实际出现的全部 rt-* 类
        for (const selector of ['.rt-BaseButton', '.rt-Button', '.rt-IconButton', '.rt-SliderRoot', '.rt-SliderTrack', '.rt-SliderRange', '.rt-SliderThumb', '.rt-SwitchRoot', '.rt-SwitchThumb', '.rt-TextFieldRoot', '.rt-TextFieldInput', '.rt-SegmentedControlRoot', '.rt-reset']) {
            expect(filtered, selector).toContain(selector);
        }
        expect(filtered).not.toContain('.rt-Card {');
        expect(filtered).not.toContain('.rt-TableRoot');
        expect(filtered).toContain('@keyframes');
        expect(filtered.length).toBeLessThan(source.length);
        expect(countBraces(filtered).open).toBe(countBraces(filtered).close);
    });
});
