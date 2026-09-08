import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const outputDirectory = path.resolve(
    root,
    process.env.SCREENHELLO_DESKTOP_SBOM_DIR || 'artifacts/release/desktop-matrix/local',
);
const timestamp = process.env.SCREENHELLO_EVIDENCE_TIMESTAMP || new Date().toISOString();
const candidateSha = process.env.SCREENHELLO_RELEASE_CANDIDATE || 'local-uncommitted';
const target = process.env.SCREENHELLO_DESKTOP_TARGET || 'local';

const runJson = async (command, args) => {
    const { stdout } = await execFileAsync(command, args, {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
    });
    return JSON.parse(stdout);
};

const encodedNpmName = (name) => {
    if (!name.startsWith('@')) return encodeURIComponent(name);
    const [scope, packageName] = name.slice(1).split('/');
    return `%40${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}`;
};

const licenseEntry = (expression) => ({ license: { name: String(expression || 'NOASSERTION').slice(0, 256) } });
const baseBom = (component, components) => ({
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: {
        timestamp,
        component,
        properties: [
            { name: 'screenhello:candidate-sha', value: candidateSha },
            { name: 'screenhello:desktop-target', value: target },
        ],
    },
    components,
});

// pnpm's Windows .cmd shim cannot be launched by execFile. The package script
// supplies the actual CLI entrypoint, which Node can execute on every platform.
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli || !path.isAbsolute(pnpmCli)) {
    throw new Error('desktop-sbom-run-via-pnpm-desktop-sbom');
}
const npmLicenses = await runJson(process.execPath, [pnpmCli, 'licenses', 'list', '--json', '--long']);
const npmComponents = [];
const npmSeen = new Set();
for (const entries of Object.values(npmLicenses)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
        for (const version of entry.versions || []) {
            const key = `${entry.name}@${version}`;
            if (npmSeen.has(key)) continue;
            npmSeen.add(key);
            npmComponents.push({
                type: 'library',
                name: entry.name,
                version,
                purl: `pkg:npm/${encodedNpmName(entry.name)}@${encodeURIComponent(version)}`,
                licenses: [licenseEntry(entry.license)],
            });
        }
    }
}
npmComponents.sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`, 'en'));

const cargoMetadata = await runJson('cargo', [
    'metadata',
    '--locked',
    '--format-version', '1',
    '--manifest-path', 'src-tauri/Cargo.toml',
]);
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const cargoApplication = cargoMetadata.packages.find(({ id }) => id === cargoMetadata.resolve?.root);
if (!cargoApplication) throw new Error('desktop-sbom-cargo-root-missing');
const cargoComponents = cargoMetadata.packages.map((entry) => ({
    type: entry.name === 'screenhello-desktop' ? 'application' : 'library',
    name: entry.name,
    version: entry.version,
    purl: `pkg:cargo/${encodeURIComponent(entry.name)}@${encodeURIComponent(entry.version)}`,
    licenses: [licenseEntry(entry.license)],
})).sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`, 'en'));

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
    writeFile(
        path.join(outputDirectory, 'npm.cdx.json'),
        `${JSON.stringify(baseBom({ type: 'application', name: 'ScreenHello Web', version: packageJson.version }, npmComponents), null, 2)}\n`,
        'utf8',
    ),
    writeFile(
        path.join(outputDirectory, 'cargo.cdx.json'),
        `${JSON.stringify(baseBom({ type: 'application', name: 'ScreenHello Desktop', version: cargoApplication.version }, cargoComponents), null, 2)}\n`,
        'utf8',
    ),
]);

console.log(JSON.stringify({
    target,
    npmComponents: npmComponents.length,
    cargoComponents: cargoComponents.length,
    outputDirectory: path.relative(root, outputDirectory),
}, null, 2));
