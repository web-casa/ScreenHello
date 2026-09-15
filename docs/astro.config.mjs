// ScreenHello 公开文档站：Fumadocs 16 + Astro 7 静态生成。
// 站点挂载在 /docs/{locale}/{topic}/，默认语言也保留前缀，与旧站的语言优先结构一致。
// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';
import { unified } from '@astrojs/markdown-remark';
import {
    rehypeCode,
    remarkCodeTab,
    remarkHeading,
    remarkNpm,
    remarkStructure,
} from 'fumadocs-core/mdx-plugins';
import { DOCS_LOCALES } from './src/lib/content.mjs';
import { siteOptions } from '../site/site.mjs';

const deployment = siteOptions({
    base: process.env.SCREENHELLO_BASE_PATH || '/',
    origin: process.env.SCREENHELLO_SITE_ORIGIN || 'https://screenhello.com',
    indexable: process.env.SCREENHELLO_SITE_INDEXABLE !== 'false',
});

const remarkPlugins = [
    remarkHeading,
    remarkCodeTab,
    remarkNpm,
    [remarkStructure, { exportAs: 'structuredData' }],
];
const rehypePlugins = [rehypeCode];

export default defineConfig({
    outDir: './dist',
    base: deployment.base,
    site: deployment.origin,
    trailingSlash: 'always',
    // Cloudflare Pages 直接把 /docs/zh-cn/beautify/ 映射到同名 index.html。
    build: { format: 'directory' },
    i18n: {
        locales: DOCS_LOCALES,
        defaultLocale: 'en',
        routing: {
            // 默认语言也带前缀：/docs/en/... 与 /docs/zh-cn/... 结构完全对称。
            prefixDefaultLocale: true,
            redirectToDefaultLocale: false,
        },
    },
    markdown: {
        processor: unified({
            syntaxHighlight: false,
            remarkPlugins,
            rehypePlugins,
        }),
    },
    integrations: [
        react(),
        mdx({
            extendMarkdownConfig: true,
            syntaxHighlight: false,
        }),
    ],
    vite: {
        plugins: [tailwindcss()],
        resolve: {
            alias: { '@': new URL('./src', import.meta.url).pathname },
        },
    },
});
