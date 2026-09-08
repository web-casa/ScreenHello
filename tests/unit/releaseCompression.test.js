import { describe, expect, it } from 'vitest';
import { compressionCases, COMPRESSION_SCOPE, validateCompressionEvidence } from '../release/compression-contract.mjs';

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
