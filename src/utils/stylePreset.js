import { normalizeOption } from '@utils/projectDocument';

export const STYLE_PRESET_VERSION = 1;
export const EXPORT_FORMATS = ['png', 'jpg', 'webp', 'avif'];
export const EXPORT_RATIOS = [1, 2, 3];

export const normalizeWorkspaceName = (value, fallback = '未命名') => {
    const printable = Array.from(String(value ?? ''))
        .filter((character) => character >= ' ' && character !== '\u007f')
        .join('');
    const clean = printable
        .replace(/[\\/:*?"<>|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
    return clean || fallback;
};

export const normalizeExportSettings = (value = {}) => ({
    format: EXPORT_FORMATS.includes(value?.format) ? value.format : 'png',
    ratio: EXPORT_RATIOS.includes(Number(value?.ratio)) ? Number(value.ratio) : 1,
});

export function createStylePreset({ id = null, name, option, exportSettings } = {}) {
    const normalizedOption = normalizeOption(option);
    // backgroundAssetId 是当前 runtime 的临时引用，不能跨会话直接复用。
    normalizedOption.backgroundAssetId = null;
    if (normalizedOption.frameConf?.background?.type === 'image') {
        normalizedOption.frameConf.background = {
            ...normalizedOption.frameConf.background,
            url: null,
        };
    }
    return {
        version: STYLE_PRESET_VERSION,
        id: typeof id === 'string' && id ? id.slice(0, 120) : null,
        name: normalizeWorkspaceName(name, '未命名预设'),
        option: normalizedOption,
        exportSettings: normalizeExportSettings(exportSettings),
    };
}

export function validateStylePreset(input) {
    const errors = [];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { ok: false, preset: createStylePreset(), errors: ['preset is not an object'] };
    }
    if (Number(input.version) !== STYLE_PRESET_VERSION) {
        errors.push(`unsupported preset version ${input.version}`);
    }
    if (!input.option || typeof input.option !== 'object' || Array.isArray(input.option)) {
        errors.push('preset option is not an object');
    }
    return {
        ok: errors.length === 0,
        preset: createStylePreset(input),
        errors,
    };
}
