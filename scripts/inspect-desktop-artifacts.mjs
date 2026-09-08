import { execFile } from 'node:child_process';
import { lstat, mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const inspectBinaryHeader = (buffer) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 64) throw new Error('desktop-binary-header-too-short');
    if (buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
        if (buffer[4] !== 2 || buffer[5] !== 1) throw new Error('desktop-elf-format-unsupported');
        const machine = buffer.readUInt16LE(18);
        const architecture = ({ 0x3e: 'x86_64', 0xb7: 'arm64' })[machine];
        if (!architecture) throw new Error(`desktop-elf-architecture-unsupported:${machine}`);
        return { format: 'elf', architecture };
    }
    if (buffer.readUInt32LE(0) === 0xfeedfacf) {
        const cpuType = buffer.readUInt32LE(4);
        const architecture = ({ 0x01000007: 'x86_64', 0x0100000c: 'arm64' })[cpuType];
        if (!architecture) throw new Error(`desktop-mach-o-architecture-unsupported:${cpuType}`);
        return { format: 'mach-o', architecture };
    }
    if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
        const peOffset = buffer.readUInt32LE(0x3c);
        if (peOffset < 0x40 || peOffset + 6 > buffer.length
            || buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
            throw new Error('desktop-pe-header-invalid');
        }
        const machine = buffer.readUInt16LE(peOffset + 4);
        const architecture = ({ 0x8664: 'x86_64', 0xaa64: 'arm64' })[machine];
        if (!architecture) throw new Error(`desktop-pe-architecture-unsupported:${machine}`);
        return { format: 'pe', architecture };
    }
    throw new Error('desktop-binary-format-unsupported');
};

const readBinaryHeader = async (absolute) => {
    const handle = await open(absolute, 'r');
    try {
        const buffer = Buffer.alloc(4_096);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return inspectBinaryHeader(buffer.subarray(0, bytesRead));
    } finally {
        await handle.close();
    }
};

const runText = async (command, args, cwd) => {
    const { stdout, stderr } = await execFileAsync(command, args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
    });
    return `${stdout}${stderr}`.trim();
};

const execute = async () => {
    const root = await realpath(process.cwd());
    const matrix = JSON.parse(await readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8'));
    const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
    const target = matrix.targets.find(({ id }) => id === process.env.SCREENHELLO_DESKTOP_TARGET);
    const candidateSha = process.env.SCREENHELLO_RELEASE_CANDIDATE;
    if (!target) throw new Error('desktop-artifact-target-invalid');
    if (!/^[0-9a-f]{40}$/u.test(candidateSha || '')) throw new Error('desktop-artifact-candidate-invalid');
    if (process.platform !== target.nodePlatform || process.arch !== target.arch) {
        throw new Error('desktop-artifact-host-mismatch');
    }
    if (await runText('git', ['rev-parse', 'HEAD'], root) !== candidateSha) {
        throw new Error('desktop-artifact-checkout-mismatch');
    }

    const repositoryEntry = async (value, type, id) => {
        if (!value) throw new Error(`${id}-missing`);
        const requested = path.resolve(root, value);
        const requestedDetails = await lstat(requested);
        if (requestedDetails.isSymbolicLink()) throw new Error(`${id}-symlink-forbidden`);
        const absolute = await realpath(requested);
        const relative = path.relative(root, absolute);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${id}-outside-repository`);
        const details = await lstat(absolute);
        if ((type === 'file' && !details.isFile()) || (type === 'directory' && !details.isDirectory())) {
            throw new Error(`${id}-type-invalid`);
        }
        return absolute;
    };

    const binary = await repositoryEntry(process.env.SCREENHELLO_DESKTOP_BINARY, 'file', 'desktop-binary');
    const bundle = await repositoryEntry(process.env.SCREENHELLO_DESKTOP_BUNDLE, 'file', 'desktop-bundle');
    const binaryHeader = await readBinaryHeader(binary);
    if (binaryHeader.format !== target.binaryFormat || binaryHeader.architecture !== target.binaryArchitecture) {
        throw new Error('desktop-binary-target-mismatch');
    }

    const packageResult = {
        kind: target.bundleKind,
        channel: target.channel,
        identity: target.packageIdentity,
        identitySource: target.packageIdentitySource,
        version: config.version,
        architecture: target.packageArchitecture,
        payloadVerified: false,
    };

    if (target.platform === 'linux') {
        const [identity, version, architecture, contents] = await Promise.all([
            runText('dpkg-deb', ['--field', bundle, 'Package'], root),
            runText('dpkg-deb', ['--field', bundle, 'Version'], root),
            runText('dpkg-deb', ['--field', bundle, 'Architecture'], root),
            runText('dpkg-deb', ['--contents', bundle], root),
        ]);
        if (identity !== target.packageIdentity || version !== config.version
            || architecture !== target.packageArchitecture
            || !/(?:^|\s)usr\/bin\/screenhello-desktop(?:\s|$)/mu.test(contents)) {
            throw new Error('desktop-deb-contents-invalid');
        }
        packageResult.payloadVerified = true;
    } else if (target.platform === 'macos') {
        const application = await repositoryEntry(process.env.SCREENHELLO_DESKTOP_APP_BUNDLE, 'directory', 'desktop-app-bundle');
        const infoPlist = path.join(application, 'Contents', 'Info.plist');
        const appBinary = path.join(application, 'Contents', 'MacOS', 'screenhello-desktop');
        await Promise.all([lstat(infoPlist), lstat(appBinary)]);
        const [identity, version, executable, archiveEntries] = await Promise.all([
            runText('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', infoPlist], root),
            runText('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', infoPlist], root),
            runText('plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', infoPlist], root),
            runText('unzip', ['-Z1', bundle], root),
        ]);
        const appHeader = await readBinaryHeader(appBinary);
        const entries = archiveEntries.split(/\r?\n/u).filter(Boolean);
        if (identity !== target.packageIdentity || version !== config.version
            || executable !== 'screenhello-desktop'
            || appHeader.format !== target.binaryFormat || appHeader.architecture !== target.binaryArchitecture
            || entries.some((entry) => entry.startsWith('/') || entry.split('/').includes('..'))
            || !entries.some((entry) => entry.endsWith('/Contents/Info.plist'))
            || !entries.some((entry) => entry.endsWith('/Contents/MacOS/screenhello-desktop'))) {
            throw new Error('desktop-macos-app-contents-invalid');
        }
        packageResult.payloadVerified = true;
    } else if (target.platform === 'windows') {
        const listing = await runText('7z', ['l', '-slt', bundle], root);
        const expectedVersionFragment = `_${config.version}_x64-setup.exe`.toLowerCase();
        if (!path.basename(bundle).toLowerCase().endsWith(expectedVersionFragment)
            || !/^Type = Nsis$/mu.test(listing)
            || !/^Path = (?:.*[\\/])?screenhello-desktop\.exe\r?$/imu.test(listing)) {
            throw new Error('desktop-nsis-contents-invalid');
        }
        packageResult.payloadVerified = true;
    } else {
        throw new Error('desktop-artifact-platform-unsupported');
    }

    const output = path.resolve(
        root,
        process.env.SCREENHELLO_DESKTOP_ARTIFACT_INSPECTION
            || `artifacts/release/desktop-matrix/${target.id}/artifact-inspection.json`,
    );
    const relativeOutput = path.relative(root, output);
    if (!relativeOutput || relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) {
        throw new Error('desktop-artifact-inspection-output-invalid');
    }
    const report = {
        schemaVersion: 1,
        candidateSha,
        target: target.id,
        application: {
            productName: config.productName,
            identifier: config.identifier,
            version: config.version,
        },
        binary: binaryHeader,
        package: packageResult,
    };
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ ...report, report: relativeOutput }, null, 2));
};

const isCli = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) await execute();
