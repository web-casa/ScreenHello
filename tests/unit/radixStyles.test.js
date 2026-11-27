import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

/**
 * Radix 的体积与库契约回归：
 * - 站点、库与桌面外壳三个入口只引 tokens + components，不引整包 styles.css；
 * - Radix 是随产物封装的实现依赖，不能再出现在 dependencies 里（宿主只需 peerDependencies）。
 * src/inspector-preview.jsx 是独立对照页，用 Radix 布局组件，保留整包属于已知例外。
 *
 * 桌面入口 src/desktop/main.jsx 曾经漏掉这三条样式导入：独立站顶栏的复制/导出按钮来自
 * Radix，于是打包后的桌面应用里它们没有任何按钮外观，只剩挤在一起的裸图标和文字。
 */

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const radixEntries = ['src/main.jsx', 'src/index.js', 'src/desktop/main.jsx'];

describe('Radix stylesheet policy', () => {
    it.each(radixEntries)('%s imports the slim Radix entries only', async (path) => {
        const source = await read(path);
        expect(source).toContain("'@radix-ui/themes/tokens.css'");
        expect(source).toContain("'@radix-ui/themes/components.css'");
        expect(source).not.toContain('@radix-ui/themes/styles.css');
    });

    it.each(radixEntries)('%s keeps the Radix bridge styles', async (path) => {
        // 桥接里的 .shoteasy-top-actions-radix{display:contents} 是必须项：
        // Radix 根主题带 min-height:100dvh，包裹层一旦参与布局就会把顶栏撑满整个外壳。
        const source = await read(path);
        expect(source).toMatch(/radix-bridge\.css/);
    });

    it('loads the desktop entry that carries those styles from the desktop document', async () => {
        const html = await read('desktop/index.html');
        expect(html).toContain('src="../src/desktop/main.jsx"');
    });

    it('keeps the full stylesheet only in the standalone inspector preview', async () => {
        const preview = await read('src/inspector-preview.jsx');
        expect(preview).toContain("'@radix-ui/themes/styles.css'");
    });

    it('ships Radix as a bundled devDependency instead of a host dependency', async () => {
        const pkg = JSON.parse(await read('package.json'));
        const dependencies = Object.keys(pkg.dependencies || {});
        expect(dependencies.filter((name) => name.startsWith('@radix-ui/'))).toEqual([]);
        expect(Object.keys(pkg.devDependencies).filter((name) => name.startsWith('@radix-ui/')).sort())
            .toEqual(['@radix-ui/react-icons', '@radix-ui/react-slider', '@radix-ui/themes']);
        expect(Object.keys(pkg.peerDependencies).some((name) => name.startsWith('@radix-ui/'))).toBe(false);
    });

    it('bundles the Radix theme into the library entry so hosts need no extra setup', async () => {
        const entry = await read('src/index.js');
        const radixImport = entry.indexOf("'@radix-ui/themes/tokens.css'");
        // Build the needle without a literal relative import: the public
        // repository audit treats quote-delimited ./specifiers in exported
        // sources as real imports and would flag this file.
        const appImport = entry.indexOf("from '" + './App' + "'");
        expect(radixImport).toBeGreaterThanOrEqual(0);
        expect(appImport).toBeGreaterThan(radixImport);
    });
});
