import { describe, expect, it } from 'vitest';
import {
    PWA_APP_SHELL_MAX_BYTES,
    WEB_ICON_FILES,
    createCoreManifestTransform,
    createPwaOptions,
    isCorePrecacheEntry,
    matchesRuntimeBuildAsset,
    normalizeWebBase,
} from '../../config/pwaConfig.js';
import { getInstallMode, getUpdateBlockReason } from '../../src/pwa/pwaSupport.js';

describe('PWA build contract', () => {
    it('derives manifest, scope, and icon paths from the normalized Vite base', () => {
        expect(normalizeWebBase()).toBe('/');
        expect(normalizeWebBase('tools/screenhello')).toBe('/tools/screenhello/');

        const options = createPwaOptions('/tools/screenhello/');
        expect(options).toMatchObject({
            injectRegister: false,
            registerType: 'prompt',
            includeManifestIcons: false,
            base: '/tools/screenhello/',
            scope: '/tools/screenhello/',
            devOptions: { enabled: false },
            manifest: {
                name: 'ScreenHello — 本地截图美化工具',
                short_name: 'ScreenHello',
                start_url: '/tools/screenhello/',
                scope: '/tools/screenhello/',
                display: 'standalone',
                theme_color: '#111318',
                background_color: '#111318',
            },
            workbox: {
                cleanupOutdatedCaches: true,
                clientsClaim: false,
                skipWaiting: false,
                navigateFallback: 'index.html',
            },
        });
        expect(options.manifest.icons).toEqual([
            { src: '/tools/screenhello/web-app-manifest-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/tools/screenhello/web-app-manifest-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/tools/screenhello/pwa-maskable-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: '/tools/screenhello/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ]);
    });

    it('precaches only the core shell and keeps heavy or low-frequency assets out', () => {
        const included = [
            ['index.html', 2_400],
            ['assets/index-AbCd1234.js', 240_000],
            ['assets/index-EfGh5678.css', 70_000],
            ['assets/vendor-radix-EfGh5678.css', 190_000],
            ['assets/rolldown-runtime-AbCd1234.js', 2_000],
            ['assets/useStores-A1_b2-C3.js', 180_000],
            ['assets/useI18n-A1_b2-C3.js', 160_000],
            ['assets/i18n-catalogs-A1_b2-C3.js', 320_000],
            ['assets/utils-A1_b2-C3.js', 120_000],
            ['assets/browser-A1_b2-C3.js', 18_000],
            ['assets/codeCardSchema-A1_b2-C3.js', 2_400],
            ['assets/PurePanel-AbCd1234.js', 120_000],
            ['assets/Icon-AbCd1234.js', 135_000],
            ['assets/exportService-AbCd1234.js', 160_000],
            ['assets/backgroundConfig-AbCd1234.js', 15_000],
            ['assets/stylePreset-AbCd1234.js', 10_000],
            ['assets/jsx-runtime-AbCd1234.js', 9_000],
            ['assets/mobx-AbCd1234.js', 45_000],
            ['assets/perspectiveSchema-AbCd1234.js', 3_000],
            ['assets/textCardSchema-AbCd1234.js', 3_000],
            ['assets/vendor-react-AbCd1234.js', 180_000],
            ['assets/vendor-antd-AbCd1234.js', 260_000],
            ['assets/vendor-rc-AbCd1234.js', 200_000],
            ['assets/vendor-leafer-AbCd1234.js', 220_000],
            ['assets/vendor-radix-AbCd1234.js', 80_000],
            ['assets/watermarkSchema-AbCd1234.js', 3_000],
            ['assets/workbox-window.prod.es5-AbCd1234.js', 6_000],
            ['assets/logo-AbCd1234.png', 100_000],
            ['assets/favicon-AbCd1234.png', 15_000],
            ['assets/ambient-import-AbCd1234.webp', 80_000],
            ['assets/color-AbCd1234.svg', 2_000],
            ['assets/13-green-AbCd1234.webp', 80_000],
            ['pwa-maskable-512x512.png', 300_000],
            ...WEB_ICON_FILES.map(filename => [filename, 100]),
        ];
        const excluded = [
            ['assets/demo-mobile-AbCd1234.webp', 53_404],
            ['assets/demo-desktop-AbCd1234.webp', 162_160],
            ['assets/avif_enc-AbCd1234.wasm', 3_500_000],
            ['assets/avifEncoder.worker-AbCd1234.js', 22_000],
            ['assets/EmojiPicker-AbCd1234.js', 510_000],
            ['assets/BatchExportPanel-AbCd1234.js', 6_000],
            ['assets/CropperDialog-AbCd1234.js', 42_000],
            ['assets/CodeCardDialog-AbCd1234.js', 28_000],
            ['assets/TextCardDialog-AbCd1234.js', 24_000],
            ['assets/textCardRenderer-AbCd1234.js', 14_000],
            ['assets/perspectiveRenderer-AbCd1234.js', 12_000],
            ['assets/SceneTemplateModal-AbCd1234.js', 16_000],
            ['assets/sceneTemplates-AbCd1234.js', 8_000],
            ['assets/MotionExportDialog-AbCd1234.js', 22_000],
            ['assets/animationPresets-AbCd1234.js', 4_000],
            ['assets/animationFrameRenderer-AbCd1234.js', 6_000],
            ['assets/gifEncoder-AbCd1234.js', 14_000],
            ['assets/gifEncoder.worker-AbCd1234.js', 14_000],
            ['assets/13-green-AbCd1234.jpg', 900_000],
            ['assets/future-large-AbCd1234.webp', 120_000],
            ['project.screenhello', 2_000],
        ];

        for (const [url, size] of included) expect(isCorePrecacheEntry({ url, size }), url).toBe(true);
        for (const [url, size] of excluded) expect(isCorePrecacheEntry({ url, size }), url).toBe(false);

        const transform = createCoreManifestTransform();
        const result = transform([...included, ...excluded].map(([url, size]) => ({ url, size, revision: 'test' })));
        expect(result.manifest.map(({ url }) => url)).toEqual(included.map(([url]) => url));
        expect(result.warnings).toEqual([]);
        expect(() => transform([{ url: 'assets/index-AbCd1234.js', size: PWA_APP_SHELL_MAX_BYTES + 1 }]))
            .toThrow(/pwa-app-shell-budget-exceeded/);
    });

    it('runtime-caches only same-origin fingerprinted build assets inside the SW scope', () => {
        const request = { method: 'GET' };
        const scope = 'https://screenhello.com/tools/screenhello/';
        expect(matchesRuntimeBuildAsset({
            request,
            url: new URL('https://screenhello.com/tools/screenhello/assets/avif_enc-AbCd1234.wasm'),
        }, scope)).toBe(true);
        expect(matchesRuntimeBuildAsset({
            request,
            url: new URL('https://screenhello.com/tools/screenhello/assets/EmojiPicker-AbCd1234.js'),
        }, scope)).toBe(true);
        expect(matchesRuntimeBuildAsset({
            request,
            url: new URL('https://screenhello.com/other/assets/EmojiPicker-AbCd1234.js'),
        }, scope)).toBe(false);
        expect(matchesRuntimeBuildAsset({
            request,
            url: new URL('https://cdn.example/ tools/screenhello/assets/avif_enc-AbCd1234.wasm'.replace(' ', '')),
        }, scope)).toBe(false);
        expect(matchesRuntimeBuildAsset({
            request,
            url: new URL('https://screenhello.com/tools/screenhello/assets/project.screenhello'),
        }, scope)).toBe(false);
        expect(matchesRuntimeBuildAsset({
            request: { method: 'POST' },
            url: new URL('https://screenhello.com/tools/screenhello/assets/index-AbCd1234.js'),
        }, scope)).toBe(false);
    });
});

it('uses the same content version in the manifest and exact precache URL', () => {
    const versions = Object.fromEntries(WEB_ICON_FILES.map(filename => [filename, '123456789abc']));
    const options = createPwaOptions('/nested/', versions);
    expect(options.manifest.id).toBe('/nested/');
    expect(options.manifest.icons[0].src).toBe('/nested/web-app-manifest-192x192.png?v=123456789abc');
    const transform = options.workbox.manifestTransforms[0];
    const result = transform(WEB_ICON_FILES.map(url => ({ url, size: 10, revision: 'content-revision' })));
    expect(result.manifest.map(entry => entry.url)).toEqual(WEB_ICON_FILES.map(filename => `${filename}?v=123456789abc`));
    expect(result.manifest.every(entry => entry.revision === 'content-revision')).toBe(true);
});

describe('PWA runtime guards', () => {
    it('only exposes install UI for a real Chromium prompt or iOS manual path', () => {
        expect(getInstallMode({ standalone: true, hasPrompt: true })).toBe('installed');
        expect(getInstallMode({ hasPrompt: true })).toBe('prompt');
        expect(getInstallMode({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X)' }))
            .toBe('ios-manual');
        expect(getInstallMode({ platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ios-manual');
        expect(getInstallMode({ userAgent: 'Mozilla/5.0 Firefox/128.0' })).toBe('none');
    });

    it('blocks updates while local work is busy and requires explicit discard when dirty', () => {
        expect(getUpdateBlockReason({
            workspace: { isDirty: true, busy: 'save' },
            batch: { isBusy: false },
            exportService: { isBusy: false },
        })).toBe('busy');
        expect(getUpdateBlockReason({
            workspace: { isDirty: true, busy: null },
            batch: { isBusy: false },
            exportService: { isBusy: false },
        })).toBe('dirty');
        expect(getUpdateBlockReason({
            workspace: { isDirty: false, busy: null },
            batch: { isBusy: true },
            exportService: { isBusy: false },
        })).toBe('busy');
        expect(getUpdateBlockReason({
            workspace: { isDirty: false, busy: null },
            batch: { isBusy: false },
            exportService: { isBusy: true },
        })).toBe('busy');
        expect(getUpdateBlockReason({
            workspace: { isDirty: false, busy: null },
            batch: { isBusy: false },
            exportService: { isBusy: false },
        })).toBeNull();
    });
});
