import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const source = fileURLToPath(new URL('./native/screencapturekit-probe.swift', import.meta.url));
export const PROBE_MINIMUM_MACOS = '14.0';
export function validateProbeCapture(value) {
    const allowed = ['status', 'backend', 'width', 'height', 'imageBytesPersisted'];
    if (!value || Object.keys(value).length !== allowed.length || !allowed.every((key) => Object.hasOwn(value, key))
        || value.status !== 'passed' || value.backend !== 'screencapturekit' || value.imageBytesPersisted !== false
        || !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height)
        || value.width <= 0 || value.height <= 0 || value.width * value.height > 7680 * 4320) {
        throw new Error('sck-probe-capture-invalid');
    }
    return value;
}
export function parseProbeRun(result) {
    if (result.error?.code === 'ETIMEDOUT') return { status: 'timed-out' };
    if (result.error || result.signal) return { status: 'process-failed' };
    let value;
    try { value = JSON.parse(result.stdout); } catch { return { status: 'invalid-response' }; }
    if (result.status === 0) {
        try { return validateProbeCapture(value); } catch { return { status: 'invalid-response' }; }
    }
    const failures = ['capture-consent-required', 'system-permission-required', 'primary-display-unavailable',
        'pixel-budget-exceeded', 'capture-dimensions-mismatch', 'capture-failed'];
    if (result.status === 2 && value && Object.keys(value).length === 1 && failures.includes(value.status)) return value;
    return { status: 'process-failed' };
}
export function probeCompileArguments(arch, output) {
    if (!['arm64', 'x86_64'].includes(arch)) throw new Error('sck-probe-architecture-invalid');
    return ['--sdk', 'macosx', 'swiftc', '-parse-as-library', '-O', '-target', `${arch}-apple-macos${PROBE_MINIMUM_MACOS}`,
        '-framework', 'ScreenCaptureKit', '-framework', 'CoreGraphics', source, '-o', output];
}
const sha256 = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');
function run(command, args, timeout = 120_000) {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(`sck-probe-command-failed:${path.basename(command)}`);
    return result.stdout.trim();
}
async function main() {
    const { values } = parseArgs({ options: { output: { type: 'string' }, 'capture-main-display': { type: 'boolean', default: false } } });
    if (!values.output) throw new Error('sck-probe-output-required');
    if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) throw new Error('sck-probe-native-macos-required');
    const output = path.resolve(values.output);
    await mkdir(path.dirname(output), { recursive: true });
    await mkdir(output); // A previous evidence directory must not be overwritten.
    const evidence = {
        schemaVersion: 1, releaseReady: false, minimumMacOS: PROBE_MINIMUM_MACOS,
        sourceSha256: await sha256(source), runnerSha256: await sha256(fileURLToPath(import.meta.url)), osVersion: run('sw_vers', ['-productVersion']),
        xcode: run('xcodebuild', ['-version']), sdk: run('xcrun', ['--sdk', 'macosx', '--show-sdk-version']),
        builds: [], hostArch: process.arch, consentGuard: 'not-run', capture: { status: 'not-run' }, productionIntegration: 'not-run',
    };
    try {
        for (const arch of ['arm64', 'x86_64']) {
            const binary = path.join(output, `sck-probe-${arch}`);
            run('xcrun', probeCompileArguments(arch, binary));
            run('lipo', ['-verify_arch', arch, binary]);
            evidence.builds.push({ arch, status: 'passed', sha256: await sha256(binary) });
        }
        const nativeArch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
        const guard = parseProbeRun(spawnSync(path.join(output, `sck-probe-${nativeArch}`), [], {
            encoding: 'utf8', timeout: 5_000, maxBuffer: 1024 * 1024,
        }));
        if (guard.status !== 'capture-consent-required') throw new Error('sck-probe-consent-guard-failed');
        evidence.consentGuard = 'passed';
        if (values['capture-main-display']) {
            evidence.capture = { status: 'failed' };
            const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
            if (Number(evidence.osVersion.split('.')[0]) < 14) throw new Error('sck-probe-runtime-macos14-required');
            const result = spawnSync(path.join(output, `sck-probe-${arch}`), ['--capture-main-display'], {
                encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
            });
            evidence.capture = parseProbeRun(result);
            if (evidence.capture.status !== 'passed') throw new Error(`sck-probe-${evidence.capture.status}`);
        }
    } finally {
        await writeFile(path.join(output, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
    }
    console.log(JSON.stringify(evidence, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
