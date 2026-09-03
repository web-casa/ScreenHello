import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
});

function crc32(buffer) {
    let value = 0xffffffff;
    for (const byte of buffer) {
        value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
    }
    return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
    const name = Buffer.from(type, 'ascii');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, checksum]);
}

export function createPngFixture(width = 64, height = 48) {
    const scanlines = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y += 1) {
        const row = y * (width * 4 + 1);
        scanlines[row] = 0;
        for (let x = 0; x < width; x += 1) {
            const offset = row + 1 + x * 4;
            const alternate = (x < width / 2) !== (y < height / 2);
            scanlines[offset] = alternate ? 0x16 : 0xe8;
            scanlines[offset + 1] = alternate ? 0x66 : 0x3b;
            scanlines[offset + 2] = alternate ? 0xff : 0x46;
            scanlines[offset + 3] = 0xff;
        }
    }

    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;

    return Buffer.concat([
        PNG_SIGNATURE,
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(scanlines)),
        chunk('IEND'),
    ]);
}
