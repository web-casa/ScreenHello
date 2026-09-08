import { afterEach, describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { BatchStore } from '../../src/stores/batchStore.js';
import { BatchExportService, resolveBatchStyle } from '../../src/stores/batchExportService.js';
import { createStylePreset } from '../../src/utils/stylePreset.js';

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const file = name => new File([name], name, { type: 'image/png' });
const owners = [];
afterEach(() => { owners.splice(0).forEach(owner => owner.dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function harness({ settings = { format: 'png', ratio: 2, compression: 'lossy', paletteColors: 64 }, background = false } = {}) {
    const option = { padding: 12, background: background ? 'upload_image' : 'none', frameConf: { width: 8, height: 6, background: background ? { type: 'image', url: 'blob:original' } : null } };
    const backgroundBlob = background ? new Blob(['background'], { type: 'image/png' }) : null;
    const root = {
        editor: { theme: 'dark' },
        isDisposed: false, option: { ...option, toDocument: () => structuredClone(option) },
        assetStore: { get: () => backgroundBlob ? { blob: backgroundBlob } : null },
        workspace: { exportSettings: settings },
        exportService: { exportImage: vi.fn(async () => ({ blob: new Blob(['ok'], { type: 'image/png' }), width: 16, height: 12 })) },
        draftStore: { loadPreset: vi.fn(async () => ({ preset: createStylePreset({ option, exportSettings: settings }), backgroundBlob })) },
    };
    const styles = [];
    const rendererFactory = vi.fn(async ({ style }) => {
        styles.push(style);
        return { target: {}, size: { width: 8, height: 6 }, prepare: vi.fn(), waitUntilReady: vi.fn(), clear: vi.fn(), dispose: vi.fn() };
    });
    const service = new BatchExportService(root, { rendererFactory });
    const store = new BatchStore(root, { serviceFactory: async () => service }); owners.push(store);
    return { root, option, backgroundBlob, styles, rendererFactory, service, store };
}

describe('C3 frozen batch compression', () => {
    it.each([
        { format: 'png', ratio: 2, compression: 'lossy', paletteColors: 128 },
        { format: 'png', ratio: 1, compression: 'lossless' },
        { format: 'webp', ratio: 3, compression: 'lossless' },
        { format: 'webp', ratio: 2, compression: 'lossy', quality: 60 },
        { format: 'jpg', ratio: 1, compression: 'lossy', quality: 80 },
        { format: 'avif', ratio: 1, compression: 'lossy', quality: 40 },
    ])('forwards all $format/$compression settings to every serial job without committing preferences', async settings => {
        const h = harness({ settings });
        await expect(h.store.start([file('one.png'), file('two.png')])).resolves.toBe(true);
        for (const [request] of h.root.exportService.exportImage.mock.calls) expect(request).toMatchObject(settings);
        expect(h.root.workspace.exportSettings).toBe(settings);
        expect(h.store.summary).toMatchObject({ outputBytes: 4, successCount: 2 });
        const bytes = new Uint8Array(await h.store.archive.arrayBuffer());
        expect(h.store.summary.archiveBytes).toBe(bytes.length);
        expect(Object.values(unzipSync(bytes)).reduce((size, entry) => size + entry.length, 0)).toBe(4);
    });

    it.each([false, true])('retries the same owned style after settings, preset and background sources change (preset=%s)', async preset => {
        const h = harness({ background: true });
        h.root.exportService.exportImage.mockRejectedValueOnce(Object.assign(new Error('cancelled'), { code: 'export-cancelled' }));
        await h.store.start([file('retry.png'), file('ok.png')], { presetId: preset ? 'original' : null });
        expect(h.store.canRetry).toBe(true);
        const snapshot = h.store._styleSnapshot;
        expect(snapshot.theme).toBe('dark');
        expect(Object.isFrozen(snapshot.option.frameConf.background)).toBe(true);
        expect(snapshot.option.frameConf.background.url).toBeNull();
        expect(snapshot.backgroundBlob).toBe(h.backgroundBlob);
        h.option.padding = 99;
        h.root.editor.theme = 'light';
        h.root.workspace.exportSettings = { format: 'jpg', ratio: 3 };
        h.root.draftStore.loadPreset.mockResolvedValue(null);
        h.store.setPreset('deleted');
        await expect(h.store.retryFailed()).resolves.toBe(true);
        expect(h.styles).toEqual([snapshot, snapshot]);
        expect(h.styles[1].theme).toBe('dark');
        expect(h.store.jobs.map(job => job.name)).toEqual(['retry.png']);
        expect(h.root.draftStore.loadPreset).toHaveBeenCalledTimes(preset ? 1 : 0);
        expect(h.root.exportService.exportImage.mock.lastCall[0]).toMatchObject({ format: 'png', ratio: 2, compression: 'lossy', paletteColors: 64 });
        expect(Object.keys(unzipSync(new Uint8Array(await h.store.archive.arrayBuffer())))).toEqual(['retry-screenhello@2.png']);
        h.store.clear();
        expect(h.store._styleSnapshot).toBeNull(); expect(h.store.summary).toBeNull(); expect(h.store.archive).toBeNull();
    });

    it('releases the snapshot on new files, explicit start, and dispose, independently of another store', async () => {
        const a = harness(), b = harness();
        await Promise.all([a.store.start([file('a.png')]), b.store.start([file('b.png')])]);
        const other = b.store._styleSnapshot;
        a.store.selectFiles([file('next.png')]); expect(a.store._styleSnapshot).toBeNull();
        await a.store.start(); const before = a.store._styleSnapshot;
        a.root.workspace.exportSettings = { format: 'jpg', ratio: 1 };
        await a.store.start(); expect(a.store._styleSnapshot).not.toBe(before);
        expect(a.store.snapshotSettings).toEqual({ format: 'jpg', ratio: 1 });
        a.store.dispose(); expect(a.store._styleSnapshot).toBeNull(); expect(a.store.canRetry).toBe(false);
        expect(b.store._styleSnapshot).toBe(other);
        await expect(b.service.run({ jobs: [{ id: 'x', file: file('x.png') }], styleSnapshot: before })).rejects.toMatchObject({ code: 'batch-style-invalid' });
    });

    it.each([false, true])('captures output theme before lazy service loading (preset=%s)', async preset => {
        const h = harness(); const pending = deferred();
        h.store.serviceFactory = () => pending.promise;
        const running = h.store.start([file('a.png')], { presetId: preset ? 'original' : null });
        h.root.editor.theme = 'light';
        pending.resolve(h.service);
        await expect(running).resolves.toBe(true);
        expect(h.styles[0].theme).toBe('dark');
        expect(h.root.editor.theme).toBe('light');
    });

    it('never publishes a retry snapshot after renderer/background initialization fails', async () => {
        const h = harness();
        h.rendererFactory.mockRejectedValueOnce(Object.assign(new Error('bad background'), { code: 'batch-background-unavailable' }));
        await expect(h.store.start([file('a.png')])).resolves.toBe(false);
        expect(h.store.jobs[0]).toMatchObject({ status: 'failed', errorCode: 'batch-background-unavailable' });
        expect(h.store.canRetry).toBe(false); expect(h.store._styleSnapshot).toBeNull();
        expect(h.root.exportService.exportImage).not.toHaveBeenCalled();
        await expect(h.store.start()).resolves.toBe(true);
    });

    it('resolves a current blob URL only once and retries after the source URL is revoked', async () => {
        const h = harness({ background: true });
        h.root.assetStore.get = () => null;
        const fetchMock = vi.fn(async () => new Response(h.backgroundBlob));
        vi.stubGlobal('fetch', fetchMock);
        h.root.exportService.exportImage.mockRejectedValueOnce(Object.assign(new Error('failed'), { code: 'export-render-failed' }));
        await h.store.start([file('a.png')]);
        expect(fetchMock).toHaveBeenCalledWith('blob:original', expect.objectContaining({ redirect: 'error', credentials: 'omit' }));
        fetchMock.mockRejectedValue(new Error('URL revoked'));
        await expect(h.store.retryFailed()).resolves.toBe(true);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(await h.store._styleSnapshot.backgroundBlob.text()).toBe('background');
    });

    it.each(['cancel', 'dispose'])('rejects late preset reads after %s and releases all snapshot references', async action => {
        const h = harness(); const pending = deferred();
        h.root.draftStore.loadPreset.mockReturnValue(pending.promise);
        const running = h.store.start([file('a.png')], { presetId: 'slow' });
        await vi.waitFor(() => expect(h.root.draftStore.loadPreset).toHaveBeenCalled());
        if (action === 'cancel') h.store.cancelAll(); else h.store.dispose();
        await expect(running).resolves.toBe(false);
        pending.resolve({ preset: createStylePreset({ option: h.option }) });
        await Promise.resolve();
        expect(h.store._styleSnapshot).toBeNull(); expect(h.store.canRetry).toBe(false);
        expect(h.rendererFactory).not.toHaveBeenCalled(); expect(h.root.exportService.exportImage).not.toHaveBeenCalled();
    });

    it('preserves a visible compatibility warning in a normalized preset snapshot', async () => {
        const h = harness();
        h.root.draftStore.loadPreset.mockResolvedValue({ preset: { ...createStylePreset({ option: h.option }), exportSettings: { format: 'jpg', ratio: 2, compression: 'lossless' } } });
        await h.store.start([file('a.png')], { presetId: 'old' });
        expect(h.store.hasSettingsWarning).toBe(true);
        expect(h.store.snapshotSettings).toEqual({ format: 'jpg', ratio: 2 });
    });

    it('bounds style reads and does not fetch anything for a pre-aborted request', async () => {
        vi.useFakeTimers(); const pending = deferred();
        const root = { draftStore: { loadPreset: vi.fn(() => pending.promise) } };
        const result = resolveBatchStyle(root, { kind: 'preset', id: 'slow' });
        const assertion = expect(result).rejects.toMatchObject({ code: 'batch-style-timeout' });
        await vi.advanceTimersByTimeAsync(10_000); await assertion;
        const controller = new AbortController(); controller.abort();
        await expect(resolveBatchStyle(root, { kind: 'preset', id: 'slow' }, controller.signal)).rejects.toMatchObject({ code: 'batch-cancelled' });
        expect(root.draftStore.loadPreset).toHaveBeenCalledOnce();
    });
});
