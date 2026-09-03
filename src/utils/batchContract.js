import { normalizeExportSettings } from '@utils/stylePreset';

export const MAX_BATCH_FILES = 12;
export const MAX_BATCH_BASENAME_BYTES = 120;
export const MAX_BATCH_OUTPUT_BYTES = 96 * 1024 * 1024;
export const MAX_BATCH_ARCHIVE_BYTES = 97 * 1024 * 1024;
export const BATCH_ARCHIVE_MIME = 'application/zip';

export const batchError = (code, cause) => {
    const error = Object.assign(new Error(code), { code });
    if (cause !== undefined) error.cause = cause;
    return error;
};

const utf8Length = (value) => new TextEncoder().encode(value).byteLength;
const RESERVED_FILENAME_CHARACTERS = new Set(Array.from('<>:"/\\|?*'));
const isControlCharacter = (character) => {
    const code = character.codePointAt(0);
    return code <= 31 || code === 127;
};

const truncateUtf8 = (value, maxBytes) => {
    let output = '';
    let bytes = 0;
    for (const character of value) {
        const size = utf8Length(character);
        if (bytes + size > maxBytes) break;
        output += character;
        bytes += size;
    }
    return output;
};

export const sanitizeBatchBasename = (value) => {
    const leaf = String(value ?? '').split(/[\\/]/u).at(-1) || '';
    const dot = leaf.lastIndexOf('.');
    const withoutExtension = dot > 0 ? leaf.slice(0, dot) : leaf;
    const normalized = typeof withoutExtension.normalize === 'function'
        ? withoutExtension.normalize('NFC')
        : withoutExtension;
    const safe = Array.from(normalized, (character) => (
        RESERVED_FILENAME_CHARACTERS.has(character) || isControlCharacter(character) ? '-' : character
    )).join('')
        .replace(/\s+/gu, ' ')
        .replace(/-+/gu, '-')
        .replace(/^[\s.-]+|[\s.-]+$/gu, '');
    const base = safe && safe !== '.' && safe !== '..' ? safe : 'image';
    return truncateUtf8(base, MAX_BATCH_BASENAME_BYTES).replace(/[\s.-]+$/gu, '') || 'image';
};

export const createBatchEntryNamer = ({ format, ratio }) => {
    const settings = normalizeExportSettings({ format, ratio });
    const occurrences = new Map();
    const used = new Set();
    return (inputName) => {
        const base = sanitizeBatchBasename(inputName);
        const key = base.toLowerCase();
        let occurrence = (occurrences.get(key) || 0) + 1;
        let deduplicated = occurrence === 1 ? base : `${base}-${occurrence}`;
        while (used.has(deduplicated.toLowerCase())) {
            occurrence += 1;
            deduplicated = `${base}-${occurrence}`;
        }
        occurrences.set(key, occurrence);
        used.add(deduplicated.toLowerCase());
        const scale = settings.ratio > 1 ? `@${settings.ratio}` : '';
        return `${deduplicated}-screenhello${scale}.${settings.format}`;
    };
};

export const isSafeBatchEntryName = (name) => typeof name === 'string'
    && name.length > 0
    && name !== '.'
    && name !== '..'
    && Array.from(name).every((character) => !isControlCharacter(character) && character !== '/' && character !== '\\')
    && utf8Length(name) <= MAX_BATCH_BASENAME_BYTES + 48;

export const captureCurrentBatchStyleSource = (root) => {
    const option = structuredClone(root.option.toDocument());
    const liveBackground = root.option.frameConf?.background;
    const backgroundAsset = root.assetStore.get(root.option.backgroundAssetId);
    return {
        kind: 'snapshot',
        option,
        exportSettings: normalizeExportSettings(root.workspace.exportSettings),
        backgroundBlob: backgroundAsset?.blob || null,
        backgroundName: backgroundAsset?.name || 'background',
        backgroundType: backgroundAsset?.type || null,
        backgroundUrl: backgroundAsset?.blob ? null : (liveBackground?.type === 'image' ? liveBackground.url : null),
    };
};
