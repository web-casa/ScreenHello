import { Inflate, strFromU8, strToU8, zip } from 'fflate';
import { isImageBackgroundKey } from './backgroundConfig';
import { exportSettingsWarnings } from './exportSettings';
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
const MANIFEST_MAX_BYTES = 512 * 1024;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 48 * 1024 * 1024;
const MAX_TOTAL_BYTES = 96 * 1024 * 1024;
const MAX_ENTRY_COUNT = MAX_PROJECT_IMAGES + 2;
const INFLATE_CHUNK_BYTES = 64 * 1024;
const ZIP_SIG_LFH = 0x04034b50;
const ZIP_SIG_CD = 0x02014b50;
const ZIP_SIG_EOCD = 0x06054b50;
const ZIP_SIG_ZIP64_LOCATOR = 0x07064b50;
const ZIP_UINT16_MAX = 0xffff;
const ZIP_UINT32_MAX = 0xffffffff;

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
        let value = i;
        for (let bit = 0; bit < 8; bit += 1) {
            value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
        }
        table[i] = value >>> 0;
    }
    return table;
})();

const computeCrc32 = (bytes) => {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.byteLength; i += 1) {
        crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
};

const isAllowedArchiveEntryName = (name) => (
    name === MANIFEST_PATH
    || /^assets\/(image|background)\.[a-z0-9]+$/.test(name)
    || /^assets\/images\/\d{2}\.[a-z0-9]+$/.test(name)
);

const inspectZipContainer = (bytes) => {
    const len = bytes.byteLength;
    if (len < 22) throw archiveError('archive-invalid');
    const view = new DataView(bytes.buffer, bytes.byteOffset, len);

    // 禁止非零 ZIP 注释、ZIP64 与尾部追加数据：EOCD 必须精确位于文件末尾 22 字节。
    const eocdOffset = len - 22;
    if (view.getUint32(eocdOffset, true) !== ZIP_SIG_EOCD) {
        throw archiveError('archive-invalid');
    }
    if (eocdOffset >= 20 && view.getUint32(eocdOffset - 20, true) === ZIP_SIG_ZIP64_LOCATOR) {
        throw archiveError('archive-entry-rejected');
    }

    const diskNumber = view.getUint16(eocdOffset + 4, true);
    const cdStartDisk = view.getUint16(eocdOffset + 6, true);
    const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
    const entriesTotal = view.getUint16(eocdOffset + 10, true);
    const cdSize = view.getUint32(eocdOffset + 12, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    const commentLen = view.getUint16(eocdOffset + 20, true);

    if (
        diskNumber !== 0
        || cdStartDisk !== 0
        || commentLen !== 0
        || entriesOnDisk !== entriesTotal
        || entriesTotal === 0
        || entriesTotal === ZIP_UINT16_MAX
        || entriesTotal > MAX_ENTRY_COUNT
        || cdSize === ZIP_UINT32_MAX
        || cdOffset === ZIP_UINT32_MAX
        || cdOffset + cdSize !== eocdOffset
    ) {
        throw archiveError('archive-entry-rejected');
    }

    const entries = [];
    const seenNames = new Set();
    let declaredTotal = 0;
    let cdCursor = cdOffset;

    for (let index = 0; index < entriesTotal; index += 1) {
        if (cdCursor + 46 > eocdOffset || view.getUint32(cdCursor, true) !== ZIP_SIG_CD) {
            throw archiveError('archive-invalid');
        }
        const flags = view.getUint16(cdCursor + 8, true);
        const method = view.getUint16(cdCursor + 10, true);
        const crc32 = view.getUint32(cdCursor + 16, true);
        const compressedSize = view.getUint32(cdCursor + 20, true);
        const uncompressedSize = view.getUint32(cdCursor + 24, true);
        const nameLen = view.getUint16(cdCursor + 28, true);
        const extraLen = view.getUint16(cdCursor + 30, true);
        const entryCommentLen = view.getUint16(cdCursor + 32, true);
        const lfhOffset = view.getUint32(cdCursor + 42, true);

        const cdEntryEnd = cdCursor + 46 + nameLen + extraLen + entryCommentLen;
        if (cdEntryEnd > eocdOffset) throw archiveError('archive-invalid');

        // 一律拒绝加密条目（bit 0）、数据描述符（bit 3）和未允许的压缩方法。
        if ((flags & 0x01) !== 0 || (flags & 0x08) !== 0 || (method !== 0 && method !== 8)) {
            throw archiveError('archive-entry-rejected');
        }
        if (
            compressedSize === ZIP_UINT32_MAX
            || uncompressedSize === ZIP_UINT32_MAX
            || lfhOffset === ZIP_UINT32_MAX
        ) {
            throw archiveError('archive-entry-rejected');
        }

        const name = strFromU8(bytes.subarray(cdCursor + 46, cdCursor + 46 + nameLen));
        if (!isAllowedArchiveEntryName(name) || seenNames.has(name)) {
            throw archiveError('archive-entry-rejected');
        }
        seenNames.add(name);

        const entryLimit = name === MANIFEST_PATH ? MANIFEST_MAX_BYTES : MAX_ENTRY_BYTES;
        if (uncompressedSize > entryLimit) throw archiveError('archive-entry-rejected');
        declaredTotal += uncompressedSize;
        if (declaredTotal > MAX_TOTAL_BYTES) throw archiveError('archive-entry-rejected');

        if (method === 0 && compressedSize !== uncompressedSize) {
            throw archiveError('archive-entry-rejected');
        }
        if (method === 8 && uncompressedSize > 0 && compressedSize === 0) {
            throw archiveError('archive-entry-rejected');
        }

        // 严格核对 Local File Header 与 Central Directory 一致性。
        if (lfhOffset + 30 > cdOffset || view.getUint32(lfhOffset, true) !== ZIP_SIG_LFH) {
            throw archiveError('archive-invalid');
        }
        const lfhFlags = view.getUint16(lfhOffset + 6, true);
        const lfhMethod = view.getUint16(lfhOffset + 8, true);
        const lfhCrc = view.getUint32(lfhOffset + 14, true);
        const lfhCompSize = view.getUint32(lfhOffset + 18, true);
        const lfhUncompSize = view.getUint32(lfhOffset + 22, true);
        const lfhNameLen = view.getUint16(lfhOffset + 26, true);
        const lfhExtraLen = view.getUint16(lfhOffset + 28, true);
        const dataStart = lfhOffset + 30 + lfhNameLen + lfhExtraLen;
        const dataEnd = dataStart + compressedSize;

        if (
            lfhFlags !== flags
            || lfhMethod !== method
            || lfhCrc !== crc32
            || lfhCompSize !== compressedSize
            || lfhUncompSize !== uncompressedSize
            || lfhNameLen !== nameLen
            || dataStart > cdOffset
            || dataEnd > cdOffset
        ) {
            throw archiveError('archive-entry-rejected');
        }
        const lfhName = strFromU8(bytes.subarray(lfhOffset + 30, lfhOffset + 30 + lfhNameLen));
        if (lfhName !== name) throw archiveError('archive-entry-rejected');

        entries.push({
            name,
            method,
            crc32,
            compressedSize,
            uncompressedSize,
            lfhOffset,
            dataStart,
            dataEnd,
            entryLimit,
        });
        cdCursor = cdEntryEnd;
    }

    if (cdCursor !== eocdOffset) throw archiveError('archive-invalid');

    // 严格平铺连续不变式：从偏移 0 开始逐条紧邻排列直至 Central Directory 起点，彻底阻断重叠段与隐藏附加区。
    entries.sort((a, b) => a.lfhOffset - b.lfhOffset);
    let cursor = 0;
    for (const entry of entries) {
        if (entry.lfhOffset !== cursor) throw archiveError('archive-entry-rejected');
        cursor = entry.dataEnd;
    }
    if (cursor !== cdOffset) throw archiveError('archive-entry-rejected');

    return entries;
};

const extractValidatedEntry = (bytes, entry, remainingTotalBudget) => {
    const allowedMax = Math.min(entry.entryLimit, remainingTotalBudget);
    if (entry.uncompressedSize > allowedMax) throw archiveError('archive-entry-rejected');
    const slice = bytes.subarray(entry.dataStart, entry.dataEnd);

    let output;
    if (entry.method === 0) {
        if (slice.byteLength !== entry.uncompressedSize || slice.byteLength > allowedMax) {
            throw archiveError('archive-entry-rejected');
        }
        output = slice.slice();
    } else {
        const chunks = [];
        let written = 0;
        let finished = false;
        let overflowed = false;
        const inflater = new Inflate((chunk, final) => {
            if (overflowed) return;
            if (chunk && chunk.byteLength > 0) {
                written += chunk.byteLength;
                if (written > allowedMax || written > entry.uncompressedSize) {
                    overflowed = true;
                    throw archiveError('archive-entry-rejected');
                }
                chunks.push(chunk.slice());
            }
            if (final) finished = true;
        });
        try {
            if (slice.byteLength === 0) {
                inflater.push(new Uint8Array(0), true);
            } else {
                for (let offset = 0; offset < slice.byteLength; offset += INFLATE_CHUNK_BYTES) {
                    const end = Math.min(slice.byteLength, offset + INFLATE_CHUNK_BYTES);
                    inflater.push(slice.subarray(offset, end), end >= slice.byteLength);
                }
            }
        } catch (error) {
            if (error?.code === 'archive-entry-rejected') throw error;
            throw archiveError('archive-invalid', error?.message || 'archive-invalid');
        }
        if (overflowed || !finished || written !== entry.uncompressedSize) {
            throw archiveError('archive-entry-rejected');
        }
        output = new Uint8Array(written);
        let pos = 0;
        for (const chunk of chunks) {
            output.set(chunk, pos);
            pos += chunk.byteLength;
        }
    }

    if (computeCrc32(output) !== entry.crc32) {
        throw archiveError('archive-invalid');
    }
    return output;
};
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
    if (manifestBytes.byteLength > MANIFEST_MAX_BYTES || totalBytes > MAX_TOTAL_BYTES) {
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
    if (isImageBackgroundKey(doc.option.background) && !assets.background) {
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
    if (isImageBackgroundKey(validation.preset.option.background) && !assets.background) {
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
    const validatedEntries = inspectZipContainer(bytes);
    const files = Object.create(null);
    let extractedTotal = 0;
    for (const entry of validatedEntries) {
        const extracted = extractValidatedEntry(bytes, entry, MAX_TOTAL_BYTES - extractedTotal);
        extractedTotal += extracted.byteLength;
        files[entry.name] = extracted;
    }
    const manifestBytes = files[MANIFEST_PATH];
    if (!manifestBytes || manifestBytes.byteLength > MANIFEST_MAX_BYTES) throw archiveError('manifest-missing');
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
        if (isImageBackgroundKey(validation.doc.option.background) && !background) throw archiveError('background-asset-missing');
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
            exportSettingsWarnings: exportSettingsWarnings(manifest.exportSettings),
            image: images[0].file,
            images,
            background,
        };
    }
    const validation = validateStylePreset(manifest.preset);
    if (!validation.ok) throw archiveError('preset-invalid');
    if (isImageBackgroundKey(validation.preset.option.background) && !background) {
        throw archiveError('background-asset-missing');
    }
    return {
        kind: 'preset',
        name: validation.preset.name,
        preset: validation.preset,
        exportSettingsWarnings: validation.exportSettingsWarnings,
        background,
    };
}
