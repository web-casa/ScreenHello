import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { desktopPackageChannel, inspectBinaryHeader } from '../../scripts/inspect-desktop-artifacts.mjs';

const matrix = JSON.parse(await readFile(new URL('../../config/desktop-release-matrix.json', import.meta.url), 'utf8'));

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

const fatMachO = (...cpuTypes) => {
    const buffer = Buffer.alloc(64);
    buffer.writeUInt32BE(0xcafebabe, 0);
    buffer.writeUInt32BE(cpuTypes.length, 4);
    cpuTypes.forEach((cpuType, index) => buffer.writeUInt32BE(cpuType, 8 + index * 20));
    return buffer;
};

describe('desktop artifact binary inspection', () => {
    it.each([
        [elf(0x3e), { format: 'elf', architecture: 'x86_64' }],
        [elf(0xb7), { format: 'elf', architecture: 'arm64' }],
        [machO(0x01000007), { format: 'mach-o', architecture: 'x86_64' }],
        [machO(0x0100000c), { format: 'mach-o', architecture: 'arm64' }],
        [pe(0x8664), { format: 'pe', architecture: 'x86_64' }],
        [pe(0xaa64), { format: 'pe', architecture: 'arm64' }],
        [fatMachO(0x01000007, 0x0100000c), { format: 'mach-o', architecture: 'universal', architectures: ['x86_64', 'arm64'] }],
    ])('recognizes a supported native executable', (buffer, expected) => {
        expect(inspectBinaryHeader(buffer)).toEqual(expected);
    });

    it('rejects an unsupported or malformed executable', () => {
        expect(() => inspectBinaryHeader(Buffer.alloc(64))).toThrowError('desktop-binary-format-unsupported');
        expect(() => inspectBinaryHeader(Buffer.from('MZ'))).toThrowError('desktop-binary-header-too-short');
        expect(() => inspectBinaryHeader(fatMachO(0x01000007, 0x12345678))).toThrowError('desktop-mach-o-architecture-unsupported:305419896');
    });

    it('only permits each declared signed candidate channel for its target', () => {
        const macosArm64 = matrix.targets.find(({ id }) => id === 'macos-arm64');
        const macosX64 = matrix.targets.find(({ id }) => id === 'macos-x64');
        const linuxX64 = matrix.targets.find(({ id }) => id === 'linux-x64');
        const linuxArm64 = matrix.targets.find(({ id }) => id === 'linux-arm64');
        const windowsX64 = matrix.targets.find(({ id }) => id === 'windows-x64');
        const windowsArm64 = matrix.targets.find(({ id }) => id === 'windows-arm64');
        expect(desktopPackageChannel(matrix, macosArm64)).toBe('github-actions-unsigned-test');
        expect(desktopPackageChannel(
            matrix,
            macosArm64,
            'github-actions-macos-signed-candidate',
        )).toBe('github-actions-macos-signed-candidate');
        expect(desktopPackageChannel(
            matrix,
            macosX64,
            'github-actions-macos-intel-signed-candidate',
        )).toBe('github-actions-macos-intel-signed-candidate');
        expect(desktopPackageChannel(
            matrix,
            windowsX64,
            'github-actions-windows-signed-candidate',
        )).toBe('github-actions-windows-signed-candidate');
        expect(desktopPackageChannel(
            matrix,
            windowsArm64,
            'github-actions-windows-arm64-signed-candidate',
        )).toBe('github-actions-windows-arm64-signed-candidate');
        expect(desktopPackageChannel(
            matrix,
            linuxX64,
            'github-actions-linux-deb-repository-signed-candidate',
        )).toBe('github-actions-linux-deb-repository-signed-candidate');
        expect(desktopPackageChannel(
            matrix,
            linuxArm64,
            'github-actions-linux-deb-repository-signed-candidate',
        )).toBe('github-actions-linux-deb-repository-signed-candidate');
        expect(() => desktopPackageChannel(
            matrix,
            macosX64,
            'github-actions-macos-signed-candidate',
        )).toThrowError('desktop-artifact-package-channel-invalid');
        expect(() => desktopPackageChannel(
            matrix,
            macosArm64,
            'github-actions-macos-intel-signed-candidate',
        )).toThrowError('desktop-artifact-package-channel-invalid');
        expect(() => desktopPackageChannel(
            matrix,
            windowsX64,
            'github-actions-macos-signed-candidate',
        )).toThrowError('desktop-artifact-package-channel-invalid');
        expect(() => desktopPackageChannel(
            matrix,
            windowsX64,
            'github-actions-windows-arm64-signed-candidate',
        )).toThrowError('desktop-artifact-package-channel-invalid');
        expect(() => desktopPackageChannel(
            matrix,
            windowsArm64,
            'github-actions-windows-signed-candidate',
        )).toThrowError('desktop-artifact-package-channel-invalid');
        expect(() => desktopPackageChannel(
            matrix,
            macosArm64,
            'github-actions-linux-deb-repository-signed-candidate',
        )).toThrowError('desktop-artifact-package-channel-invalid');
        expect(() => desktopPackageChannel(matrix, macosArm64, 'unreviewed-channel'))
            .toThrowError('desktop-artifact-package-channel-invalid');
    });
});
