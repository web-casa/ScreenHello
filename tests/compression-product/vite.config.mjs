import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import productConfig from '../../vite.config.js';
import { upngCjsPlugin } from '../../config/upngCodecPlugin.mjs';

export default defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)), base: './', publicDir: false,
    resolve: productConfig.resolve,
    plugins: [react(), tailwind(), upngCjsPlugin()],
    worker: productConfig.worker,
    build: { target: productConfig.build.target,
        rolldownOptions: productConfig.build.rolldownOptions,
        outDir: fileURLToPath(new URL('../../artifacts/compression-product/', import.meta.url)), emptyOutDir: true },
});
