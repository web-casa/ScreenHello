import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createPngFixture } from '../fixtures/createPngFixture.js';
import { hashPaths, sha256 } from '../compression-product/memory-evidence.mjs';

// No development-store access: exercise the frozen, real PWA entry via UI.
const build = path.resolve(process.env.SCREENHELLO_PWA_OUT_DIR || 'dist');
const buildSha256 = hashPaths(build, ['./']);
const testSha256 = sha256(readFileSync(new URL('./production-downloads.spec.js', import.meta.url)));
const modes = [
    ['pc', 'png', 'lossless'], ['pc', 'png', 'lossy'],
    ['pc', 'webp', 'lossless'], ['pc', 'webp', 'lossy'], ['pc', 'jpg', 'lossy'],
    ['pc', 'avif', 'standard'], ['small', 'avif', 'lossy'], ['small', 'png', 'lossless', 2],
];

for (const [fixture, format, compression, ratio = 1] of modes) {
    test(`frozen production ${fixture} ${format}/${compression} ${ratio}x downloads decodable exact dimensions`, async ({ page }, testInfo) => {
        test.setTimeout(150_000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('/');
        expect(await page.evaluate(() => typeof window.__shoteasyStores)).toBe('undefined');
        if (fixture === 'pc') await page.getByRole('button', { name: '试用示例', exact: true }).click();
        else await page.locator('.shoteasy-upload-card input[type=file]').setInputFiles({ name: 'small.png', mimeType: 'image/png', buffer: createPngFixture(64, 48) });
        await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();
        await page.getByRole('button', { name: '导出图片', exact: true }).click();
        const drawer = page.locator('.shoteasy-export-drawer');
        await drawer.getByText(format.toUpperCase(), { exact: true }).first().click();
        await page.getByTestId(`compression-${compression}`).click();
        await drawer.getByText(`${ratio}x`, { exact: true }).click();
        const dimensions = (await drawer.locator('strong').filter({ hasText: /^\d+ × \d+ px$/ }).textContent()).match(/(\d+) × (\d+)/);
        const width = Number(dimensions[1]), height = Number(dimensions[2]);
        expect(width * height).toBeLessThanOrEqual(4_194_304);
        if (fixture === 'pc') {
            expect(width * height).toBeGreaterThan(1_048_576);
            await expect(page.getByTestId('export-preview')).toBeDisabled();
        } else expect(width * height).toBeLessThanOrEqual(1_048_576);
        await expect(page.getByTestId('export-download')).toBeEnabled();
        const downloaded = page.waitForEvent('download', { timeout: 135_000 });
        await page.getByTestId('export-download').click();
        const download = await downloaded;
        expect(await download.failure()).toBeNull();
        expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
        const chunks = [];
        for await (const chunk of await download.createReadStream()) chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        expect(bytes.length).toBeGreaterThan(0);
        if (format === 'png') expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        if (format === 'jpg') expect(bytes.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
        if (format === 'webp') { expect(bytes.subarray(0, 4).toString()).toBe('RIFF'); expect(bytes.subarray(8, 12).toString()).toBe('WEBP'); }
        if (format === 'avif') expect(bytes.subarray(4, 12).toString()).toBe('ftypavif');
        const decoded = await page.evaluate(async ({ base64, format }) => {
            const buffer = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
            const bitmap = await createImageBitmap(new Blob([buffer], { type: `image/${format === 'jpg' ? 'jpeg' : format}` }));
            try { return { width: bitmap.width, height: bitmap.height }; }
            finally { bitmap.close(); }
        }, { base64: bytes.toString('base64'), format });
        expect(decoded).toEqual({ width, height });
        await expect(drawer).toHaveCount(0);
        await expect(page.getByRole('button', { name: '导出图片', exact: true })).toBeEnabled();
        expect(errors).toEqual([]);
        await testInfo.attach('production-download-evidence', { contentType: 'application/json', body: JSON.stringify({ buildSha256, testSha256, fixture, format, compression, ratio, width, height, bytes: bytes.length, outputSha256: sha256(bytes), decoded, pageErrors: errors }) });
        await download.delete();
    });
}

test('frozen production refuses PC-size lossy AVIF but preserves explicit standard choice', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '试用示例', exact: true }).click();
    await expect(page.locator('.shoteasy-editor-canvas')).toBeVisible();
    await page.getByRole('button', { name: '导出图片', exact: true }).click();
    await page.locator('.shoteasy-export-drawer').getByText('AVIF', { exact: true }).click();
    await page.getByTestId('compression-lossy').click();
    await expect(page.getByTestId('export-download')).toBeDisabled();
    await expect(page.getByTestId('export-download')).toHaveAccessibleDescription(/AVIF.*PNG.*JPG.*WebP/);
    await page.getByTestId('compression-standard').click();
    await expect(page.getByTestId('export-download')).toBeEnabled();
});
