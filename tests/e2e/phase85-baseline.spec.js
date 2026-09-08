import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { createPngFixture } from '../fixtures/createPngFixture.js';

const enabled = process.env.SCREENHELLO_PHASE85_BASELINE === '1';
const viewports = [
    { id: '390x844', width: 390, height: 844 },
    { id: '430x932', width: 430, height: 932 },
    { id: '768x1024', width: 768, height: 1024 },
    { id: '1024x768', width: 1024, height: 768 },
    { id: '1440x900', width: 1440, height: 900 },
];
const themes = ['dark', 'light'];

test.skip(!enabled, 'Run explicitly with SCREENHELLO_PHASE85_BASELINE=1.');

test('records the Phase 8.5 responsive, theme, reduced-motion, and axe baseline', async ({ browser, baseURL }, testInfo) => {
    const outputRoot = path.resolve('artifacts/phase85-baseline');
    const screenshotRoot = path.join(outputRoot, 'screenshots');
    await mkdir(screenshotRoot, { recursive: true });
    const records = [];

    for (const viewport of viewports) {
        for (const theme of themes) {
            const context = await browser.newContext({
                viewport: { width: viewport.width, height: viewport.height },
                colorScheme: theme,
                reducedMotion: 'reduce',
                locale: 'zh-CN',
                timezoneId: 'UTC',
            });
            const page = await context.newPage();
            const externalRequests = [];
            const pageErrors = [];
            page.on('pageerror', (error) => pageErrors.push(error.message));
            await page.route('**/*', async (route) => {
                const url = new URL(route.request().url());
                if (
                    ['127.0.0.1', 'localhost'].includes(url.hostname)
                    || ['blob:', 'data:'].includes(url.protocol)
                ) {
                    await route.continue();
                    return;
                }
                externalRequests.push(url.href);
                await route.abort('blockedbyclient');
            });
            await page.addInitScript((selectedTheme) => {
                localStorage.setItem('SHOTEASY_BEAUTIFIER_THEME', selectedTheme);
            }, theme);
            await page.goto(baseURL);
            await page.locator('.shoteasy-upload-card input[type="file"]').setInputFiles({
                name: `phase85-${viewport.id}-${theme}.png`,
                mimeType: 'image/png',
                buffer: createPngFixture(640, 480),
            });
            await expect(page.getByRole('button', { name: '导出图片' })).toBeEnabled();
            await expect(page.locator('.shoteasy-app')).toHaveAttribute('data-mode', theme);

            const metrics = await page.evaluate(() => {
                const measureRegion = (element) => {
                    if (!element) return null;
                    const rect = element.getBoundingClientRect();
                    return {
                        clientWidth: element.clientWidth,
                        scrollWidth: element.scrollWidth,
                        left: Math.round(rect.left),
                        right: Math.round(rect.right),
                        top: Math.round(rect.top),
                        bottom: Math.round(rect.bottom),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                        clippedByViewport: rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight,
                        hasInternalHorizontalOverflow: element.scrollWidth > element.clientWidth,
                    };
                };
                const visibleTargets = [...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="menuitem"]')]
                    .map((element) => {
                        const rect = element.getBoundingClientRect();
                        const style = getComputedStyle(element);
                        return {
                            name: element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent?.trim().slice(0, 60) || element.tagName,
                            width: Math.round(rect.width),
                            height: Math.round(rect.height),
                            visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
                        };
                    })
                    .filter((target) => target.visible);
                const motionTarget = document.querySelector('.shoteasy-top-action--export');
                const motionStyle = motionTarget ? getComputedStyle(motionTarget) : null;
                return {
                    viewport: { width: innerWidth, height: innerHeight },
                    document: {
                        clientWidth: document.documentElement.clientWidth,
                        scrollWidth: document.documentElement.scrollWidth,
                        hasPageHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
                    },
                    regions: {
                        app: measureRegion(document.querySelector('.shoteasy-app')),
                        topbar: measureRegion(document.querySelector('.shoteasy-topbar')),
                        topActions: measureRegion(document.querySelector('.shoteasy-top-actions')),
                        editor: measureRegion(document.querySelector('.shoteasy-editor-canvas')),
                        annotationToolbar: measureRegion(document.querySelector('.shoteasy-bottom-toolbar')),
                        zoom: measureRegion(document.querySelector('.shoteasy-zoom-controls')),
                    },
                    touchTargets: {
                        visibleCount: visibleTargets.length,
                        below44Count: visibleTargets.filter(({ width, height }) => width < 44 || height < 44).length,
                        below44: visibleTargets.filter(({ width, height }) => width < 44 || height < 44).slice(0, 30),
                    },
                    reducedMotion: {
                        matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
                        animationDuration: motionStyle?.animationDuration || null,
                        transitionDuration: motionStyle?.transitionDuration || null,
                    },
                };
            });
            const axe = await new AxeBuilder({ page })
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
                .analyze();
            const screenshotName = `${viewport.id}-${theme}-reduce.png`;
            const screenshotPath = path.join(screenshotRoot, screenshotName);
            await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled', caret: 'hide' });

            records.push({
                id: `${viewport.id}-${theme}-reduce`,
                viewport,
                theme,
                reducedMotion: 'reduce',
                metrics,
                axe: {
                    violations: axe.violations,
                    incomplete: axe.incomplete,
                    passes: axe.passes.length,
                },
                externalRequests,
                pageErrors,
                screenshot: `screenshots/${screenshotName}`,
            });
            await context.close();
        }
    }

    const reportPath = path.join(outputRoot, 'report.json');
    await writeFile(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2)}\n`);
    await testInfo.attach('phase85-layout-baseline.json', {
        path: reportPath,
        contentType: 'application/json',
    });

    expect(records).toHaveLength(viewports.length * themes.length);
    expect(records.every(({ metrics }) => metrics.reducedMotion.matches)).toBe(true);
    expect(records.flatMap(({ externalRequests }) => externalRequests)).toEqual([]);
    expect(records.flatMap(({ pageErrors }) => pageErrors)).toEqual([]);
});
