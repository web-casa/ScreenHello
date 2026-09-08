import assert from 'node:assert/strict';

export const COMPRESSION_SCOPE = 'foreground-compression-download/v1';
export const compressionCases = () => [
    { id: 'small-avif-lossy', fixture: 'small', format: 'avif', compression: 'lossy', ratio: 1 },
    { id: 'small-png-2x', fixture: 'small', format: 'png', compression: 'lossless', ratio: 2 },
    { id: 'small-png-preview', fixture: 'small', format: 'png', compression: 'lossy', ratio: 1, preview: true },
    ...[['png', 'lossless'], ['png', 'lossy'], ['webp', 'lossless'], ['webp', 'lossy'], ['jpg', 'lossy']]
        .map(([format, compression]) => ({ id: `pc-${format}-${compression}`, fixture: 'pc', format, compression, ratio: 1 })),
].map(specification => ({ ...specification, ...(specification.compression === 'lossy'
    ? specification.format === 'png' ? { paletteColors: 256 } : { quality: specification.format === 'avif' ? 60 : 90 }
    : {}) }));

export function validateCompressionResult(result, specification) {
    for (const key of ['id', 'fixture', 'format', 'compression', 'ratio']) assert.equal(result[key], specification[key], key);
    for (const key of ['quality', 'paletteColors']) if (specification[key] !== undefined) assert.equal(result[key], specification[key], key);
    const { width, height, decoded, type, size, hex } = result;
    assert.ok(Number.isInteger(width) && width > 0 && width <= 8192);
    assert.ok(Number.isInteger(height) && height > 0 && height <= 8192);
    const pixels = width * height;
    assert.ok(pixels <= (specification.fixture === 'pc' ? 4_194_304 : 1_048_576));
    if (specification.fixture === 'pc') assert.ok(pixels > 1_048_576, 'PC fixture must exercise the restored budget');
    assert.equal(decoded?.width, width, 'decoded width');
    assert.equal(decoded?.height, height, 'decoded height');
    assert.equal(type, `image/${specification.format === 'jpg' ? 'jpeg' : specification.format}`);
    assert.ok(Number.isFinite(size) && size > 0);
    const signature = { png: '89504e470d0a1a0a', jpg: 'ffd8ff', webp: '52494646', avif: '6674797061766966' };
    assert.ok(specification.format === 'avif' ? hex?.slice(8, 24) === signature.avif : hex?.startsWith(signature[specification.format]));
    if (specification.format === 'webp') assert.equal(hex?.slice(16, 24), '57454250');
    assert.equal(result.visibility, 'visible');
    assert.equal(result.focused, true);
    assert.ok(Number.isFinite(result.durationMs) && result.durationMs >= 0);
    assert.equal(result.editorSurvived, true);
    if (specification.fixture === 'small' && specification.format === 'png') assert.equal(decoded.corner?.[3], 0, 'transparent PNG corner');
    if (specification.preview) {
        assert.equal(result.previewBytes, size);
        assert.equal(result.previewBlobReused, true);
    }
}

export function validateCompressionEvidence(evidence) {
    assert.equal(evidence?.scope, COMPRESSION_SCOPE);
    assert.deepEqual(evidence.registration?.cases, compressionCases(), 'registered case list');
    assert.equal(evidence.registration?.attemptsPerCase, 1);
    assert.equal(evidence.registration?.memoryMeasurement, false);
    assert.ok(Number.isFinite(Date.parse(evidence.registration?.registeredAt)));
    for (const fixture of ['small', 'pc']) assert.match(evidence.registration?.fixtureSha256?.[fixture] || '', /^[a-f0-9]{64}$/);
    assert.equal(evidence.status, 'passed');
    assert.equal(evidence.results?.length, compressionCases().length);
    compressionCases().forEach((specification, index) => validateCompressionResult(evidence.results[index], specification));
    assert.deepEqual(evidence.largeAvifRejection, { lossyDisabled: true, standardEnabled: true, previewDisabled: true, noDownload: true });
}
