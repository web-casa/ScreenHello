import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { createPngFixture } from '../fixtures/createPngFixture.js';

async function openFixture(page) {
    await page.goto('/');
    await page.locator('.shoteasy-upload-card input[type=file]').setInputFiles({
        name: 'compression.png', mimeType: 'image/png', buffer: createPngFixture(64, 48),
    });
    await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();
}

test('C1 complete-scene compression preserves transparency, white fills, dimensions and exact prepared bytes', async ({ page }) => {
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await openFixture(page);
    expect(requests.some(url => /oxipng|pngEncoder/.test(url))).toBe(false);
    const outputs = await page.evaluate(async () => {
        const root = window.__shoteasyStores;
        root.option.setBackground('none');
        root.option.setPadding(24);
        root.option.setPaddingBg('rgba(0,0,0,0)');
        root.option.setShadowConf({ visible: false });
        root.editor.addShape({ id: 'c1-marker', type: 'SquareFill', x: 24, y: 24, width: 24, height: 18, fill: '#ff1245', zIndex: 10 });
        root.editor.addShape({ id: 'c1-readback-text', type: 'text', x: 6, y: 6, text: 'Aa 0123', fontSize: 12, fill: '#172b4d', zIndex: 11 });
        const inspect = async blob => {
            const bitmap = await createImageBitmap(blob);
            const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
            const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0); bitmap.close();
            return { width: canvas.width, height: canvas.height, corner: [...context.getImageData(0, 0, 1, 1).data] };
        };
        const rows = [];
        for (const settings of [
            { format: 'png', compression: 'lossless' },
            ...[256, 128, 64].map(paletteColors => ({ format: 'png', compression: 'lossy', paletteColors })),
            { format: 'webp', compression: 'lossless' },
            { format: 'webp', compression: 'lossy', quality: 80 },
            { format: 'jpg', compression: 'lossy', quality: 60 },
            { format: 'avif', compression: 'lossy', quality: 40 },
        ]) {
            const standard = settings.format === 'png' && settings.compression === 'lossless'
                ? await root.exportService.exportImage({ format: 'png', ratio: 2 }) : null;
            const { token, result } = await root.exportService.prepareImage({ ...settings, ratio: 2 });
            const originalDownload = root.exportService.platform.export.download;
            let same = false;
            root.exportService.platform.export.download = async blob => { same = blob === result.blob; };
            try { await root.exportService.downloadPreparedImage(token); }
            finally { root.exportService.platform.export.download = originalDownload; }
            rows.push({ settings, same, summary: result.summary,
                standard: standard ? [...new Uint8Array(await standard.blob.arrayBuffer())] : null,
                ...(await inspect(result.blob)),
                ...(settings.format === 'png' ? { bytes: [...new Uint8Array(await result.blob.arrayBuffer())],
                    reference: [...new Uint8Array(await result.referenceBlob.arrayBuffer())] } : {}),
            });
        }
        return { rows, leases: root.exportService._canvasLeases.size, settings: { ...root.workspace.exportSettings } };
    });
    expect(outputs.leases).toBe(0);
    expect(outputs.settings).toEqual({ format: 'png', ratio: 1 }); // Service alone never commits UI preferences.
    for (const row of outputs.rows) {
        expect(row.same).toBe(true);
        expect(row.width).toBeGreaterThan(0); expect(row.height).toBeGreaterThan(0);
        expect(row.summary.outputBytes).toBeGreaterThan(0);
        if (row.settings.format === 'png') {
            const decoded = PNG.sync.read(Buffer.from(row.bytes));
            const baseline = PNG.sync.read(Buffer.from(row.reference));
            expect(decoded.width).toBe(row.width); expect(decoded.height).toBe(row.height);
            expect(decoded.data[3]).toBe(0);
            if (row.settings.compression === 'lossless') {
                expect(decoded.data).toEqual(baseline.data);
                expect(decoded.data).toEqual(PNG.sync.read(Buffer.from(row.standard)).data);
            }
        }
        if (['jpg', 'webp'].includes(row.settings.format)) expect(row.corner).toEqual([255, 255, 255, 255]);
    }
    expect(errors).toEqual([]);
});

test('C1 waits for HDR and region snapshots without exporting hidden annotations', async ({ page }) => {
    await openFixture(page);
    const result = await page.evaluate(async () => {
        const root = window.__shoteasyStores;
        root.option.setHdrEnabled(true);
        root.editor.addShape({ id: 'c1-mosaic', type: 'mosaic', x: 30, y: 30, width: 36, height: 24, effect: { blockSize: 8 } });
        root.editor.addShape({ id: 'c1-marker', type: 'SquareFill', x: 12, y: 12, width: 18, height: 12, fill: '#ff1245', zIndex: 10 });
        const prepared = await root.exportService.prepareImage({ format: 'png', compression: 'lossless' });
        const bytes = [...new Uint8Array(await prepared.result.blob.arrayBuffer())];
        const reference = [...new Uint8Array(await prepared.result.referenceBlob.arrayBuffer())];
        const visible = root.editor.app.tree.children[0].children.filter(node => ['c1-mosaic', 'c1-marker'].includes(node.id)).map(node => node.visible);
        root.editor.app.tree.children[0].fill = '#112233'; // Paint-only change, before any store update.
        let stale;
        try { await root.exportService.downloadPreparedImage(prepared.token); } catch (error) { stale = error.code; }
        return { bytes, reference, visible, stale, pending: root.renderTaskTracker.size, snapshot: !!root.editor.snap };
    });
    const decoded = PNG.sync.read(Buffer.from(result.bytes));
    expect(decoded.data).toEqual(PNG.sync.read(Buffer.from(result.reference)).data);
    let marker = false;
    for (let i = 0; i < decoded.data.length; i += 4) if (decoded.data[i] === 255 && decoded.data[i + 1] === 18 && decoded.data[i + 2] === 69) marker = true;
    expect(marker).toBe(true);
    expect(result.visible).toEqual([true, true]);
    expect(result.snapshot).toBe(true);
    expect(result.pending).toBe(0);
    expect(result.stale).toBe('export-stale');
});

test('C1 simultaneous instance encoders and ready results have independent ownership', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
        const { mountI18nHarness } = await import('/tests/fixtures/i18n-harness.jsx');
        const container = document.createElement('div'); document.body.append(container);
        window.__compressionPair = mountI18nHarness(container);
    });
    for (const name of ['first', 'second']) await page.getByTestId(`locale-${name}`).locator('.shoteasy-upload-card input[type=file]').setInputFiles({
        name: `${name}.png`, mimeType: 'image/png', buffer: createPngFixture(128, 96),
    });
    await page.waitForFunction(() => ['first', 'second'].every(name => window.__compressionPair.runtimes[name]?.editor.app?.tree));
    const result = await page.evaluate(async () => {
        const { first, second } = window.__compressionPair.runtimes;
        const [a, b] = await Promise.all([
            first.exportService.prepareImage({ compression: 'lossy', paletteColors: 64 }),
            second.exportService.prepareImage({ compression: 'lossless' }),
        ]);
        const distinctWorkers = first.exportService._pngEncoder.worker !== second.exportService._pngEncoder.worker;
        first.editor.setTheme(first.editor.theme === 'dark' ? 'light' : 'dark');
        const independent = first.exportService.stage === 'stale' && second.exportService.stage === 'ready';
        const snapshot = { distinctWorkers, independent, distinctBlobs: a.result.blob !== b.result.blob,
            leases: first.exportService._canvasLeases.size + second.exportService._canvasLeases.size };
        window.__compressionPair.unmount();
        return snapshot;
    });
    expect(result).toEqual({ distinctWorkers: true, independent: true, distinctBlobs: true, leases: 0 });
});
