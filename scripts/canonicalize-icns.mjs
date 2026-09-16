// Tauri emits the same ICNS image chunks in nondeterministic map order. Keep
// every payload byte, but give the container a stable order for reproducibility.
const TYPES = ['is32', 's8mk', 'il32', 'l8mk', 'ic07', 'ic08', 'ic09', 'ic10', 'ic11', 'ic12', 'ic13', 'ic14'];

export const canonicalizeIcns = bytes => {
    if (!Buffer.isBuffer(bytes) || bytes.length < 8 || bytes.toString('ascii', 0, 4) !== 'icns'
        || bytes.readUInt32BE(4) !== bytes.length) throw new Error('invalid-icns-header');
    const chunks = new Map();
    for (let offset = 8; offset < bytes.length;) {
        if (offset + 8 > bytes.length) throw new Error('invalid-icns-chunk');
        const type = bytes.toString('ascii', offset, offset + 4);
        const length = bytes.readUInt32BE(offset + 4);
        if (length <= 8 || offset + length > bytes.length || !TYPES.includes(type) || chunks.has(type)) {
            throw new Error('invalid-icns-chunk');
        }
        chunks.set(type, bytes.subarray(offset, offset + length));
        offset += length;
    }
    if (!chunks.size) throw new Error('empty-icns');
    return Buffer.concat([bytes.subarray(0, 8), ...TYPES.filter(type => chunks.has(type)).map(type => chunks.get(type))]);
};
