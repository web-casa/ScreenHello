import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { WEB_ICON_FILES, versionWebIconUrl } from './pwaConfig.js';

export const readWebIconVersions = (publicDirectory) => Object.fromEntries(WEB_ICON_FILES.map(filename => [
    filename, createHash('sha256').update(readFileSync(path.join(publicDirectory, filename))).digest('hex').slice(0, 12),
]));

export function versionWebIconHtml(html, versions) {
    return WEB_ICON_FILES.reduce((result, filename) => result.replaceAll(
        `href="%BASE_URL%${filename}"`, `href="%BASE_URL%${versionWebIconUrl(filename, versions)}"`,
    ), html);
}

export function webFaviconPlugin(publicDirectory, buildVersions) {
    let building = false;
    return {
        name: 'screenhello-web-favicon',
        configResolved(config) { building = config.command === 'build'; },
        transformIndexHtml: {
            order: 'pre',
            handler(html) {
                // Development reloads use current bytes; production shares the
                // same version snapshot as the generated manifest and Workbox.
                return versionWebIconHtml(html, building ? buildVersions : readWebIconVersions(publicDirectory));
            },
        },
    };
}

export function versionFaviconHtml(html, iconBytes) {
    const version = createHash('sha256').update(iconBytes).digest('hex').slice(0, 12);
    // Legacy source-asset references (now used by desktop); preserve relative paths.
    return html.replace(
        /(\bhref=["']\.\.?\/src\/assets\/favicon\.png)(["'])/g,
        `$1?v=${version}$2`,
    );
}

export function devFaviconPlugin(faviconPath) {
    return {
        name: 'screenhello-dev-favicon',
        // Production already fingerprints assets. Do not add query parameters
        // to its URLs: the PWA precache must keep matching those exact URLs.
        apply: 'serve',
        transformIndexHtml: {
            order: 'pre',
            handler(html) {
                // Read on each HTML request so replacing the icon takes effect
                // on reload without a config edit or a dev server restart.
                return versionFaviconHtml(html, readFileSync(faviconPath));
            },
        },
    };
}
