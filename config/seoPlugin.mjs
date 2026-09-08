import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { createSiteArtifacts, renderRootSeo, SITE_LANGUAGES, SITE_TOPICS, pagePath } from '../site/site.mjs';

const mime = name => name.endsWith('.xml') ? 'application/xml; charset=utf-8'
    : name.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';

export function publicSitePlugin(input) {
    let config;
    const site = createSiteArtifacts(input);
    const routes = new Map();
    const redirects = new Map([[`${site.options.base}index.html`, site.options.base]]);
    for (const slug of SITE_LANGUAGES) for (const topic of SITE_TOPICS) {
        const route = pagePath(site.options.base, slug, topic);
        routes.set(route, `${slug}/${topic ? `${topic}/` : ''}index.html`);
        redirects.set(route.slice(0, -1), route);
        redirects.set(`${route}index.html`, route);
    }
    for (const filename of ['robots.txt', 'sitemap.xml', 'llms.txt', '404.html']) routes.set(`${site.options.base}${filename}`, filename);
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
            response.statusCode = filename === '404.html' ? 404 : 200;
            response.setHeader('Content-Type', mime(filename));
            response.setHeader('Cache-Control', 'no-cache');
            if (filename === '404.html') response.setHeader('X-Robots-Tag', 'noindex, follow');
            response.end(request.method === 'HEAD' ? undefined : preview ? readFileSync(output) : site.artifacts.get(filename));
            return;
        }
        // Vite's SPA fallback would turn unknown routes into a 200 editor page.
        const internal = /^\/(?:@|__vite)/.test(pathname)
            || ['assets/', 'site/', 'src/', 'node_modules/'].some(prefix => pathname.startsWith(`${site.options.base}${prefix}`));
        const publicFile = pathname.startsWith(site.options.base) && !pathname.slice(site.options.base.length).includes('/') && /\.[a-z0-9]+$/i.test(pathname);
        // Vite also serves optional local assets and imported source files outside
        // src/. Leave resource resolution to Vite; only catch document navigation.
        const destination = request.headers['sec-fetch-dest'];
        const resourceRequest = (destination && destination !== 'document') || url.searchParams.has('import');
        if (pathname === site.options.base || internal || publicFile || resourceRequest) return next();
        response.statusCode = 404;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('X-Robots-Tag', 'noindex, follow');
        response.end(request.method === 'HEAD' ? undefined : site.artifacts.get('404.html'));
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
