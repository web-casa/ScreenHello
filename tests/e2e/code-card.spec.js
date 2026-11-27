import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';

const readDownload = async (download) => {
    const filePath = await download.path();
    return new Uint8Array(await readFile(filePath));
};

test('creates, previews, re-edits, undoes/redoes a code card and passes axe WCAG checks', async ({ page }) => {
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));

    await page.goto('/?workspace=true');
    await expect(page.getByRole('button', { name: '选择图片', exact: true })).toBeVisible();

    // Lazy chunk must not be requested before opening the dialog.
    expect(requests.some((url) => /CodeCardDialog|codeHighlighter|codeCardRenderer/.test(url))).toBe(false);

    // Open via File menu on empty canvas.
    await page.getByRole('menuitem', { name: '文件', exact: true }).click();
    await page.getByRole('menuitem', { name: /^新建代码卡片/ }).click();

    const dialog = page.getByRole('dialog', { name: '新建代码卡片' });
    await expect(dialog).toBeVisible();
    await expect.poll(() => requests.some((url) => /CodeCardDialog/.test(url))).toBe(true);

    // Wait for initial preview canvas paint.
    const previewCanvas = dialog.getByTestId('code-card-preview-canvas');
    await expect(previewCanvas).toBeVisible();
    await expect.poll(() => previewCanvas.evaluate((el) => el.width)).toBeGreaterThan(200);

    // WCAG axe-core check on modal surface.
    const axeResults = await new AxeBuilder({ page })
        .include('.shoteasy-code-card-modal')
        .analyze();
    expect(axeResults.violations).toEqual([]);

    // WCAG 2.1.2: Tab inside textarea must move focus out, never trap keyboard users.
    const textarea = dialog.getByTestId('code-card-textarea');
    await textarea.focus();
    await page.keyboard.press('Tab');
    const focusedTag = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') || document.activeElement?.tagName);
    expect(focusedTag).not.toBe('code-card-textarea');

    // Clear button empties code and disables Confirm button.
    const confirmBtn = dialog.getByRole('button', { name: /生成卡片/ });
    await dialog.getByTestId('code-card-clear').click();
    await expect(confirmBtn).toBeDisabled();

    // Indent button inserts spaces cleanly, then type a Python snippet.
    await dialog.getByTestId('code-card-indent').click();
    await expect(textarea).toHaveValue('  ');
    await textarea.fill([
        'def fibonacci(n: int) -> list[int]:',
        '    # Generate sequence',
        '    seq = [0, 1]',
        '    for i in range(2, n):',
        '        seq.append(seq[-1] + seq[-2])',
        '    return seq',
    ].join('\n'));
    await dialog.getByTestId('code-card-title').fill('fibonacci.py');
    await expect(confirmBtn).toBeEnabled();

    // Wait for debounced auto-detect to pick up Python.
    await expect(dialog.getByTestId('code-card-meta')).toContainText('Python');

    // Toggle line numbers off and back on, then confirm.
    await dialog.getByTestId('code-card-line-numbers').click();
    await dialog.getByTestId('code-card-line-numbers').click();
    await confirmBtn.click();
    await expect(dialog).toBeHidden();

    // Verify canvas is visible and layer carries codeCard metadata & multi-color syntax pixels.
    await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();
    const createdState = await page.evaluate(async () => {
        const stores = window.__shoteasyStores;
        const layer = stores.imageStore.activeLayer;
        const img = stores.editor.img;
        const response = await fetch(img.src);
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
        const distinctColors = new Set();
        for (let i = 0; i < data.length; i += 16) {
            if (data[i + 3] > 200) {
                distinctColors.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
            }
        }
        bitmap.close();
        canvas.width = canvas.height = 0;
        return {
            title: layer?.codeCard?.title,
            theme: layer?.codeCard?.theme,
            width: img.width,
            height: img.height,
            colorBuckets: distinctColors.size,
        };
    });
    expect(createdState.title).toBe('fibonacci.py');
    expect(createdState.theme).toBe('one-dark');
    expect(createdState.width).toBeGreaterThanOrEqual(840);
    expect(createdState.height).toBeGreaterThan(200);
    // Multi-color syntax tokens + traffic lights produce many distinct quantized color buckets.
    expect(createdState.colorBuckets).toBeGreaterThan(8);

    // Re-edit via RightInspector button, switch theme to GitHub Light and rename title.
    await page.getByRole('button', { name: '编辑代码卡片' }).click();
    const editDialog = page.getByRole('dialog', { name: '编辑代码卡片' });
    await expect(editDialog).toBeVisible();
    await expect(editDialog.getByTestId('code-card-title')).toHaveValue('fibonacci.py');

    await editDialog.getByTestId('code-card-title').fill('fib-light.py');
    await editDialog.getByTestId('code-card-theme').click();
    await page.locator('.ant-select-item-option').filter({ hasText: 'GitHub Light' }).click();
    await editDialog.getByRole('button', { name: /更新卡片/ }).click();
    await expect(editDialog).toBeHidden();

    await expect.poll(() => page.evaluate(() => ({
        title: window.__shoteasyStores.imageStore.activeLayer?.codeCard?.title,
        theme: window.__shoteasyStores.imageStore.activeLayer?.codeCard?.theme,
    }))).toEqual({ title: 'fib-light.py', theme: 'github-light' });

    // Undo restores previous codeCard title & theme; Redo restores updated version.
    await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
    await page.getByRole('menuitem', { name: /^撤销/ }).click();
    await expect.poll(() => page.evaluate(() => ({
        title: window.__shoteasyStores.imageStore.activeLayer?.codeCard?.title,
        theme: window.__shoteasyStores.imageStore.activeLayer?.codeCard?.theme,
    }))).toEqual({ title: 'fibonacci.py', theme: 'one-dark' });

    await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
    await page.getByRole('menuitem', { name: /^重做/ }).click();
    await expect.poll(() => page.evaluate(() => ({
        title: window.__shoteasyStores.imageStore.activeLayer?.codeCard?.title,
        theme: window.__shoteasyStores.imageStore.activeLayer?.codeCard?.theme,
    }))).toEqual({ title: 'fib-light.py', theme: 'github-light' });
});

test('round-trips codeCard metadata in .screenhello project archives and remains re-editable after reload', async ({ browser, page }) => {
    await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
    await page.goto('/?workspace=true');

    await page.getByRole('menuitem', { name: '文件', exact: true }).click();
    await page.getByRole('menuitem', { name: /^新建代码卡片/ }).click();
    const dialog = page.getByRole('dialog', { name: '新建代码卡片' });
    await dialog.getByTestId('code-card-title').fill('archive-card.ts');
    await dialog.getByRole('button', { name: /生成卡片/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();

    // Save .screenhello project archive.
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: '文件', exact: true }).click();
    await page.getByRole('menuitem', { name: /^保存项目/ }).click();
    const archiveBytes = await readDownload(await downloadPromise);
    const entries = unzipSync(archiveBytes);
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    expect(manifest.document.images[0].codeCard.title).toBe('archive-card.ts');

    // Open a clean isolated browser context (zero IndexedDB drafts) and load the saved .screenhello archive.
    const cleanContext = await browser.newContext();
    try {
        const cleanPage = await cleanContext.newPage();
        await cleanPage.goto('/?workspace=true');
        await expect(cleanPage.getByRole('button', { name: '选择图片', exact: true })).toBeVisible();
        await cleanPage.getByTestId('project-file-input').setInputFiles({
            name: 'code-card-project.screenhello',
            mimeType: 'application/vnd.screenhello.project+zip',
            buffer: Buffer.from(archiveBytes),
        });

        await expect(cleanPage.locator('.shoteasy-editor-canvas')).toBeVisible();
        const editBtn = cleanPage.getByRole('button', { name: '编辑代码卡片' });
        await expect(editBtn).toBeVisible();
        await editBtn.click();

        const reopenedDialog = cleanPage.getByRole('dialog', { name: '编辑代码卡片' });
        await expect(reopenedDialog).toBeVisible();
        await expect(reopenedDialog.getByTestId('code-card-title')).toHaveValue('archive-card.ts');
    } finally {
        await cleanContext.close();
    }
});
