import { expect, test } from '@playwright/test';

test('safe retry remounts only its runtime and disables draft writes', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__shoteasyStores));
    const original = await page.evaluate(() => window.__shoteasyStores.id);
    await page.evaluate(async () => {
        const { mountRecoveryHarness } = await import('/tests/fixtures/recovery-harness.jsx');
        const container = document.createElement('div');
        container.id = 'recovery-fixture';
        document.body.append(container);
        window.__recoveryFixture = mountRecoveryHarness(container);
    });
    const fixture = page.locator('#recovery-fixture');
    const first = await fixture.getByTestId('recovery-runtime').getAttribute('data-id');
    await fixture.getByRole('button', { name: 'Trigger expected failure' }).click();
    await fixture.getByRole('button', { name: '保留草稿并以空白编辑器重试' }).click();
    await expect(fixture.getByTestId('recovery-runtime')).not.toHaveAttribute('data-id', first);
    await expect(fixture.getByText('原草稿已保留，本次会话已暂停自动保存')).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
        const instances = window.__recoveryFixture.instances;
        return { disposed: instances[0].isDisposed, enabled: instances.at(-1).draftService.isEnabled() };
    })).toEqual({ disposed: true, enabled: false });
    expect(await page.evaluate(() => window.__shoteasyStores.id)).toBe(original);
    await page.evaluate(() => window.__recoveryFixture.unmount());
});

test('invalid stored draft survives a reload and subsequent image edits', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__shoteasyStores));
    await page.evaluate(async () => {
        await window.__shoteasyStores.draftStore.saveProject('shoteasy-default', { version: 999, rescue: 'keep-me' });
    });
    await page.reload();
    await expect(page.getByText('原草稿已保留，本次会话已暂停自动保存')).toBeVisible();
    const result = await page.evaluate(async () => {
        const runtime = window.__shoteasyStores;
        runtime.editor.replaceImg({ src: 'data:image/png;base64,bad', width: 64, height: 48 });
        return {
            saved: await runtime.draftService.flush(),
            cleared: await runtime.draftService.clear(),
            record: await runtime.draftStore.loadProject('shoteasy-default'),
        };
    });
    expect(result).toEqual({ saved: false, cleared: false, record: { version: 999, rescue: 'keep-me' } });
});

test('recovery fallback keeps the instance language selected before the crash', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
        const { mountRecoveryHarness } = await import('/tests/fixtures/recovery-harness.jsx');
        const container = document.createElement('div');
        container.id = 'recovery-fixture';
        document.body.append(container);
        window.__recoveryFixture = mountRecoveryHarness(container);
    });
    const fixture = page.locator('#recovery-fixture');
    await expect(fixture.getByTestId('recovery-runtime')).toBeVisible();
    await page.evaluate(() => window.__recoveryFixture.instances.at(-1).i18n.setOptions('en-US'));
    await fixture.getByRole('button', { name: 'Trigger expected failure' }).click();
    await expect(fixture.getByRole('button', { name: 'Keep draft and restart with a blank editor' })).toBeVisible();
    await page.evaluate(() => window.__recoveryFixture.unmount());
});
