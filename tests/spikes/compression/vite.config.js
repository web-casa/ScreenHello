import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { upngCjsPlugin } from './upngCjsPlugin.mjs';
import { VitePWA } from 'vite-plugin-pwa';
import { createPwaOptions } from '../../../config/pwaConfig.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
export default defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    base: './', publicDir: false,
    plugins: [react(), tailwind(), upngCjsPlugin(), VitePWA({
        ...createPwaOptions('/'), manifest: false, injectRegister: false, includeAssets: [],
        workbox: { ...createPwaOptions('/').workbox,
            // Isolated shell, actual product runtime-cache rule. Never cache WASM eagerly.
            globPatterns: ['index.html', 'assets/index-*.js'], manifestTransforms: [],
        },
    })],
    worker: { plugins: () => [upngCjsPlugin()] },
    resolve: { alias: Object.fromEntries(Object.entries({
        '@stores': 'stores', '@utils': 'utils', '@components': 'components',
        '@style': 'style', '@assets': 'assets', '@hooks': 'hooks',
    }).map(([key, value]) => [key, `${repo}src/${value}`])) },
    optimizeDeps: { exclude: ['@jsquash/oxipng', '@jsquash/webp', '@jsquash/avif'] },
    preview: { headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:" } },
    build: { target: ['chrome111', 'edge111', 'firefox128', 'safari16.4'],
        outDir: `${repo}artifacts/compression-spike`, emptyOutDir: true },
});
