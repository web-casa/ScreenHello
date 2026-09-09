import assert from 'node:assert/strict';
import https from 'node:https';
import { sha256 } from '../compression-product/memory-evidence.mjs';

export const ENTRYPOINTS = Object.freeze([
    { path: '/', file: 'index.html', mime: ['text/html'] },
    { path: '/sw.js', file: 'sw.js', mime: ['text/javascript', 'application/javascript'] },
    { path: '/manifest.webmanifest', file: 'manifest.webmanifest', mime: ['application/manifest+json'] },
]);
export const MAX_ENTRYPOINT_BYTES = 1024 * 1024;
export const ENTRYPOINT_TIMEOUT_MS = 15000;

export function checkedEntrypointUrl(value) {
    const url = new URL(value);
    assert.equal(url.origin, 'https://screenhello.com', 'only the authorized production origin is in scope');
    assert.ok(!url.username && !url.password && !url.search && !url.hash, 'credentials/query/hash are not allowed');
    assert.ok(ENTRYPOINTS.some(entry => entry.path === url.pathname), 'not an entrypoint');
    return url;
}

// Fresh connections, ordinary certificate + hostname verification, no redirect
// following, cookies, compression negotiation or retries. The deadline includes
// DNS and handshake, unlike an idle socket timeout alone.
export function fetchEntrypoint(value, { get = https.get } = {}) {
    const url = checkedEntrypointUrl(value);
    assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0', 'insecure TLS environment');
    return new Promise((resolve, reject) => {
        let request;
        let settled = false;
        const finish = (error, result) => {
            if (settled) return;
            settled = true;
            clearTimeout(deadline);
            if (error) { request?.destroy(); reject(error); }
            else resolve(result);
        };
        const deadline = setTimeout(() => finish(new Error('entrypoint-deadline')), ENTRYPOINT_TIMEOUT_MS);
        try {
            request = get(url, { agent: false, rejectUnauthorized: true, maxHeaderSize: 16384,
                headers: { 'accept-encoding': 'identity', 'cache-control': 'no-cache' } }, response => {
                response.on('error', error => finish(error));
                response.on('aborted', () => finish(new Error('entrypoint-aborted')));
                try {
                    assert.equal(response.socket.authorized, true, 'TLS certificate not authorized');
                    const tls = { authorized: true, protocol: response.socket.getProtocol(),
                        fingerprint256: response.socket.getPeerCertificate().fingerprint256 };
                    assert.equal(response.statusCode, 200, `entrypoint-http-${response.statusCode}`);
                    assert.ok(!response.headers['content-encoding'] || response.headers['content-encoding'] === 'identity', 'unexpected content encoding');
                    const length = response.headers['content-length'];
                    assert.ok(length === undefined || (/^\d+$/.test(length) && Number(length) <= MAX_ENTRYPOINT_BYTES), 'entrypoint-too-large');
                    const chunks = []; let size = 0;
                    response.on('data', chunk => {
                        if (settled) return;
                        size += chunk.length;
                        if (size > MAX_ENTRYPOINT_BYTES) { finish(new Error('entrypoint-too-large')); return; }
                        chunks.push(chunk);
                    });
                    response.on('end', () => {
                        if (!response.complete || !size || (length !== undefined && Number(length) !== size)) {
                            finish(new Error('entrypoint-incomplete')); return;
                        }
                        finish(null, { status: 200, size, sha256: sha256(Buffer.concat(chunks)), tls,
                            contentType: response.headers['content-type'] || '',
                            cacheControl: response.headers['cache-control'] || '',
                            csp: response.headers['content-security-policy'] || '' });
                    });
                } catch (error) { response.destroy(); finish(error); }
            });
            request.on('error', error => finish(error));
        } catch (error) { finish(error); }
    });
}

export function compareEntrypoint(entry, expectedBytes, observed) {
    assert.ok(Buffer.isBuffer(expectedBytes) && expectedBytes.length > 0 && expectedBytes.length <= MAX_ENTRYPOINT_BYTES, 'invalid local entrypoint');
    const expectedSha256 = sha256(expectedBytes);
    const mimeMatches = entry.mime.includes(observed.contentType.split(';')[0].trim().toLowerCase());
    return { path: entry.path, expectedSha256, observed, mimeMatches, bytesMatch: observed.sha256 === expectedSha256 };
}

export function summarizeEntrypoints(rows) {
    assert.deepEqual(rows.map(row => row.path), ENTRYPOINTS.map(entry => entry.path), 'entrypoint set mismatch');
    const errors = rows.some(row => row.error || row.observed?.tls?.authorized !== true || row.observed?.status !== 200);
    return { scope: 'https-entrypoint-identity-only',
        status: errors ? 'ERROR-HOLD' : rows.every(row => row.mimeMatches === true && row.bytesMatch === true) ? 'ENTRYPOINTS-MATCH' : 'CANDIDATE-MISMATCH-HOLD',
        releaseGate: 'HOLD', fullAssetClosureVerified: false, pwaBrowserAcceptance: false, deploymentAuthorized: false };
}
