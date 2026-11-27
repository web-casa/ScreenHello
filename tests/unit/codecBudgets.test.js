import { expect, it } from 'vitest';
import { validateCodecBudgets } from '../../config/codecBudgets.mjs';

const assets = [
    { file: 'dist/assets/avif_enc-hash.wasm', bytes: 3_485_872, gzipBytes: 1_128_053 },
    { file: 'dist/assets/webp_enc-hash.wasm', bytes: 281_261, gzipBytes: 114_971 },
    { file: 'dist/assets/squoosh_oxipng_bg-hash.wasm', bytes: 164_172, gzipBytes: 76_146 },
];
it('accepts exactly the three approved scalar codec assets in Web and library builds', () => {
    expect(validateCodecBudgets('Web', assets)).toEqual([]);
    expect(validateCodecBudgets('Library', assets.map(asset => ({ ...asset, file: asset.file.replace('dist/', 'lib/') })))).toEqual([]);
});
it('rejects missing, duplicate or extra WASM rather than allowing arbitrary third codecs', () => {
    expect(validateCodecBudgets('Web', assets.slice(0, 2)).join()).toContain('PNG/Oxipng');
    expect(validateCodecBudgets('Web', [...assets, assets[2]]).join()).toContain('exactly one');
    expect(validateCodecBudgets('Web', [...assets, { ...assets[2], file: 'dist/assets/extra.wasm' }]).join()).toContain('no extra WASM');
});
it.each([{ bytes: 180_001 }, { gzipBytes: 85_001 }, { bytes: NaN }, { gzipBytes: 0 }])('rejects invalid/over-budget Oxipng sizes: %j', change => {
    expect(validateCodecBudgets('Web', [...assets.slice(0, 2), { ...assets[2], ...change }]).join()).toContain('PNG/Oxipng WASM exceeds');
});
