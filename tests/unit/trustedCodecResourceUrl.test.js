import { describe, expect, it } from 'vitest';
import { trustedCodecResourceUrl } from '../../src/utils/trustedCodecResourceUrl.js';

describe('trusted codec resource URL policy', () => {
    it.each([
        ['web production', 'https://screenhello.example/assets/avif.wasm', 'https://screenhello.example/assets/worker.js'],
        ['web development', '/assets/webp.wasm', 'http://localhost:1420/assets/worker.js'],
        ['Tauri macOS/Linux', '/assets/oxipng.wasm', 'tauri://localhost/assets/worker.js'],
        ['Tauri Windows', '/assets/oxipng.wasm', 'http://tauri.localhost/assets/worker.js'],
    ])('accepts a bundled %s resource', (_name, value, base) => {
        expect(trustedCodecResourceUrl(value, base)).toBe(new URL(value, base).href);
    });

    it.each([
        ['a remote web host', 'https://cdn.example/codec.wasm', 'https://screenhello.example/assets/worker.js'],
        ['a different Tauri host', 'tauri://other-host/assets/codec.wasm', 'tauri://localhost/assets/worker.js'],
        ['a different localhost port', 'http://localhost:5173/assets/codec.wasm', 'http://localhost:1420/assets/worker.js'],
        ['the user-file asset protocol', 'asset://localhost/private/codec.wasm', 'tauri://localhost/assets/worker.js'],
        ['a file URL', 'file:///tmp/codec.wasm', 'tauri://localhost/assets/worker.js'],
        ['a data URL', 'data:application/wasm;base64,AA==', 'tauri://localhost/assets/worker.js'],
        ['credentials', 'https://user:pass@screenhello.example/codec.wasm', 'https://screenhello.example/assets/worker.js'],
        ['whitespace padded input', ' /assets/codec.wasm', 'tauri://localhost/assets/worker.js'],
    ])('rejects %s', (_name, value, base) => {
        expect(() => trustedCodecResourceUrl(value, base)).toThrow('codec-resource-url-untrusted');
    });
});
