import { expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { hashPaths } from '../compression-product/memory-evidence.mjs';
import net from 'node:net';
import http from 'node:http';
import { once } from 'node:events';
import { startPreviewNetworkGate } from '../release/preview-network-gate.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkedPreviewOrigin, previewHeaders, previewInventory, checkPreviewResponse, PREVIEW_CSP, validateOfflineProbe } from '../release/https-preview-contract.mjs';
import { fetchVerifiedHttps } from '../release/https-entrypoints.mjs';

it.each(['https://screenhello.com', 'https://screenhello-preview.pages.dev', 'https://candidate.screenhello-preview.pages.dev',
    'http://mg3-pwa-20260909.screenhello-preview.pages.dev', 'https://abcdef12.screenhello-preview.pages.dev/',
    'https://abcdef12.screenhello-preview.pages.dev:443', 'https://abcdef12.screenhello-preview.pages.dev@evil.example',
    'https://abcdef12.screenhello-preview.pages.dev?x=1', 'https://abcdef12.other-project.pages.dev'])('rejects out of scope preview: %s', value => {
    expect(() => checkedPreviewOrigin(value)).toThrow();
});
it('allows only the isolated branch alias and immutable deployment origins', () => {
    for (const prefix of ['mg3-pwa-20260909', 'abcdef12']) expect(checkedPreviewOrigin(`https://${prefix}.screenhello-preview.pages.dev`)).toContain(prefix);
});
it('preserves existing rules and applies CSP only to root, SW and hashed assets', () => {
    const source = '/*\n  X-Content-Type-Options: nosniff\n\n/sw.js\n  Cache-Control: no-cache\n';
    const headers = previewHeaders(source);
    expect(headers).toContain('Cache-Control: no-cache');
    expect(headers.match(/^\/sw.js$/gm)).toHaveLength(1);
    expect(headers.match(/Content-Security-Policy:/g)).toHaveLength(3);
    expect(() => previewHeaders(headers)).toThrow();
    expect(PREVIEW_CSP).not.toContain("script-src 'self' 'unsafe-eval'");
});
function response() {
    return { status: 200, tls: { authorized: true }, sha256: 'a'.repeat(64), size: 10, robots: 'noindex, follow',
        nosniff: 'nosniff', contentType: 'text/html; charset=utf-8', csp: PREVIEW_CSP, cacheControl: 'public, no-cache, max-age=0, must-revalidate' };
}
const row = { file: 'index.html', sha256: 'a'.repeat(64), bytes: 10 };
it('accepts rejected CONNECT only with independent offline gateway counters', () => {
    const before = { offline: true, opened: 2, refused: 0 }, after = { offline: true, opened: 2, refused: 1 };
    for (const observed of [{ error: 'TypeError' }, { status: 503, body: '' }]) expect(() => validateOfflineProbe(observed, before, after)).not.toThrow();
    for (const observed of [{ status: 200, body: '' }, { status: 404, body: '' }, { status: 503, body: 'upstream' }, { error: 'TimeoutError' }]) expect(() => validateOfflineProbe(observed, before, after)).toThrow();
    for (const changed of [{ ...after, opened: 3 }, { ...after, refused: 0 }, { ...after, offline: false }, { ...after, opened: NaN }]) expect(() => validateOfflineProbe({ error: 'TypeError' }, before, changed)).toThrow();
});
it('checks exact bytes and headers, not just successful status', () => expect(() => checkPreviewResponse(row, response())).not.toThrow());
it.each([
    data => { data.status = 302; }, data => { data.tls.authorized = false; }, data => { data.sha256 = 'b'.repeat(64); },
    data => { data.size = 11; }, data => { data.robots = 'index'; }, data => { data.nosniff = ''; },
    data => { data.contentType = 'application/octet-stream'; }, data => { data.csp = ''; },
    data => { data.cacheControl = 'public, max-age=0'; }, data => { data.cacheControl += ', max-age=14400'; },
])('rejects incorrect preview identity/policy', mutate => {
    const data = response(); mutate(data); expect(() => checkPreviewResponse(row, data)).toThrow();
});
it('requires WASM MIME and immutable caching for hashed assets', () => {
    const data = { ...response(), contentType: 'application/wasm', cacheControl: 'public, max-age=31536000, immutable' };
    const asset = { ...row, file: 'assets/codec-test.wasm' };
    expect(() => checkPreviewResponse(asset, data)).not.toThrow();
    expect(() => checkPreviewResponse(asset, { ...data, contentType: 'text/html' })).toThrow();
    expect(() => checkPreviewResponse(asset, { ...data, cacheControl: 'public' })).toThrow();
});
it('keeps transport budgets bounded before networking', () => {
    for (const maxBytes of [0, -1, Infinity, 4 * 1024 * 1024 + 1]) expect(() => fetchVerifiedHttps('https://example.com', { maxBytes })).toThrow();
    expect(() => fetchVerifiedHttps('http://example.com')).toThrow();
    expect(() => fetchVerifiedHttps('https://user:pass@example.com')).toThrow();
    expect(() => fetchVerifiedHttps('https://example.com', { expectedStatus: 302 })).toThrow();
});
it('inventories only bounded static files, rejects private paths and symlinks', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'screenhello-preview-unit-'));
    try {
        for (const file of ['index.html', 'sw.js', 'manifest.webmanifest', '_headers', '_redirects', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.txt']) writeFileSync(path.join(directory, file), 'fixture');
        expect(previewInventory(directory)).toHaveLength(7);
        expect(previewInventory(directory).find(item => item.file === 'index.html').requestPath).toBe('/');
        writeFileSync(path.join(directory, '404.html'), 'not found');
        expect(previewInventory(directory).find(item => item.file === '404.html').requestPath).toBe('/screenhello-preview-not-found-check');
        writeFileSync(path.join(directory, 'source.map'), '{}');
        expect(() => previewInventory(directory)).toThrow();
        rmSync(path.join(directory, 'source.map'));
        symlinkSync(path.join(directory, 'index.html'), path.join(directory, 'alias.html'));
        expect(() => previewInventory(directory)).toThrow('upload symlink');
        rmSync(path.join(directory, 'alias.html'));
        writeFileSync(path.join(directory, 'sw.js'), '/' + ['home', 'example', 'private'].join('/'));
        expect(() => previewInventory(directory)).toThrow('private upload content');
    } finally { rmSync(directory, { recursive: true }); }
});
it('prepares an exclusive upload with unchanged application bytes and rejects overwrite', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'screenhello-preview-cli-unit-'));
    try {
        const source = path.join(directory, 'source'), dist = path.join(source, 'dist'), out = path.join(directory, 'upload');
        mkdirSync(dist, { recursive: true });
        for (const file of ['index.html', 'sw.js', 'manifest.webmanifest', '_headers', '_redirects']) writeFileSync(path.join(dist, file), file === '_headers' ? '/*\n  X-Content-Type-Options: nosniff\n\n/sw.js\n  Cache-Control: no-cache\n' : 'fixture');
        for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) writeFileSync(path.join(source, file), 'license');
        const hash = hashPaths(dist, ['./']);
        const args = ['tests/release/prepare-https-preview.mjs', source, out, hash];
        const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10000 });
        expect(result.status, result.stderr).toBe(0);
        expect(hashPaths(dist, ['./'])).toBe(hash);
        expect(readFileSync(path.join(out, 'sw.js'), 'utf8')).toBe('fixture');
        expect(JSON.parse(readFileSync(`${out}.json`, 'utf8')).inventory).toHaveLength(7);
        expect(spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10000 }).status).not.toBe(0);
    } finally { rmSync(directory, { recursive: true }); }
});
it('network gate relays only its exact host, severs live tunnels and refuses offline reconnects', async () => {
    const upstream = net.createServer(socket => socket.pipe(socket));
    upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
    let connects = 0;
    const gate = await startPreviewNetworkGate('https://abcdef12.screenhello-preview.pages.dev', { connect: () => {
        connects++; return net.connect({ host: '127.0.0.1', port: upstream.address().port });
    } });
    const open = target => new Promise((resolve, reject) => {
        const request = http.request({ hostname: '127.0.0.1', port: new URL(gate.url).port, method: 'CONNECT', path: target });
        request.once('connect', (response, socket) => resolve({ response, socket })); request.once('error', reject); request.end();
    });
    try {
        const denied = await open('other.example:443'); expect(denied.response.statusCode).toBe(403); denied.socket.destroy(); expect(connects).toBe(0);
        const allowed = await open('abcdef12.screenhello-preview.pages.dev:443'); expect(allowed.response.statusCode).toBe(200);
        const echo = once(allowed.socket, 'data'); allowed.socket.write('fixture'); expect((await echo)[0].toString()).toBe('fixture');
        const closed = once(allowed.socket, 'close'); gate.setOffline(true); await closed;
        const refused = await open('abcdef12.screenhello-preview.pages.dev:443'); expect(refused.response.statusCode).toBe(503); refused.socket.destroy();
        expect(connects).toBe(1); expect(gate.snapshot()).toMatchObject({ offline: true, opened: 1, refused: 1 });
        gate.setOffline(false); const recovered = await open('abcdef12.screenhello-preview.pages.dev:443'); expect(recovered.response.statusCode).toBe(200); recovered.socket.destroy();
        expect(connects).toBe(2);
    } finally { await gate.close(); await new Promise(resolve => upstream.close(resolve)); }
});
