import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { auditDesktopCodecAssets } from '../../scripts/audit-desktop-codecs.mjs';

const temporaryDirectories = [];
const codecFixtures = [
    ['avifEncoder.worker-a.js', 'avif_enc-a.wasm', 1_000_000],
    ['webpEncoder.worker-a.js', 'webp_enc-a.wasm', 80_000],
    ['pngEncoder.worker-a.js', 'squoosh_oxipng_bg-a.wasm', 30_000],
];

const createAssets = async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'screenhello-desktop-codecs-'));
    temporaryDirectories.push(directory);
    await Promise.all(codecFixtures.flatMap(([worker, wasm, bytes]) => [
        writeFile(path.join(directory, worker), `new URL('${wasm}', self.location.href);\n`, 'utf8'),
        writeFile(path.join(directory, wasm), Buffer.alloc(bytes)),
    ]));
    return directory;
};

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('desktop codec asset audit', () => {
    it('accepts one linked scalar Worker and WASM binary for each codec', async () => {
        const result = await auditDesktopCodecAssets(await createAssets());
        expect(result.failures).toEqual([]);
        expect(result.codecs.map(({ id }) => id)).toEqual(['avif', 'webp', 'png']);
    });

    it('rejects a Worker whose bundled WASM reference is missing', async () => {
        const directory = await createAssets();
        await writeFile(path.join(directory, 'webpEncoder.worker-a.js'), 'self.onmessage = () => {};\n', 'utf8');
        const result = await auditDesktopCodecAssets(directory);
        expect(result.failures).toContain('desktop-codec-worker-wasm-link-missing:webp');
    });

    it('rejects a truncated bundled WASM file', async () => {
        const directory = await createAssets();
        await writeFile(path.join(directory, 'squoosh_oxipng_bg-a.wasm'), Buffer.alloc(1));
        const result = await auditDesktopCodecAssets(directory);
        expect(result.failures).toContain('desktop-codec-wasm-size-invalid:png');
    });
});
