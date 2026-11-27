// Exact local extraction only. Missing optional packs never cause remote fetches.
// The library boundary plugin replaces this module with an empty map.
// Handheld variants were withdrawn; keeping old local files must not bundle them.
export const IPHONE_DUO_ASSETS = import.meta.glob([
    '../../local-device-assets/iphone-duo-portrait-v1*.png',
    '../../local-device-assets/iphone-duo-landscape-v1*.png',
], {
    eager: true, query: '?url&no-inline', import: 'default',
});
