import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Derived raster of our code-native SVG, not a third-party screenshot.
const svg = await readFile(new URL('../public/site/social.svg', import.meta.url), 'utf8');
if (/<(?:script|image|foreignObject)\b|\bon\w+=|href=/i.test(svg)) throw new Error('site-social-external-resource');
const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await page.route('**/*', route => route.abort());
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    await page.screenshot({ path: fileURLToPath(new URL('../public/site/social.png', import.meta.url)) });
} finally { await browser.close(); }
