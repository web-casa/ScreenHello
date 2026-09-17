import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

/**
 * library 构建的设备素材边界插件。
 *
 * Devices.css 机型（`src/utils/devicesCssConfig.js` + `src/assets/devicescss/`）只服务独立站：
 * 它们是 2.8 MB 的第三方（MIT）位图素材，打进 library 产物只会让 npm 包无谓变大，
 * 而宿主一旦缺素材，位图设备本来就按“不可用即隐藏”降级（与可选本地素材包一致）。
 *
 * 因此 lib 构建仅保留设备 ID/几何元数据，移除素材 URL：
 * `available: false` 的条目会被 `FRAME_DEFINITIONS`/`getFrameGroups` 隐藏，
 * 站点构建与桌面构建不受影响。回归由 `pnpm audit:pwa:library` 与 consumer 用例守着。
 */
const STUB_ID = '\0screenhello-devicescss-stub';
const manifest = JSON.parse(readFileSync(new URL('../src/assets/devicescss/manifest.json', import.meta.url), 'utf8'));
const devices = Object.fromEntries(manifest.map(entry => [entry.id, {
    id: entry.id, model: entry.model, title: entry.title, color: entry.color,
    colorTitle: entry.colorTitle, swatch: entry.swatch,
    width: entry.sourceWidth, height: entry.sourceHeight,
    screenAspect: entry.screenAspect, corners: entry.corners, deviceKind: entry.kind,
    image: null, mask: null, thumb: null, available: false,
}]));
const STUB_CODE = `export const DEVICESCSS_DEVICES = Object.freeze(Object.fromEntries(
    Object.entries(${JSON.stringify(devices)}).map(([id, device]) => [id, Object.freeze(device)])
));\n`;

export const libraryDeviceBoundaryPlugin = () => ({
    name: 'screenhello-library-device-boundary',
    enforce: 'pre',
    resolveId(source) {
        if (/\biphoneDuoAssets(?:\.js)?$/.test(source)) return '\0screenhello-duo-assets-stub';
        return /\bdevicesCssConfig(?:\.js)?$/.test(source) ? STUB_ID : null;
    },
    load(id) {
        if (id === '\0screenhello-duo-assets-stub') return 'export const IPHONE_DUO_ASSETS = {};';
        return id === STUB_ID ? STUB_CODE : null;
    },
});
