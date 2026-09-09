import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANCEL_SCOPE, cancellationCases, recoverySpecification, validateCancelEvidence } from '../release/cancel-contract.mjs';
import { installCancelObserver } from '../release/cancel-observer.mjs';
import { compressionCases, COMPRESSION_SCOPE, validateCompressionEvidence } from '../release/compression-contract.mjs';
import { decodeAvifFile } from '../release/avif-file-decoder.mjs';
import { readFileSync } from 'node:fs';
import createEncoder from '@jsquash/avif/codec/enc/avif_enc.js';
import { defaultOptions } from '@jsquash/avif/meta.js';

const fixture = () => ({
    scope: COMPRESSION_SCOPE, status: 'passed',
    avifPreviewCapability: { state: 'supported', noticeVisible: false, previewEnabled: true, directDownloadEnabled: true },
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

const cancelFixture = () => ({
    scope: CANCEL_SCOPE, status: 'passed', registration: { registeredAt: '2026-09-09T00:00:00Z',
        cases: cancellationCases(), attemptsPerCase: 1, memoryMeasurement: false, fixtureSha256: 'c'.repeat(64) },
    job: { id: 1, width: 1200, height: 1000, compression: 'standard', startedAt: 1, cancelRequestedAt: 2,
        terminatedAt: 3, completedAt: null, failed: false },
    cancelledDownloads: 0, cancellationMs: 25, recoveredSamePage: true, overflow: false, jobsAdded: 1, recoveryDownloads: 1,
    layersBefore: ['PC example 1200 × 1000'], layersAfter: ['PC example 1200 × 1000'],
    recovery: { ...fixture().results[3], ...recoverySpecification },
});

afterEach(() => vi.unstubAllGlobals());
describe('real Worker cancellation evidence', () => {
    it('accepts a submitted then cancelled job and same-page PNG recovery', () => {
        expect(() => validateCancelEvidence(cancelFixture())).not.toThrow();
    });
    it.each([
        ['missing registration', e => { delete e.registration; }],
        ['extra attempt', e => { e.registration.attemptsPerCase = 2; }],
        ['already completed', e => { e.job.completedAt = 1.5; }],
        ['missing termination', e => { e.job.terminatedAt = null; }],
        ['no cancel click', e => { e.job.cancelRequestedAt = null; }],
        ['termination before click', e => { e.job.terminatedAt = 1.5; }],
        ['cancel before submit', e => { e.job.cancelRequestedAt = 0; }],
        ['failed Worker', e => { e.job.failed = true; }],
        ['extra submitted job', e => { e.jobsAdded = 2; }],
        ['wrong mode', e => { e.job.compression = 'lossy'; }],
        ['unexpected download', e => { e.cancelledDownloads = 1; }],
        ['late download', e => { e.recoveryDownloads = 2; }],
        ['page reload', e => { e.recoveredSamePage = false; }],
        ['lost project layers', e => { e.layersAfter = []; }],
        ['missing dimensions', e => { e.job.width = 0; }],
        ['changed project dimensions', e => { e.job.width = 1400; }],
        ['trace overflow', e => { e.overflow = true; }],
        ['slow cancellation', e => { e.cancellationMs = 10_001; }],
        ['wrong recovery MIME', e => { e.recovery.type = 'image/avif'; }],
    ])('rejects %s', (_name, mutate) => {
        const evidence = cancelFixture(); mutate(evidence);
        expect(() => validateCancelEvidence(evidence)).toThrow();
    });
    it('transparently observes AVIF Worker calls, preserving transfers, this and newTarget', () => {
        let click;
        vi.stubGlobal('document', { addEventListener: (type, listener, capture) => { expect(type).toBe('click'); expect(capture).toBe(true); click = listener; } });
        const post = vi.fn(function () { expect(this).toBeInstanceOf(NativeWorker); return 'posted'; });
        const stop = vi.fn();
        class NativeWorker {
            constructor(...args) { this.args = args; this.listeners = {}; }
            postMessage = post;
            terminate = stop;
            addEventListener(type, listener) { this.listeners[type] = listener; }
        }
        vi.stubGlobal('window', { Worker: NativeWorker });
        installCancelObserver();
        class Child extends window.Worker {}
        const worker = new Child('codec.js', { type: 'module', name: 'screenhello-avif-encoder' });
        expect(worker).toBeInstanceOf(Child);
        const pixels = new ArrayBuffer(4); const message = { id: 7, width: 2, height: 1, pixels }; const transfers = [pixels];
        expect(worker.postMessage(message, transfers)).toBe('posted');
        expect(post).toHaveBeenCalledExactlyOnceWith(message, transfers);
        const job = window.__screenhelloCancelObserver.jobs[0];
        expect(job).not.toHaveProperty('pixels');
        click({ target: { closest: () => ({}) } });
        worker.terminate();
        expect(stop).toHaveBeenCalledOnce();
        expect(job.cancelRequestedAt).toBeTypeOf('number');
        expect(job.terminatedAt).toBeGreaterThanOrEqual(job.cancelRequestedAt);
        worker.listeners.message({ data: { id: 7, ok: true } });
        expect(job.completedAt).toBeTypeOf('number');
        const unchanged = new window.Worker('other.js', { name: 'other' });
        expect(unchanged.postMessage).toBe(post);
    });
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
        ['missing AVIF capability', e => { delete e.avifPreviewCapability; }],
        ['download blocked by preview', e => { e.avifPreviewCapability.directDownloadEnabled = false; }],
        ['preview blocked without explanation', e => { e.avifPreviewCapability.previewEnabled = false; }],
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
