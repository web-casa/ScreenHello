import { describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import {
    BatchArchiveBuilder,
} from '../../src/utils/batchExport.js';
import {
    MAX_BATCH_ARCHIVE_BYTES,
    MAX_BATCH_OUTPUT_BYTES,
    createBatchEntryNamer,
    sanitizeBatchBasename,
} from '../../src/utils/batchContract.js';
import { BatchExportService, resolveBatchStyle } from '../../src/stores/batchExportService.js';
import { BatchStore } from '../../src/stores/batchStore.js';
import { createStylePreset } from '../../src/utils/stylePreset.js';

const file = (name, contents = name, type = 'image/png') => new File([contents], name, { type });

const job = (id, name) => ({ id, file: file(name) });

const createServiceHarness = ({ prepareFailure, exportFailure, outputSize = 4 } = {}) => {
    const calls = [];
    let active = 0;
    let maxActive = 0;
    const renderer = {
        target: { export: vi.fn() },
        size: { width: 80, height: 60 },
        prepare: vi.fn(async (input) => {
            calls.push(`prepare:${input.name}`);
            if (prepareFailure?.(input)) throw Object.assign(new Error('decode failed'), { code: 'batch-image-decode-failed' });
        }),
        waitUntilReady: vi.fn(async () => { calls.push('ready'); }),
        clear: vi.fn(() => { calls.push('clear'); }),
        dispose: vi.fn(() => { calls.push('dispose'); }),
    };
    const exportImage = vi.fn(async ({ baseName, signal }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        calls.push(`export:${baseName}`);
        try {
            await Promise.resolve();
            if (signal?.aborted) throw Object.assign(new Error('cancelled'), { code: 'export-cancelled' });
            if (exportFailure?.(baseName)) throw Object.assign(new Error('render failed'), { code: 'export-render-failed' });
            return {
                blob: new Blob([new Uint8Array(outputSize).fill(baseName.length)], { type: 'image/png' }),
                format: 'png',
                mimeType: 'image/png',
                pixelRatio: 1,
                width: 80,
                height: 60,
            };
        } finally {
            active -= 1;
        }
    });
    const root = { isDisposed: false, exportService: { exportImage } };
    const service = new BatchExportService(root, {
        styleResolver: vi.fn(async () => ({
            option: { frameConf: { width: 80, height: 60 }, size: { type: 'fixed' } },
            exportSettings: { format: 'png', ratio: 1 },
            backgroundBlob: null,
        })),
        rendererFactory: vi.fn(async () => renderer),
    });
    return { calls, exportImage, getMaxActive: () => maxActive, renderer, service };
};

describe('batch export utilities', () => {
    it('sanitizes local paths, reserved characters, dot entries, and UTF-8 length', () => {
        expect(sanitizeBatchBasename('../../CON<script>.png')).toBe('CON-script');
        expect(sanitizeBatchBasename('folder\\..')).toBe('image');
        const unicode = sanitizeBatchBasename(`${'截图😀'.repeat(80)}.png`);
        expect(new TextEncoder().encode(unicode).byteLength).toBeLessThanOrEqual(120);
        expect(Array.from(unicode).every((character) => {
            const code = character.codePointAt(0);
            return code > 31 && code !== 127 && !Array.from('\\/<>:"|?*').includes(character);
        })).toBe(true);
    });

    it('deduplicates after sanitization while keeping the frozen naming contract', () => {
        const nextName = createBatchEntryNamer({ format: 'png', ratio: 2 });
        expect(nextName('a/same.png')).toBe('same-screenhello@2.png');
        expect(nextName('b\\same.jpg')).toBe('same-2-screenhello@2.png');
        expect(nextName('../..')).toBe('image-screenhello@2.png');
    });

    it('avoids collisions between generated duplicate suffixes and literal basenames', () => {
        const nextName = createBatchEntryNamer({ format: 'webp', ratio: 1 });
        expect(nextName('foo.png')).toBe('foo-screenhello.webp');
        expect(nextName('foo-2.png')).toBe('foo-2-screenhello.webp');
        expect(nextName('FOO.jpg')).toBe('FOO-3-screenhello.webp');
    });

    it('uses the shared AVIF extension contract for batch entries', () => {
        const nextName = createBatchEntryNamer({ format: 'avif', ratio: 1 });
        expect(nextName('capture.png')).toBe('capture-screenhello.avif');
    });

    it('creates a pass-through ZIP and preserves completed entries when the output budget is reached', async () => {
        const archive = new BatchArchiveBuilder({ maxOutputBytes: 5, maxArchiveBytes: 1024 });
        await archive.add('one-screenhello.png', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
        await expect(archive.add('two-screenhello.png', new Blob([new Uint8Array([4, 5, 6])], { type: 'image/png' })))
            .rejects.toMatchObject({ code: 'batch-output-budget-exceeded' });
        const result = await archive.finish();
        const entries = unzipSync(new Uint8Array(await result.arrayBuffer()));
        expect(Object.keys(entries)).toEqual(['one-screenhello.png']);
        expect([...entries['one-screenhello.png']]).toEqual([1, 2, 3]);
        expect(result.type).toBe('application/zip');
        expect(MAX_BATCH_OUTPUT_BYTES).toBe(96 * 1024 * 1024);
        expect(MAX_BATCH_ARCHIVE_BYTES).toBe(97 * 1024 * 1024);
    });

    it('fails deterministically and discards chunks when the archive hard budget is exceeded', async () => {
        const archive = new BatchArchiveBuilder({ maxOutputBytes: 1024, maxArchiveBytes: 1 });
        await expect(archive.add(
            'one-screenhello.png',
            new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
        )).rejects.toMatchObject({ code: 'batch-archive-budget-exceeded' });
        await expect(archive.finish()).rejects.toMatchObject({ code: 'batch-archive-budget-exceeded' });
    });
});

describe('BatchExportService', () => {
    it('loads a preset snapshot without applying it to the active runtime', async () => {
        const activeOption = { untouched: true };
        const preset = createStylePreset({
            id: 'preset-1',
            name: 'WebP 预设',
            option: { background: 'none', padding: 42 },
            exportSettings: { format: 'webp', ratio: 3 },
        });
        const root = {
            option: activeOption,
            draftStore: {
                loadPreset: vi.fn(async () => ({ preset, backgroundBlob: null })),
            },
        };
        const resolved = await resolveBatchStyle(root, { kind: 'preset', id: 'preset-1' });
        expect(resolved.option.padding).toBe(42);
        expect(resolved.exportSettings).toEqual({ format: 'webp', ratio: 3 });
        expect(root.option).toBe(activeOption);
        expect(root.draftStore.loadPreset).toHaveBeenCalledWith('preset-1');
    });

    it('rejects an image-background snapshot when its local resource is unavailable', async () => {
        await expect(resolveBatchStyle({}, {
            kind: 'snapshot',
            option: { frameConf: { background: { type: 'image', url: null } } },
            exportSettings: { format: 'png', ratio: 1 },
        })).rejects.toMatchObject({ code: 'batch-background-unavailable' });
    });

    it('does not request a cross-origin background from an imported snapshot', async () => {
        const fetchMock = vi.fn(async () => new Response(new Blob(['tracking']), { status: 200 }));
        vi.stubGlobal('location', new URL('https://screenhello.test/editor'));
        vi.stubGlobal('fetch', fetchMock);

        try {
            await expect(resolveBatchStyle({}, {
                kind: 'snapshot',
                backgroundUrl: 'https://attacker.invalid/tracking.png',
                option: {
                    frameConf: {
                        background: { type: 'image', url: 'https://attacker.invalid/tracking.png' },
                    },
                },
                exportSettings: { format: 'png', ratio: 1 },
            })).rejects.toMatchObject({ code: 'batch-background-unavailable' });
            expect(fetchMock).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('runs jobs serially, isolates failures, and archives only successful files', async () => {
        const { getMaxActive, renderer, service } = createServiceHarness({
            prepareFailure: (input) => input.name === 'broken.png',
            exportFailure: (name) => name === 'render-fails.png',
        });
        const states = new Map();
        const transitions = new Map();
        const result = await service.run({
            jobs: [job('one', 'same.png'), job('bad', 'broken.png'), job('render', 'render-fails.png'), job('two', 'same.png')],
            styleSource: { kind: 'current' },
            onUpdate(id, patch) {
                states.set(id, { ...(states.get(id) || {}), ...patch });
                if (patch.status) transitions.set(id, [...(transitions.get(id) || []), patch.status]);
            },
        });

        expect(getMaxActive()).toBe(1);
        expect(result).toMatchObject({ successCount: 2, failedCount: 2, cancelledCount: 0, outputBytes: 8 });
        expect(states.get('bad')).toMatchObject({ status: 'failed', errorCode: 'batch-image-decode-failed' });
        expect(states.get('render')).toMatchObject({ status: 'failed', errorCode: 'export-render-failed' });
        expect(transitions.get('one')).toEqual(['preparing', 'rendering', 'encoding', 'completed']);
        expect(transitions.get('two')).toEqual(['preparing', 'rendering', 'encoding', 'completed']);
        const entries = unzipSync(new Uint8Array(await result.archive.arrayBuffer()));
        expect(Object.keys(entries)).toEqual(['same-screenhello.png', 'same-2-screenhello.png']);
        expect(renderer.clear).toHaveBeenCalledTimes(4);
        expect(renderer.dispose).toHaveBeenCalledOnce();
    });

    it('does not create an empty archive when every job fails', async () => {
        const { service } = createServiceHarness({ prepareFailure: () => true });
        const result = await service.run({ jobs: [job('bad', 'broken.png')], styleSource: { kind: 'current' } });
        expect(result).toMatchObject({ archive: null, successCount: 0, failedCount: 1 });
    });

    it('processes the maximum twelve jobs with render concurrency fixed at one', async () => {
        const { exportImage, getMaxActive, service } = createServiceHarness();
        const jobs = Array.from({ length: 12 }, (_, index) => job(String(index), `image-${index + 1}.png`));
        const result = await service.run({ jobs, styleSource: { kind: 'current' } });
        expect(exportImage).toHaveBeenCalledTimes(12);
        expect(getMaxActive()).toBe(1);
        expect(result).toMatchObject({ successCount: 12, failedCount: 0, cancelledCount: 0 });
        expect(Object.keys(unzipSync(new Uint8Array(await result.archive.arrayBuffer())))).toHaveLength(12);
    });

    it('cancels only the active job and continues queued jobs', async () => {
        let releaseFirst;
        const firstStarted = new Promise((resolve) => { releaseFirst = resolve; });
        const { exportImage, renderer, service } = createServiceHarness();
        exportImage.mockImplementationOnce(async ({ signal }) => {
            releaseFirst();
            await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
            throw Object.assign(new Error('cancelled'), { code: 'export-cancelled' });
        });
        const states = new Map();
        const running = service.run({
            jobs: [job('one', 'first.png'), job('two', 'second.png')],
            styleSource: { kind: 'current' },
            onUpdate: (id, patch) => states.set(id, { ...(states.get(id) || {}), ...patch }),
        });
        await firstStarted;
        service.cancelCurrent();
        const result = await running;
        expect(states.get('one').status).toBe('cancelled');
        expect(states.get('two').status).toBe('completed');
        expect(result).toMatchObject({ successCount: 1, cancelledCount: 1 });
        expect(renderer.clear).toHaveBeenCalledTimes(2);
        expect(renderer.dispose).toHaveBeenCalledOnce();
    });

    it('keeps the current-job cancellation active while its output is entering the ZIP', async () => {
        let releaseAdd;
        let addStarted;
        const started = new Promise((resolve) => { addStarted = resolve; });
        const archive = {
            entryCount: 0,
            outputBytes: 0,
            isFinished: false,
            add: vi.fn(async (name, blob, { signal }) => {
                if (archive.add.mock.calls.length === 1) {
                    addStarted();
                    await new Promise((resolve) => { releaseAdd = resolve; });
                    if (signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'batch-cancelled' });
                }
                archive.entryCount += 1;
                archive.outputBytes += blob.size;
            }),
            finish: vi.fn(async () => {
                archive.isFinished = true;
                return new Blob(['zip'], { type: 'application/zip' });
            }),
            terminate: vi.fn(),
        };
        const { renderer, service } = createServiceHarness();
        service.archiveFactory = () => archive;
        const states = new Map();
        const running = service.run({
            jobs: [job('one', 'first.png'), job('two', 'second.png')],
            styleSource: { kind: 'current' },
            onUpdate: (id, patch) => states.set(id, { ...(states.get(id) || {}), ...patch }),
        });
        await started;
        service.cancelCurrent();
        releaseAdd();
        const result = await running;
        expect(states.get('one').status).toBe('cancelled');
        expect(states.get('two').status).toBe('completed');
        expect(result).toMatchObject({ successCount: 1, cancelledCount: 1 });
        expect(renderer.clear).toHaveBeenCalledTimes(2);
        expect(renderer.dispose).toHaveBeenCalledOnce();
    });

    it('cancels the active and every queued job when the batch signal aborts', async () => {
        let started;
        const active = new Promise((resolve) => { started = resolve; });
        const { exportImage, renderer, service } = createServiceHarness();
        exportImage.mockImplementationOnce(async ({ signal }) => {
            started();
            await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
            throw Object.assign(new Error('cancelled'), { code: 'export-cancelled' });
        });
        const controller = new AbortController();
        const states = new Map();
        const running = service.run({
            jobs: [job('one', 'first.png'), job('two', 'second.png'), job('three', 'third.png')],
            styleSource: { kind: 'current' },
            signal: controller.signal,
            onUpdate: (id, patch) => states.set(id, { ...(states.get(id) || {}), ...patch }),
        });
        await active;
        expect(service.rendererFactory).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
        controller.abort();
        const result = await running;
        expect([...states.values()].map(({ status }) => status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
        expect(result).toMatchObject({ archive: null, successCount: 0, failedCount: 0, cancelledCount: 3 });
        expect(renderer.clear).toHaveBeenCalledOnce();
        expect(renderer.dispose).toHaveBeenCalledOnce();
    });

    it('stops queued work at the cumulative output budget and keeps prior success downloadable', async () => {
        const { exportImage, service } = createServiceHarness();
        exportImage
            .mockResolvedValueOnce({ blob: new Blob([new Uint8Array(4)]), format: 'png', mimeType: 'image/png', pixelRatio: 1, width: 80, height: 60 })
            .mockResolvedValueOnce({ blob: new Blob([new Uint8Array(4)]), format: 'png', mimeType: 'image/png', pixelRatio: 1, width: 80, height: 60 });
        const states = new Map();
        const result = await service.run({
            jobs: [job('one', 'first.png'), job('two', 'second.png'), job('three', 'third.png')],
            styleSource: { kind: 'current' },
            maxOutputBytes: 6,
            maxArchiveBytes: 1024,
            onUpdate: (id, patch) => states.set(id, { ...(states.get(id) || {}), ...patch }),
        });
        expect(states.get('one').status).toBe('completed');
        expect(states.get('two')).toMatchObject({ status: 'failed', errorCode: 'batch-output-budget-exceeded' });
        expect(states.get('three')).toMatchObject({ status: 'cancelled', errorCode: 'batch-budget-stopped' });
        expect(result).toMatchObject({ successCount: 1, failedCount: 1, cancelledCount: 1, stoppedByBudget: true });
    });
});

describe('BatchStore', () => {
    const root = () => ({
        isDisposed: false,
        option: {
            frameConf: { width: 80, height: 60, background: null },
            backgroundAssetId: null,
            toDocument: () => ({
                padding: 12,
                size: { type: 'fixed' },
                frameConf: { width: 80, height: 60, background: null },
            }),
        },
        assetStore: { get: vi.fn(() => null) },
        workspace: { exportSettings: { format: 'png', ratio: 1 } },
    });

    it('freezes current style before the lazy service loads and downloads one archive', async () => {
        let resolveService;
        const serviceReady = new Promise((resolve) => { resolveService = resolve; });
        let receivedSource = null;
        const service = {
            run: vi.fn(async ({ jobs, styleSource, onUpdate }) => {
                receivedSource = styleSource;
                jobs.forEach(({ id }) => onUpdate(id, { status: 'completed' }));
                return {
                    archive: new Blob(['zip'], { type: 'application/zip' }),
                    filename: 'ScreenHello-batch.zip',
                    successCount: jobs.length,
                    failedCount: 0,
                    cancelledCount: 0,
                };
            }),
            cancelCurrent: vi.fn(),
            dispose: vi.fn(),
        };
        const platform = { export: { download: vi.fn(async () => {}) } };
        const currentRoot = root();
        const store = new BatchStore(currentRoot, {
            serviceFactory: async () => {
                await serviceReady;
                return service;
            },
            platform,
        });
        store.selectFiles([file('one.png')]);
        const running = store.start();
        currentRoot.option.toDocument = () => ({ padding: 99, frameConf: { width: 1, height: 1 } });
        resolveService();
        await running;

        expect(receivedSource.option.padding).toBe(12);
        expect(store.jobs[0].status).toBe('completed');
        expect(store.state).toBe('completed');
        await expect(store.download()).resolves.toBe(true);
        expect(platform.export.download).toHaveBeenCalledOnce();
        expect(platform.export.download).toHaveBeenCalledWith(store.archive, 'ScreenHello-batch.zip');

        platform.export.download.mockRejectedValueOnce(
            Object.assign(new Error('cancelled'), { code: 'export-cancelled' }),
        );
        store.errorCode = null;
        await expect(store.download()).resolves.toBe(false);
        expect(store.errorCode).toBeNull();
    });

    it('retries only failed or cancelled files and keeps store instances isolated', async () => {
        const runs = [];
        const makeService = () => ({
            run: vi.fn(async ({ jobs, onUpdate }) => {
                runs.push(jobs.map(({ file: input }) => input.name));
                jobs.forEach(({ id, file: input }) => onUpdate(id, {
                    status: runs.length === 1 && input.name === 'bad.png' ? 'failed' : 'completed',
                }));
                return { archive: new Blob(['zip']), filename: 'batch.zip' };
            }),
            dispose: vi.fn(),
        });
        const first = new BatchStore(root(), { serviceFactory: async () => makeService() });
        const second = new BatchStore(root(), { serviceFactory: async () => makeService() });
        first.selectFiles([file('ok.png'), file('bad.png')]);
        second.selectFiles([file('other.png')]);
        expect(first.jobs.map(({ id }) => id)).toEqual(['batch-job-1', 'batch-job-2']);
        expect(second.jobs.map(({ id }) => id)).toEqual(['batch-job-1']);
        await first.start();
        expect(second.jobs.map(({ name }) => name)).toEqual(['other.png']);
        await first.retryFailed();
        expect(runs).toEqual([['ok.png', 'bad.png'], ['bad.png']]);
        expect(first.jobs.map(({ name, status }) => ({ name, status }))).toEqual([
            { name: 'bad.png', status: 'completed' },
        ]);
    });
});
