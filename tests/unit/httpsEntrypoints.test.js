import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { checkExpectedWebBuild } from '../release/candidate-identity.mjs';
import { checkedEntrypointUrl, fetchEntrypoint, compareEntrypoint, summarizeEntrypoints, ENTRYPOINTS, MAX_ENTRYPOINT_BYTES, ENTRYPOINT_TIMEOUT_MS } from '../release/https-entrypoints.mjs';

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
const hash = 'a'.repeat(64);
it('requires the exact expected candidate when supplied, keeping empty legacy dispatch compatible', () => {
    expect(checkExpectedWebBuild(hash)).toEqual({ expectedWebBuildSha256: null, expectedWebBuildMatched: null });
    expect(checkExpectedWebBuild(hash, hash)).toEqual({ expectedWebBuildSha256: hash, expectedWebBuildMatched: true });
    for (const value of [' ', ` ${hash}`, hash.toUpperCase(), 'b'.repeat(64), null, 0]) {
        expect(() => checkExpectedWebBuild(hash, value)).toThrow();
    }
    expect(() => checkExpectedWebBuild('')).toThrow();
});
it.each(['http://screenhello.com/', 'https://other.example/', 'https://screenhello.com:444/',
    'https://user:password@screenhello.com/', 'https://screenhello.com/?x=1', 'https://screenhello.com/#x',
    'https://screenhello.com/assets/codec.wasm', 'https://127.0.0.1/'])('refuses out-of-scope URLs: %s', url => {
    expect(() => checkedEntrypointUrl(url)).toThrow();
});

function transport({ status = 200, headers = {}, authorized = true, chunks = [Buffer.from('test')], complete = true, abort = false, stall = false, error } = {}) {
    const request = new EventEmitter(); request.destroy = vi.fn();
    const get = vi.fn((url, options, callback) => {
        queueMicrotask(() => {
            if (error) { request.emit('error', new Error(error)); return; }
            if (stall) return;
            const response = new PassThrough();
            response.statusCode = status;
            response.headers = { 'content-type': 'text/html; charset=utf-8', ...headers };
            response.socket = { authorized, getProtocol: () => 'TLSv1.3', getPeerCertificate: () => ({ fingerprint256: 'synthetic' }) };
            response.complete = complete;
            callback(response);
            if (abort) { response.emit('aborted'); response.destroy(); return; }
            for (const chunk of chunks) response.write(chunk);
            response.end();
        });
        return request;
    });
    return { get, request };
}
it('uses a fresh verified TLS connection, no cookies and exact uncompressed bytes', async () => {
    const { get } = transport();
    const result = await fetchEntrypoint('https://screenhello.com/', { get });
    expect(get.mock.calls[0][1]).toEqual({ agent: false, rejectUnauthorized: true, maxHeaderSize: 16384,
        headers: { 'accept-encoding': 'identity', 'cache-control': 'no-cache' } });
    expect(result).toMatchObject({ status: 200, size: 4, tls: { authorized: true, protocol: 'TLSv1.3' } });
    expect(compareEntrypoint(ENTRYPOINTS[0], Buffer.from('test'), result)).toMatchObject({ bytesMatch: true, mimeMatches: true });
    expect(compareEntrypoint(ENTRYPOINTS[1], Buffer.from('other'), result)).toMatchObject({ bytesMatch: false, mimeMatches: false });
});
it.each([
    [{ status: 302, headers: { location: 'https://other.example/' } }, 'entrypoint-http-302'],
    [{ status: 503 }, 'entrypoint-http-503'],
    [{ authorized: false }, 'TLS certificate not authorized'],
    [{ headers: { 'content-encoding': 'gzip' } }, 'unexpected content encoding'],
    [{ headers: { 'content-length': String(MAX_ENTRYPOINT_BYTES + 1) } }, 'entrypoint-too-large'],
    [{ chunks: [Buffer.alloc(MAX_ENTRYPOINT_BYTES), Buffer.alloc(1)] }, 'entrypoint-too-large'],
    [{ chunks: [] }, 'entrypoint-incomplete'],
    [{ complete: false }, 'entrypoint-incomplete'],
    [{ headers: { 'content-length': '5' } }, 'entrypoint-incomplete'],
    [{ abort: true }, 'entrypoint-aborted'],
    [{ error: 'CERT_HAS_EXPIRED' }, 'CERT_HAS_EXPIRED'],
])('fails closed and does not retry: %j', async (scenario, message) => {
    const { get, request } = transport(scenario);
    await expect(fetchEntrypoint('https://screenhello.com/', { get })).rejects.toThrow(message);
    expect(get).toHaveBeenCalledTimes(1);
    expect(request.destroy).toHaveBeenCalled();
});
it('bounds DNS/handshake stalls with an absolute deadline and destroys the request', async () => {
    vi.useFakeTimers();
    const { get, request } = transport({ stall: true });
    const assertion = expect(fetchEntrypoint('https://screenhello.com/', { get })).rejects.toThrow('entrypoint-deadline');
    await vi.advanceTimersByTimeAsync(ENTRYPOINT_TIMEOUT_MS);
    await assertion;
    expect(request.destroy).toHaveBeenCalledOnce();
});
it('refuses certificate bypass before any request', () => {
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');
    const { get } = transport();
    expect(() => fetchEntrypoint('https://screenhello.com/', { get })).toThrow('insecure TLS environment');
    expect(get).not.toHaveBeenCalled();
});
it('entrypoint matches never stand in for full HTTPS/PWA release acceptance', () => {
    const rows = ENTRYPOINTS.map(entry => ({ path: entry.path, bytesMatch: true, mimeMatches: true, observed: { status: 200, tls: { authorized: true } } }));
    expect(summarizeEntrypoints(rows)).toMatchObject({ status: 'ENTRYPOINTS-MATCH', releaseGate: 'HOLD', pwaBrowserAcceptance: false, deploymentAuthorized: false });
    rows[0].bytesMatch = false;
    expect(summarizeEntrypoints(rows).status).toBe('CANDIDATE-MISMATCH-HOLD');
    rows[0].error = 'certificate';
    expect(summarizeEntrypoints(rows).status).toBe('ERROR-HOLD');
    expect(() => summarizeEntrypoints(rows.slice(1))).toThrow();
});
