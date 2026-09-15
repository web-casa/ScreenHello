const CODEC_BUDGETS = [
    { name: 'AVIF', pattern: /\/avif_enc-[^/]+\.wasm$/, bytes: 3_600_000, gzipBytes: 1_200_000 },
    { name: 'WebP', pattern: /\/webp_enc-[^/]+\.wasm$/, bytes: 300_000, gzipBytes: 130_000 },
    { name: 'PNG/Oxipng', pattern: /\/squoosh_oxipng_bg-[^/]+\.wasm$/, bytes: 180_000, gzipBytes: 85_000 },
];

export function validateCodecBudgets(target, assets) {
    const violations = [];
    if (assets.length !== CODEC_BUDGETS.length) {
        violations.push(`${target} must emit exactly one standalone AVIF, WebP and scalar PNG/Oxipng WASM asset, with no extra WASM.`);
    }
    for (const expected of CODEC_BUDGETS) {
        const matches = assets.filter(({ file }) => expected.pattern.test(file));
        if (matches.length !== 1) {
            violations.push(`${target} must emit exactly one standalone ${expected.name} WASM asset.`);
            continue;
        }
        const [asset] = matches;
        if (!Number.isFinite(asset.bytes) || !Number.isFinite(asset.gzipBytes)
            || asset.bytes <= 0 || asset.gzipBytes <= 0 || asset.bytes > expected.bytes || asset.gzipBytes > expected.gzipBytes) {
            violations.push(`${target} ${expected.name} WASM exceeds its budget or has invalid size (${expected.bytes} raw / ${expected.gzipBytes} gzip bytes).`);
        }
    }
    return violations;
}
