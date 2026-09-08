import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Serve only one generated experiment directory on an ephemeral loopback port.
// Refusing origin requests verifies cache misses even when an engine's simulated
// offline mode does not cover every ServiceWorker / dedicated-worker request.
export async function startProbeServer(root, { base = '/' } = {}) {
    if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) throw new Error('invalid probe base');
    let offline = false;
    let refused = 0;
    const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm',
        '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    const server = createServer(async (request, response) => {
        if (offline) { refused++; response.writeHead(503); response.end('C0 origin unavailable'); return; }
        let pathname;
        try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
        catch { response.writeHead(400); response.end(); return; }
        if (!pathname.startsWith(base)) { response.writeHead(404); response.end(); return; }
        const relative = pathname.slice(base.length) || 'index.html';
        const file = path.resolve(root, relative);
        if (!file.startsWith(`${path.resolve(root)}${path.sep}`)) { response.writeHead(403); response.end(); return; }
        try {
            const bytes = await readFile(file);
            response.writeHead(200, {
                'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream',
                'Cache-Control': 'no-store',
                'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:",
            });
            response.end(bytes);
        } catch { response.writeHead(404); response.end(); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return { url: `http://127.0.0.1:${server.address().port}${base}`, setOffline: value => { offline = value; },
        get refused() { return refused; },
        close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
