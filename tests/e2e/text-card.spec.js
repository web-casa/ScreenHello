import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';

const readDownload = async (download) => {
    const filePath = await download.path();
    return new Uint8Array(await readFile(filePath));
};

test('creates, switches kinds, re-edits, undoes/redoes a text card and passes axe WCAG checks', async ({ page }) => {
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));

    await page.goto('/?workspace=true');
    await expect(page.getByRole('button', { name: '选择图片', exact: true })).toBeVisible();

    // Lazy text card modules must not be fetched on initial load.
    expect(requests.some((url) => /TextCardDialog|textCardRenderer/.test(url))).toBe(false);

    // Quick create shortcuts on Init welcome stage should be visible and launch modals directly.
    await expect(page.getByTestId('init-create-code-card')).toBeVisible();
    await expect(page.getByTestId('init-create-text-card')).toBeVisible();
    await expect(page.getByTestId('init-open-templates')).toBeVisible();

    await page.getByTestId('init-create-text-card').click();

    const dialog = page.getByRole('dialog', { name: '新建文本卡片' });
    await expect(dialog).toBeVisible();
    await expect.poll(() => requests.some((url) => /TextCardDialog/.test(url))).toBe(true);

    const previewCanvas = dialog.getByTestId('text-card-preview-canvas');
    await expect(previewCanvas).toBeVisible();
    await expect.poll(() => previewCanvas.evaluate((el) => el.width)).toBeGreaterThan(200);

    // WCAG axe-core check on modal surface.
    const axeResults = await new AxeBuilder({ page })
        .include('.shoteasy-text-card-modal')
        .analyze();
    expect(axeResults.violations).toEqual([]);

    // Update social card author and body, confirm creation.
    await dialog.getByTestId('text-card-author').fill('Alice Dev');
    await dialog.getByTestId('text-card-body').fill('ScreenHello local-first text & social card works offline.');
    await dialog.getByRole('button', { name: /生成卡片/ }).click();
    await expect(dialog).toBeHidden();

    await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();
    const createdMeta = await page.evaluate(() => ({
        kind: window.__shoteasyStores.imageStore.activeLayer?.textCard?.kind,
        authorName: window.__shoteasyStores.imageStore.activeLayer?.textCard?.authorName,
        width: window.__shoteasyStores.editor.img?.width,
        height: window.__shoteasyStores.editor.img?.height,
    }));
    expect(createdMeta.kind).toBe('social');
    expect(createdMeta.authorName).toBe('Alice Dev');
    expect(createdMeta.width).toBeGreaterThanOrEqual(840);
    expect(createdMeta.height).toBeGreaterThan(200);

    // Re-edit via RightInspector button, switch to changelog kind, and update.
    await page.getByRole('button', { name: '编辑文本卡片' }).click();
    const editDialog = page.getByRole('dialog', { name: '编辑文本卡片' });
    await expect(editDialog).toBeVisible();
    await expect(editDialog.getByTestId('text-card-author')).toHaveValue('Alice Dev');

    await editDialog.getByText('更新日志', { exact: true }).click();
    await editDialog.getByTestId('text-card-changelog-title').fill('v2.1 Release Notes');
    await editDialog.getByRole('button', { name: /更新卡片/ }).click();
    await expect(editDialog).toBeHidden();

    await expect.poll(() => page.evaluate(() => ({
        kind: window.__shoteasyStores.imageStore.activeLayer?.textCard?.kind,
        title: window.__shoteasyStores.imageStore.activeLayer?.textCard?.changelogTitle,
    }))).toEqual({ kind: 'changelog', title: 'v2.1 Release Notes' });

    // Undo restores previous social card; Redo restores changelog card.
    await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
    await page.getByRole('menuitem', { name: /^撤销/ }).click();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.imageStore.activeLayer?.textCard?.kind))
        .toBe('social');

    await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
    await page.getByRole('menuitem', { name: /^重做/ }).click();
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.imageStore.activeLayer?.textCard?.kind))
        .toBe('changelog');
});

test('round-trips textCard and codeCard highlight/diff in .screenhello project archive', async ({ browser, page }) => {
    await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
    await page.goto('/?workspace=true');

    // Create a Code Card with highlightLines & diffMode enabled.
    await page.getByRole('menuitem', { name: '文件', exact: true }).click();
    await page.getByRole('menuitem', { name: /^新建代码卡片/ }).click();
    const codeDialog = page.getByRole('dialog', { name: '新建代码卡片' });
    await codeDialog.getByTestId('code-card-textarea').fill([
        'const mode = "fast";',
        '-const oldFlag = false;',
        '+const newFlag = true;',
    ].join('\n'));
    await codeDialog.getByTestId('code-card-highlight-lines').fill('1');
    await codeDialog.getByTestId('code-card-diff-mode').click();
    await codeDialog.getByRole('button', { name: /生成卡片/ }).click();
    await expect(codeDialog).toBeHidden();

    // Add a Text Card (quote) as second layer.
    await page.getByRole('menuitem', { name: '文件', exact: true }).click();
    await page.getByRole('menuitem', { name: /^新建文本卡片/ }).click();
    const textDialog = page.getByRole('dialog', { name: '新建文本卡片' });
    await textDialog.getByText('引文海报', { exact: true }).click();
    await textDialog.getByTestId('text-card-body').fill('Simplicity is the ultimate sophistication.');
    await textDialog.getByRole('button', { name: /生成卡片/ }).click();
    await expect(textDialog).toBeHidden();

    // Save .screenhello project archive and inspect manifest.
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: '文件', exact: true }).click();
    await page.getByRole('menuitem', { name: /^保存项目/ }).click();
    const archiveBytes = await readDownload(await downloadPromise);
    const entries = unzipSync(archiveBytes);
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    expect(manifest.document.images).toHaveLength(2);
    expect(manifest.document.images[0].codeCard.highlightLines).toBe('1');
    expect(manifest.document.images[0].codeCard.diffMode).toBe(true);
    expect(manifest.document.images[1].textCard.kind).toBe('quote');

    // Reload archive in clean browser context and verify re-editability.
    const cleanContext = await browser.newContext();
    try {
        const cleanPage = await cleanContext.newPage();
        await cleanPage.goto('/?workspace=true');
        await expect(cleanPage.getByRole('button', { name: '选择图片', exact: true })).toBeVisible();
        await cleanPage.getByTestId('project-file-input').setInputFiles({
            name: 'cards-v2.screenhello',
            mimeType: 'application/vnd.screenhello.project+zip',
            buffer: Buffer.from(archiveBytes),
        });
        await expect(cleanPage.locator('.shoteasy-editor-canvas')).toBeVisible();
        const restored = await cleanPage.evaluate(() => window.__shoteasyStores.imageStore.list.map((l) => ({
            hasCode: Boolean(l.codeCard),
            diffMode: l.codeCard?.diffMode ?? null,
            textKind: l.textCard?.kind ?? null,
        })));
        expect(restored).toEqual([
            { hasCode: true, diffMode: true, textKind: null },
            { hasCode: false, diffMode: null, textKind: 'quote' },
        ]);
    } finally {
        await cleanContext.close();
    }
});
