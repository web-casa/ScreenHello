import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdir, link, unlink, open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const MEMORY_POLICY = 'screenhello-export-memory/v2';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const digest = value => sha256(JSON.stringify(value));
export const root = fileURLToPath(new URL('../../', import.meta.url));
export function hashPaths(base, paths) {
    const hash = createHash('sha256');
    function walk(file, relative) {
        const entries = readdirSync(file, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            assert.ok(!entry.isSymbolicLink(), `unresolved source symlink: ${relative}/${entry.name}`);
            const name = `${relative}${entry.name}`;
            if (entry.isDirectory()) walk(path.join(file, entry.name), `${name}/`);
            else hash.update(name).update('\0').update(readFileSync(path.join(file, entry.name)));
        }
    }
    for (const item of paths) {
        if (item.endsWith('/')) walk(path.join(base, item), item === './' ? '' : item);
        else hash.update(item).update('\0').update(readFileSync(path.join(base, item)));
    }
    return hash.digest('hex');
}
// Content fingerprints, not Git HEAD: the working tree may be dirty. The
// production build is independently bound and never inferred from this hash.
export function candidateFingerprint() {
    return {
        buildSha256: hashPaths(path.join(root, 'artifacts/compression-product'), ['./']),
        webBuildSha256: hashPaths(process.env.SCREENHELLO_COMPRESSION_WEB_BUILD || path.join(root, 'dist'), ['./']),
        sourceSha256: hashPaths(root, ['src/', 'public/', 'config/', 'scripts/', 'index.html', 'package.json', 'pnpm-lock.yaml', 'vite.config.js']),
        runnerSha256: hashPaths(root, ['tests/compression-product/', 'tests/spikes/compression/', 'tests/fixtures/']),
    };
}
export function environmentFingerprint() {
    return { platform: process.platform, arch: process.arch, ramBytes: os.totalmem(), cpus: os.cpus().length,
        model: os.cpus()[0]?.model || 'unknown', kernel: os.release(), node: process.version };
}
export const scenarioId = scene => [scene.engine, scene.kind, scene.mode, scene.width, scene.height, scene.profile, scene.path, scene.repeat].join(':');
export const DIRECT_PATH = 'App-ExportPanel-direct-download';
export function requiredMemoryScenarios() {
    const scenes = [];
    const add = (engine, kind, mode, size, repeat) => scenes.push({ engine, kind, mode, width: size, height: size, repeat, profile: 'web', path: DIRECT_PATH });
    for (const kind of ['screenshot', 'noise']) add('chromium', kind, 'avif-standard', 2048, 24);
    for (const engine of ['chromium', 'firefox', 'webkit']) for (const kind of ['screenshot', 'noise']) add(engine, kind, 'avif-lossy', 1024, 6);
    add('chromium', 'noise', 'png-lossless', 2048, 6);
    add('webkit', 'noise', 'webp-lossless', 2048, 6);
    return scenes;
}
export const REQUIRED_GATES = ['output-decode-dimensions-mime-transparency', 'limits-serial-cancel-recovery-isolation', 'production-downloads', 'pwa-offline-update', 'licenses-provenance'];
export const REQUIRED_DEVICES = ['native-amd64-minimum-browsers', 'macos-14-real-safari', 'representative-mobile'];
export function validateManifest(manifest) {
    assert.equal(manifest?.schema, MEMORY_POLICY, 'unknown memory policy');
    assert.ok(['release', 'instrumentation'].includes(manifest.scope), 'invalid scope');
    for (const key of ['buildSha256', 'webBuildSha256', 'sourceSha256', 'runnerSha256']) assert.match(manifest.candidate?.[key] || '', /^[a-f0-9]{64}$/, `missing ${key}`);
    assert.ok(manifest.environment?.platform && manifest.environment?.arch && manifest.environment?.ramBytes > 0, 'missing environment');
    assert.ok(Number.isFinite(Date.parse(manifest.registeredAt)), 'missing registration time');
    assert.ok(Array.isArray(manifest.scenarios) && manifest.scenarios.length > 0, 'empty required scenarios');
    assert.equal(new Set(manifest.scenarios.map(scenarioId)).size, manifest.scenarios.length, 'duplicate scenario');
    for (const scene of manifest.scenarios) {
        assert.ok(['chromium', 'firefox', 'webkit'].includes(scene.engine) && ['screenshot', 'noise'].includes(scene.kind), 'invalid scenario');
        assert.ok(['png-lossless', 'png-lossy', 'webp-lossless', 'webp-lossy', 'jpg-lossy', 'avif-lossy', 'avif-standard'].includes(scene.mode), 'invalid mode');
        assert.equal(scene.profile, 'web'); assert.equal(scene.path, DIRECT_PATH);
        assert.ok(Number.isInteger(scene.repeat) && scene.repeat >= 6 && scene.repeat <= 24, 'invalid repetitions');
        assert.ok([scene.width, scene.height].every(n => Number.isInteger(n) && n > 0 && n <= 8192) && scene.width * scene.height <= 4_194_304, 'invalid dimensions');
        assert.ok(scene.mode !== 'avif-lossy' || scene.width * scene.height <= 1_048_576, 'Web AVIF compression limit');
    }
    if (manifest.scope === 'release') for (const scene of requiredMemoryScenarios()) assert.ok(manifest.scenarios.some(item => scenarioId(item) === scenarioId(scene)), `required scene removed: ${scenarioId(scene)}`);
    assert.deepEqual(manifest.requiredGates, REQUIRED_GATES, 'required gates changed');
    assert.deepEqual(manifest.requiredDevices, REQUIRED_DEVICES, 'required devices changed');
}

// Directory reservation provides an exclusive run identity. Immutable atomic
// checkpoints expose complete JSON or nothing, even on interruption. The tiny
// .tmp is retained on unexpected termination for diagnosis, never read as data.
export async function writeImmutableJson(file, value) {
    const temporary = `${file}.tmp`;
    const handle = await open(temporary, 'wx');
    try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    try { await link(temporary, file); }
    finally { await unlink(temporary); }
}
export async function reserveEvidence(directory, registration) {
    await mkdir(directory); // no recursive: EEXIST is intentionally fatal
    await writeImmutableJson(path.join(directory, 'registration.json'), registration);
    return {
        checkpoint: (index, report) => writeImmutableJson(path.join(directory, `checkpoint-${index}.json`), report),
        complete: report => writeImmutableJson(path.join(directory, 'complete.json'), report),
        failure: report => writeImmutableJson(path.join(directory, 'failure.json'), report),
    };
}
export async function registerMemory(file, scope = 'release') {
    const manifest = { schema: MEMORY_POLICY, scope, registeredAt: new Date().toISOString(),
        candidate: candidateFingerprint(), environment: environmentFingerprint(),
        scenarios: scope === 'instrumentation' ? [{ engine: 'chromium', kind: 'screenshot', mode: 'png-lossless', width: 64, height: 64, repeat: 6, profile: 'web', path: DIRECT_PATH }] : requiredMemoryScenarios(),
        requiredGates: REQUIRED_GATES, requiredDevices: REQUIRED_DEVICES };
    validateManifest(manifest);
    await writeImmutableJson(file, manifest);
    return manifest;
}
