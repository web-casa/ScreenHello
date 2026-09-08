// Only asset URLs are imported eagerly, not decoded images. An absent optional
// pack produces an empty glob in clean/public builds; never fetch a remote CDN.
const assets = import.meta.glob([
    '../../local-device-assets/surface-studio.png',
    '../../local-device-assets/surface-studio-screen.png',
    '../../local-device-assets/surface-pro-8.png',
    '../../local-device-assets/surface-pro-8-screen.png',
    '../../local-device-assets/macbook-pro.png',
    '../../local-device-assets/macbook-air.png',
    '../../local-device-assets/imac.png',
    '../../local-device-assets/ipad.png',
    '../../local-device-assets/iphone.png',
    '../../local-device-assets/macbook-air-m2-silver-v1.png',
    '../../local-device-assets/macbook-air-m2-silver-v1-thumb.png',
    '../../local-device-assets/macbook-air-m2-starlight-v1.png',
    '../../local-device-assets/macbook-air-m2-starlight-v1-thumb.png',
    '../../local-device-assets/macbook-air-m2-space-gray-v1.png',
    '../../local-device-assets/macbook-air-m2-space-gray-v1-thumb.png',
    '../../local-device-assets/macbook-air-m2-midnight-v1.png',
    '../../local-device-assets/macbook-air-m2-midnight-v1-thumb.png',
    '../../local-device-assets/imac-24-blue-v1.png',
    '../../local-device-assets/imac-24-blue-v1-thumb.png',
    '../../local-device-assets/imac-24-orange-v1.png',
    '../../local-device-assets/imac-24-orange-v1-thumb.png',
    '../../local-device-assets/imac-24-purple-v1.png',
    '../../local-device-assets/imac-24-purple-v1-thumb.png',
    '../../local-device-assets/imac-24-red-v1.png',
    '../../local-device-assets/imac-24-red-v1-thumb.png',
    '../../local-device-assets/imac-24-silver-v1.png',
    '../../local-device-assets/imac-24-silver-v1-thumb.png',
    '../../local-device-assets/pixel-9-pro-original-v1.png',
    '../../local-device-assets/pixel-9-pro-original-v1-thumb.png',
], {
    eager: true, query: '?url&no-inline', import: 'default',
});

const definitions = [
    {
        id: 'surface-studio', title: 'Surface Studio', width: 1440, height: 1257,
        screenAspect: 1.5,
        corners: [[63.434343, 65.456123], [1380.606061, 65.456123], [1380.606061, 943.457088], [63.434343, 943.457088]],
        author: 'Tony Thomas / Medialoot',
        source: 'https://medialoot.com/item/surface-studio-mockup/',
        license: 'https://medialoot.com/member/license/',
    },
    {
        id: 'surface-pro-8', title: 'Surface Pro', width: 1440, height: 1160,
        screenAspect: 3302 / 2074,
        corners: [[172.140745, 65.777565], [1233.097339, 62.766342], [1250.422018, 744.549779], [159.853211, 747.645048]],
        author: 'MockupFree.co',
        source: 'https://mockupfree.co/product/free-microsoft-surface-pro-8-mockup-psd-template/',
        license: 'https://mockupfree.co/licence/',
    },
];

// Original upstream bitmap bytes, installed only in the optional local pack.
// New IDs must not change saved generic/legacy projects into different artwork.
for (const [name, title, sourceWidth, sourceHeight] of [
    ['macbook-pro', 'MacBook Pro', 1920, 1266],
    ['macbook-air', 'MacBook Air', 1920, 1147],
    ['imac', 'iMac', 1920, 1599],
    ['ipad', 'iPad', 1920, 1425],
    ['iphone', 'iPhone', 968, 1920],
]) {
    const scale = Math.min(1, 1440 / Math.max(sourceWidth, sourceHeight));
    definitions.push({ id: `${name}-bitmap`, assetName: name, title, sourceWidth, sourceHeight,
        replacedBy: name === 'macbook-air' ? 'macbook-air-m2' : name === 'imac' ? 'imac-24' : null,
        width: Math.round(sourceWidth * scale), height: Math.round(sourceHeight * scale),
        maskFromAlpha: true, author: 'Shoteasy', sourceProject: 'Shoteasy', licenseStatus: 'unverified',
        source: 'https://github.com/ricocc/shoteasy', license: null });
}

const monkrSource = 'https://github.com/blaineam/Monkr/blob/33e69fb008d3ea53718ac19dae87260bd72c9cfb/static/devices';
for (const [model, title, width, height, colors] of [
    ['macbook-air-m2', 'MacBook Air M2', 1440, 936, [
        ['silver', '银色', '#d9d9d7'], ['starlight', '星光色', '#e9ddcb'],
        ['space-gray', '深空灰', '#7b7c80'], ['midnight', '午夜色', '#343d46'],
    ]],
    ['imac-24', 'iMac 24″', 1440, 1215, [
        ['blue', '蓝色', '#b4ccdf'], ['orange', '橙色', '#eaa98f'], ['purple', '紫色', '#c3bfe4'],
        ['red', '红色', '#ecc3bf'], ['silver', '银色', '#d2d3d5'],
    ]],
]) {
    for (const [color, colorTitle, swatch] of colors) definitions.push({
        id: `${model}-${color}-v1`, model, title, width, height, color, colorTitle, swatch,
        maskFromAlpha: true, author: 'Monkr', licenseStatus: 'unverified', sourceProject: 'Monkr',
        source: `${monkrSource}/${model}/${color}.png`, license: null,
    });
}
definitions.push({ id: 'pixel-9-pro-original-v1', model: 'pixel-9-pro', title: 'Pixel 9 Pro',
    width: 682, height: 1440, maskFromAlpha: true, color: 'original', colorTitle: '原始浅金属色', swatch: '#d1c6b4',
    author: 'Dimah Snisarenko / telephone', licenseStatus: 'MIT',
    source: 'https://github.com/sneas/telephone/blob/c1644a3d49dcd50ebf8c76306409c4b1d9b7a2b4/packages/telephone/src/pixel-9-pro.html.ts',
    license: 'https://github.com/sneas/telephone/blob/c1644a3d49dcd50ebf8c76306409c4b1d9b7a2b4/LICENSE',
});

export const RASTER_DEVICES = Object.freeze(Object.fromEntries(definitions.map(device => {
    const image = assets[`../../local-device-assets/${device.assetName || device.id}.png`];
    const mask = assets[`../../local-device-assets/${device.id}-screen.png`];
    const thumb = assets[`../../local-device-assets/${device.id}-thumb.png`];
    return [device.id, Object.freeze({ ...device, image, mask, thumb, available: Boolean(image && (mask || device.maskFromAlpha)) })];
})));

export const getRasterDevice = frame => Object.hasOwn(RASTER_DEVICES, frame) ? RASTER_DEVICES[frame] : null;
// Pure classification for stores. Importing frameConfig here would pull Leafer's
// Canvas platform into non-DOM store consumers and create a dependency cycle.
const legacyVectorIds = new Set(['genericLaptop', 'genericDesktop', 'genericTablet', 'genericPhone',
    'macbookpro16', 'macbookair', 'imacpro', 'ipadpro', 'iphonepro']);
export const isDeviceFrameId = frame => legacyVectorIds.has(frame) || Object.hasOwn(RASTER_DEVICES, frame);
export const getDeviceVariants = frame => {
    const selected = getRasterDevice(frame);
    return selected?.model ? Object.values(RASTER_DEVICES).filter(device => device.model === selected.model && device.available) : [];
};
