import { describe, expect, it, vi } from 'vitest';
import { blockExternalRequests, isLocalBrowserUrl } from '../e2e/offline.js';

describe('E2E offline routing', () => {
    it('keeps loopback, Blob, and data URLs on their native connection', () => {
        for (const value of [
            'http://127.0.0.1:4173/',
            'http://localhost:4173/src/main.jsx',
            'http://[::1]:4173/',
            'blob:http://127.0.0.1:4173/owned-image',
            'data:image/png;base64,AA==',
        ]) {
            expect(isLocalBrowserUrl(new URL(value))).toBe(true);
        }
        expect(isLocalBrowserUrl(new URL('https://example.test/image.png'))).toBe(false);
    });

    it('installs a route only for external requests and reports the aborted target', async () => {
        let match;
        let handler;
        const route = vi.fn(async (nextMatch, nextHandler) => {
            match = nextMatch;
            handler = nextHandler;
        });
        const external = [];
        await blockExternalRequests({ route }, (url) => external.push(url));

        expect(match(new URL('http://127.0.0.1:4173/src/main.jsx'))).toBe(false);
        expect(match(new URL('https://example.test/image.png'))).toBe(true);

        const abort = vi.fn(async () => {});
        await handler({
            request: () => ({ url: () => 'https://example.test/image.png' }),
            abort,
        });
        expect(external).toEqual(['https://example.test/image.png']);
        expect(abort).toHaveBeenCalledWith('blockedbyclient');
    });
});
