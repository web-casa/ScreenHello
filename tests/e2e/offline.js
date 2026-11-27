const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export const isLocalBrowserUrl = (url) => (
    LOCAL_HOSTS.has(url.hostname)
    || url.protocol === 'blob:'
    || url.protocol === 'data:'
);

/**
 * Keep offline assertions honest without proxying the Vite application itself.
 * Routing every request through Playwright made a local ESM cold start
 * intermittently fail with ERR_NETWORK_CHANGED. Only external requests need
 * blocking: requests for the test server should keep their native connection.
 */
export async function blockExternalRequests(page, onExternalRequest) {
    await page.route((url) => !isLocalBrowserUrl(url), (route) => {
        onExternalRequest?.(route.request().url());
        return route.abort('blockedbyclient');
    });
}

export async function openOffline(page, onExternalRequest) {
    await blockExternalRequests(page, onExternalRequest);
    await page.goto('/');
}
