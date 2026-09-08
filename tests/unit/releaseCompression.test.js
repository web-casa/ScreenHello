import { describe, expect, it } from 'vitest';
import { compressionCases, COMPRESSION_SCOPE, validateCompressionEvidence } from '../release/compression-contract.mjs';
import { decodeAvifFile } from '../release/avif-file-decoder.mjs';
import { readFileSync } from 'node:fs';
import createEncoder from '@jsquash/avif/codec/enc/avif_enc.js';
import { defaultOptions } from '@jsquash/avif/meta.js';

const fixture = () => ({
    scope: COMPRESSION_SCOPE, status: 'passed',
    registration: { registeredAt: '2026-09-09T00:00:00Z', cases: compressionCases(), attemptsPerCase: 1, memoryMeasurement: false,
        fixtureSha256: { small: 'a'.repeat(64), pc: 'b'.repeat(64) } },
    results: compressionCases().map(specification => {
        const width = specification.fixture === 'pc' ? 1200 : 73 * specification.ratio;
        const height = specification.fixture === 'pc' ? 1000 : 55 * specification.ratio;
        return { ...specification, width, height, decoded: { width, height, corner: [0, 0, 0, 0] },
            type: `image/${specification.format === 'jpg' ? 'jpeg' : specification.format}`, size: 1234,
            hex: { png: '89504e470d0a1a0a', jpg: 'ffd8ff', webp: '524946460000000057454250', avif: '000000006674797061766966' }[specification.format],
            focused: true, visibility: 'visible', durationMs: 125, editorSurvived: true,
            ...(specification.preview ? { previewBytes: 1234, previewBlobReused: true } : {}),
        };
    }),
    largeAvifRejection: { lossyDisabled: true, standardEnabled: true, previewDisabled: true, noDownload: true },
});

describe('bounded browser compression evidence', () => {
    it('validates AVIF bytes using the pinned independent decoder in a disposable Node worker', async () => {
        const codec = await createEncoder({ noInitialRun: true,
            wasmBinary: readFileSync(new URL(import.meta.resolve('@jsquash/avif/codec/enc/avif_enc.wasm'))) });
        const encoded = codec.encode(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0]), 2, 1,
            { ...defaultOptions, quality: 60, qualityAlpha: 60, speed: 8, subsample: 3 });
        const decoded = await decodeAvifFile(Buffer.from(encoded).toString('base64'));
        expect(decoded).toMatchObject({ width: 2, height: 1, decoder: 'jsquash-avif-2.1.1-node-wasm' });
        expect(decoded.corner[3]).toBe(255);
    });
    it('rejects corrupt AVIF rather than accepting its MIME label', async () => {
        await expect(decodeAvifFile(Buffer.from('invalid image').toString('base64'))).rejects.toThrow();
    });
    it('rejects unbounded decoder inputs before spawning a worker', () => {
        expect(() => decodeAvifFile('')).toThrow('avif-fixture-file-size-invalid');
        expect(() => decodeAvifFile(Buffer.alloc(131_073).toString('base64'))).toThrow('avif-fixture-file-size-invalid');
    });
    it('keeps native AVIF failure explicit when the file is independently valid', () => {
        const evidence = fixture();
        evidence.results[0].decodeError = 'native decoder unavailable';
        evidence.results[0].decoded.decoder = 'jsquash-avif-2.1.1-node-wasm';
        expect(() => validateCompressionEvidence(evidence)).not.toThrow();
        delete evidence.results[0].decodeError;
        expect(() => validateCompressionEvidence(evidence)).toThrow();
    });
    it('accepts the eight exact cases and an explicit large-AVIF rejection', () => {
        expect(() => validateCompressionEvidence(fixture())).not.toThrow();
        expect(compressionCases()).toHaveLength(8);
    });
    it.each([
        ['missing case', e => e.results.pop()],
        ['duplicate case', e => { e.results[1] = e.results[0]; }],
        ['edited registration', e => e.registration.cases.pop()],
        ['missing fixture identity', e => { delete e.registration.fixtureSha256.pc; }],
        ['extra attempts', e => { e.registration.attemptsPerCase = 2; }],
        ['false memory claim', e => { e.registration.memoryMeasurement = true; }],
        ['failed status', e => { e.status = 'failed'; }],
        ['undecodable bytes', e => { delete e.results[0].decoded; }],
        ['wrong decoded size', e => e.results[0].decoded.width++],
        ['wrong MIME', e => { e.results[0].type = 'image/png'; }],
        ['changed quality', e => { e.results[0].quality = 1; }],
        ['fake AVIF signature', e => { e.results[0].hex = '000000006674797061766973'; }],
        ['small PC fixture', e => { e.results[3].width = 64; }],
        ['oversized small AVIF', e => { e.results[0].width = 8192; }],
        ['lost focus', e => { e.results[0].focused = false; }],
        ['opaque PNG', e => { e.results[1].decoded.corner[3] = 255; }],
        ['different preview Blob', e => { e.results[2].previewBlobReused = false; }],
        ['different preview bytes', e => e.results[2].previewBytes++],
        ['lost editor', e => { e.results[0].editorSurvived = false; }],
        ['large AVIF enabled', e => { e.largeAvifRejection.lossyDisabled = false; }],
        ['unexpected rejected download', e => { e.largeAvifRejection.noDownload = false; }],
    ])('rejects %s despite a claimed pass', (_label, mutate) => {
        const evidence = fixture(); mutate(evidence);
        expect(() => validateCompressionEvidence(evidence)).toThrow();
    });
});
