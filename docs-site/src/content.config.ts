import { glob } from 'astro/loaders';
import { defineCollection, z } from 'astro:content';

// 生成的 MDX 位于 content/docs/{locale}/{topic}.mdx，locale 是目录层级，
// 因此 Fumadocs 侧必须用 i18n parser: 'dir'。
const docs = defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: './content/docs' }),
    schema: z.object({
        title: z.string(),
        seoTitle: z.string(),
        description: z.string().optional(),
        reviewed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
});

const meta = defineCollection({
    loader: glob({ pattern: '**/meta.json', base: './content/docs' }),
    schema: z.object({
        title: z.string().optional(),
        pages: z.array(z.string()).optional(),
        name: z.string(),
        ui: z.record(z.string(), z.string()),
        editorLanguage: z.string(),
        open: z.string(),
        skip: z.string(),
        languages: z.string(),
        updated: z.string(),
    }),
});

export const collections = { docs, meta };
