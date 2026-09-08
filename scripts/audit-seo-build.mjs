import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { createSiteArtifacts, SITE_LANGUAGES, SITE_TOPICS, pagePath } from '../site/site.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.resolve(root, process.env.SCREENHELLO_SEO_OUT_DIR || 'dist');
const site = createSiteArtifacts({ base: process.env.SCREENHELLO_BASE_PATH || '/',
    origin: process.env.SCREENHELLO_SITE_ORIGIN || 'https://screenhello.com',
    indexable: process.env.SCREENHELLO_SITE_INDEXABLE !== 'false' });
const failures = [];
const check = (condition, code) => { if (!condition) failures.push(code); };
const read = filename => readFile(path.join(output, filename), 'utf8');
const attributes = (html, name) => [...html.matchAll(new RegExp(`\\b${name}="([^"]*)"`, 'g'))].map(match => match[1].replaceAll('&amp;', '&'));
let pageBytes = 0;
for (const [filename, expected] of site.artifacts) {
    const actual = await read(filename);
    check(actual === expected, `stale-generated-file:${filename}`);
    if (!filename.endsWith('/index.html')) continue;
    pageBytes += Buffer.byteLength(actual);
    check((actual.match(/<h1>/g) || []).length === 1, `h1:${filename}`);
    check((actual.match(/rel="canonical"/g) || []).length === 1, `canonical:${filename}`);
    check((actual.match(/rel="alternate"/g) || []).length === 8, `hreflang:${filename}`);
    check((actual.match(/<script/g) || []).length === 1 && actual.includes('type="application/ld+json"'), `runtime-script:${filename}`);
    check(!/googletagmanager|google-analytics|fonts.googleapis|\/home\/|__shoteasy/.test(actual), `private-or-tracking:${filename}`);
    const schema = JSON.parse(actual.match(/<script type="application\/ld\+json">([^]*?)<\/script>/)[1]);
    check(schema['@graph'].some(item => item['@type'] === 'WebApplication' && item.name === 'ScreenHello'), `schema:${filename}`);
    for (const reference of [...attributes(actual, 'href'), ...attributes(actual, 'src')]) {
        if (!reference.startsWith(site.options.base)) continue;
        const url = new URL(reference, site.options.origin);
        let local = url.pathname.slice(site.options.base.length);
        if (!local || local.endsWith('/')) local += 'index.html';
        check(Boolean(await stat(path.join(output, local)).catch(() => null)), `broken-link:${filename}:${reference}`);
    }
}
const index = await read('index.html');
check(!index.includes('SCREENHELLO_SEO_'), 'root-unprocessed-markers');
check((index.match(/rel="canonical"/g) || []).length === 1, 'root-canonical');
check(index.includes(`<link rel="canonical" href="${site.options.origin}${site.options.base}">`), 'root-canonical-base');
check(index.includes(site.options.indexable ? 'index,follow,max-image-preview:large' : 'noindex,follow'), 'root-indexability');
for (const slug of SITE_LANGUAGES) check(index.includes(`href="${pagePath(site.options.base, slug)}"`), `root-discovery:${slug}`);
const sitemap = await read('sitemap.xml');
check((sitemap.match(/<loc>/g) || []).length === (site.options.indexable ? 43 : 0), 'sitemap-count');
const social = PNG.sync.read(await readFile(path.join(output, 'site/social.png')));
check(social.width === 1200 && social.height === 630, 'social-dimensions');
const css = await stat(path.join(output, 'site/site.css'));
check(css.size < 12_000, 'content-css-budget');
const images = await Promise.all(['before.svg', 'after.svg', 'social.png'].map(name => stat(path.join(output, 'site', name))));
check(images.every(file => file.size < 250_000), 'content-image-budget');
console.log(JSON.stringify({ output, pages: SITE_LANGUAGES.length * SITE_TOPICS.length, pageBytes, cssBytes: css.size,
    indexable: site.options.indexable, failures }, null, 2));
if (failures.length) process.exitCode = 1;
