/**
 * 每组在每个浏览器中运行于一个独立 Playwright project。
 *
 * 这些分组既保持单 worker 的串行网络边界，又会在高资源编辑/编解码场景之后
 * 重启 browser worker，避免把一整套 140 项测试累积在同一个浏览器进程中。
 * 新增 E2E spec 时必须放入恰好一个组；unit contract 会拒绝遗漏或重复。
 */
export const e2eTestGroups = [
    {
        id: 'editor',
        files: [
            'ambient-init.spec.js',
            'app.spec.js',
            'brand-assets.spec.js',
            'compression-batch.spec.js',
            'compression-ui.spec.js',
            'compression.spec.js',
            'devicescss-devices.spec.js',
            'i18n.spec.js',
        ],
    },
    {
        id: 'runtime',
        files: [
            'phase85-baseline.spec.js',
            'phase852-menu.spec.js',
            'phase853-discovery.spec.js',
            'phase854-mobile.spec.js',
            'pixel-readback.spec.js',
            'preset-backgrounds.spec.js',
            'privacy.spec.js',
            'raster-device.spec.js',
            'iphone-duo.spec.js',
            'recovery.spec.js',
            'seo.spec.js',
            'theme-readability.spec.js',
        ],
    },
];
