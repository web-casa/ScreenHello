import { expect, test } from '@playwright/test';
import { unzipSync, strFromU8, strToU8, zipSync } from 'fflate';
import { PNG } from 'pngjs';
import AxeBuilder from '@axe-core/playwright';
import { createPngFixture } from '../fixtures/createPngFixture.js';

async function openEditor(page) {
    await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
    await page.goto('/');
    await page.locator('.shoteasy-upload-card input[type=file]').setInputFiles({ name: 'C3.png', mimeType: 'image/png', buffer: createPngFixture(64, 48) });
    await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();
    await page.evaluate(() => {
        const root = window.__shoteasyStores;
        root.option.setBackground('none');
        root.option.setSize({ type: 'fixed', width: 128, height: 96 });
        root.option.setPadding(12);
        root.option.setShadowConf({ visible: false });
    });
}
async function readDownload(download) {
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    return Buffer.concat(chunks);
}

test('HF1 batch AVIF restriction survives retries without changing saved settings or allocating export canvases', async ({ page }) => {
    await openEditor(page);
    const result = await page.evaluate(async bytes => {
        const root = window.__shoteasyStores;
        root.option.setSize({ type: 'fixed', width: 2048, height: 2048 });
        const settings = { format: 'avif', compression: 'lossy', quality: 80, ratio: 1 };
        root.workspace.setExportSettings(settings, { replace: true });
        let captures = 0;
        const capture = root.exportService._capture.bind(root.exportService);
        root.exportService._capture = (...args) => { captures++; return capture(...args); };
        try {
            await root.batch.start([new File([new Uint8Array(bytes)], 'only.png', { type: 'image/png' })]);
            const first = root.batch.jobs.map(({ status, errorCode }) => ({ status, errorCode }));
            await root.batch.retryFailed();
            return { first, retry: root.batch.jobs.map(({ status, errorCode }) => ({ status, errorCode })),
                captures, settings: root.workspace.exportSettings, archive: Boolean(root.batch.archive),
                leases: root.exportService._canvasLeases.size };
        } finally { root.exportService._capture = capture; }
    }, [...createPngFixture(64, 48)]);
    const failure = [{ status: 'failed', errorCode: 'export-web-avif-compression-size-too-large' }];
    expect(result).toEqual({ first: failure, retry: failure, captures: 0,
        settings: { format: 'avif', compression: 'lossy', quality: 80, ratio: 1 }, archive: false, leases: 0 });
    await page.evaluate(() => window.__shoteasyStores.commands.execute('file.openBatch'));
    await expect(page.locator('.shoteasy-batch-drawer')).toContainText('网页版 AVIF 压缩');
});

test('C3 projects, recent projects and preset copy/rename/import preserve compression through real local storage', async ({ page }) => {
    test.setTimeout(90_000);
    await openEditor(page);
    const result = await page.evaluate(async () => {
        const root = window.__shoteasyStores;
        const { readWorkspaceArchive } = await import('/src/utils/workspaceArchive.js');
        const originalDownload = root.platform.export.download;
        const rows = [];
        let saved;
        root.platform.export.download = async blob => { saved = blob; };
        try {
            root.editor.addShape({ id: 'c3-persist', type: 'Square', x: 2, y: 3, width: 12, height: 10 });
            for (const settings of [
                { format: 'png', ratio: 2, compression: 'lossy', paletteColors: 128 },
                { format: 'webp', ratio: 1, compression: 'lossless' },
                { format: 'avif', ratio: 1, compression: 'lossy', quality: 40 },
            ]) {
                root.workspace.setExportSettings(settings, { replace: true });
                const save = await root.workspace.saveProject({ saveAs: true });
                const project = await readWorkspaceArchive(saved);
                const recentId = root.workspace.currentRecentId;
                root.workspace.setExportSettings({ format: 'png', ratio: 1 }, { replace: true });
                const reopened = await root.workspace.openRecentProject(recentId);
                const recentSettings = { ...root.workspace.exportSettings };
                const ids = new Set(root.workspace.presets.map(item => item.id));
                const presetSaved = await root.workspace.savePreset(`C3 ${settings.format}`);
                const id = root.workspace.presets.find(item => !ids.has(item.id)).id;
                ids.add(id);
                const copied = await root.workspace.duplicatePreset(id);
                const copy = root.workspace.presets.find(item => !ids.has(item.id)).id;
                const renamed = await root.workspace.renamePreset(copy, `Copy ${settings.format}`);
                const exported = await root.workspace.exportPreset(copy);
                const presetFile = new File([saved], 'C3.screenhello-preset', { type: saved.type });
                const portable = await readWorkspaceArchive(presetFile);
                ids.add(copy);
                const imported = await root.workspace.importPresetFile(presetFile);
                const importedId = root.workspace.presets.find(item => !ids.has(item.id)).id;
                root.workspace.setExportSettings({ format: 'png', ratio: 1 }, { replace: true });
                const applied = await root.workspace.applyPreset(importedId);
                rows.push({ settings, flags: [save, reopened, presetSaved, copied, renamed, exported, imported, applied],
                    project: project.exportSettings, recentSettings, portable: portable.preset.exportSettings,
                    applied: { ...root.workspace.exportSettings }, marker: root.editor.shapes.has('c3-persist') });
            }
            await root.draftService.flush();
            const draft = await root.draftStore.loadProject('shoteasy-default');
            return { rows, draftHasExportSettings: Object.hasOwn(draft, 'exportSettings') };
        } finally { root.platform.export.download = originalDownload; }
    });
    for (const row of result.rows) {
        expect(row.flags.every(Boolean)).toBe(true); expect(row.marker).toBe(true);
        for (const value of [row.project, row.recentSettings, row.portable, row.applied]) expect(value).toEqual(row.settings);
    }
    expect(result.draftHasExportSettings).toBe(false);
});

test('C4 ZIP handoff blocks duplicate saves, batch mutations, commands and PWA updates until the system settles', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(async () => {
        const root = window.__shoteasyStores;
        root.batch.selectFiles([new File(['fixture'], 'one.png', { type: 'image/png' })]);
        root.batch.archive = new Blob(['owned ZIP']); root.batch.archiveFilename = 'one.zip';
        window.__c4SaveCalls = 0;
        root.platform.export.download = () => {
            window.__c4SaveCalls++;
            return new Promise((resolve, reject) => { window.__c4SaveResolve = resolve; window.__c4SaveReject = reject; });
        };
        await root.commands.execute('file.openBatch');
    });
    const drawer = page.locator('.shoteasy-batch-drawer');
    await drawer.getByRole('button', { name: '下载 ZIP' }).click();
    await expect(drawer.getByRole('button', { name: '正在保存…' })).toBeDisabled();
    await expect(drawer.getByRole('button', { name: '开始批量处理' })).toBeDisabled();
    await expect(drawer.getByRole('button', { name: '清空', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(drawer).toBeVisible();
    const blocked = await page.evaluate(async () => {
        const root = window.__shoteasyStores;
        const { getUpdateBlockReason } = await import('/src/pwa/pwaSupport.js');
        return { again: await root.batch.download(), start: await root.batch.start(), clear: root.batch.clear(),
            command: await root.commands.execute('file.newProject'), update: getUpdateBlockReason(root), calls: window.__c4SaveCalls };
    });
    expect(blocked).toEqual({ again: false, start: false, clear: false, command: false, update: 'busy', calls: 1 });
    await page.evaluate(() => window.__c4SaveReject(Object.assign(new Error('cancelled'), { code: 'export-cancelled' })));
    await expect(drawer.getByRole('button', { name: '下载 ZIP' })).toBeEnabled();
    await expect(drawer.getByRole('alert')).toHaveCount(0);
    await drawer.getByRole('button', { name: '下载 ZIP' }).click();
    await page.evaluate(() => window.__c4SaveResolve());
    await expect(drawer.getByRole('button', { name: '下载 ZIP' })).toBeEnabled();
    expect(await page.evaluate(() => window.__c4SaveCalls)).toBe(2);
});

test('C3 twelve-file PNG batch and retry preserve exact style after preset deletion, background URL revocation and live edits', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await openEditor(page);
    await page.evaluate(async backgroundBytes => {
        const root = window.__shoteasyStores;
        root.editor.setTheme('dark');
        const asset = root.assetStore.add(new File([new Uint8Array(backgroundBytes)], 'background.png', { type: 'image/png' }));
        root.option.setUploadedBackground(asset);
        root.workspace.setExportSettings({ format: 'png', ratio: 2, compression: 'lossy', paletteColors: 64 }, { replace: true });
        await root.workspace.savePreset('Frozen C3');
        root.batch.setPreset(root.workspace.presets.find(item => item.name === 'Frozen C3').id);
        const exportImage = root.exportService.exportImage.bind(root.exportService);
        let calls = 0;
        window.__c3 = { calls: [], originalBackgroundUrl: asset.url };
        root.exportService.exportImage = async request => {
            calls++;
            window.__c3.calls.push({ format: request.format, ratio: request.ratio, compression: request.compression, paletteColors: request.paletteColors,
                stroke: request.target.children.find(node => node.name === 'frame')?.stroke });
            if (calls === 2) throw Object.assign(new Error('controlled failure'), { code: 'export-render-failed' });
            if (calls === 3) throw Object.assign(new Error('controlled cancellation'), { code: 'export-cancelled' });
            // Trigger a real active-scene version change while a separate target is being encoded.
            const result = exportImage(request);
            root.option.setPadding(calls % 2 ? 20 : 24);
            root.editor.setTheme(calls % 2 ? 'light' : 'dark');
            return result;
        };
        await root.commands.execute('file.openBatch');
    }, [...createPngFixture(16, 16)]);
    const drawer = page.locator('.shoteasy-batch-drawer');
    await page.getByTestId('batch-file-input').setInputFiles(Array.from({ length: 12 }, (_, i) => ({ name: `${i + 1}.png`, mimeType: 'image/png', buffer: createPngFixture(64, 48) })));
    await drawer.getByRole('button', { name: '开始批量处理' }).click();
    await expect(drawer.getByRole('status')).toContainText('10 张成功', { timeout: 60_000 });
    await expect(page.getByTestId('batch-frozen-settings')).toContainText('PNG 2x');
    await expect(page.getByTestId('batch-frozen-settings')).toContainText('最多 64 色');
    await expect(page.getByTestId('batch-retry-notice')).toBeVisible();
    const firstDownload = page.waitForEvent('download');
    await drawer.getByRole('button', { name: '下载 ZIP' }).click();
    const firstBytes = await readDownload(await firstDownload);
    const firstEntries = unzipSync(firstBytes);
    expect(Object.keys(firstEntries)).toHaveLength(10);
    const baseline = PNG.sync.read(Buffer.from(firstEntries['1-screenhello@2.png']));
    expect([baseline.width, baseline.height]).toEqual([256, 192]);
    const colors = new Set();
    for (let i = 0; i < baseline.data.length; i += 4) colors.add(baseline.data.subarray(i, i + 4).toString('hex'));
    expect(colors.size).toBeLessThanOrEqual(64);
    const stats = await page.evaluate(() => ({ output: window.__shoteasyStores.batch.summary.outputBytes, archive: window.__shoteasyStores.batch.summary.archiveBytes }));
    expect(stats).toEqual({ output: Object.values(firstEntries).reduce((sum, bytes) => sum + bytes.length, 0), archive: firstBytes.length });
    await page.evaluate(async () => {
        const root = window.__shoteasyStores;
        await root.workspace.deletePreset(root.batch.presetId);
        root.editor.setTheme('light');
        root.option.setBackground('none');
        URL.revokeObjectURL(window.__c3.originalBackgroundUrl);
        root.workspace.setExportSettings({ format: 'jpg', ratio: 1, compression: 'lossy', quality: 60 }, { replace: true });
        root.batch.setPreset(null);
    });
    await drawer.getByRole('button', { name: '重试失败项' }).click();
    await expect(drawer.getByRole('status')).toContainText('2 张成功', { timeout: 60_000 });
    const retryDownload = page.waitForEvent('download');
    await drawer.getByRole('button', { name: '下载 ZIP' }).click();
    const entries = unzipSync(await readDownload(await retryDownload));
    expect(Object.keys(entries)).toEqual(['2-screenhello@2.png', '3-screenhello@2.png']);
    for (const bytes of Object.values(entries)) expect(PNG.sync.read(Buffer.from(bytes)).data).toEqual(baseline.data);
    const after = await page.evaluate(() => ({ calls: window.__c3.calls, settings: { ...window.__shoteasyStores.workspace.exportSettings }, leases: window.__shoteasyStores.exportService._canvasLeases.size }));
    expect(after.calls).toHaveLength(14);
    expect(after.calls.every(call => call.format === 'png' && call.ratio === 2 && call.compression === 'lossy' && call.paletteColors === 64)).toBe(true);
    expect(after.calls.every(call => call.stroke === 'rgba(136, 136, 136, 0.16)')).toBe(true);
    expect(after.settings).toEqual({ format: 'jpg', ratio: 1, compression: 'lossy', quality: 60 });
    expect(after.leases).toBe(0); expect(errors).toEqual([]);
    await drawer.getByRole('button', { name: '清空', exact: true }).click();
    expect(await page.evaluate(() => window.__shoteasyStores.batch._styleSnapshot)).toBeNull();
});

test('C3 real one-file codecs retain transparent PNG, JPG/WebP white fill and output dimensions', async ({ page }) => {
    test.setTimeout(90_000);
    await openEditor(page);
    const results = await page.evaluate(async bytes => {
        const root = window.__shoteasyStores;
        const rows = [];
        for (const settings of [
            { format: 'png', ratio: 3, compression: 'lossless' },
            { format: 'webp', ratio: 2, compression: 'lossless' },
            { format: 'jpg', ratio: 2, compression: 'lossy', quality: 80 },
            { format: 'avif', ratio: 1, compression: 'lossy', quality: 40 },
        ]) {
            root.workspace.setExportSettings(settings, { replace: true });
            await root.batch.start([new File([new Uint8Array(bytes)], 'only.png', { type: 'image/png' })]);
            rows.push({ settings, archive: [...new Uint8Array(await root.batch.archive.arrayBuffer())], reported: root.batch.jobs[0].bytes });
        }
        root.batch.clear();
        return rows;
    }, [...createPngFixture(64, 48)]);
    for (const row of results) {
        const [filename, bytes] = Object.entries(unzipSync(new Uint8Array(row.archive)))[0];
        const decoded = await page.evaluate(async ({ bytes, format }) => {
            const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: `image/${format === 'jpg' ? 'jpeg' : format}` }));
            const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
            return { width: canvas.width, height: canvas.height, corner: [...ctx.getImageData(0, 0, 1, 1).data] };
        }, { bytes: [...bytes], format: row.settings.format });
        expect([decoded.width, decoded.height]).toEqual([128 * row.settings.ratio, 96 * row.settings.ratio]);
        expect(bytes.length).toBe(row.reported); expect(filename.endsWith(`.${row.settings.format}`)).toBe(true);
        if (row.settings.format === 'png') expect(decoded.corner[3]).toBe(0);
        if (['jpg', 'webp'].includes(row.settings.format)) expect(decoded.corner).toEqual([255, 255, 255, 255]);
    }
});

test('C3 invalid preset import and local apply warn visibly without losing scene content', async ({ page }) => {
    await openEditor(page);
    const source = await page.evaluate(async () => {
        const { createPresetArchive } = await import('/src/utils/workspaceArchive.js');
        const { createStylePreset } = await import('/src/utils/stylePreset.js');
        const blob = await createPresetArchive({ preset: createStylePreset({ name: 'Future C3', option: window.__shoteasyStores.option.toDocument() }) });
        return [...new Uint8Array(await blob.arrayBuffer())];
    });
    const entries = unzipSync(new Uint8Array(source));
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    manifest.preset.exportSettings = { format: 'jpg', ratio: 2, compression: 'lossless' };
    entries['manifest.json'] = strToU8(JSON.stringify(manifest));
    expect(await page.evaluate(async bytes => window.__shoteasyStores.workspace.importPresetFile(new File([new Uint8Array(bytes)], 'future.screenhello-preset')), [...zipSync(entries)])).toBe(true);
    await expect(page.getByText('无法识别的压缩设置已恢复为标准导出；图片和图层未改变。').last()).toBeVisible();
    const result = await page.evaluate(async () => {
        const root = window.__shoteasyStores;
        const id = root.workspace.presets.find(preset => preset.name === 'Future C3').id;
        const record = await root.draftStore.loadPreset(id);
        record.preset.exportSettings = { format: 'png', ratio: 1, compression: 'lossy', paletteColors: 63 };
        await root.draftStore.savePreset(record);
        const previous = root.imageStore.list.length;
        const ok = await root.workspace.applyPreset(id);
        return { ok, previous, after: root.imageStore.list.length, settings: { ...root.workspace.exportSettings } };
    });
    expect(result).toEqual({ ok: true, previous: 1, after: 1, settings: { format: 'png', ratio: 1 } });
    await expect(page.getByText('无法识别的压缩设置已恢复为标准导出；图片和图层未改变。').last()).toBeVisible();
});

test('C3 retry notice, fixed settings and byte totals stay accessible in seven languages on a narrow screen', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await openEditor(page);
    await page.evaluate(() => window.__shoteasyStores.commands.execute('file.openBatch'));
    await page.getByTestId('batch-file-input').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid') });
    const drawer = page.locator('.shoteasy-batch-drawer');
    await drawer.getByRole('button', { name: '开始批量处理' }).click();
    await expect(page.getByTestId('batch-retry-notice')).toBeVisible();
    for (const locale of ['zh-CN', 'en-US', 'zh-TW', 'de-DE', 'ko-KR', 'es-ES', 'pt-PT']) {
        for (const theme of ['dark', 'light']) {
            await page.evaluate(({ locale, theme }) => {
                window.__shoteasyStores.i18n.setOptions(locale);
                window.__shoteasyStores.editor.setTheme(theme);
            }, { locale, theme });
            await expect(page.locator('.shoteasy-app').first()).toHaveAttribute('lang', locale);
            await expect(page.locator('.shoteasy-app').first()).toHaveAttribute('data-mode', theme);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await expect.poll(() => drawer.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity).length)).toBe(0);
            const result = await new AxeBuilder({ page }).include('.shoteasy-batch-drawer').withTags(['wcag2a', 'wcag2aa']).analyze();
            expect(result.violations.map(item => ({ locale, theme, id: item.id, nodes: item.nodes.map(node => ({ target: node.target, reason: node.failureSummary })) }))).toEqual([]);
            expect(await drawer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        }
    }
    await page.getByTestId('batch-retry-notice').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('compression-batch-mobile-pt-light.png') });
});
