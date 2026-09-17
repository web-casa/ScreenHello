import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assertPeArchitecture, masEntitlements, msixManifest, storeInputs } from './desktop-store-config.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const nativeRoot = path.join(root, 'src-tauri');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const run = (command, args, env = process.env, capture = false) => {
    const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`store-command-failed:${path.basename(command)}:${result.status}`);
    return result.stdout?.trim();
};
const digest = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');
// Invoke pnpm through its installed JS entry on Windows, without a shell/cmd.exe.
const tauri = (args, env) => {
    const entry = process.env.npm_execpath;
    if (!entry || !path.isAbsolute(entry)) throw new Error('store-use-pnpm-desktop-store-package');
    run(process.execPath, [entry, 'exec', 'tauri', ...args], env);
};

async function packageMas(input, output) {
    const profile = path.resolve(input.profile);
    const entitlements = path.join(output, 'entitlements.plist');
    await writeFile(entitlements, masEntitlements(input), { flag: 'wx' });
    const decodedProfile = path.join(output, 'profile.plist');
    await writeFile(decodedProfile, run('security', ['cms', '-D', '-i', profile], process.env, true), { flag: 'wx', mode: 0o600 });
    try {
        run('python3', ['-c', `import datetime, plistlib, sys
p = plistlib.load(open(sys.argv[1], 'rb'))
e = p.get('Entitlements', {})
assert p['ExpirationDate'] > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None), 'expired profile'
assert sys.argv[2] in p.get('TeamIdentifier', []), 'profile team mismatch'
assert e.get('com.apple.application-identifier') == sys.argv[2] + '.' + sys.argv[3], 'profile app mismatch'
assert not e.get('get-task-allow', False) and not e.get('com.apple.security.get-task-allow', False), 'development profile'
assert not p.get('ProvisionedDevices') and not p.get('ProvisionsAllDevices'), 'not a Store profile'
`, decodedProfile, input.team, input.identifier]);
    } finally {
        await rm(decodedProfile, { force: true });
    }
    const config = path.join(output, 'tauri.store.json');
    await writeFile(config, json({
        identifier: input.identifier,
        build: { features: ['mac-app-store'] },
        bundle: { active: true, targets: ['app'], category: 'Photography', macOS: {
            minimumSystemVersion: '14.0', signingIdentity: input.appIdentity, entitlements, hardenedRuntime: true,
            bundleVersion: input.buildNumber, files: { 'embedded.provisionprofile': profile },
        } },
    }), { flag: 'wx' });
    const env = { ...process.env, MACOSX_DEPLOYMENT_TARGET: '14.0' };
    // A MAS package must not enter the Developer ID notarization route.
    for (const key of ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_API_ISSUER', 'APPLE_API_KEY', 'APPLE_API_KEY_PATH', 'APPLE_SIGNING_IDENTITY']) delete env[key];
    tauri(['build', '--ci', '--target', input.target, '--bundles', 'app', '--config', config], env);
    const app = path.join(nativeRoot, 'target', input.target, 'release', 'bundle', 'macos', 'ScreenHello.app');
    const binary = path.join(app, 'Contents', 'MacOS', 'screenhello-desktop');
    const architectures = run('lipo', ['-archs', binary], process.env, true).split(/\s+/u).sort();
    const expected = (input.arch === 'universal' ? ['arm64', 'x86_64'] : [input.arch === 'arm64' ? 'arm64' : 'x86_64']).sort();
    if (json(architectures) !== json(expected)) throw new Error('store-macho-architecture-mismatch');
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
    const actual = path.join(output, 'signed-entitlements.plist');
    await writeFile(actual, run('codesign', ['-d', '--entitlements', ':-', app], process.env, true), { flag: 'wx' });
    run('python3', ['-c', `import plistlib, sys
expected = plistlib.load(open(sys.argv[1], 'rb'))
actual = plistlib.load(open(sys.argv[2], 'rb'))
assert expected == actual, 'signed entitlements mismatch'
info = plistlib.load(open(sys.argv[3], 'rb'))
assert info.get('LSMinimumSystemVersion') == '14.0', 'MAS minimum system version mismatch'
assert info['CFBundleIdentifier'] == sys.argv[4] and info['CFBundleVersion'] == sys.argv[5], 'bundle identity/version mismatch'
`, entitlements, actual, path.join(app, 'Contents', 'Info.plist'), input.identifier, input.buildNumber]);
    if (await digest(path.join(app, 'Contents', 'embedded.provisionprofile')) !== await digest(profile)) throw new Error('store-embedded-profile-mismatch');
    const file = path.join(output, `ScreenHello-mas-${input.arch}.pkg`);
    run('productbuild', ['--component', app, '/Applications', '--sign', input.installerIdentity, file]);
    run('pkgutil', ['--check-signature', file]);
    return file;
}

async function packageMsix(input, output) {
    const makeappx = process.env.SCREENHELLO_MAKEAPPX;
    if (!makeappx || !path.isAbsolute(makeappx)) throw new Error('store-input-required:SCREENHELLO_MAKEAPPX');
    const runtime = path.resolve(input.runtimeDirectory);
    const runtimeExe = path.join(runtime, 'msedgewebview2.exe');
    assertPeArchitecture(await readFile(runtimeExe), input.arch);
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "$s = Get-AuthenticodeSignature -LiteralPath $env:SCREENHELLO_VERIFY_FILE; if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation(?:,|$)') { throw 'Invalid Microsoft WebView2 signature' }"],
    { ...process.env, SCREENHELLO_VERIFY_FILE: runtimeExe });
    // This path is compiled into Tauri and preserved next to the packaged EXE.
    const runtimeRelative = `store-webview2/${input.arch}`;
    const stagedRuntime = path.join(nativeRoot, runtimeRelative);
    await mkdir(path.dirname(stagedRuntime), { recursive: true });
    await mkdir(stagedRuntime); // Refuse to overwrite another build's runtime.
    try {
        await cp(runtime, stagedRuntime, { recursive: true, dereference: false, errorOnExist: true, force: false });
        const config = path.join(output, 'tauri.store.json');
        await writeFile(config, json({ bundle: { active: false, windows: {
            webviewInstallMode: { type: 'fixedRuntime', path: runtimeRelative },
        } } }), { flag: 'wx' });
        tauri(['build', '--ci', '--target', input.target, '--no-bundle', '--no-sign', '--config', config], process.env);
        const release = path.join(nativeRoot, 'target', input.target, 'release');
        const binary = await readFile(path.join(release, 'screenhello-desktop.exe'));
        assertPeArchitecture(binary, input.arch);
        if (binary.includes(Buffer.from('SCREENHELLO_RUNNER_ONLY_TEST_BINARY'))) throw new Error('store-test-driver-forbidden');
        const layout = path.join(output, 'layout');
        await mkdir(layout);
        await writeFile(path.join(layout, 'screenhello-desktop.exe'), binary, { flag: 'wx' });
        for (const name of await readdir(release)) {
            if (name.toLowerCase().endsWith('.dll')) {
                assertPeArchitecture(await readFile(path.join(release, name)), input.arch);
                await cp(path.join(release, name), path.join(layout, name), { errorOnExist: true, force: false });
            }
        }
        await mkdir(path.join(layout, 'Assets'));
        for (const name of ['StoreLogo.png', 'Square150x150Logo.png', 'Square44x44Logo.png']) {
            await cp(path.join(nativeRoot, 'icons', name), path.join(layout, 'Assets', name), { errorOnExist: true, force: false });
        }
        await mkdir(path.join(layout, 'store-webview2'));
        await cp(stagedRuntime, path.join(layout, runtimeRelative), { recursive: true, errorOnExist: true, force: false });
        const manifest = msixManifest(input);
        await writeFile(path.join(layout, 'AppxManifest.xml'), manifest, { flag: 'wx' });
        const file = path.join(output, `ScreenHello-${input.version}-${input.arch}.msix`);
        run(makeappx, ['pack', '/d', layout, '/p', file, '/no']);
        const unpacked = path.join(output, 'unpacked');
        run(makeappx, ['unpack', '/p', file, '/d', unpacked, '/no']);
        if ((await readFile(path.join(unpacked, 'AppxManifest.xml'), 'utf8')).replace(/\r\n/gu, '\n') !== manifest) throw new Error('store-unpacked-manifest-mismatch');
        if (await digest(path.join(unpacked, 'screenhello-desktop.exe')) !== createHash('sha256').update(binary).digest('hex')) throw new Error('store-unpacked-binary-mismatch');
        if (await digest(path.join(unpacked, runtimeRelative, 'msedgewebview2.exe')) !== await digest(runtimeExe)) throw new Error('store-unpacked-runtime-mismatch');
        return file;
    } finally {
        await rm(stagedRuntime, { recursive: true, force: true });
    }
}

try {
    const { values } = parseArgs({ options: { channel: { type: 'string' }, arch: { type: 'string' }, output: { type: 'string' } }, strict: true });
    const input = storeInputs(values.channel, values.arch, process.env);
    if (process.platform !== (input.channel === 'mas' ? 'darwin' : 'win32')) throw new Error('store-native-host-required');
    if (!values.output) throw new Error('store-output-required');
    const output = path.resolve(values.output);
    await mkdir(path.dirname(output), { recursive: true });
    await mkdir(output); // Outputs are immutable candidates; a rerun needs a new directory.
    const commit = run('git', ['rev-parse', 'HEAD'], process.env, true);
    const dirty = Boolean(run('git', ['status', '--porcelain'], process.env, true));
    const file = await (input.channel === 'mas' ? packageMas(input, output) : packageMsix(input, output));
    await writeFile(path.join(output, 'package-evidence.json'), json({
        schemaVersion: 1, channel: input.channel, arch: input.arch, target: input.target, commit, dirty,
        identity: input.identifier || input.name,
        version: input.buildNumber || input.version,
        cargoLockSha256: await digest(path.join(nativeRoot, 'Cargo.lock')),
        configSha256: await digest(path.join(output, 'tauri.store.json')),
        file: path.basename(file), sha256: await digest(file),
        packaging: 'passed', installation: 'not-run', gui: 'not-run', upgrade: 'not-run',
        storeUpload: 'not-run', storeReview: 'not-run', releaseReady: false,
    }), { flag: 'wx' });
    process.stdout.write(`${file}\n`);
} catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
}
