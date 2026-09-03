import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const libDir = path.join(root, 'lib');
const fail = (message) => { throw new Error(`pwa-library-audit:${message}`); };

const walk = (directory) => readdirSync(directory).flatMap((name) => {
    const target = path.join(directory, name);
    return statSync(target).isDirectory() ? walk(target) : [target];
});

const files = walk(libDir);
const basenames = files.map((file) => path.basename(file));
for (const forbidden of [
    /^sw\.js$/,
    /^manifest\.webmanifest$/,
    /^workbox-[\w-]+\.js$/,
    /^pwa-(?:maskable-)?(?:192x192|512x512)\.png$/,
]) {
    if (basenames.some((filename) => forbidden.test(filename))) fail(`artifact-${forbidden}`);
}

const forbiddenRuntimeMarkers = [
    'virtual:pwa-register',
    'manifest.webmanifest',
    'screenhello-runtime-assets',
    'workbox-window',
    'serviceWorker.register',
];
for (const file of files.filter((filename) => /\.(?:js|css|d\.ts)$/.test(filename))) {
    const source = readFileSync(file, 'utf8');
    for (const marker of forbiddenRuntimeMarkers) {
        if (source.includes(marker)) fail(`runtime-${marker}-${path.relative(libDir, file)}`);
    }
}

console.log(JSON.stringify({
    files: files.length,
    pwaArtifacts: 0,
    pwaRuntimeMarkers: 0,
}, null, 2));
