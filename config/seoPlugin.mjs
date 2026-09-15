import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { createSiteArtifacts, renderRootSeo } from '../site/site.mjs';
import { legacyRedirects } from '../docs-site/src/lib/content.mjs';

/* 公开站分两部分：
 *   - 编辑器壳（根 `/`）由本插件注入 SEO head 与 noscript 回退；
 *   - 文档站（`/docs/*`）由 docs-site/（Fumadocs + Astro）在根构建前生成，
 *     `vite.config.js` 的 docsSitePlugin 把产物并进 dist。
 * 因此这里不再生成任何内容页，只保留根级 SEO 与旧 URL 的 301。
 * `/docs/*` 必须放行给 Vite 静态服务，否则预览会把真实产物当成未知路由返回 404。 */
const passthroughPrefixes = ['docs/', '_astro/', 'guide/', 'site/', 'assets/', 'src/', 'node_modules/'];

export function publicSitePlugin(input) {
    let config;
    const site = createSiteArtifacts(input);
    const base = site.options.base;
    // 旧内容站 URL -> /docs/{locale}/{topic}/，与 dist/_redirects 同源。
    // 只保留旧内容页的 301；根 `/` 与 `/index.html` 仍由编辑器壳响应。
    const redirects = new Map(legacyRedirects(base));
    const routes = new Map([['robots.txt', 'robots.txt'], ['sitemap.xml', 'sitemap.xml']]
        .map(([filename, target]) => [`${base}${filename}`, target]));
    const attach = (server, preview) => server.middlewares.use((request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') return next();
        // URL host and query never influence generated canonical URLs or output paths.
        let url;
        try { url = new URL(request.url, 'http://localhost'); } catch { response.statusCode = 400; response.end(); return; }
        const pathname = url.pathname;
        // Local Vite dev/preview servers are never intended for search indexing.
        response.setHeader('X-Robots-Tag', 'noindex, follow');
        if (redirects.has(pathname)) {
            response.statusCode = 301;
            response.setHeader('Location', redirects.get(pathname) + url.search);
            response.end();
            return;
        }
        const filename = routes.get(pathname);
        if (filename) {
            // Preview must serve the built bytes, never regenerate pages to conceal stale/missing output.
            const output = path.resolve(config.root, config.build.outDir, filename);
            if (preview && !existsSync(output)) { response.statusCode = 404; response.end(); return; }
            response.statusCode = 200;
            response.setHeader('Content-Type', filename.endsWith('.xml') ? 'application/xml; charset=utf-8' : 'text/plain; charset=utf-8');
            response.setHeader('Cache-Control', 'no-cache');
            response.end(request.method === 'HEAD' ? undefined : preview ? readFileSync(output) : site.artifacts.get(filename));
            return;
        }
        // Vite's SPA fallback would turn unknown routes into a 200 editor page.
        const internal = /^\/(?:@|__vite)/.test(pathname)
            || passthroughPrefixes.some(prefix => pathname.startsWith(`${base}${prefix}`));
        const publicFile = pathname.startsWith(base) && !pathname.slice(base.length).includes('/') && /\.[a-z0-9]+$/i.test(pathname);
        // Vite also serves optional local assets and imported source files outside
        // src/. Leave resource resolution to Vite; only catch document navigation.
        const destination = request.headers['sec-fetch-dest'];
        const resourceRequest = (destination && destination !== 'document') || url.searchParams.has('import');
        if (pathname === base || internal || publicFile || resourceRequest) return next();
        response.statusCode = 404;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('X-Robots-Tag', 'noindex, follow');
        const notFound = path.resolve(config.root, config.build.outDir, '404.html');
        const body = preview && existsSync(notFound) ? readFileSync(notFound) : '';
        response.end(request.method === 'HEAD' ? undefined : body);
    });
    return {
        name: 'screenhello-public-site',
        configResolved(resolved) { config = resolved; },
        transformIndexHtml: { order: 'pre', handler: html => renderRootSeo(html, site.options, site.catalog) },
        generateBundle() {
            for (const [fileName, source] of site.artifacts) this.emitFile({ type: 'asset', fileName, source });
        },
        configureServer(server) { attach(server, false); },
        configurePreviewServer(server) { attach(server, true); },
    };
}
