/* 为 docs 站产物的内联脚本/样式计算 CSP hash，并生成 /docs/* 的响应头。
 *
 * 为什么需要：Fumadocs 是客户端 React 应用，Astro 会为每个页面输出
 *   - 3 个内联 <script>（island loader / hydration runtime / 主题初始化）
 *   - 2 个内联 <style>（Astro island 与 Radix scroll-area）
 *   - 若干 style="..." 属性（Fumadocs 布局）
 * 旧内容站是零脚本零内联样式，直接用 `default-src 'none'; style-src 'self'`。
 * 这里保持同等严格度：不放开 'unsafe-inline'，改为逐块 SHA-256 hash，
 * 只有构建产物里确切出现过的内联块才被允许执行。
 *
 * 失败即阻断：若某页出现未被计入的内联块（例如依赖升级引入新脚本），
 * 生成的 hash 与页面不匹配，浏览器会拒绝执行——因此这里同时做一致性校验。 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** CSP3 下 style 属性由 style-src-attr 管辖；为兼容旧浏览器同时写 style-src。 */
export const cspHash = (source) => `'sha256-${createHash('sha256').update(source, 'utf8').digest('base64')}'`;

const walk = (directory) => readdirSync(directory).flatMap((name) => {
    const target = path.join(directory, name);
    return statSync(target).isDirectory() ? walk(target) : [target];
});

/** 从单个 HTML 里取出所有需要 hash 的内联块。 */
export function extractInlineBlocks(html) {
    const scripts = [];
    const styles = [];
    const attributes = [];

    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        const [, attrs, body] = match;
        // 外部脚本由 script-src 'self' 覆盖；JSON-LD 等数据块不可执行，CSP 不拦。
        if (/\bsrc\s*=/i.test(attrs)) continue;
        if (/type\s*=\s*["']?(?:application\/(?:ld\+json|json)|text\/(?:plain|template))/i.test(attrs)) continue;
        scripts.push(body);
    }
    for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) styles.push(match[1]);
    for (const match of html.matchAll(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi)) attributes.push(match[2]);

    return { scripts, styles, attributes };
}

/** 扫描整棵产物树，返回每个页面的内联块与其 hash 集合。 */
export function collectCspInventory(root) {
    const pages = [];
    const hashes = { scripts: new Set(), styles: new Set(), attributes: new Set() };
    for (const file of walk(root).filter(name => name.endsWith('.html'))) {
        const html = readFileSync(file, 'utf8');
        const blocks = extractInlineBlocks(html);
        for (const block of blocks.scripts) hashes.scripts.add(cspHash(block));
        for (const block of blocks.styles) hashes.styles.add(cspHash(block));
        for (const block of blocks.attributes) hashes.attributes.add(cspHash(block));
        pages.push({ file: path.relative(root, file), counts: {
            scripts: blocks.scripts.length, styles: blocks.styles.length, attributes: blocks.attributes.length,
        } });
    }
    return { pages, hashes };
}

/** 构造 /docs/* 的 CSP。仅当确有内联块时才追加 hash，避免空指令。 */
export function buildDocsCsp(hashes) {
    const scriptSrc = ["'self'", ...hashes.scripts].join(' ');
    const styleSrc = ["'self'", ...hashes.styles, ...hashes.attributes].join(' ');
    return [
        "default-src 'none'",
        "img-src 'self'",
        `script-src ${scriptSrc}`,
        `style-src ${styleSrc}`,
        "font-src 'self'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'none'",
    ].join('; ');
}

/** 校验产物未出现未被 hash 覆盖的内联块（防止新增内联内容静默失效）。 */
export function assertCovered(root, hashes) {
    for (const file of walk(root).filter(name => name.endsWith('.html'))) {
        const html = readFileSync(file, 'utf8');
        const blocks = extractInlineBlocks(html);
        for (const block of blocks.scripts) {
            if (!hashes.scripts.has(cspHash(block))) throw new Error(`csp-unhashed-script:${path.relative(root, file)}`);
        }
        for (const block of blocks.styles) {
            if (!hashes.styles.has(cspHash(block))) throw new Error(`csp-unhashed-style:${path.relative(root, file)}`);
        }
        for (const block of blocks.attributes) {
            if (!hashes.attributes.has(cspHash(block))) throw new Error(`csp-unhashed-style-attr:${path.relative(root, file)}`);
        }
    }
}
