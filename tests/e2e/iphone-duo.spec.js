import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import { createPngFixture } from '../fixtures/createPngFixture';

const ids = ['portrait', 'landscape'].map(pose => `iphone-duo-${pose}-v1`);
test.skip(!ids.every(id => existsSync(new URL(`../../local-device-assets/${id}-screen.png`, import.meta.url))),
    'Duo is an optional local pack; third-party artwork is not redistributed.');
test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('.shoteasy-upload-card input[type=file]').setInputFiles({
        name: 'screen.png', mimeType: 'image/png', buffer: createPngFixture(200, 100),
    });
    await page.waitForFunction(() => window.__shoteasyStores?.editor.app?.tree);
});

test('Duo rapid switching, magnifier, reopened projects and batch snapshots preserve the selected pose', async ({ page }) => {
    test.setTimeout(90_000);
    const result = await page.evaluate(async ids => {
        const root = window.__shoteasyStores;
        root.option.setSize({ type: 'custom', title: '自定义', width: 600, height: 500 });
        root.option.setFrame(ids[0]);
        const project = await root.workspace.createProjectBlob();
        for (let i = 0; i < 8; i++) {
            root.option.setFrame(ids[i % ids.length]);
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        const reopened = await root.workspace.openProjectFile(new File([project], 'Duo.screenhello'));
        root.editor.addShape({ id: 'duo-magnifier', type: 'Magnifier', x: 100, y: 100, width: 60, height: 60 });
        const output = await root.exportService.exportImage();
        const image = await fetch(root.editor.img.src).then(response => response.blob());
        root.batch.selectFiles([new File([image], 'one.png', { type: 'image/png' }), new File([image], 'two.png', { type: 'image/png' })]);
        const started = await root.batch.start();
        const archive = [...new Uint8Array(await root.batch.archive.arrayBuffer())];
        const selected = root.option.frame;
        root.option.setFrame(ids[1]);
        window.__duoDownload = root.batch.download();
        return { reopened, selected, started, success: root.batch.summary.successCount,
            bytes: output.blob.size, snap: Boolean(root.editor.snap), archive };
    }, ids);
    expect(result).toMatchObject({ reopened: true, selected: ids[0], started: true, success: 2, snap: true });
    expect(result.bytes).toBeGreaterThan(1500);
    const { unzipSync } = await import('fflate');
    const images = Object.values(unzipSync(new Uint8Array(result.archive)));
    expect(images).toHaveLength(2);
    for (const image of images) expect(PNG.sync.read(Buffer.from(image)).width).toBe(600);
    const notice = page.getByRole('dialog', { name: '素材许可说明' });
    await expect(notice).toContainText('竖屏');
    await notice.getByRole('button', { name: /取\s*消/ }).click();
    expect(await page.evaluate(() => window.__duoDownload)).toBe(false);
});

test('Duo renders non-handheld screens and rejects incomplete layers and cancellation', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const rows = await page.evaluate(async ids => {
        const { getRasterDevice } = await import('/src/utils/rasterDeviceConfig.js');
        const { renderRasterDevice } = await import('/src/utils/renderRasterDevice.js');
        const read = async url => {
            const image = new Image(); image.src = url; await image.decode();
            const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
            const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            image.src = ''; canvas.width = canvas.height = 0; return pixels;
        };
        const source = document.createElement('canvas'); source.width = source.height = 100;
        const ctx = source.getContext('2d'); ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, 100, 100);
        const url = source.toDataURL(); source.width = source.height = 0;
        const rows = [];
        for (const id of ids) {
            const device = getRasterDevice(id);
            const composite = await renderRasterDevice(device, url);
            try {
                const output = await read(composite), mask = await read(device.mask);
                const foreground = device.foreground ? await read(device.foreground) : null;
                let covered = 0, damaged = 0, changed = 0;
                for (let i = 0; i < output.length; i += 4) {
                    if (foreground?.[i + 3] === 255 && mask[i + 3] === 255) {
                        covered++;
                        if ([0, 1, 2, 3].some(c => output[i + c] !== foreground[i + c])) damaged++;
                    }
                    if (mask[i + 3] === 255 && (!foreground || foreground[i + 3] === 0)
                        && output[i] === 0 && output[i + 1] === 255 && output[i + 2] === 0) changed++;
                }
                const blob = await fetch(composite).then(r => r.blob());
                const data = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
                rows.push({ id, covered, damaged, changed, outside: output[3], data });
            } finally { URL.revokeObjectURL(composite); }
        }
        const device = getRasterDevice(ids[0]);
        const failure = async (overrides, signal) => {
            try { const result = await renderRasterDevice({ ...device, ...overrides }, url, {}, signal); URL.revokeObjectURL(result); return 'unexpected-success'; }
            catch (error) { return error.name === 'AbortError' ? error.name : error.code; }
        };
        const controller = new AbortController(); controller.abort();
        const inFlight = new AbortController();
        const pending = failure({}, inFlight.signal); inFlight.abort();
        return { rows, missing: await failure({ hasForeground: true, foreground: null }),
            wrongSize: await failure({ foreground: url }), cancelled: await failure({}, controller.signal), inFlight: await pending };
    }, ids);
    expect(rows.missing).toBe('device-render-failed');
    expect(rows.wrongSize).toBe('device-render-failed');
    expect(rows.cancelled).toBe('AbortError'); expect(rows.inFlight).toBe('AbortError');
    for (const row of rows.rows) {
        expect(row.damaged).toBe(0); expect(row.changed).toBeGreaterThan(10_000); expect(row.outside).toBe(0);
        if (row.id.includes('hand')) expect(row.covered).toBeGreaterThan(100);
        await testInfo.attach(`${row.id}.png`, { body: Buffer.from(row.data.split(',')[1], 'base64'), contentType: 'image/png' });
    }
});

test('Duo cards, fit modes, export sizes, undo and project archives use the shared editor pipeline', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.locator('.shoteasy-frame-panel').getByRole('button', { name: '更多外框' }).click();
    const drawer = page.locator('.shoteasy-frame-drawer');
    await expect(drawer.locator('input[value^="iphone-duo-hand-"]')).toHaveCount(0);
    for (const id of ids) await expect(drawer.locator(`input[value="${id}"]`)).toHaveCount(1);
    await drawer.locator('.shoteasy-frame-option').filter({ has: page.locator(`input[value="${ids[0]}"]`) }).click({ timeout: 15_000 });
    await drawer.screenshot({ path: testInfo.outputPath('duo-picker.png') });
    const result = await page.evaluate(async ids => {
        const root = window.__shoteasyStores;
        root.option.setSize({ type: 'custom', title: '自定义', width: 600, height: 500 });
        root.option.setPadding(0); root.option.setRound(0); root.option.setBackground('none'); root.option.setShadowConf({ visible: false });
        const rows = [];
        for (const id of ids) {
            root.option.setFrame(id);
            for (const mode of ['cover', 'fit', 'stretch']) {
                root.option.setFrameMode(mode);
                for (const format of ['png', 'jpg', 'webp']) {
                    const result = await root.exportService.exportImage({ format, ratio: format === 'png' ? 2 : 1 });
                    const url = URL.createObjectURL(result.blob);
                    const image = new Image(); image.src = url;
                    try {
                        await image.decode();
                        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
                        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
                        rows.push({ id, mode, format, width: canvas.width, height: canvas.height, corner: [...ctx.getImageData(0, 0, 1, 1).data] });
                        canvas.width = canvas.height = 0;
                    } finally { image.src = ''; URL.revokeObjectURL(url); }
                }
            }
        }
        const { createProjectArchive, createPresetArchive, readWorkspaceArchive } = await import('/src/utils/workspaceArchive.js');
        const { createStylePreset } = await import('/src/utils/stylePreset.js');
        const project = root.editor.serializeProject();
        const images = await Promise.all(project.images.map(async metadata => ({ metadata,
            blob: await fetch(root.imageStore.resolve(metadata).src).then(r => r.blob()) })));
        const blob = await createProjectArchive({ name: 'Duo', document: project, images });
        const restored = await readWorkspaceArchive(blob, { expectedKind: 'project' });
        const preset = await readWorkspaceArchive(await createPresetArchive({ preset: createStylePreset({ option: project.option }) }), { expectedKind: 'preset' });
        root.option.setFrame(ids[0]); root.history.undo();
        return { rows, undo: root.option.frame, restored: restored.document.option.frame, preset: preset.preset.option.frame,
            saved: JSON.stringify(project), archive: [...new Uint8Array(await blob.arrayBuffer())], leases: root.exportService._canvasLeases.size };
    }, ids);
    for (const row of result.rows) {
        expect([row.width, row.height]).toEqual(row.format === 'png' ? [1200, 1000] : [600, 500]);
        if (row.format === 'png') expect(row.corner).toEqual([0, 0, 0, 0]);
        else { expect(row.corner[3]).toBe(255); for (const c of row.corner.slice(0, 3)) expect(c).toBeGreaterThanOrEqual(252); }
    }
    expect(result).toMatchObject({ undo: ids[1], restored: ids[1], preset: ids[1], leases: 0 });
    expect(result.saved).not.toMatch(/local-device-assets|goodmockups|foreground\.png/);
    const { unzipSync } = await import('fflate');
    expect(Object.keys(unzipSync(new Uint8Array(result.archive)))).toHaveLength(2);
});
