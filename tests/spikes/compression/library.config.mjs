import { mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Exercise the REAL library asset-rewrite plugin with an isolated test entry.
// No production entry, lib/ output or public export is changed by this build.
const previous = process.env.NODE_TYPE;
process.env.NODE_TYPE = 'lib';
let production;
try { production = (await import('../../../vite.config.js')).default; }
finally { if (previous === undefined) delete process.env.NODE_TYPE; else process.env.NODE_TYPE = previous; }
export default mergeConfig(production, {
    build: {
        outDir: fileURLToPath(new URL('../../../artifacts/compression-library/', import.meta.url)),
        emptyOutDir: true,
        rolldownOptions: { input: fileURLToPath(new URL('./client.js', import.meta.url)) },
    },
});
