import { describe, expect, it } from 'vitest';
import { inspectBinaryHeader } from '../../scripts/inspect-desktop-artifacts.mjs';

const elf = (machine) => {
    const buffer = Buffer.alloc(64);
    buffer.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
    buffer.writeUInt16LE(machine, 18);
    return buffer;
};

const machO = (cpuType) => {
    const buffer = Buffer.alloc(64);
    buffer.writeUInt32LE(0xfeedfacf, 0);
    buffer.writeUInt32LE(cpuType, 4);
    return buffer;
};

const pe = (machine) => {
    const buffer = Buffer.alloc(256);
    buffer.set([0x4d, 0x5a]);
    buffer.writeUInt32LE(128, 0x3c);
    buffer.write('PE\0\0', 128, 'ascii');
    buffer.writeUInt16LE(machine, 132);
    return buffer;
};

describe('desktop artifact binary inspection', () => {
    it.each([
        [elf(0x3e), { format: 'elf', architecture: 'x86_64' }],
        [elf(0xb7), { format: 'elf', architecture: 'arm64' }],
        [machO(0x0100000c), { format: 'mach-o', architecture: 'arm64' }],
        [pe(0x8664), { format: 'pe', architecture: 'x86_64' }],
    ])('recognizes a supported native executable', (buffer, expected) => {
        expect(inspectBinaryHeader(buffer)).toEqual(expected);
    });

    it('rejects an unsupported or malformed executable', () => {
        expect(() => inspectBinaryHeader(Buffer.alloc(64))).toThrowError('desktop-binary-format-unsupported');
        expect(() => inspectBinaryHeader(Buffer.from('MZ'))).toThrowError('desktop-binary-header-too-short');
    });
});
