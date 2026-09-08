export const PWA_APP_SHELL_MAX_BYTES = 3 * 1024 * 1024;
export const PWA_PRECACHE_FILE_MAX_BYTES = 1024 * 1024;
export const PWA_RUNTIME_CACHE_MAX_ENTRIES = 64;
export const PWA_RUNTIME_CACHE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const CORE_JAVASCRIPT_PREFIXES = [
    'Icon',
    'PurePanel',
    'backgroundConfig',
    'browser',
    'exportService',
    'exportAsync',
    'exportSettings',
    'index',
    'i18n-catalogs',
    'jsx-runtime',
    'mobx',
    'stylePreset',
    'useI18n',
    'useStores',
    'utils',
    'workbox-window.prod.es5',
];
const CORE_IMAGE_PREFIXES = ['favicon', 'logo'];
const PWA_ICON_PATTERN = /^pwa-maskable-(?:192x192|512x512)\.png$/;
export const WEB_ICON_FILES = Object.freeze([
    'apple-touch-icon.png', 'favicon-96x96.png', 'favicon.ico', 'favicon.svg',
    'web-app-manifest-192x192.png', 'web-app-manifest-512x512.png',
]);

export const versionWebIconUrl = (filename, versions = {}) => (
    WEB_ICON_FILES.includes(filename) && versions[filename]
        ? `${filename}?v=${versions[filename]}` : filename
);
const HASHED_ASSET_PATTERN = /^assets\/([^/]+)-[A-Za-z0-9_-]{8,}\.(\w+)$/;

export const normalizeWebBase = (value = '/') => {
    const raw = String(value || '/').trim();
    let pathname = raw;
    if (/^https?:\/\//i.test(raw)) pathname = new globalThis.URL(raw).pathname;
    if (pathname === '.' || pathname === './') return '/';
    const withLeadingSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
    return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
};

const hasPrefix = (value, prefixes) => prefixes.some((prefix) => value === prefix || value.startsWith(`${prefix}-`));

export const isCorePrecacheEntry = ({ url, size = 0 } = {}) => {
    const normalizedUrl = String(url || '').replace(/^\/+/, '');
    const bytes = Number(size) || 0;
    if (normalizedUrl === 'index.html' || normalizedUrl === 'manifest.webmanifest') return true;
    if (PWA_ICON_PATTERN.test(normalizedUrl)) return true;
    if (WEB_ICON_FILES.includes(normalizedUrl)) return true;

    const match = normalizedUrl.match(HASHED_ASSET_PATTERN);
    if (!match) return false;
    const [, basename, extension] = match;
    if (extension === 'js') return hasPrefix(basename, CORE_JAVASCRIPT_PREFIXES);
    if (extension === 'css') return basename === 'index';
    if (extension === 'svg') return true;
    if (extension === 'png') return hasPrefix(basename, CORE_IMAGE_PREFIXES);
    // Full preset backgrounds load on selection, even when individually small.
    if (extension === 'webp') return !basename.startsWith('bg-image-') && !basename.startsWith('demo-') && bytes > 0 && bytes <= 96 * 1024;
    return false;
};

export const createCoreManifestTransform = (iconVersions = {}) => (entries) => {
    // Match the exact HTML/manifest URLs, including their content version. Do
    // not ignore arbitrary query strings or serve an older icon for a new URL.
    const manifest = entries.filter(isCorePrecacheEntry).map(entry => ({
        ...entry, url: versionWebIconUrl(entry.url, iconVersions),
    }));
    const totalBytes = manifest.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0);
    if (totalBytes > PWA_APP_SHELL_MAX_BYTES) {
        throw new Error(`pwa-app-shell-budget-exceeded:${totalBytes}:${PWA_APP_SHELL_MAX_BYTES}`);
    }
    return { manifest, warnings: [] };
};

// Workbox serializes this function into the generated SW. Keep every matcher
// literal inside the function: no module closure can exist in the worker.
export function matchesRuntimeBuildAsset({ request, url }, scopeUrl = globalThis.self?.registration?.scope) {
    if (request?.method !== 'GET' || !url || !scopeUrl) return false;
    const scope = new globalThis.URL(scopeUrl);
    const scopePath = scope.pathname.endsWith('/') ? scope.pathname : `${scope.pathname}/`;
    if (url.origin !== scope.origin || !url.pathname.startsWith(`${scopePath}assets/`)) return false;
    const filename = url.pathname.slice(`${scopePath}assets/`.length);
    return /^[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css|wasm|jpg|jpeg|png|webp|svg)$/.test(filename);
}

export const createPwaOptions = (baseValue = '/', iconVersions = {}) => {
    const base = normalizeWebBase(baseValue);
    const icon = (filename, sizes, purpose) => ({
        src: `${base}${versionWebIconUrl(filename, iconVersions)}`,
        sizes,
        type: 'image/png',
        purpose,
    });

    return {
        base,
        scope: base,
        injectRegister: false,
        registerType: 'prompt',
        // Icons are already selected by the audited PNG glob. Avoid appending a
        // second copy of each manifest icon to Workbox's precache manifest.
        includeManifestIcons: false,
        devOptions: { enabled: false },
        manifest: {
            id: base,
            name: 'ScreenHello — 本地截图美化工具',
            short_name: 'ScreenHello',
            description: '纯本地运行的截图美化、批量处理与导出工具。',
            lang: 'zh-CN',
            start_url: base,
            scope: base,
            display: 'standalone',
            theme_color: '#111318',
            background_color: '#111318',
            icons: [
                icon('web-app-manifest-192x192.png', '192x192', 'any'),
                icon('web-app-manifest-512x512.png', '512x512', 'any'),
                icon('pwa-maskable-192x192.png', '192x192', 'maskable'),
                icon('pwa-maskable-512x512.png', '512x512', 'maskable'),
            ],
        },
        workbox: {
            cacheId: 'screenhello',
            cleanupOutdatedCaches: true,
            clientsClaim: false,
            skipWaiting: false,
            navigateFallback: 'index.html',
            // NavigationRoute tests pathname + search. Never serve the editor
            // for product/help pages, missing routes or private deployment paths.
            navigateFallbackAllowlist: [new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:index\\.html)?(?:\\?.*)?$`)],
            // The plugin appends manifest.webmanifest itself. Matching it here
            // would create a duplicate precache entry.
            globPatterns: ['**/*.{html,js,css,ico,png,svg,webp}'],
            maximumFileSizeToCacheInBytes: PWA_PRECACHE_FILE_MAX_BYTES,
            manifestTransforms: [createCoreManifestTransform(iconVersions)],
            runtimeCaching: [{
                urlPattern: matchesRuntimeBuildAsset,
                handler: 'CacheFirst',
                method: 'GET',
                options: {
                    cacheName: 'screenhello-runtime-assets-v1',
                    cacheableResponse: { statuses: [200] },
                    expiration: {
                        maxEntries: PWA_RUNTIME_CACHE_MAX_ENTRIES,
                        maxAgeSeconds: PWA_RUNTIME_CACHE_MAX_AGE_SECONDS,
                        purgeOnQuotaError: true,
                    },
                },
            }],
            offlineGoogleAnalytics: false,
            navigationPreload: false,
            disableDevLogs: true,
            sourcemap: false,
        },
    };
};
