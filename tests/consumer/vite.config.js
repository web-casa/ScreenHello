import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const consumerRoot = fileURLToPath(new URL('.', import.meta.url));
const consumerDist = fileURLToPath(new URL('../../artifacts/consumer-dist/', import.meta.url));

export default defineConfig({
    root: consumerRoot,
    plugins: [react()],
    resolve: {
        dedupe: [
            'react', 'react-dom', 'mobx', 'mobx-react-lite',
            '@ant-design/cssinjs', 'antd',
        ],
    },
    build: {
        outDir: consumerDist,
        emptyOutDir: true,
    },
});
