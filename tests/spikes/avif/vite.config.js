import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    root,
    base: './',
    optimizeDeps: { exclude: ['@jsquash/avif'] },
    build: {
        target: ['chrome111', 'edge111', 'firefox128', 'safari16.4'],
        outDir: '../../../artifacts/avif-production-spike',
        emptyOutDir: true,
    },
});
