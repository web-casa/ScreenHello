import { defineConfig, esmExternalRequirePlugin } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { createPwaOptions, normalizeWebBase } from './config/pwaConfig.js';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const libraryPeers = Object.keys(pkg.peerDependencies || {});
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const libraryPeerPatterns = libraryPeers.map((dependency) => new RegExp(`^${escapeRegExp(dependency)}(?:/|$)`));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const browserTargets = ['chrome111', 'edge111', 'firefox128', 'safari16.4'];

const resolve = (url) => path.resolve(__dirname, url);
const type = process.env.NODE_TYPE;
const webBase = normalizeWebBase(process.env.SCREENHELLO_BASE_PATH || '/');
const buildConf = {
    base: type === 'lib' ? './' : webBase,
    build: { target: browserTargets },
};

// Vite library mode emits `new URL("assets/...", import.meta.url)` for `?no-inline`
// assets. A consumer's dependency optimizer may relocate that JS chunk without the
// sibling assets. Keep real ESM asset imports in the published output so the host
// bundler owns the final URL and can copy/fingerprint the files normally.
const preserveLibraryAssetImports = () => ({
    name: 'screenhello-preserve-library-asset-imports',
    enforce: 'post',
    generateBundle(_options, bundle) {
        const assetUrlPattern = /new URL\((["'])(assets\/[^"'\\]+)\1,\s*import\.meta\.url\)\.href/g;
        for (const output of Object.values(bundle)) {
            if (output.type !== 'chunk') continue;
            const imports = new Map();
            output.code = output.code.replace(assetUrlPattern, (match, _quote, assetPath) => {
                // Worker 必须保持 new Worker(new URL(...)) 形态，供宿主 Vite 识别；
                // 把包内 .js?url 作为普通依赖导入会被 Rolldown 优化器当成 JS 模块。
                if (/\.worker-[^/]+\.js$/.test(assetPath)) return match;
                if (!imports.has(assetPath)) {
                    const assetQuery = assetPath.endsWith('.wasm') ? '?url&no-inline' : '';
                    imports.set(assetPath, {
                        identifier: `__screenhello_asset_${imports.size}`,
                        // 裸 `.wasm` import 会被宿主 Vite 当成原生 WASM 模块；
                        // 显式 URL 同时让宿主接管复制/指纹，并保持资源独立按需加载。
                        specifier: `./${assetPath}${assetQuery}`,
                    });
                }
                return imports.get(assetPath)?.identifier || match;
            });
            if (imports.size) {
                const importBlock = [...imports.values()].map(({ identifier, specifier }) => (
                    `import ${identifier} from "${specifier}";`
                )).join('\n');
                output.code = `${importBlock}\n${output.code}`;
            }
            // 非 HTML ESM input 仍会保留 Vite 的动态导入 wrapper。宿主 Vite 会在
            // 二次构建时声明同名 helper，因此发布产物使用包内私有名称避免绑定冲突。
            output.code = output.code.replace(/\b__vitePreload\b/g, '__screenhelloPreload');
        }
    },
});

// 用于上传npm包
if (type === 'lib') {
    buildConf.base = './';
    buildConf.build = {
        ...buildConf.build,
        // Vite 的 build.lib 会无条件内联全部资产，包含多 MiB WASM。使用非 HTML
        // ESM input 保留相同公共入口，同时让 AVIF Worker/WASM 继续独立、按需加载。
        cssCodeSplit: false,
        copyPublicDir: false,
        minify: false,
        // 发布包保留原生 dynamic import，由宿主构建器基于最终图生成 preload；
        // 否则当前构建注入的 __vitePreload 会与宿主 Vite 再注入的同名 helper 冲突。
        modulePreload: false,
        rolldownOptions: {
            input: resolve('./src/index.js'),
            preserveEntrySignatures: 'strict',
            plugins: [esmExternalRequirePlugin({
                // 只 external 明确的宿主依赖，其余实现依赖随 library 构建。该插件
                // 同时把 bundled CJS 中的 external require 改写为浏览器 ESM import。
                external: libraryPeerPatterns,
            })],
            output: {
                entryFileNames: 'image-beautifier.es.js',
                chunkFileNames: '[name]-[hash].js',
                assetFileNames: (assetInfo) => assetInfo.name === 'style.css'
                    ? 'style.css'
                    : 'assets/[name]-[hash][extname]',
            },
        },
        outDir: 'lib', // 打包后存放的目录文件
    }
}

// https://vitejs.dev/config/
export default defineConfig({
    optimizeDeps: {
        // 根应用只扫描自己的入口；tests/consumer 是独立安装、独立启动的真实包消费端。
        entries: ['index.html'],
        // jSquash 官方文档要求 Vite 不预构建其动态 WASM 路径；实际生产构建仍由 Vite 接管资源 URL。
        exclude: ['@jsquash/avif', '@jsquash/webp'],
    },
    resolve: {
        // 根应用与嵌套/已安装 consumer fixture 必须解析到同一组宿主实例。
        dedupe: libraryPeers,
        alias: {
            '@components': resolve('./src/components'),
            '@assets': resolve('./src/assets'),
            '@style': resolve('./src/style'),
            '@stores': resolve('./src/stores'),
            '@utils': resolve('./src/utils'),
            '@hooks': resolve('./src/hooks'),
        },
        extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json'], // 省略扩展名
    },
    preview: {
        // Release browsers run in a sibling Docker container and reach the host through this explicit gateway name.
        allowedHosts: ['host.docker.internal'],
    },
    plugins: [
        tailwindcss(),
        react(),
        ...(type === 'lib'
            ? [preserveLibraryAssetImports()]
            : [VitePWA(createPwaOptions(webBase))]),
    ],
    ...buildConf
});
