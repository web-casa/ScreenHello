import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config.js';
import docsAstroConfig from '../../docs-site/astro.config.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const docsRoot = path.join(root, 'docs-site');

describe('editor and typecheck path aliases', () => {
    it.each(['jsconfig.json', 'tsconfig.check.json'])('%s matches every Vite alias without deprecated baseUrl', (name) => {
        const { compilerOptions } = JSON.parse(readFileSync(path.join(root, name), 'utf8'));
        expect(compilerOptions.baseUrl, `${name}: baseUrl is deprecated in TypeScript 6`).toBeUndefined();
        for (const [alias, directory] of Object.entries(viteConfig.resolve.alias)) {
            const patterns = compilerOptions.paths[`${alias}/*`];
            expect(patterns, `${name}: ${alias}/*`).toHaveLength(1);
            expect(path.resolve(root, patterns[0])).toBe(path.join(directory, '*'));
        }
        expect(path.resolve(root, compilerOptions.paths['@stores'][0]))
            .toBe(path.join(viteConfig.resolve.alias['@stores'], 'index.js'));
    });

    it('docs-site/tsconfig.json matches docs-site Astro Vite alias without deprecated baseUrl', () => {
        const { compilerOptions } = JSON.parse(readFileSync(path.join(docsRoot, 'tsconfig.json'), 'utf8'));
        expect(compilerOptions.baseUrl).toBeUndefined();
        const patterns = compilerOptions.paths['@/*'];
        expect(patterns).toHaveLength(1);
        expect(path.resolve(docsRoot, patterns[0])).toBe(path.join(docsAstroConfig.vite.resolve.alias['@'], '*'));
    });
});
