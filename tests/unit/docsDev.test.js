import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { docsDevMiddleware } from '../../config/docsDevPlugin.mjs';

describe('documentation development service', () => {
    it.each(['/', '/tools/editor/'])('serves actual docs and assets under %s without exposing other files', async base => {
        const directory = await mkdtemp(path.join(tmpdir(), 'docs-dev-'));
        await mkdir(path.join(directory, 'docs/en'), { recursive: true });
        await mkdir(path.join(directory, '_astro'));
        await writeFile(path.join(directory, 'docs/en/index.html'), '<h1>Documentation</h1>');
        await writeFile(path.join(directory, '_astro/client.js'), 'export const ready = true;');
        await writeFile(path.join(directory, 'secret.txt'), 'not a documentation resource');
        const middleware = docsDevMiddleware(directory, base);
        const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const origin = `http://127.0.0.1:${server.address().port}`;
        try {
            const page = await fetch(`${origin}${base}docs/en/`);
            expect(page.status).toBe(200);
            expect(page.headers.get('content-type')).toContain('text/html');
            expect(page.headers.get('x-robots-tag')).toBe('noindex, follow');
            expect(await page.text()).toBe('<h1>Documentation</h1>');
            const asset = await fetch(`${origin}${base}_astro/client.js`);
            expect(asset.headers.get('content-type')).toContain('text/javascript');
            expect(await asset.text()).toContain('export const ready');
            const head = await fetch(`${origin}${base}docs/en/`, { method: 'HEAD' });
            expect(head.status).toBe(200);
            expect(await head.text()).toBe('');
            for (const route of ['docs/missing/', 'docs/%2e%2e%2fsecret.txt', 'secret.txt']) {
                expect((await fetch(`${origin}${base}${route}`)).status).toBe(404);
            }
        } finally {
            await new Promise(resolve => server.close(resolve));
            await rm(directory, { recursive: true, force: true });
        }
    });
});
