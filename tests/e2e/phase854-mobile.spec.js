import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createPngFixture } from '../fixtures/createPngFixture.js';

const phoneViewports = [
    { id: 'portrait-390', width: 390, height: 844 },
    { id: 'portrait-430', width: 430, height: 932 },
    { id: 'landscape', width: 844, height: 390 },
    { id: 'soft-keyboard', width: 390, height: 500 },
    { id: 'text-200', width: 390, height: 844, textScale: 200 },
];

async function openOffline(page) {
    await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (['127.0.0.1', 'localhost'].includes(url.hostname) || ['blob:', 'data:'].includes(url.protocol)) {
            await route.continue();
        } else {
            await route.abort('blockedbyclient');
        }
    });
    await page.goto('/');
}

async function importFixture(page) {
    await page.locator('.shoteasy-upload-card input[type="file"]').setInputFiles({
        name: 'phase854-mobile.png',
        mimeType: 'image/png',
        buffer: createPngFixture(96, 72),
    });
    await expect.poll(() => page.evaluate(() => window.__shoteasyStores.imageStore.list.length)).toBe(1);
}

async function createPhonePage(browser, baseURL, viewport = phoneViewports[0]) {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: true,
        colorScheme: 'dark',
        reducedMotion: 'reduce',
        locale: 'zh-CN',
    });
    const page = await context.newPage();
    await openOffline(page);
    return { context, page };
}

const targetBox = async (locator) => locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
});

test('[Phase 8.5.4] phone shell has one menu, project status, and a fixed export action', async ({ browser, baseURL }, testInfo) => {
    const { context, page } = await createPhonePage(browser, baseURL);
    try {
        await importFixture(page);
        const topbar = page.locator('.shoteasy-topbar');
        const mobileMenu = page.getByRole('button', { name: '打开应用菜单' });
        const projectStatus = topbar.getByRole('button', { name: /^项目：/ });
        const exportAction = topbar.getByRole('button', { name: '导出图片' });

        await expect(page.getByRole('menubar', { name: '应用菜单' })).toBeHidden();
        await expect(mobileMenu).toBeVisible();
        await expect(projectStatus).toBeVisible();
        await expect(exportAction).toBeVisible();
        expect(await topbar.getByRole('button').allTextContents()).toHaveLength(3);

        for (const target of [mobileMenu, projectStatus, exportAction]) {
            const box = await targetBox(target);
            expect(box.width).toBeGreaterThanOrEqual(44);
            expect(box.height).toBeGreaterThanOrEqual(44);
        }
        const topbarRects = await Promise.all([mobileMenu, projectStatus, exportAction].map((target) => (
            target.evaluate((element) => {
                const rect = element.getBoundingClientRect();
                return { left: rect.left, right: rect.right };
            })
        )));
        expect(topbarRects[1].left - topbarRects[0].right).toBeGreaterThanOrEqual(8);
        expect(topbarRects[2].left - topbarRects[1].right).toBeGreaterThanOrEqual(8);

        await mobileMenu.tap();
        const drawer = page.getByRole('dialog', { name: '应用菜单' });
        await expect(drawer).toBeVisible();
        await expect.poll(() => drawer.evaluate((element) => {
            const wrapper = element.closest('.ant-drawer-content-wrapper');
            const rect = wrapper?.getBoundingClientRect();
            return Boolean(wrapper && getComputedStyle(wrapper).transform === 'none' && rect.top < innerHeight * 0.4);
        })).toBe(true);
        await expect(drawer.getByRole('tab')).toHaveCount(4);
        for (const tab of await drawer.getByRole('tab').all()) {
            const box = await targetBox(tab);
            expect(box.width).toBeGreaterThanOrEqual(44);
            expect(box.height).toBeGreaterThanOrEqual(44);
        }
        await expect(drawer.getByRole('menuitem', { name: /新建项目/ })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('mobile-menu.png') });

        await drawer.getByRole('tab', { name: '编辑' }).tap();
        await expect(drawer.getByRole('menuitem', { name: /撤销/ })).toBeVisible();
        await drawer.getByRole('tab', { name: '视图' }).tap();
        await expect(drawer.getByRole('menuitem', { name: /适应画布/ })).toBeVisible();
        await drawer.getByRole('tab', { name: '帮助' }).tap();
        await expect(drawer.getByRole('menuitem', { name: /快速入门/ })).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(drawer).toBeHidden();
        await expect(mobileMenu).toBeFocused();

        await mobileMenu.tap();
        await drawer.getByRole('menuitem', { name: /导出图片/ }).tap();
        const exportDrawer = page.getByRole('dialog', { name: '导出图片' });
        await expect(exportDrawer).toBeVisible();
        await expect(drawer).toBeHidden();
        await page.getByTestId('export-cancel').tap();
        await expect(mobileMenu).toBeFocused();

        await mobileMenu.tap();
        await drawer.getByRole('tab', { name: '帮助' }).tap();
        await drawer.getByRole('menuitem', { name: /快速入门/ }).tap();
        const helpDialog = page.getByRole('dialog', { name: '快速入门' });
        await expect(helpDialog).toBeVisible();
        await expect(drawer).toBeHidden();
        await page.getByTestId('help-close').tap();
        await expect(mobileMenu).toBeFocused();
    } finally {
        await context.close();
    }
});

test('[Phase 8.5.4] annotation sheet and compact zoom expose every core action without horizontal scrolling', async ({ browser, baseURL }) => {
    const { context, page } = await createPhonePage(browser, baseURL);
    try {
        await importFixture(page);
        const annotationTrigger = page.getByRole('button', { name: /打开标注工具/ });
        const zoomTrigger = page.getByRole('button', { name: /打开缩放菜单/ });
        await expect(annotationTrigger).toBeVisible();
        await expect(zoomTrigger).toBeVisible();
        expect(await targetBox(annotationTrigger)).toEqual({ width: 44, height: 44 });
        expect(await targetBox(zoomTrigger)).toEqual({ width: 44, height: 44 });

        await annotationTrigger.tap();
        const sheet = page.getByRole('dialog', { name: '标注工具' });
        await expect(sheet).toBeVisible();
        await expect(sheet.getByRole('button', { name: '矩形', exact: true })).toBeVisible();
        await sheet.getByText('更多标注工具', { exact: true }).tap();
        for (const name of ['放大镜', '步骤序号', '文字', '模糊', '马赛克', '聚光', '选择表情']) {
            await expect(sheet.getByRole('button', { name })).toBeVisible();
        }
        const sheetMetrics = await sheet.evaluate((element) => ({
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            inputFontSizes: [...element.querySelectorAll('input, textarea, select')]
                .map((input) => Number.parseFloat(getComputedStyle(input).fontSize)),
        }));
        expect(sheetMetrics.scrollWidth).toBeLessThanOrEqual(sheetMetrics.clientWidth);
        expect(sheetMetrics.inputFontSizes.every((size) => size >= 16)).toBe(true);
        const undersizedButtons = await sheet.getByRole('button').evaluateAll((buttons) => buttons
            .map((button) => {
                const rect = button.getBoundingClientRect();
                return {
                    name: button.getAttribute('aria-label') || button.textContent?.trim(),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                };
            })
            .filter(({ width, height }) => width < 44 || height < 44));
        expect(undersizedButtons).toEqual([]);
        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(axe.violations).toEqual([]);

        await sheet.getByRole('button', { name: '标注颜色' }).tap();
        const colorDialog = page.getByRole('dialog', { name: '标注颜色设置' });
        await expect(colorDialog).toBeVisible();
        expect(await page.locator('.ant-popover.shoteasy-annotation-popup').evaluate((element) => (
            Number.parseInt(getComputedStyle(element).zIndex, 10)
        ))).toBeGreaterThanOrEqual(1050);
        await page.keyboard.press('Escape');
        await expect(colorDialog).toBeHidden();

        await sheet.getByRole('button', { name: '画笔' }).tap();
        await expect(sheet).toBeHidden();
        await expect.poll(() => page.evaluate(() => window.__shoteasyStores.editor.useTool)).toBe('Pencil');

        const scaleBefore = await page.evaluate(() => window.__shoteasyStores.editor.scale);
        await zoomTrigger.tap();
        const zoomMenu = page.getByRole('menu', { name: '缩放与画布' });
        await expect(zoomMenu).toBeVisible();
        await zoomMenu.getByRole('menuitem', { name: '放大' }).tap();
        await expect.poll(() => page.evaluate(() => window.__shoteasyStores.editor.scale)).not.toBe(scaleBefore);
    } finally {
        await context.close();
    }
});

test('[Phase 8.5.4] phone portrait, landscape, and reduced-height layouts stay inside the dynamic viewport', async ({ browser, baseURL }) => {
    for (const viewport of phoneViewports) {
        const { context, page } = await createPhonePage(browser, baseURL, viewport);
        try {
            if (viewport.textScale) {
                await page.addStyleTag({ content: `
                    html { -webkit-text-size-adjust: ${viewport.textScale}%; text-size-adjust: ${viewport.textScale}%; }
                    .shoteasy-topbar button,
                    .shoteasy-mobile-menu-drawer .shoteasy-command-label { font-size: ${viewport.textScale}% !important; }
                ` });
            }
            await importFixture(page);
            const metrics = await page.evaluate(() => {
                const visible = (element) => {
                    if (!element) return false;
                    const style = getComputedStyle(element);
                    const rect = element.getBoundingClientRect();
                    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
                };
                const clipped = [...document.querySelectorAll([
                    '.shoteasy-topbar button',
                    '.shoteasy-mobile-annotation-trigger',
                    '.shoteasy-mobile-zoom-trigger',
                ].join(','))].filter(visible).map((element) => {
                    const rect = element.getBoundingClientRect();
                    return {
                        name: element.getAttribute('aria-label') || element.textContent?.trim(),
                        left: rect.left,
                        right: rect.right,
                        top: rect.top,
                        bottom: rect.bottom,
                    };
                }).filter((rect) => (
                    rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight
                ));
                const app = document.querySelector('.shoteasy-app');
                const topbar = document.querySelector('.shoteasy-topbar');
                return {
                    viewport: { width: innerWidth, height: innerHeight },
                    appHeight: Math.round(app.getBoundingClientRect().height),
                    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
                    topbarOverflow: topbar.scrollWidth > topbar.clientWidth,
                    clipped,
                    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
                    annotationTransitionMs: Math.max(...getComputedStyle(document.querySelector('.shoteasy-mobile-annotation-trigger'))
                        .transitionDuration.split(',')
                        .map((value) => value.trim())
                        .map((value) => Number.parseFloat(value) * (value.endsWith('ms') ? 1 : 1000))),
                };
            });
            expect(metrics.appHeight).toBe(metrics.viewport.height);
            expect(metrics.pageOverflow).toBe(false);
            expect(metrics.topbarOverflow).toBe(false);
            expect(metrics.clipped).toEqual([]);
            expect(metrics.reducedMotion).toBe(true);
            expect(metrics.annotationTransitionMs).toBeLessThanOrEqual(0.02);
            await expect(page.getByRole('button', { name: '打开应用菜单' })).toBeVisible();
            if (viewport.textScale) {
                await page.getByRole('button', { name: '打开应用菜单' }).tap();
                const drawer = page.getByRole('dialog', { name: '应用菜单' });
                await expect(drawer).toBeVisible();
                expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
                await page.keyboard.press('Escape');
            }
        } finally {
            await context.close();
        }
    }
});

test('[Phase 8.5.4] annotation presentation follows editor width without changing desktop or tablet commands', async ({ browser, baseURL }) => {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1024, height: 768 },
        colorScheme: 'dark',
        reducedMotion: 'reduce',
        locale: 'zh-CN',
    });
    const page = await context.newPage();
    try {
        await openOffline(page);
        await importFixture(page);
        const toolbar = page.locator('.shoteasy-bottom-toolbar');
        const annotationTrigger = page.getByRole('button', { name: /打开标注工具/ });

        await expect(page.getByRole('menubar', { name: '应用菜单' })).toBeVisible();
        await expect(toolbar).toBeHidden();
        await expect(annotationTrigger).toBeVisible();
        await annotationTrigger.click();
        await expect(page.getByRole('dialog', { name: '标注工具' })).toBeVisible();
        await page.keyboard.press('Escape');

        await page.setViewportSize({ width: 768, height: 1024 });
        await expect(toolbar).toBeVisible();
        await expect(annotationTrigger).toBeHidden();
        expect(await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

        await page.setViewportSize({ width: 1440, height: 900 });
        await expect(toolbar).toBeVisible();
        await expect(annotationTrigger).toBeHidden();
        expect(await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

        await page.setViewportSize({ width: 1180, height: 820 });
        await expect(toolbar).toBeHidden();
        await expect(annotationTrigger).toBeVisible();

        await page.setViewportSize({ width: 1280, height: 820 });
        await expect(toolbar).toBeVisible();
        await expect(annotationTrigger).toBeHidden();
        expect(await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    } finally {
        await context.close();
    }
});
