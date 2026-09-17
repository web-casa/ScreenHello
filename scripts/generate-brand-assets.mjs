import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { canonicalizeIcns } from './canonicalize-icns.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const cli = require.resolve('@tauri-apps/cli/tauri.js');
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    throw new Error('brand-assets-usage: node scripts/generate-brand-assets.mjs [--check]');
}
const check = args[0] === '--check';
const source = await readFile(path.join(root, 'src/assets/logo.svg'), 'utf8');
// Imported Web icons are reviewed, byte-pinned outputs of the supplied logo,
// not outputs of the Tauri renderer. Never overwrite or silently regenerate them.
const webIcons = JSON.parse(await readFile(path.join(root, 'config/webIconAssets.json'), 'utf8'));
if (createHash('sha256').update(source).digest('hex') !== webIcons.sourceLogoSha256) {
    throw new Error('web-icons-source-changed: review and regenerate the imported Web icon pack');
}
for (const [filename, expected] of Object.entries(webIcons.files)) {
    const bytes = await readFile(path.join(root, 'public', filename));
    if (createHash('sha256').update(bytes).digest('hex') !== expected) {
        throw new Error(`web-icons-content-changed:${filename}`);
    }
}
if (!source.startsWith('<svg ')
    || /<(?:script|foreignObject|image|style)\b|\bon\w+\s*=|\b(?:href|xlink:href)\s*=/i.test(source)) {
    throw new Error('brand-source-must-be-reviewed-static-svg');
}
const viewBox = source.match(/viewBox="([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+)"/);
if (!viewBox) throw new Error('brand-source-must-be-reviewed-static-svg');
const [, minX, minY, viewWidth, viewHeight] = viewBox.map(Number);
// The supplied mark keeps the generator's own square viewport: the artwork is
// centred in 0..1024 and already carries its visible padding, so the compact
// render uses the source viewport as-is.
const compact = source;
// Maskable icons keep an opaque theme base. Android guarantees only the central
// safe circle, while this mark is round and reaches r=0.579 of the viewport at
// its bounding corners. Scale it about the viewport centre so no artwork pixel
// lands outside the safe radius; the box is squared so the mark stays round.
const SAFE_RADIUS_RATIO = 0.4;
const MARK_CORNER_RADIUS_RATIO = 0.579;
const maskableScale = SAFE_RADIUS_RATIO / MARK_CORNER_RADIUS_RATIO;
const centerX = minX + viewWidth / 2;
const centerY = minY + viewHeight / 2;
const maskable = source.replace(/(<svg\b[^>]*>)/,
    `$1\n<rect x="${minX}" y="${minY}" width="${viewWidth}" height="${viewHeight}" fill="#111318"/>`
    + `\n<g transform="translate(${centerX} ${centerY}) scale(${maskableScale}) translate(${-centerX} ${-centerY})">`)
    .replace(/<\/svg>\s*$/, '</g>\n</svg>');
const desktopFiles = [
    '32x32.png', '64x64.png', '128x128.png', '128x128@2x.png', 'icon.png', 'icon.ico', 'icon.icns',
    'StoreLogo.png', 'Square30x30Logo.png', 'Square44x44Logo.png', 'Square71x71Logo.png',
    'Square89x89Logo.png', 'Square107x107Logo.png', 'Square142x142Logo.png',
    'Square150x150Logo.png', 'Square284x284Logo.png', 'Square310x310Logo.png',
];
const scratch = await mkdtemp(path.join(tmpdir(), 'screenhello-brand-assets-'));
const generated = new Map();
try {
    const compactPath = path.join(scratch, 'compact.svg');
    const maskablePath = path.join(scratch, 'maskable.svg');
    await writeFile(compactPath, compact);
    await writeFile(maskablePath, maskable);
    const render = (input, output, size) => {
        const command = [cli, 'icon', input, '--output', output];
        if (size) command.push('--png', String(size));
        const result = spawnSync(process.execPath, command, {
            // Never let automatic mobile project discovery touch this repo.
            cwd: scratch, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
        });
        if (result.error || result.status !== 0) {
            throw new Error(`brand-render-failed:${result.error?.message || result.stderr || result.stdout}`);
        }
    };
    const desktop = path.join(scratch, 'desktop');
    render(compactPath, desktop);
    for (const name of desktopFiles) {
        const bytes = await readFile(path.join(desktop, name));
        generated.set(`src-tauri/icons/${name}`, name.endsWith('.icns') ? canonicalizeIcns(bytes) : bytes);
    }
    generated.set('src/assets/logo.png', generated.get('src-tauri/icons/icon.png'));
    generated.set('src/assets/favicon.png', generated.get('src-tauri/icons/32x32.png'));
    generated.set('public/pwa-512x512.png', generated.get('src-tauri/icons/icon.png'));
    const any192 = path.join(scratch, 'any192');
    render(compactPath, any192, 192);
    generated.set('public/pwa-192x192.png', await readFile(path.join(any192, '192x192.png')));
    for (const size of [192, 512]) {
        const output = path.join(scratch, `maskable${size}`);
        render(maskablePath, output, size);
        const decoded = PNG.sync.read(await readFile(path.join(output, `${size}x${size}.png`)));
        // Preserve the existing PWA RGB (no alpha channel) contract.
        generated.set(`public/pwa-maskable-${size}x${size}.png`, PNG.sync.write(decoded, { colorType: 2 }));
    }
    // Render and read every required artifact before replacing any tracked file.
    const mismatches = [];
    for (const [name, bytes] of generated) {
        const destination = path.join(root, name);
        if (check) {
            const current = await readFile(destination).catch(error => {
                if (error.code === 'ENOENT') return null;
                throw error;
            });
            if (!current?.equals(bytes)) mismatches.push(name);
        } else {
            await mkdir(path.dirname(destination), { recursive: true });
            await writeFile(destination, bytes);
        }
    }
    console.log(JSON.stringify({
        mode: check ? 'check' : 'generate',
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        files: generated.size, importedWebIconsChecked: Object.keys(webIcons.files).length, mismatches,
    }, null, 2));
    if (mismatches.length) process.exitCode = 1;
} finally {
    // Remove only this invocation's exact mkdtemp output, never a repo or cache.
    await rm(scratch, { recursive: true, force: true });
}
