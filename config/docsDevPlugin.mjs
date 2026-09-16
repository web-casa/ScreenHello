import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

const contentTypes = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};

/** Serve the Astro snapshot during editor development, without SPA HTML transforms. */
export function docsDevMiddleware(directory, base) {
    const root = path.resolve(directory);
    return (request, response, next) => {
        if (!['GET', 'HEAD'].includes(request.method)) return next();
        let pathname;
        try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
        catch { response.statusCode = 400; response.end(); return; }
        const relative = pathname.startsWith(base) ? pathname.slice(base.length) : '';
        if (!['docs/', '_astro/', 'guide/'].some(prefix => relative.startsWith(prefix))) return next();
        if (relative.split(/[\\/]/).includes('..')) { response.statusCode = 404; response.end(); return; }
        let file = path.resolve(root, relative);
        if (!file.startsWith(`${root}${path.sep}`)) { response.statusCode = 404; response.end(); return; }
        if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
        if (!existsSync(file) || !statSync(file).isFile()) { response.statusCode = 404; response.end(); return; }
        response.setHeader('Content-Type', contentTypes[path.extname(file)] || 'application/octet-stream');
        response.setHeader('Cache-Control', 'no-cache');
        response.setHeader('X-Robots-Tag', 'noindex, follow');
        if (request.method === 'HEAD') { response.end(); return; }
        const stream = createReadStream(file);
        stream.on('error', () => { response.destroy(); });
        response.on('close', () => stream.destroy());
        stream.pipe(response);
    };
}
