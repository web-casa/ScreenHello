import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const MAX_GIT_BLOB_BYTES = 24 * 1024 * 1024;
const PUBLIC_MARKER_FILE = 'PUBLIC_REPOSITORY.json';
const VISUAL_ASSET_PATTERN = /\.(?:avif|bmp|gif|icns|ico|jpe?g|png|svg|webp)$/i;
const GENERATED_DIRECTORIES = new Set(['artifacts', 'dist', 'lib', 'node_modules']);
const joinInternalName = (...segments) => segments.join('');
const agentInstructionsFile = joinInternalName('AGEN', 'TS.md');
const agentWorkDirectory = joinInternalName('docs', '4ai');
const privateRepositoryFragment = joinInternalName('screenhello', '-Shoteasy');
const privatePlanningFiles = [
    joinInternalName('task', '_plan.md'),
    joinInternalName('find', 'ings.md'),
    joinInternalName('prog', 'ress.md'),
];
const escapedRegex = (value) => value.replace(/[|\\{}()[\]^$+*?.]/gu, '\\$&');
const FORBIDDEN_PATH_NAMES = new Set([
    agentInstructionsFile,
    agentWorkDirectory,
    privatePlanningFiles[1],
    'local-device-assets',
    privatePlanningFiles[2],
    privatePlanningFiles[0],
]);
const SECRET_PATTERNS = Object.freeze([
    ['private-key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
    ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
    ['npm-token', /\bnpm_[A-Za-z0-9]{30,}\b/],
    ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
    ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
]);
const INTERNAL_CONTENT_PATTERNS = Object.freeze([
    ['private-repository-name', new RegExp(escapedRegex(privateRepositoryFragment), 'i')],
    ['ai-work-directory', new RegExp(escapedRegex(agentWorkDirectory), 'i')],
    ['ai-agent-instructions', new RegExp(`\\b${escapedRegex(agentInstructionsFile)}\\b`, 'i')],
    ['private-planning-file', new RegExp(`\\b(?:${privatePlanningFiles
        .map(escapedRegex)
        .join('|')})\\b`, 'i')],
    ['local-linux-home', /\/home\/[A-Za-z0-9._-]+\//],
    ['local-macos-home', /\/Users\/[A-Za-z0-9._-]+\//],
    ['local-windows-home', /[A-Za-z]:\\Users\\[^\\\r\n]+\\/i],
]);

const gitEnvironment = (provided = {}) => {
    const environment = { ...process.env, ...provided };
    for (const name of [
        'GIT_ALTERNATE_OBJECT_DIRECTORIES',
        'GIT_CONFIG_COUNT',
        'GIT_CONFIG_GLOBAL',
        'GIT_CONFIG_NOSYSTEM',
        'GIT_CONFIG_PARAMETERS',
        'GIT_DIR',
        'GIT_INDEX_FILE',
        'GIT_OBJECT_DIRECTORY',
        'GIT_REPLACE_REF_BASE',
        'GIT_WORK_TREE',
    ]) delete environment[name];
    for (const name of Object.keys(environment)) {
        if (/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u.test(name)) delete environment[name];
    }
    environment.GIT_NO_REPLACE_OBJECTS = '1';
    return environment;
};

const runFile = (command, args, options = {}) => new Promise((resolve, reject) => {
    execFile(command, args, {
        cwd: options.cwd,
        encoding: options.encoding ?? null,
        // Immutable public-export inputs must not be redirected through Git
        // environment overrides or repository-local replace refs.
        env: gitEnvironment(options.env),
        maxBuffer: options.maxBuffer ?? MAX_GIT_BLOB_BYTES,
        windowsHide: true,
    }, (error, stdout, stderr) => {
        if (error) {
            error.stdout = stdout;
            error.stderr = stderr;
            reject(error);
            return;
        }
        resolve(stdout);
    });
});

const runText = async (command, args, options = {}) => String(await runFile(command, args, {
    ...options,
    encoding: 'utf8',
}));

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const compareRepositoryPaths = (left, right) => (left === right ? 0 : (left < right ? -1 : 1));

const relativePath = (root, candidate) => path.relative(root, candidate).split(path.sep).join('/');

export const normalizeRepositoryPath = (value) => {
    if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || value.includes('\\')) {
        throw new Error(`public-manifest-invalid-path:${String(value)}`);
    }
    const normalized = path.posix.normalize(value);
    const segments = value.split('/');
    if (normalized !== value
        || path.posix.isAbsolute(value)
        || value.endsWith('/')
        || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
        throw new Error(`public-manifest-invalid-path:${value}`);
    }
    return value;
};

const uniqueSortedPaths = (values, label) => {
    if (!Array.isArray(values)) throw new Error(`public-manifest-${label}-invalid`);
    const normalized = values.map(normalizeRepositoryPath);
    if (new Set(normalized).size !== normalized.length) throw new Error(`public-manifest-${label}-duplicate`);
    if ([...normalized].sort().some((value, index) => value !== normalized[index])) {
        throw new Error(`public-manifest-${label}-not-sorted`);
    }
    return normalized;
};

export const validatePublicManifest = (value) => {
    if (!value || typeof value !== 'object' || value.schemaVersion !== 1) {
        throw new Error('public-manifest-schema-unsupported');
    }
    if (value.targetRepository !== 'https://github.com/web-casa/ScreenHello') {
        throw new Error('public-manifest-target-invalid');
    }
    const files = uniqueSortedPaths(value.include?.files, 'files');
    const directories = uniqueSortedPaths(value.include?.directories, 'directories');
    const generatedFiles = uniqueSortedPaths(value.generatedFiles, 'generated-files');
    const allowedVisualAssets = uniqueSortedPaths(value.allowedVisualAssets, 'allowed-visual-assets');
    const requiredFiles = uniqueSortedPaths(value.requiredFiles, 'required-files');
    for (const [index, directory] of directories.entries()) {
        if (directories.some((candidate, candidateIndex) => (
            candidateIndex !== index && directory.startsWith(`${candidate}/`)
        ))) {
            throw new Error(`public-manifest-overlapping-path:${directory}`);
        }
    }
    for (const file of files) {
        if (directories.some((directory) => file.startsWith(`${directory}/`))) {
            throw new Error(`public-manifest-overlapping-path:${file}`);
        }
    }
    for (const generated of generatedFiles) {
        if (files.includes(generated) || directories.some((directory) => generated.startsWith(`${directory}/`))) {
            throw new Error(`public-manifest-generated-path-overlap:${generated}`);
        }
    }
    for (const asset of allowedVisualAssets) {
        if (!files.includes(asset) && !directories.some((directory) => asset.startsWith(`${directory}/`))) {
            throw new Error(`public-manifest-visual-asset-not-allowed:${asset}`);
        }
    }
    for (const required of requiredFiles) {
        if (!files.includes(required) && !generatedFiles.includes(required)
            && !directories.some((directory) => required.startsWith(`${directory}/`))) {
            throw new Error(`public-manifest-required-path-not-allowed:${required}`);
        }
    }
    return {
        ...value,
        include: { files, directories },
        generatedFiles,
        allowedVisualAssets,
        requiredFiles,
    };
};

export const readPublicManifest = async (manifestPath) => validatePublicManifest(
    JSON.parse(await readFile(manifestPath, 'utf8'))
);

export const isPublicPathAllowed = (repositoryPath, manifest) => {
    const normalized = normalizeRepositoryPath(repositoryPath);
    return manifest.include.files.includes(normalized)
        || manifest.generatedFiles.includes(normalized)
        || manifest.include.directories.some((directory) => (
            normalized.startsWith(`${directory}/`)
        ));
};

const resolveCommit = async (sourceRoot, ref) => {
    const sha = (await runText('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: sourceRoot })).trim();
    if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error('public-export-ref-invalid');
    return sha;
};

const parseTreeEntries = (buffer) => buffer.toString('utf8').split('\0').filter(Boolean).map((record) => {
    const match = record.match(/^([0-9]{6}) ([a-z]+) ([0-9a-f]{40,64})\t(.+)$/s);
    if (!match) throw new Error('public-export-git-tree-invalid');
    const [, mode, type, objectId, repositoryPath] = match;
    normalizeRepositoryPath(repositoryPath);
    if (type !== 'blob' || !['100644', '100755'].includes(mode)) {
        throw new Error(`public-export-entry-type-unsupported:${repositoryPath}`);
    }
    return { mode, objectId, path: repositoryPath };
});

const listCommitEntries = async (sourceRoot, commit, manifest) => {
    const requestedPaths = [
        ...manifest.include.files,
        ...manifest.include.directories,
    ];
    const output = await runFile('git', ['ls-tree', '-r', '-z', commit, '--', ...requestedPaths], {
        cwd: sourceRoot,
        maxBuffer: 32 * 1024 * 1024,
    });
    const entries = parseTreeEntries(output);
    if (manifest.generatedFiles.length) {
        const generatedOutput = await runFile('git', [
            'ls-tree', '-r', '-z', commit, '--', ...manifest.generatedFiles,
        ], {
            cwd: sourceRoot,
            maxBuffer: 32 * 1024 * 1024,
        });
        const generatedEntries = parseTreeEntries(generatedOutput);
        for (const generated of manifest.generatedFiles) {
            if (generatedEntries.some((entry) => (
                entry.path === generated || entry.path.startsWith(`${generated}/`)
            ))) {
                throw new Error(`public-export-generated-file-present:${generated}`);
            }
        }
    }
    const paths = new Set(entries.map((entry) => entry.path));
    for (const file of manifest.include.files) {
        if (!paths.has(file)) throw new Error(`public-export-source-file-missing:${file}`);
    }
    for (const directory of manifest.include.directories) {
        if (!entries.some((entry) => entry.path.startsWith(`${directory}/`))) {
            throw new Error(`public-export-source-directory-empty:${directory}`);
        }
    }
    for (const entry of entries) {
        if (!isPublicPathAllowed(entry.path, manifest)) {
            throw new Error(`public-export-path-not-allowed:${entry.path}`);
        }
    }
    return entries.sort((left, right) => compareRepositoryPaths(left.path, right.path));
};

const ensureNonexistentSafeOutput = async (sourceRoot, outputRoot) => {
    const source = await realpath(sourceRoot);
    const requested = path.resolve(outputRoot);
    const output = path.join(await realpath(path.dirname(requested)), path.basename(requested));
    const outputInsideSource = relativePath(source, output);
    const sourceInsideOutput = relativePath(output, source);
    if (output === source
        || (!outputInsideSource.startsWith('../') && outputInsideSource !== '..')
        || (!sourceInsideOutput.startsWith('../') && sourceInsideOutput !== '..')) {
        throw new Error('public-export-output-must-be-isolated');
    }
    try {
        await lstat(output);
        throw new Error('public-export-output-already-exists');
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    return output;
};

const publicMarker = (manifest, preview = false) => ({
        schemaVersion: 1,
        repository: manifest.targetRepository,
        sourcePolicy: preview ? 'local-worktree-preview' : 'reviewed-allowlist-export',
        ...(preview ? { releaseReady: false } : {}),
    });

const renderPublicMarker = (manifest, preview = false) => Buffer.from(
    `${JSON.stringify(publicMarker(manifest, preview), null, 2)}\n`,
    'utf8',
);

const writePublicMarker = async (outputRoot, manifest, preview = false) => {
    await writeFile(path.join(outputRoot, PUBLIC_MARKER_FILE), renderPublicMarker(manifest, preview), {
        encoding: 'utf8',
        mode: 0o644,
    });
};

const readCommitBlob = async (sourceRoot, objectId) => {
    const blob = await runFile('git', ['cat-file', 'blob', objectId], {
        cwd: sourceRoot,
        maxBuffer: MAX_GIT_BLOB_BYTES,
    });
    if (blob.length > MAX_GIT_BLOB_BYTES) throw new Error('public-export-source-file-too-large');
    return blob;
};

export const readPublicManifestAtCommit = async ({
    sourceRoot,
    ref = 'HEAD',
    manifestPath = 'config/public-export-manifest.json',
} = {}) => {
    const source = path.resolve(sourceRoot || '');
    const repositoryPath = normalizeRepositoryPath(manifestPath);
    const commit = await resolveCommit(source, ref);
    let raw;
    try {
        raw = await readCommitBlob(source, `${commit}:${repositoryPath}`);
    } catch {
        throw new Error(`public-export-source-manifest-missing:${repositoryPath}`);
    }
    try {
        return {
            commit,
            manifest: validatePublicManifest(JSON.parse(raw.toString('utf8'))),
        };
    } catch (error) {
        if (error?.message?.startsWith('public-manifest-')) throw error;
        throw new Error(`public-export-source-manifest-invalid:${repositoryPath}`);
    }
};

export const createPublicExportSnapshot = async ({ sourceRoot, ref = 'HEAD', manifest } = {}) => {
    const source = path.resolve(sourceRoot || '');
    const validatedManifest = validatePublicManifest(manifest);
    const commit = await resolveCommit(source, ref);
    const entries = await listCommitEntries(source, commit, validatedManifest);
    const files = [];
    for (const entry of entries) {
        const blob = await readCommitBlob(source, entry.objectId);
        files.push({
            path: entry.path,
            mode: entry.mode,
            bytes: blob.length,
            sha256: sha256(blob),
        });
    }
    const marker = renderPublicMarker(validatedManifest);
    files.push({
        path: PUBLIC_MARKER_FILE,
        mode: '100644',
        bytes: marker.length,
        sha256: sha256(marker),
    });
    files.sort((left, right) => compareRepositoryPaths(left.path, right.path));
    if (new Set(files.map(({ path: repositoryPath }) => repositoryPath)).size !== files.length) {
        throw new Error('public-export-snapshot-path-duplicate');
    }
    const tree = files.map(({ path: repositoryPath, mode, bytes, sha256: digest }) => ({
        path: repositoryPath,
        mode,
        bytes,
        sha256: digest,
    }));
    const auditRoot = await mkdtemp(path.join(os.tmpdir(), 'screenhello-public-snapshot-'));
    try {
        for (const entry of entries) {
            const destination = path.join(auditRoot, ...entry.path.split('/'));
            await mkdir(path.dirname(destination), { recursive: true });
            await writeFile(destination, await readCommitBlob(source, entry.objectId), {
                mode: entry.mode === '100755' ? 0o755 : 0o644,
            });
        }
        await writePublicMarker(auditRoot, validatedManifest);
        await auditPublicRepository({ root: auditRoot, manifest: validatedManifest });
    } finally {
        await rm(auditRoot, { recursive: true, force: true });
    }
    return {
        schemaVersion: 1,
        sourceCommit: commit,
        repository: validatedManifest.targetRepository,
        files: tree,
        treeSha256: sha256(`${JSON.stringify(tree)}\n`),
    };
};

export const verifyPublicExportSnapshot = async ({ snapshot, ...options } = {}) => {
    const expected = await createPublicExportSnapshot(options);
    if (!sameJson(snapshot, expected)) throw new Error('public-export-snapshot-invalid');
    return expected;
};

const walkFiles = async (root, current = root) => {
    const files = [];
    for (const entry of await readdir(current, { withFileTypes: true })) {
        if (current === root && GENERATED_DIRECTORIES.has(entry.name)) continue;
        const absolute = path.join(current, entry.name);
        const repositoryPath = relativePath(root, absolute);
        if (entry.isSymbolicLink()) throw new Error(`public-audit-symlink-forbidden:${repositoryPath}`);
        if (entry.isDirectory()) files.push(...await walkFiles(root, absolute));
        else if (entry.isFile()) files.push(repositoryPath);
        else throw new Error(`public-audit-entry-type-unsupported:${repositoryPath}`);
    }
    return files.sort();
};

const listAuditedFiles = async (root) => {
    let hasGitMetadata = false;
    try {
        await access(path.join(root, '.git'), fsConstants.F_OK);
        hasGitMetadata = true;
    } catch {
        hasGitMetadata = false;
    }
    if (!hasGitMetadata) return walkFiles(root);
    const output = await runFile('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
    return output.toString('utf8').split('\0').filter(Boolean).sort();
};

const fileIsBinary = (buffer) => buffer.subarray(0, 8_192).includes(0);

const validateMarkdownLinks = (repositoryPath, content, fileSet, failures) => {
    const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
    for (const match of content.matchAll(linkPattern)) {
        let target = match[1].trim();
        if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
        target = target.split(/\s+["']/u, 1)[0];
        if (!target || target.startsWith('#') || target.startsWith('/')
            || /^(?:https?:|mailto:)/i.test(target)) continue;
        const withoutAnchor = target.split('#', 1)[0];
        let decoded;
        try {
            decoded = decodeURIComponent(withoutAnchor);
        } catch {
            failures.push(`public-audit-markdown-link-invalid:${repositoryPath}:${target}`);
            continue;
        }
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(repositoryPath), decoded));
        const directory = resolved.endsWith('/') ? resolved : `${resolved}/`;
        if (resolved.startsWith('../') || (!fileSet.has(resolved) && ![...fileSet].some(file => file.startsWith(directory)))) {
            failures.push(`public-audit-markdown-link-missing:${repositoryPath}:${target}`);
        }
    }
};

const resolveRelativeModule = (repositoryPath, target, fileSet) => {
    const cleanTarget = target.split(/[?#]/u, 1)[0];
    let decoded;
    try {
        decoded = decodeURIComponent(cleanTarget);
    } catch {
        return false;
    }
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(repositoryPath), decoded));
    if (resolved.startsWith('../')) return false;
    const candidates = [
        resolved,
        ...['.mjs', '.js', '.d.ts', '.ts', '.jsx', '.tsx', '.json', '.css'].map((extension) => `${resolved}${extension}`),
        ...['.mjs', '.js', '.d.ts', '.ts', '.jsx', '.tsx', '.json'].map((extension) => `${resolved}/index${extension}`),
    ];
    return candidates.some((candidate) => fileSet.has(candidate));
};

const validateRelativeModuleReferences = (repositoryPath, content, fileSet, failures) => {
    const modulePatterns = [
        /\bfrom\s*(['"])(\.[^'"]+)\1/g,
        /\bimport\s*\(\s*(['"])(\.[^'"]+)\1\s*\)/g,
        /\bimport\s*(['"])(\.[^'"]+)\1/g,
    ];
    for (const pattern of modulePatterns) {
        for (const match of content.matchAll(pattern)) {
            const target = match[2];
            if (!resolveRelativeModule(repositoryPath, target, fileSet)) {
                failures.push(`public-audit-relative-module-missing:${repositoryPath}:${target}`);
            }
        }
    }
    const assetUrlPattern = /\bnew\s+URL\s*\(\s*(['"])(\.[^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g;
    for (const match of content.matchAll(assetUrlPattern)) {
        const target = match[2];
        const cleanTarget = target.split(/[?#]/u, 1)[0];
        if (!path.posix.extname(cleanTarget)) continue;
        if (!resolveRelativeModule(repositoryPath, target, fileSet)) {
            failures.push(`public-audit-relative-asset-missing:${repositoryPath}:${target}`);
        }
    }
};

const validatePackageContract = async (root, manifest, failures) => {
    const packagePath = path.join(root, 'package.json');
    let packageJson;
    try {
        packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
    } catch {
        failures.push('public-audit-package-json-invalid');
        return;
    }
    if (packageJson.private !== true) failures.push('public-audit-npm-publish-not-blocked');
    if (packageJson.repository?.url !== `${manifest.targetRepository}.git`) {
        failures.push('public-audit-package-repository-mismatch');
    }
    if (/\bnpm\s+publish\b/.test(String(packageJson.scripts?.release || ''))) {
        failures.push('public-audit-direct-npm-publish-script');
    }
    const dependencySpecs = Object.values({
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.optionalDependencies,
    });
    const privateDependencyPattern = new RegExp(
        `(?:git\\+ssh|git@|github\\.com/web-casa/${escapedRegex(privateRepositoryFragment)})`,
        'i',
    );
    if (dependencySpecs.some((spec) => privateDependencyPattern.test(String(spec)))) {
        failures.push('public-audit-private-dependency');
    }
};

export const auditPublicRepository = async ({ root, manifest, allowWorktreePreview = false }) => {
    const publicRoot = path.resolve(root);
    const failures = [];
    const files = await listAuditedFiles(publicRoot);
    const fileSet = new Set(files);
    for (const repositoryPath of files) {
        try {
            if (!isPublicPathAllowed(repositoryPath, manifest)) {
                failures.push(`public-audit-path-not-allowed:${repositoryPath}`);
            }
        } catch (error) {
            failures.push(error.message);
        }
        const segments = repositoryPath.split('/');
        if (segments.some((segment) => FORBIDDEN_PATH_NAMES.has(segment))) {
            failures.push(`public-audit-private-path:${repositoryPath}`);
        }
    }
    for (const required of manifest.requiredFiles) {
        if (!fileSet.has(required)) failures.push(`public-audit-required-file-missing:${required}`);
    }
    const allowedVisualAssets = new Set(manifest.allowedVisualAssets);
    for (const repositoryPath of files.filter((file) => VISUAL_ASSET_PATTERN.test(file))) {
        if (!allowedVisualAssets.has(repositoryPath)) {
            failures.push(`public-audit-visual-asset-not-reviewed:${repositoryPath}`);
        }
    }
    for (const repositoryPath of allowedVisualAssets) {
        if (!fileSet.has(repositoryPath)) {
            failures.push(`public-audit-reviewed-visual-asset-missing:${repositoryPath}`);
        }
    }

    for (const repositoryPath of files) {
        const buffer = await readFile(path.join(publicRoot, ...repositoryPath.split('/')));
        if (fileIsBinary(buffer)) continue;
        const content = buffer.toString('utf8');
        for (const [id, pattern] of SECRET_PATTERNS) {
            if (pattern.test(content)) failures.push(`public-audit-${id}:${repositoryPath}`);
        }
        for (const [id, pattern] of INTERNAL_CONTENT_PATTERNS) {
            if (pattern.test(content)) failures.push(`public-audit-${id}:${repositoryPath}`);
        }
        if (repositoryPath.endsWith('.md')) {
            validateMarkdownLinks(repositoryPath, content, fileSet, failures);
        }
        if (/\.(?:[cm]?js|jsx|tsx?)$/u.test(repositoryPath)) {
            validateRelativeModuleReferences(repositoryPath, content, fileSet, failures);
        }
    }

    await validatePackageContract(publicRoot, manifest, failures);
    const license = await readFile(path.join(publicRoot, 'LICENSE'), 'utf8').catch(() => '');
    if (!license.includes('Copyright (c) 2024 Chenliwen') || !license.includes('MIT License')) {
        failures.push('public-audit-upstream-license-missing');
    }
    const notice = await readFile(path.join(publicRoot, 'NOTICE'), 'utf8').catch(() => '');
    if (!notice.includes('Shoteasy') || !notice.includes('ScreenHello')) {
        failures.push('public-audit-modification-notice-missing');
    }
    const assetProvenance = await readFile(path.join(publicRoot, 'ASSET_PROVENANCE.md'), 'utf8').catch(() => '');
    if (!assetProvenance.includes('Asset Provenance')
        || !assetProvenance.includes('code-native')
        || !assetProvenance.includes('redistribution license')) {
        failures.push('public-audit-asset-provenance-missing');
    }
    const marker = await readFile(path.join(publicRoot, PUBLIC_MARKER_FILE), 'utf8').catch(() => '');
    try {
        const parsed = JSON.parse(marker);
        const preview = parsed.sourcePolicy === 'local-worktree-preview' && parsed.releaseReady === false;
        if (parsed.repository !== manifest.targetRepository
            || (parsed.sourcePolicy !== 'reviewed-allowlist-export' && !(allowWorktreePreview && preview))) {
            failures.push('public-audit-marker-invalid');
        }
    } catch {
        failures.push('public-audit-marker-invalid');
    }

    const uniqueFailures = [...new Set(failures)].sort();
    if (uniqueFailures.length) {
        throw Object.assign(new Error(`public-repository-audit-failed\n${uniqueFailures.join('\n')}`), {
            failures: uniqueFailures,
        });
    }
    return { files: files.length, repository: manifest.targetRepository };
};

export const exportPublicRepository = async ({ sourceRoot, outputRoot, ref = 'HEAD', manifest }) => {
    const source = path.resolve(sourceRoot);
    const validatedManifest = validatePublicManifest(manifest);
    const output = await ensureNonexistentSafeOutput(source, outputRoot);
    const status = await runText('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: source });
    if (status.trim()) throw new Error('public-export-source-worktree-dirty');
    const commit = await resolveCommit(source, ref);
    const entries = await listCommitEntries(source, commit, validatedManifest);
    await mkdir(output, { recursive: false });
    try {
        for (const entry of entries) {
            const destination = path.join(output, ...entry.path.split('/'));
            await mkdir(path.dirname(destination), { recursive: true });
            const blob = await readCommitBlob(source, entry.objectId);
            await writeFile(destination, blob, { mode: entry.mode === '100755' ? 0o755 : 0o644 });
            await chmod(destination, entry.mode === '100755' ? 0o755 : 0o644);
        }
        await writePublicMarker(output, validatedManifest);
        const audit = await auditPublicRepository({ root: output, manifest: validatedManifest });
        return { ...audit, commit, output };
    } catch (error) {
        await rm(output, { recursive: true, force: true });
        throw error;
    }
};

// A local, explicitly non-release verification copy. The committed-blob export
// above remains unchanged and continues to reject every dirty worktree.
export const exportWorktreePreview = async ({ sourceRoot, outputRoot, manifest }) => {
    const source = path.resolve(sourceRoot);
    const validatedManifest = validatePublicManifest(manifest);
    const output = await ensureNonexistentSafeOutput(source, outputRoot);
    const listed = await runText('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: source });
    const files = [...new Set(listed.split('\0').filter(Boolean))]
        .filter(file => isPublicPathAllowed(file, validatedManifest) && !validatedManifest.generatedFiles.includes(file)).sort();
    for (const required of validatedManifest.include.files) {
        if (!files.includes(required)) throw new Error(`public-preview-source-file-missing:${required}`);
    }
    await mkdir(output, { recursive: false });
    try {
        for (const file of files) {
            const segments = file.split('/');
            for (let index = 1; index <= segments.length; index++) {
                const entry = await lstat(path.join(source, ...segments.slice(0, index)));
                if (entry.isSymbolicLink()) throw new Error(`public-preview-symlink-forbidden:${file}`);
                if (index === segments.length && (!entry.isFile() || entry.size > MAX_GIT_BLOB_BYTES)) {
                    throw new Error(`public-preview-file-invalid:${file}`);
                }
            }
            const destination = path.join(output, ...segments);
            const metadata = await lstat(path.join(source, ...segments));
            await mkdir(path.dirname(destination), { recursive: true });
            await writeFile(destination, await readFile(path.join(source, ...segments)), { mode: metadata.mode & 0o111 ? 0o755 : 0o644 });
        }
        await writePublicMarker(output, validatedManifest, true);
        const audit = await auditPublicRepository({ root: output, manifest: validatedManifest, allowWorktreePreview: true });
        return { ...audit, sourcePolicy: 'local-worktree-preview', releaseReady: false, output };
    } catch (error) {
        await rm(output, { recursive: true, force: true });
        throw error;
    }
};

export const runVerificationCommand = (command, args, { cwd, env }) => new Promise((resolve, reject) => {
    const child = spawn(command, args, {
        cwd,
        env,
        stdio: 'inherit',
        shell: false,
        windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`public-verification-command-failed:${command}:${args.join(' ')}:${code ?? signal}`));
    });
});
