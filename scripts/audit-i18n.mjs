import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { englishMessages } from '../src/i18n/catalog.js';
import { catalogs } from '../src/i18n/messages.js';

const walk = async (directory) => (await Promise.all((await readdir(directory, { withFileTypes: true }))
    .map((entry) => entry.isDirectory() ? walk(path.join(directory, entry.name)) : path.join(directory, entry.name)))).flat();

export const auditTranslations = async (root = 'src') => {
    const missing = new Set();
    const placeholders = new Set();
    const keys = new Set();
    for (const file of (await walk(root)).filter((file) => /\.jsx?$/.test(file) && !file.includes(`${path.sep}i18n${path.sep}`))) {
        const source = await readFile(file, 'utf8');
        const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.JS);
        const visit = (node) => {
            if (ts.isCallExpression(node) && /(?:^|\.)t$/.test(node.expression.getText(ast)) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
                const key = node.arguments[0].text;
                if (/\p{Script=Han}/u.test(key)) keys.add(key);
            }
            ts.forEachChild(node, visit);
        };
        visit(ast);
    }
    const parameters = (value) => [...new Set([...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort().join(',');
    for (const key of keys) if (!Object.hasOwn(englishMessages, key)) missing.add(key);
    for (const [key, value] of Object.entries(englishMessages)) {
        if (parameters(key) !== parameters(value)) placeholders.add(key);
    }
    for (const [locale, catalog] of Object.entries(catalogs)) {
        for (const key of Object.keys(englishMessages)) {
            if (!Object.hasOwn(catalog, key) || typeof catalog[key] !== 'string' || !catalog[key].trim()) missing.add(`${locale}: ${key}`);
            else if (parameters(key) !== parameters(catalog[key])) placeholders.add(`${locale}: ${key}`);
        }
        for (const key of Object.keys(catalog)) if (!Object.hasOwn(englishMessages, key)) missing.add(`${locale}: unknown key ${key}`);
    }
    return { keys: keys.size, missing: [...missing], placeholders: [...placeholders] };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const result = await auditTranslations();
    console.log(JSON.stringify(result, null, 2));
    if (result.missing.length || result.placeholders.length) process.exitCode = 1;
}
