/* 文档页脚本使用构建期 hash 白名单；样式允许组件所需的内联 CSS。
 * Fumadocs 的网格通过 style 属性定义，Radix 也会在运行时注入 style 标签。
 * 静态 HTML 的 hash 清单不能覆盖 hydration 后的样式；仅给属性列出 hash
 * 而不使用 unsafe-hashes 也不会放行属性。样式策略仅用于 /docs/*，
 * 不放宽脚本、远程样式、连接、对象或 frame 权限。
 * 保留静态样式清单用于构建一致性检查，不将其视为运行时 CSP 验收。
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** 计算构建产物内联块的完整 SHA-256。 */
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
    return [
        "default-src 'none'",
        "img-src 'self'",
        `script-src ${scriptSrc}`,
        // Do not combine unsafe-inline with hashes: browsers then ignore unsafe-inline.
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'none'",
    ].join('; ');
}

/**
 * 构造编辑器页面（/、/index.html、/404.html）的最小权限 CSP：
 * - 允许本地 WASM 编解码（'wasm-unsafe-eval'）与本地 Worker/Blob/Data URL；
 * - 允许 getDisplayMedia / MediaRecorder 本地视频流（media-src 'self' blob:）与 PWA manifest；
 * - 禁止 unsafe-inline 脚本、禁止 unsafe-eval、禁止远程 connect-src / frame-src / object-src / frame-ancestors。
 */
export function buildEditorCsp(scriptHashes = []) {
    const scriptSrc = ["'self'", "'wasm-unsafe-eval'", ...scriptHashes].join(' ');
    return [
        "default-src 'self'",
        `script-src ${scriptSrc}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' blob: data:",
        "media-src 'self' blob:",
        "font-src 'self' data:",
        "connect-src 'self' blob: data:",
        "worker-src 'self' blob:",
        "manifest-src 'self'",
        "object-src 'none'",
        "frame-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
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
