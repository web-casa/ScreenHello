import { strFromU8, strToU8, unzip, zip } from 'fflate';
import { MAX_PROJECT_IMAGES, validateDocument } from '@utils/projectDocument';
import {
    createStylePreset,
    normalizeExportSettings,
    normalizeWorkspaceName,
    validateStylePreset,
} from '@utils/stylePreset';

import {
    PRESET_ARCHIVE_MIME,
    PROJECT_ARCHIVE_MIME,
    WORKSPACE_CONTAINER_VERSION,
} from '@utils/workspaceFormat';

export {
    PRESET_ARCHIVE_MIME,
    PRESET_EXTENSION,
    PROJECT_ARCHIVE_MIME,
    PROJECT_EXTENSION,
    WORKSPACE_CONTAINER_VERSION,
} from '@utils/workspaceFormat';

const MANIFEST_PATH = 'manifest.json';
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 48 * 1024 * 1024;
const MAX_TOTAL_BYTES = 96 * 1024 * 1024;
const MAX_ENTRY_COUNT = MAX_PROJECT_IMAGES + 2;
const IMAGE_MIME_EXTENSIONS = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/bmp': '.bmp',
};

const archiveError = (code, message = code) => Object.assign(new Error(message), { code });

const toBytes = async (blob) => new Uint8Array(await blob.arrayBuffer());

const sha256 = async (bytes) => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle?.digest) return null;
    const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
    return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
};

const zipAsync = (files) => new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (error, data) => {
        if (error) reject(archiveError('archive-create-failed', error.message));
        else resolve(data);
    });
});

const unzipAsync = (bytes, options) => new Promise((resolve, reject) => {
    unzip(bytes, options, (error, data) => {
        if (error) reject(archiveError('archive-invalid', error.message));
        else resolve(data);
    });
});

const assertImageBlob = (blob, code) => {
    if (!(blob instanceof Blob) || !blob.type.startsWith('image/') || blob.size <= 0) {
        throw archiveError(code, 'Archive image asset is missing or invalid');
    }
    if (blob.size > MAX_ENTRY_BYTES) throw archiveError('archive-asset-too-large');
};

const createAssetEntry = async (role, blob, metadata = {}, pathRole = role) => {
    assertImageBlob(blob, `${role}-asset-invalid`);
    const type = blob.type || metadata.type || 'image/png';
    const extension = IMAGE_MIME_EXTENSIONS[type] || '.img';
    const path = `assets/${pathRole}${extension}`;
    const bytes = await toBytes(blob);
    return {
        descriptor: {
            path,
            type,
            name: normalizeWorkspaceName(metadata.name, `${role}${extension}`),
            size: bytes.byteLength,
            sha256: await sha256(bytes),
            ...(Number.isFinite(Number(metadata.width)) ? { width: Number(metadata.width) } : {}),
            ...(Number.isFinite(Number(metadata.height)) ? { height: Number(metadata.height) } : {}),
        },
        bytes,
    };
};

const makeArchive = async (manifest, assetEntries) => {
    const manifestBytes = strToU8(JSON.stringify(manifest));
    const totalBytes = assetEntries.reduce((sum, entry) => sum + entry.bytes.byteLength, manifestBytes.byteLength);
    if (manifestBytes.byteLength > 512 * 1024 || totalBytes > MAX_TOTAL_BYTES) {
        throw archiveError('archive-too-large');
    }
    const files = {
        [MANIFEST_PATH]: [manifestBytes, { level: 6 }],
    };
    for (const entry of assetEntries) {
        files[entry.descriptor.path] = [entry.bytes, { level: 0 }];
    }
    const bytes = await zipAsync(files);
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw archiveError('archive-too-large');
    return bytes;
};

export async function createProjectArchive({ name, document, images, image, background = null, exportSettings } = {}) {
    const validation = validateDocument(document);
    if (!validation.ok) throw archiveError('project-document-invalid', validation.errors.join(', '));
    const imageInputs = Array.isArray(images) && images.length
        ? images
        : (image ? [{ blob: image, metadata: validation.doc.images[0] || document?.image || {} }] : []);
    if (!imageInputs.length || imageInputs.length !== validation.doc.images.length) {
        throw archiveError('project-image-count-invalid');
    }
    const imageDescriptors = [];
    const uniqueImageEntries = [];
    const entriesByAssetId = new Map();
    for (let index = 0; index < imageInputs.length; index += 1) {
        const input = imageInputs[index];
        const metadata = { ...validation.doc.images[index], ...(input.metadata || input) };
        const blob = input.blob || input;
        let entry = metadata.assetId ? entriesByAssetId.get(metadata.assetId) : null;
        if (entry) {
            assertImageBlob(blob, 'image-asset-invalid');
            if (blob !== entry.blob) {
                const bytes = await toBytes(blob);
                const sameBytes = bytes.byteLength === entry.bytes.byteLength
                    && bytes.every((value, offset) => value === entry.bytes[offset]);
                if (blob.type !== entry.blob.type || !sameBytes) throw archiveError('project-asset-conflict');
            }
        } else {
            entry = await createAssetEntry(
                'image',
                blob,
                metadata,
                `images/${String(uniqueImageEntries.length).padStart(2, '0')}`
            );
            entry.blob = blob;
            uniqueImageEntries.push(entry);
            if (metadata.assetId) entriesByAssetId.set(metadata.assetId, entry);
        }
        imageDescriptors.push({
            ...entry.descriptor,
            assetId: metadata.assetId,
            id: metadata.id,
        });
    }
    const entries = [...uniqueImageEntries];
    const assets = { images: imageDescriptors };
    if (background) {
        const backgroundEntry = await createAssetEntry('background', background.blob || background, background);
        entries.push(backgroundEntry);
        assets.background = backgroundEntry.descriptor;
    }
    const doc = structuredClone(validation.doc);
    doc.images = doc.images.map((layer, index) => ({
        ...layer,
        assetId: imageDescriptors[index].assetId || layer.assetId,
        width: imageDescriptors[index].width || layer.width || 0,
        height: imageDescriptors[index].height || layer.height || 0,
        type: imageDescriptors[index].type,
        name: imageDescriptors[index].name,
    }));
    doc.option.backgroundAssetId = null;
    if (doc.option.frameConf?.background?.type === 'image') {
        doc.option.frameConf.background = { ...doc.option.frameConf.background, url: null };
    }
    if (doc.option.background === 'upload_image' && !assets.background) {
        throw archiveError('background-asset-missing');
    }
    const manifest = {
        format: 'screenhello',
        containerVersion: WORKSPACE_CONTAINER_VERSION,
        kind: 'project',
        name: normalizeWorkspaceName(name, '未命名项目'),
        createdAt: new Date().toISOString(),
        document: doc,
        exportSettings: normalizeExportSettings(exportSettings),
        assets,
    };
    const bytes = await makeArchive(manifest, entries);
    return new Blob([bytes], { type: PROJECT_ARCHIVE_MIME });
}

export async function createPresetArchive({ preset, background = null } = {}) {
    const validation = validateStylePreset(preset);
    if (!validation.ok) throw archiveError('preset-invalid', validation.errors.join(', '));
    const entries = [];
    const assets = {};
    if (background) {
        const backgroundEntry = await createAssetEntry('background', background.blob || background, background);
        entries.push(backgroundEntry);
        assets.background = backgroundEntry.descriptor;
    }
    if (validation.preset.option.background === 'upload_image' && !assets.background) {
        throw archiveError('background-asset-missing');
    }
    const manifest = {
        format: 'screenhello',
        containerVersion: WORKSPACE_CONTAINER_VERSION,
        kind: 'preset',
        name: validation.preset.name,
        createdAt: new Date().toISOString(),
        preset: createStylePreset(validation.preset),
        assets,
    };
    const bytes = await makeArchive(manifest, entries);
    return new Blob([bytes], { type: PRESET_ARCHIVE_MIME });
}

const validateDescriptor = (descriptor, role) => {
    if (!descriptor || typeof descriptor !== 'object') throw archiveError(`${role}-descriptor-invalid`);
    const pathPattern = role === 'image'
        ? /^assets\/(?:image|images\/\d{2})\.[a-z0-9]+$/
        : /^assets\/background\.[a-z0-9]+$/;
    if (!pathPattern.test(descriptor.path || '')) {
        throw archiveError(`${role}-path-invalid`);
    }
    if (typeof descriptor.type !== 'string' || !descriptor.type.startsWith('image/')) {
        throw archiveError(`${role}-type-invalid`);
    }
    const size = Number(descriptor.size);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_ENTRY_BYTES) {
        throw archiveError(`${role}-size-invalid`);
    }
};

const readAsset = async (files, descriptor, role) => {
    validateDescriptor(descriptor, role);
    const bytes = files[descriptor.path];
    if (!bytes || bytes.byteLength !== descriptor.size) throw archiveError(`${role}-asset-missing`);
    if (descriptor.sha256) {
        const digest = await sha256(bytes);
        if (digest && digest !== descriptor.sha256) throw archiveError(`${role}-checksum-mismatch`);
    }
    return new File([bytes], descriptor.name || role, { type: descriptor.type });
};

export async function readWorkspaceArchive(blob, { expectedKind } = {}) {
    if (!(blob instanceof Blob) || blob.size <= 0) throw archiveError('archive-empty');
    if (blob.size > MAX_ARCHIVE_BYTES) throw archiveError('archive-too-large');
    const bytes = await toBytes(blob);
    let rejectedEntry = false;
    let entryCount = 0;
    let declaredTotal = 0;
    const files = await unzipAsync(bytes, {
        filter(entry) {
            entryCount += 1;
            const allowed = entry.name === MANIFEST_PATH
                || /^assets\/(image|background)\.[a-z0-9]+$/.test(entry.name)
                || /^assets\/images\/\d{2}\.[a-z0-9]+$/.test(entry.name);
            const originalSize = Number(entry.originalSize);
            if (!allowed || entryCount > MAX_ENTRY_COUNT || !Number.isFinite(originalSize) || originalSize > MAX_ENTRY_BYTES) {
                rejectedEntry = true;
                return false;
            }
            declaredTotal += originalSize;
            if (declaredTotal > MAX_TOTAL_BYTES) {
                rejectedEntry = true;
                return false;
            }
            return true;
        },
    });
    if (rejectedEntry) throw archiveError('archive-entry-rejected');
    const manifestBytes = files[MANIFEST_PATH];
    if (!manifestBytes || manifestBytes.byteLength > 512 * 1024) throw archiveError('manifest-missing');
    let manifest;
    try {
        manifest = JSON.parse(strFromU8(manifestBytes));
    } catch {
        throw archiveError('manifest-invalid-json');
    }
    if (manifest?.format !== 'screenhello' || Number(manifest.containerVersion) !== WORKSPACE_CONTAINER_VERSION) {
        throw archiveError('container-version-unsupported');
    }
    if (!['project', 'preset'].includes(manifest.kind) || (expectedKind && manifest.kind !== expectedKind)) {
        throw archiveError('archive-kind-invalid');
    }
    const imageDescriptors = Array.isArray(manifest.assets?.images)
        ? manifest.assets.images
        : (manifest.assets?.image ? [manifest.assets.image] : []);
    if (imageDescriptors.length > MAX_PROJECT_IMAGES) throw archiveError('project-image-count-invalid');
    const expectedPaths = new Set([
        MANIFEST_PATH,
        ...imageDescriptors.map((descriptor) => descriptor?.path),
        ...(manifest.assets?.background?.path ? [manifest.assets.background.path] : []),
    ]);
    if (Object.keys(files).some((path) => !expectedPaths.has(path))) throw archiveError('archive-entry-rejected');
    const images = [];
    for (const descriptor of imageDescriptors) {
        const file = await readAsset(files, descriptor, 'image');
        images.push({ file, assetId: descriptor.assetId || null, id: descriptor.id || null });
    }
    const background = manifest.assets?.background
        ? await readAsset(files, manifest.assets.background, 'background')
        : null;
    if (manifest.kind === 'project') {
        const validation = validateDocument(manifest.document);
        if (!validation.ok || !images.length || validation.doc.images.length !== images.length) {
            throw archiveError('project-document-invalid');
        }
        const sharedAssets = new Map();
        validation.doc.images.forEach((layer, index) => {
            const descriptor = imageDescriptors[index];
            if ((descriptor.assetId && layer.assetId && descriptor.assetId !== layer.assetId)
                || (descriptor.id && descriptor.id !== layer.id)) {
                throw archiveError('project-document-invalid');
            }
            const assetId = layer.assetId || descriptor.assetId;
            if (!assetId) return;
            const fingerprint = [descriptor.path, descriptor.type, descriptor.size, descriptor.sha256 || ''].join('|');
            const previous = sharedAssets.get(assetId);
            if (previous && previous !== fingerprint) throw archiveError('project-asset-conflict');
            sharedAssets.set(assetId, fingerprint);
        });
        const document = structuredClone(validation.doc);
        document.images = document.images.map((layer, index) => ({
            ...layer,
            assetId: layer.assetId || images[index].assetId,
        }));
        return {
            kind: 'project',
            name: normalizeWorkspaceName(manifest.name, '未命名项目'),
            document,
            exportSettings: normalizeExportSettings(manifest.exportSettings),
            image: images[0].file,
            images,
            background,
        };
    }
    const validation = validateStylePreset(manifest.preset);
    if (!validation.ok) throw archiveError('preset-invalid');
    if (validation.preset.option.background === 'upload_image' && !background) {
        throw archiveError('background-asset-missing');
    }
    return {
        kind: 'preset',
        name: validation.preset.name,
        preset: validation.preset,
        background,
    };
}
