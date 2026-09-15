import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const desktopCodecArtifacts = Object.freeze([
    {
        id: 'avif',
        worker: /^avifEncoder\.worker-[A-Za-z0-9_-]+\.js$/u,
        wasm: /^avif_enc-[A-Za-z0-9_-]+\.wasm$/u,
        wasmBytes: [1_000_000, 8_000_000],
    },
    {
        id: 'webp',
        worker: /^webpEncoder\.worker-[A-Za-z0-9_-]+\.js$/u,
        wasm: /^webp_enc-[A-Za-z0-9_-]+\.wasm$/u,
        wasmBytes: [80_000, 1_000_000],
    },
    {
        id: 'png',
        worker: /^pngEncoder\.worker-[A-Za-z0-9_-]+\.js$/u,
        wasm: /^squoosh_oxipng_bg-[A-Za-z0-9_-]+\.wasm$/u,
        wasmBytes: [30_000, 1_000_000],
    },
]);

const exactlyOne = (names, matcher) => names.filter((name) => matcher.test(name));

export async function auditDesktopCodecAssets(assetsDirectory) {
    const failures = [];
    const entries = await readdir(assetsDirectory, { withFileTypes: true }).catch(() => null);
    if (!entries) return { assetsDirectory, codecs: [], failures: ['desktop-codec-assets-missing'] };
    const names = entries.filter((entry) => entry.isFile()).map(({ name }) => name);
    const codecs = [];

    for (const specification of desktopCodecArtifacts) {
        const workers = exactlyOne(names, specification.worker);
        const wasmFiles = exactlyOne(names, specification.wasm);
        if (workers.length !== 1) failures.push(`desktop-codec-worker-invalid:${specification.id}`);
        if (wasmFiles.length !== 1) failures.push(`desktop-codec-wasm-invalid:${specification.id}`);
        if (workers.length !== 1 || wasmFiles.length !== 1) continue;

        const [worker, wasm] = [workers[0], wasmFiles[0]];
        const [workerSource, wasmDetails] = await Promise.all([
            readFile(path.join(assetsDirectory, worker), 'utf8').catch(() => null),
            stat(path.join(assetsDirectory, wasm)).catch(() => null),
        ]);
        const [minimumBytes, maximumBytes] = specification.wasmBytes;
        if (typeof workerSource !== 'string' || !workerSource.includes(wasm)) {
            failures.push(`desktop-codec-worker-wasm-link-missing:${specification.id}`);
        }
        if (!wasmDetails || !wasmDetails.isFile() || wasmDetails.size < minimumBytes || wasmDetails.size > maximumBytes) {
            failures.push(`desktop-codec-wasm-size-invalid:${specification.id}`);
        }
        codecs.push({ id: specification.id, worker, wasm, wasmBytes: wasmDetails?.size ?? 0 });
    }

    return { assetsDirectory, codecs, failures };
}

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const root = process.cwd();
    const distDirectory = path.resolve(root, process.env.SCREENHELLO_DESKTOP_DIST || 'dist-desktop');
    const result = await auditDesktopCodecAssets(path.join(distDirectory, 'assets'));
    console.log(JSON.stringify({
        status: result.failures.length ? 'failed' : 'passed',
        directory: path.relative(root, result.assetsDirectory) || '.',
        codecs: result.codecs,
        failures: result.failures,
    }, null, 2));
    if (result.failures.length) process.exitCode = 1;
}
