import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { candidateTargets } from './audit-desktop-release-contract.mjs';

const execFileAsync = promisify(execFile);
const maxPayloadFiles = 20_000;
const maxNativeBinaries = 256;

const machOArchitecture = (cpuType) => ({
    0x01000007: 'x86_64',
    0x0100000c: 'arm64',
})[cpuType];

const machOArchitectures = (buffer) => {
    const magic = buffer.readUInt32BE(0);
    if (magic !== 0xcafebabe && magic !== 0xcafebabf) return null;
    if (buffer.length < 8) throw new Error('desktop-mach-o-fat-header-too-short');
    const count = buffer.readUInt32BE(4);
    const entryBytes = magic === 0xcafebabf ? 32 : 20;
    if (!count || count > 16 || 8 + count * entryBytes > buffer.length) {
        throw new Error('desktop-mach-o-fat-header-invalid');
    }
    const architectures = [];
    for (let index = 0; index < count; index += 1) {
        const cpuType = buffer.readUInt32BE(8 + index * entryBytes);
        const architecture = machOArchitecture(cpuType);
        if (!architecture) throw new Error(`desktop-mach-o-architecture-unsupported:${cpuType}`);
        if (!architectures.includes(architecture)) architectures.push(architecture);
    }
    return architectures;
};

export const inspectBinaryHeader = (buffer) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 64) throw new Error('desktop-binary-header-too-short');
    if (buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
        if (buffer[4] !== 2 || buffer[5] !== 1) throw new Error('desktop-elf-format-unsupported');
        const machine = buffer.readUInt16LE(18);
        const architecture = ({ 0x3e: 'x86_64', 0xb7: 'arm64' })[machine];
        if (!architecture) throw new Error(`desktop-elf-architecture-unsupported:${machine}`);
        return { format: 'elf', architecture };
    }
    const fatArchitectures = machOArchitectures(buffer);
    if (fatArchitectures) {
        return fatArchitectures.length === 1
            ? { format: 'mach-o', architecture: fatArchitectures[0] }
            : { format: 'mach-o', architecture: 'universal', architectures: fatArchitectures };
    }
    if (buffer.readUInt32LE(0) === 0xfeedfacf) {
        const cpuType = buffer.readUInt32LE(4);
        const architecture = machOArchitecture(cpuType);
        if (!architecture) throw new Error(`desktop-mach-o-architecture-unsupported:${cpuType}`);
        return { format: 'mach-o', architecture };
    }
    if (buffer.readUInt32LE(0) === 0xfeedface) throw new Error('desktop-mach-o-format-unsupported');
    if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
        const peOffset = buffer.readUInt32LE(0x3c);
        if (peOffset < 0x40 || peOffset + 6 > buffer.length
            || buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
            throw new Error('desktop-pe-header-invalid');
        }
        const machine = buffer.readUInt16LE(peOffset + 4);
        const architecture = ({ 0x14c: 'x86', 0x8664: 'x86_64', 0xaa64: 'arm64' })[machine];
        if (!architecture) throw new Error(`desktop-pe-architecture-unsupported:${machine}`);
        return { format: 'pe', architecture };
    }
    throw new Error('desktop-binary-format-unsupported');
};

const nativeFileSignature = (buffer) => (
    buffer.length >= 4
    && (buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
        || buffer.readUInt32BE(0) === 0xcafebabe
        || buffer.readUInt32BE(0) === 0xcafebabf
        || buffer.readUInt32LE(0) === 0xfeedfacf
        || buffer.readUInt32LE(0) === 0xfeedface
        || (buffer[0] === 0x4d && buffer[1] === 0x5a))
);

const readNativeHeader = async (absolute) => {
    const handle = await open(absolute, 'r');
    try {
        const buffer = Buffer.alloc(4_096);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const header = buffer.subarray(0, bytesRead);
        return nativeFileSignature(header) ? inspectBinaryHeader(header) : null;
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

const relativePayloadPath = (payloadRoot, absolute) => {
    const relative = path.relative(payloadRoot, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('desktop-package-payload-path-invalid');
    }
    return relative.split(path.sep).join('/');
};

const collectRegularFiles = async (payloadRoot) => {
    const files = [];
    const visit = async (directory, depth) => {
        if (depth > 32) throw new Error('desktop-package-payload-depth-invalid');
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
            const absolute = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory()) {
                await visit(absolute, depth + 1);
            } else if (entry.isFile()) {
                files.push(absolute);
                if (files.length > maxPayloadFiles) throw new Error('desktop-package-payload-file-count-invalid');
            }
        }
    };
    await visit(payloadRoot, 0);
    return files.sort((left, right) => left.localeCompare(right, 'en'));
};

const assertPayloadRegularFile = async (payloadRoot, absolute, id) => {
    relativePayloadPath(payloadRoot, absolute);
    const details = await lstat(absolute);
    if (details.isSymbolicLink() || !details.isFile()) throw new Error(`${id}-invalid`);
    return absolute;
};

const headerSupportsTarget = (header, target) => (
    header.format === target.binaryFormat
    && (header.architecture === target.binaryArchitecture
        || header.architectures?.includes(target.binaryArchitecture))
);

const nativeBinaryRecord = (payloadRoot, absolute, header) => ({
    path: relativePayloadPath(payloadRoot, absolute),
    format: header.format,
    architecture: header.architecture,
    ...(header.architectures ? { architectures: header.architectures } : {}),
});

const inspectNativePayload = async ({ payloadRoot, primary, target, files }) => {
    const primaryFile = await assertPayloadRegularFile(payloadRoot, primary, 'desktop-package-primary-binary');
    const payloadFiles = files || await collectRegularFiles(payloadRoot);
    const nativeBinaries = [];
    for (const absolute of payloadFiles) {
        let header;
        try {
            header = await readNativeHeader(absolute);
        } catch (error) {
            throw new Error(`desktop-package-native-binary-invalid:${relativePayloadPath(payloadRoot, absolute)}:${error.message}`);
        }
        if (!header) continue;
        if (!headerSupportsTarget(header, target)) {
            throw new Error(`desktop-package-native-binary-target-mismatch:${relativePayloadPath(payloadRoot, absolute)}`);
        }
        nativeBinaries.push(nativeBinaryRecord(payloadRoot, absolute, header));
        if (nativeBinaries.length > maxNativeBinaries) throw new Error('desktop-package-native-binary-count-invalid');
    }
    const mainBinary = relativePayloadPath(payloadRoot, primaryFile);
    const primaryRecord = nativeBinaries.find(({ path: recordPath }) => recordPath === mainBinary);
    if (!primaryRecord
        || primaryRecord.format !== target.binaryFormat
        || primaryRecord.architecture !== target.binaryArchitecture) {
        throw new Error('desktop-package-primary-binary-target-mismatch');
    }
    return { mainBinary, nativeBinaries };
};

const withTemporaryDirectory = async (prefix, operation) => {
    const directory = await mkdtemp(path.join(tmpdir(), prefix));
    try {
        return await operation(directory);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
};

const inspectDebPayload = async ({ bundle, config, root, target }) => {
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
    return withTemporaryDirectory('screenhello-deb-', async (payloadRoot) => {
        await runText('dpkg-deb', ['--extract', bundle, payloadRoot], root);
        return inspectNativePayload({
            payloadRoot,
            primary: path.join(payloadRoot, 'usr', 'bin', 'screenhello-desktop'),
            target,
        });
    });
};

const findMacApplication = async (mountpoint, productName) => {
    const applications = (await readdir(mountpoint, { withFileTypes: true }))
        .filter((entry) => !entry.isSymbolicLink() && entry.isDirectory() && entry.name.endsWith('.app'));
    if (applications.length !== 1 || applications[0].name !== `${productName}.app`) {
        throw new Error('desktop-macos-app-contents-invalid');
    }
    return path.join(mountpoint, applications[0].name);
};

const inspectDmgPayload = async ({ bundle, config, root, target }) => withTemporaryDirectory(
    'screenhello-dmg-',
    async (mountpoint) => {
        // `hdiutil attach` can create the mount before returning a non-zero
        // exit code. Always try to detach this fresh, private mountpoint so a
        // failed inspection cannot leak a mounted image on the runner.
        try {
            await runText('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountpoint, bundle], root);
            const application = await findMacApplication(mountpoint, config.productName);
            const infoPlist = path.join(application, 'Contents', 'Info.plist');
            const [identity, version, executable] = await Promise.all([
                runText('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', infoPlist], root),
                runText('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', infoPlist], root),
                runText('plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', infoPlist], root),
            ]);
            if (identity !== target.packageIdentity || version !== config.version || executable !== 'screenhello-desktop') {
                throw new Error('desktop-macos-app-contents-invalid');
            }
            return inspectNativePayload({
                payloadRoot: application,
                primary: path.join(application, 'Contents', 'MacOS', executable),
                target,
            });
        } finally {
            await runText('hdiutil', ['detach', mountpoint], root)
                .catch(() => runText('hdiutil', ['detach', '-force', mountpoint], root))
                .catch(() => undefined);
        }
    },
);

const findWindowsMainBinary = (files) => {
    const matches = files.filter((absolute) => path.basename(absolute).toLowerCase() === 'screenhello-desktop.exe');
    if (matches.length !== 1) throw new Error('desktop-nsis-main-binary-invalid');
    return matches[0];
};

// Tauri CLI 2.11.4's NSIS template executes these plugins in its x86
// installer process. They are not DLLs loaded by the installed application.
const nsisPluginPaths = new Set([
    '$pluginsdir/nsdialogs.dll', '$pluginsdir/nsis_tauri_utils.dll',
    '$pluginsdir/system.dll', '$pluginsdir/nsisdl.dll', '$pluginsdir/langdll.dll',
]);
export const isNsisInstallerBinaryRecord = (record) => (
    typeof record?.path === 'string'
    && nsisPluginPaths.has(record.path.toLowerCase())
    && record.format === 'pe' && record.architecture === 'x86'
    && !record.architectures
);

export const inspectNsisExtractedPayload = async ({ payloadRoot, target }) => {
    const files = await collectRegularFiles(payloadRoot);
    const applicationFiles = [];
    const installerBinaries = [];
    for (const file of files) {
        const relative = relativePayloadPath(payloadRoot, file);
        if (nsisPluginPaths.has(relative.toLowerCase())) {
            const header = await readNativeHeader(file);
            if (!header) throw new Error('desktop-nsis-plugin-header-invalid');
            const record = nativeBinaryRecord(payloadRoot, file, header);
            if (!isNsisInstallerBinaryRecord(record)) throw new Error('desktop-nsis-plugin-architecture-invalid');
            installerBinaries.push(record);
        } else {
            // Unknown plugins and every application DLL retain target checks.
            applicationFiles.push(file);
        }
    }
    return {
        ...await inspectNativePayload({ payloadRoot, primary: findWindowsMainBinary(applicationFiles), target, files: applicationFiles }),
        installerBinaries,
    };
};

const inspectNsisPayload = async ({ bundle, config, root, target }) => {
    const listing = await runText('7z', ['l', '-slt', bundle], root);
    const expectedVersionFragment = `_${config.version}_${target.packageArchitecture}-setup.exe`.toLowerCase();
    if (!path.basename(bundle).toLowerCase().endsWith(expectedVersionFragment)
        || !/^Type = Nsis$/mu.test(listing)
        || !/^Path = (?:.*[\\/])?screenhello-desktop\.exe\r?$/imu.test(listing)) {
        throw new Error('desktop-nsis-contents-invalid');
    }
    return withTemporaryDirectory('screenhello-nsis-', async (payloadRoot) => {
        await runText('7z', ['x', '-y', `-o${payloadRoot}`, bundle], root);
        return inspectNsisExtractedPayload({ payloadRoot, target });
    });
};

export const desktopPackageChannel = (matrix, target, requestedChannel) => {
    if (!target) throw new Error('desktop-artifact-target-invalid');
    const channel = requestedChannel || target.channel;
    const signedCandidates = [
        matrix?.macosSigningCandidate,
        matrix?.macosIntelSigningCandidate,
        matrix?.windowsSigningCandidate,
        matrix?.windowsArm64SigningCandidate,
        matrix?.linuxDebRepositorySigningCandidate,
    ];
    if (channel !== target.channel
        && !signedCandidates.some((candidate) => (
            (Array.isArray(candidate?.targets) ? candidate.targets : [candidate?.target]).includes(target.id)
                && channel === candidate?.channel
        ))) {
        throw new Error('desktop-artifact-package-channel-invalid');
    }
    return channel;
};

const execute = async () => {
    const root = await realpath(process.cwd());
    const matrix = JSON.parse(await readFile(new URL('../config/desktop-release-matrix.json', import.meta.url), 'utf8'));
    const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    const scope = process.env.SCREENHELLO_DESKTOP_GATE_SCOPE || 'full';
    const target = candidateTargets(matrix, scope).find(({ id }) => id === process.env.SCREENHELLO_DESKTOP_TARGET);
    const candidateSha = process.env.SCREENHELLO_RELEASE_CANDIDATE;
    const packageChannel = desktopPackageChannel(
        matrix,
        target,
        process.env.SCREENHELLO_DESKTOP_PACKAGE_CHANNEL,
    );
    if (config.version !== packageJson.version) throw new Error('desktop-artifact-version-source-mismatch');
    if (!/^[0-9a-f]{40}$/u.test(candidateSha || '')) throw new Error('desktop-artifact-candidate-invalid');
    if (process.platform !== target.nodePlatform || process.arch !== target.arch) {
        throw new Error('desktop-artifact-host-mismatch');
    }
    if (await runText('git', ['rev-parse', 'HEAD'], root) !== candidateSha) {
        throw new Error('desktop-artifact-checkout-mismatch');
    }
    if (await runText('git', ['status', '--porcelain=v1', '--untracked-files=all'], root)) {
        throw new Error('desktop-artifact-working-tree-dirty');
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
    const binaryHeader = await readNativeHeader(binary);
    if (!binaryHeader || binaryHeader.format !== target.binaryFormat || binaryHeader.architecture !== target.binaryArchitecture) {
        throw new Error('desktop-binary-target-mismatch');
    }

    const packageResult = {
        kind: target.bundleKind,
        channel: packageChannel,
        identity: target.packageIdentity,
        identitySource: target.packageIdentitySource,
        version: config.version,
        architecture: target.packageArchitecture,
        payloadVerified: false,
    };
    let payload;
    if (target.platform === 'linux') {
        payload = await inspectDebPayload({ bundle, config, root, target });
    } else if (target.platform === 'macos') {
        payload = await inspectDmgPayload({ bundle, config, root, target });
    } else if (target.platform === 'windows') {
        payload = await inspectNsisPayload({ bundle, config, root, target });
    } else {
        throw new Error('desktop-artifact-platform-unsupported');
    }
    packageResult.mainBinary = payload.mainBinary;
    packageResult.nativeBinaries = payload.nativeBinaries;
    if (payload.installerBinaries) packageResult.installerBinaries = payload.installerBinaries;
    packageResult.payloadVerified = true;

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
        schemaVersion: 2,
        scope,
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
