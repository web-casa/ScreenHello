/* 把 site/content/{locale}.json 的 7 语种 × 6 主题转换为 Fumadocs 的 MDX 内容。
   JSON 仍是唯一事实源：docs-site/ 应用只消费生成结果，不反向修改。
   `--check` 只校验产物是否与 JSON 一致，不写文件。 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS_READING_ORDER } from '../docs-site/src/lib/content.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
export const contentDirectory = path.join(root, 'docs-site', 'content', 'docs');

// 与 site.mjs 的 SITE_TOPICS 对齐：'' 是首页，其余按 labels 顺序。
const TOPICS = ['', 'beautify', 'frames', 'compression', 'guide', 'privacy'];
// 与 site.mjs 的 renderSitePage 一致：只有这三个主题展示对比图。
const FIGURE_TOPICS = new Set(['', 'beautify', 'frames']);
const RELATED_TOPICS = {
    '': ['guide', 'beautify'],
    beautify: ['frames', 'compression'],
    frames: ['beautify', 'guide'],
    compression: ['beautify', 'privacy'],
    guide: ['beautify', 'compression'],
    privacy: ['guide', 'compression'],
};
export const LOCALES = ['en', 'zh-cn', 'zh-tw', 'de', 'ko', 'es', 'pt-pt'];

export async function loadCatalogs() {
    return Object.fromEntries(await Promise.all(LOCALES.map(async (locale) => {
        const raw = await readFile(path.join(root, 'site', 'content', `${locale}.json`), 'utf8');
        return [locale, JSON.parse(raw)];
    })));
}

// MDX 正文里出现裸 `<` 会被当成 JSX；frontmatter 由 YAML 解析，用 JSON 字符串最稳。
const escapeMdxText = (value) => String(value).replace(/</g, '&lt;').replace(/\{/g, '\\{');
const yamlString = (value) => JSON.stringify(String(value));
const docsComponentImport = (name) => ['..', '..', '..', 'src', 'components', name].join('/');

/* section 的可选第三元素是子块数组：
   { h, p } -> H3 小节，{ table } -> 表格，{ note } -> 引用块。
   旧数据没有第三元素，渲染时自然退化为 H2 + 正文。 */
function renderBlocks(blocks) {
    if (!Array.isArray(blocks) || blocks.length === 0) return '';
    return blocks.map((block) => {
        if (block.table) {
            const { head, rows } = block.table;
            const header = `| ${head.map(cell => escapeMdxText(cell)).join(' | ')} |`;
            const divider = `| ${head.map(() => '---').join(' | ')} |`;
            const body = rows.map(row => `| ${row.map(cell => escapeMdxText(cell)).join(' | ')} |`).join('\n');
            return `${header}\n${divider}\n${body}\n`;
        }
        if (block.note) return `> ${escapeMdxText(block.note)}\n`;
        // 子小节用 H3，保持 H1 > H2 > H3 的层级可读。
        return `### ${escapeMdxText(block.h)}\n\n${escapeMdxText(block.p)}\n`;
    }).join('\n');
}

function renderPage(catalog, topicIndex) {
    const page = catalog.pages[topicIndex];
    const hasFigure = FIGURE_TOPICS.has(TOPICS[topicIndex]);
    const frontmatter = [
        '---',
        `title: ${yamlString(page.title)}`,
        `seoTitle: ${yamlString(page.seoTitle ?? page.title)}`,
        `description: ${yamlString(page.description)}`,
        `reviewed: ${yamlString(catalog.reviewed)}`,
        '---',
        '',
    ].join('\n');

    // ESM import 必须位于正文之前，所以在 frontmatter 之后立刻注入。
    const imports = hasFigure
        ? `import BeforeAfter from '${docsComponentImport('BeforeAfter.astro')}';\n`
        : TOPICS[topicIndex] === 'guide' ? `import GuideImage from '${docsComponentImport('GuideImage.astro')}';\n` : '';

    // 标题由 DocsPage 渲染为 h1，正文从 h2 开始；子块继续下探到 h3。
    const sections = page.sections.map(([heading, body, blocks], sectionIndex) => (
        `## ${escapeMdxText(heading)}\n\n${escapeMdxText(body)}\n\n${renderBlocks(blocks)}${TOPICS[topicIndex] === 'guide' && [1, 2].includes(sectionIndex)
            ? `\n<GuideImage src="/guide/${catalog.lang.startsWith('zh') ? 'zh-CN' : 'en-US'}-${sectionIndex === 1 ? 'editor' : 'export'}.png" caption=${yamlString(catalog.docsUi[sectionIndex === 1 ? 'guideCaption' : 'exportCaption'])} />\n` : ''}`
    )).join('\n');

    // 对比图交给 BeforeAfter.astro 渲染，MDX 只负责传参。
    const figure = hasFigure ? [
        '',
        '<BeforeAfter',
        '  before="/site/before.svg"',
        '  after="/site/after.svg"',
        `  beforeAlt=${yamlString(catalog.before)}`,
        `  afterAlt=${yamlString(catalog.after)}`,
        `  caption=${yamlString(catalog.example)}`,
        '/>',
        '',
    ].join('\n') : '';

    const topic = TOPICS[topicIndex];
    const related = RELATED_TOPICS[topic].map(target => {
        // 正文链接使用能独立说明目标内容的标题；侧栏短标签只适合导航语境。
        const label = catalog.pages[TOPICS.indexOf(target)].seoTitle;
        return `[${escapeMdxText(label)}](${topic ? '../' : ''}${target}/)`;
    }).join(' · ');

    return `${frontmatter}${imports}\n${sections}${figure}\n## ${escapeMdxText(catalog.related)}\n\n${related}\n`;
}

function renderMeta(catalog) {
    // 仅保存本地化主题名称；操作步骤编号属于入门正文。
    const pages = [
        `index~${catalog.labels[0]}`,
        ...DOCS_READING_ORDER.map(topic => `${topic}~${catalog.labels[TOPICS.indexOf(topic)]}`),
    ];
    return `${JSON.stringify({ title: catalog.labels[0], pages, name: catalog.name, ui: catalog.docsUi, editorLanguage: catalog.lang, open: catalog.open, skip: catalog.skip, languages: catalog.languages, updated: catalog.updated }, null, 2)}\n`;
}

export async function buildDocsContent() {
    const catalogs = await loadCatalogs();
    const files = new Map();
    for (const locale of LOCALES) {
        const catalog = catalogs[locale];
        if (catalog.labels?.length !== TOPICS.length || catalog.pages?.length !== TOPICS.length) {
            throw new Error(`docs-content-incomplete-locale:${locale}`);
        }
        for (const [index, topic] of TOPICS.entries()) {
            // 目录布局 {locale}/{topic}.mdx：与 site/content/*.json 结构直接对应，
            // docs-site/src/lib/source.ts 依此显式构建路由与侧边栏树。
            files.set(path.posix.join(locale, `${topic || 'index'}.mdx`), renderPage(catalog, index));
        }
        files.set(path.posix.join(locale, 'meta.json'), renderMeta(catalog));
    }
    return files;
}

async function main() {
    const check = process.argv.slice(2);
    if (check.length > 1 || (check.length === 1 && check[0] !== '--check')) {
        throw new Error('docs-content-usage: node scripts/build-docs-content.mjs [--check]');
    }
    const files = await buildDocsContent();
    const mismatches = [];
    if (check[0] === '--check') {
        for (const [relative, source] of files) {
            const current = await readFile(path.join(contentDirectory, relative), 'utf8').catch(error => {
                if (error.code === 'ENOENT') return null;
                throw error;
            });
            if (current !== source) mismatches.push(relative);
        }
        const written = await listGenerated().catch(() => []);
        for (const relative of written) if (!files.has(relative)) mismatches.push(`stale:${relative}`);
    } else {
        // 只重建本脚本负责的目录，避免留下已删除主题的陈旧文件。
        await rm(contentDirectory, { recursive: true, force: true });
        for (const [relative, source] of files) {
            const destination = path.join(contentDirectory, relative);
            await mkdir(path.dirname(destination), { recursive: true });
            await writeFile(destination, source);
        }
    }
    console.log(JSON.stringify({
        mode: check[0] === '--check' ? 'check' : 'generate',
        locales: LOCALES.length,
        topics: TOPICS.length,
        files: files.size,
        directory: path.relative(root, contentDirectory),
        mismatches,
    }, null, 2));
    if (mismatches.length) process.exitCode = 1;
}

async function listGenerated() {
    const { readdir } = await import('node:fs/promises');
    const walk = async (directory, prefix = '') => {
        const entries = await readdir(directory, { withFileTypes: true });
        const found = [];
        for (const entry of entries) {
            const relative = prefix ? path.join(prefix, entry.name) : entry.name;
            if (entry.isDirectory()) found.push(...await walk(path.join(directory, entry.name), relative));
            else found.push(relative);
        }
        return found;
    };
    return walk(contentDirectory);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
