import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('editor and typecheck path aliases', () => {
    it.each(['jsconfig.json', 'tsconfig.check.json'])('%s matches every Vite alias', (name) => {
        const { compilerOptions } = JSON.parse(readFileSync(path.join(root, name), 'utf8'));
        for (const [alias, directory] of Object.entries(viteConfig.resolve.alias)) {
            const patterns = compilerOptions.paths[`${alias}/*`];
            expect(patterns, `${name}: ${alias}/*`).toHaveLength(1);
            expect(path.resolve(root, compilerOptions.baseUrl, patterns[0])).toBe(path.join(directory, '*'));
        }
        expect(path.resolve(root, compilerOptions.baseUrl, compilerOptions.paths['@stores'][0]))
            .toBe(path.join(viteConfig.resolve.alias['@stores'], 'index.js'));
    });
});
