// Worker-safe URL policy for scalar codec WASM files. Bundled assets must stay
// on the WebView's own frontend origin; asset: intentionally remains excluded
// because it can address user-selected files through Tauri's asset protocol.
const LOCAL_FRONTEND_PROTOCOLS = new Set(['http:', 'https:', 'tauri:']);

const invalid = () => new Error('codec-resource-url-untrusted');

export function trustedCodecResourceUrl(value, base = globalThis.location?.href) {
    if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 4_096) throw invalid();
    if (typeof base !== 'string' || !base || base.length > 4_096) throw invalid();

    let frontend;
    let resource;
    try {
        frontend = new URL(base);
        resource = new URL(value, frontend);
    } catch {
        throw invalid();
    }

    // URL.origin is opaque for tauri:, so compare the normalized protocol and
    // host instead. This admits tauri://localhost on macOS/Linux and
    // http://tauri.localhost on Windows, while still rejecting another host.
    if (!LOCAL_FRONTEND_PROTOCOLS.has(frontend.protocol)
        || resource.protocol !== frontend.protocol
        || resource.host !== frontend.host
        || resource.username
        || resource.password) throw invalid();
    return resource.href;
}
