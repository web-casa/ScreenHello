// WebKit can retain a failed modulepreload resource across reloads (270357).
// Let the real dynamic import fetch codec JS; retain CSS dependencies and all
// unrelated preload optimization. No eager codec fetch or cache-busting retry.
export function resolveCodecPreloads(filename, dependencies, { hostType }) {
    if (hostType !== 'js' || !/(?:^|\/)(?:png|webp|avif)Encoder-[A-Za-z0-9_-]+\.js$/.test(filename)) return dependencies;
    return dependencies.filter(dependency => !dependency.endsWith('.js'));
}

// Vite applies dependency filtering after the default chunk hash is computed.
// Include the policy in hashing so immutable URLs cannot keep the old helper.
export function codecPreloadHashPlugin() {
    return { name: 'screenhello-codec-preload-hash', augmentChunkHash: () => `screenhello-codec-preload-v1:${resolveCodecPreloads.toString()}` };
}
