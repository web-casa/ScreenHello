import manifest from '@assets/devicescss/manifest.json';

/**
 * Devices.css 机型素材（MIT，见 vendor/devices.css/ 与 ASSET_PROVENANCE.md）。
 *
 * 素材由 `scripts/generate-devicescss-assets.mjs` 在构建期从 CSS 渲染成固定 PNG：
 * 机身、缩略图、屏幕 alpha 掩膜，加上这里读的 manifest.json（几何/配色/文件名的唯一事实来源）。
 * 因此运行时不需要 DOM 光栅化、不需要第三方前端代码，走的是与 Surface 相同的位图设备管线。
 *
 * 许可状态是明确的 MIT，所以下载前不弹素材许可说明（deviceLicenseService 对 MIT 直接放行）。
 */
const assets = import.meta.glob('../assets/devicescss/*.png', {
    eager: true, query: '?url&no-inline', import: 'default',
});

const urlOf = (file) => assets[`../assets/devicescss/${file}`] || null;

export const DEVICESCSS_SOURCE = 'https://github.com/picturepan2/devices.css';
export const DEVICESCSS_LICENSE = 'https://github.com/picturepan2/devices.css/blob/master/LICENSE';

export const DEVICESCSS_DEVICES = Object.freeze(Object.fromEntries(manifest.map((entry) => {
    const image = urlOf(entry.shell);
    const mask = urlOf(entry.mask);
    const thumb = urlOf(entry.thumb);
    return [entry.id, Object.freeze({
        id: entry.id,
        model: entry.model,
        title: entry.title,
        color: entry.color,
        colorTitle: entry.colorTitle,
        swatch: entry.swatch,
        width: entry.sourceWidth,
        height: entry.sourceHeight,
        screenAspect: entry.screenAspect,
        corners: entry.corners,
        image,
        mask,
        thumb,
        available: Boolean(image && mask && thumb),
        // 许可信息：DeviceSource 会显示作者与链接，deviceLicenseService 对 MIT 不弹确认
        author: 'Devices.css / Yan Zhu',
        licenseStatus: 'MIT',
        sourceProject: 'Devices.css',
        source: DEVICESCSS_SOURCE,
        license: DEVICESCSS_LICENSE,
        deviceKind: entry.kind,
    })];
})));
