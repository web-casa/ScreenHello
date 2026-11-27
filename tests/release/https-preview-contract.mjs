import assert from 'node:assert/strict';
import { readdirSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sha256 } from '../compression-product/memory-evidence.mjs';
import { PROBE_CSP } from '../spikes/compression/server.mjs';

const internalAuditDirectory = ['docs', '4ai'].join('');
const privateSourceRepository = ['screenhello', 'Shoteasy'].join('-');
const privateUploadPath = new RegExp(
    '(?:^|/)(?:\\.|' + internalAuditDirectory + '|node_modules|src|local-device-assets|_worker\\.js|functions)(?:/|$)|\\.(?:map|md|psd)$',
    'i',
);
const privateUploadContent = new RegExp(
    '(?:/home/|/Users/|' + privateSourceRepository + '|' + internalAuditDirectory + '|-----BEGIN .*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,})',
);

export const PREVIEW_CSP = `${PROBE_CSP}; base-uri 'self'; object-src 'none'; frame-ancestors 'none'`;
export function validateOfflineProbe(observed, before, after) {
    assert.equal(before.offline, true); assert.equal(after.offline, true);
    for (const snapshot of [before, after]) for (const key of ['opened', 'refused']) assert.ok(Number.isInteger(snapshot[key]) && snapshot[key] >= 0);
    assert.equal(after.opened, before.opened, 'new upstream connection while offline');
    assert.ok(after.refused > before.refused, 'no observed gateway refusal');
    // WebKit exposes a rejected CONNECT as an empty 503 fetch response; the
    // other engines throw TypeError. Both require independent gateway counters.
    assert.ok(observed.error === 'TypeError' || (observed.error === undefined && observed.status === 503 && observed.body === ''), 'offline transport was not refused');
}
export function checkedPreviewOrigin(value) {
    assert.equal(typeof value, 'string');
    assert.match(value, /^https:\/\/(?:[a-f0-9]{8}|mg3-pwa-20260909)\.screenhello-preview\.pages\.dev$/,
        'only the isolated ScreenHello preview deployment is allowed');
    return value;
}
export function previewHeaders(original) {
    assert.ok(!original.includes(PREVIEW_CSP), 'preview headers already applied');
    // Merge an existing route instead of repeating its key: Pages may replace
    // the earlier block, silently losing its Cache-Control rule.
    assert.equal(original.split('\n/sw.js\n').length, 2, 'one existing SW header block required');
    const merged = original.replace('\n/sw.js\n', `\n/sw.js\n  Content-Security-Policy: ${PREVIEW_CSP}\n`);
    return `${merged}\n/\n  Content-Security-Policy: ${PREVIEW_CSP}\n  Cache-Control: no-cache, max-age=0, must-revalidate\n\n/assets/*\n  Content-Security-Policy: ${PREVIEW_CSP}\n  Cache-Control: public, max-age=31536000, immutable\n`;
}
export function previewInventory(directory) {
    const rows = [];
    const walk = relative => {
        for (const name of readdirSync(path.join(directory, relative)).sort()) {
            const file = relative ? `${relative}/${name}` : name;
            assert.ok(!privateUploadPath.test(file), 'private or executable upload path');
            const stat = lstatSync(path.join(directory, file));
            assert.ok(!stat.isSymbolicLink(), 'upload symlink');
            if (stat.isDirectory()) { walk(file); continue; }
            assert.ok(stat.isFile() && stat.size > 0 && stat.size <= 4 * 1024 * 1024, 'upload file budget');
            assert.ok(/\.(?:js|css|html|webmanifest|json|txt|xml|png|webp|svg|ico|wasm)$/.test(file) || ['_headers', '_redirects'].includes(file), 'unexpected upload extension');
            const bytes = readFileSync(path.join(directory, file));
            if (/\.(?:js|css|html|txt|xml|json|webmanifest)$/.test(file)) {
                assert.ok(!privateUploadContent.test(bytes.toString()), 'private upload content');
            }
            rows.push({ file, bytes: stat.size, sha256: sha256(bytes),
                requestPath: file === '404.html' ? '/screenhello-preview-not-found-check'
                    : file.endsWith('index.html') ? `/${file.slice(0, -10)}` : `/${file}` });
        }
    };
    walk('');
    assert.ok(rows.length <= 300 && rows.reduce((sum, row) => sum + row.bytes, 0) <= 32 * 1024 * 1024, 'upload closure budget');
    for (const file of ['index.html', 'sw.js', 'manifest.webmanifest', '_headers', '_redirects', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.txt']) assert.ok(rows.some(row => row.file === file), `missing ${file}`);
    return rows;
}
export function checkPreviewResponse(row, response) {
    assert.equal(response.status, row.file === '404.html' ? 404 : 200, 'unexpected status');
    assert.equal(response.tls.authorized, true);
    assert.equal(response.sha256, row.sha256, `deployed bytes mismatch: ${row.file}`);
    assert.equal(response.size, row.bytes);
    assert.match(response.robots, /\bnoindex\b/i, 'preview must not be indexed');
    assert.equal(response.nosniff, 'nosniff');
    const mime = response.contentType.split(';')[0].toLowerCase();
    const required = { js: ['text/javascript', 'application/javascript'], css: ['text/css'], html: ['text/html'],
        wasm: ['application/wasm'], webmanifest: ['application/manifest+json'], png: ['image/png'], webp: ['image/webp'], svg: ['image/svg+xml'] }[row.file.split('.').at(-1)];
    if (required) assert.ok(required.includes(mime), `wrong MIME: ${row.file}`);
    if (['index.html', 'sw.js'].includes(row.file) || row.file.startsWith('assets/')) assert.equal(response.csp, PREVIEW_CSP, 'preview CSP mismatch');
    if (['index.html', 'sw.js', 'manifest.webmanifest'].includes(row.file)) {
        assert.match(response.cacheControl, /\bno-cache\b/); assert.match(response.cacheControl, /\bmax-age=0\b/);
        assert.ok(!/\bmax-age=[1-9]/.test(response.cacheControl));
    }
    if (row.file.startsWith('assets/')) assert.match(response.cacheControl, /\bimmutable\b/);
}
