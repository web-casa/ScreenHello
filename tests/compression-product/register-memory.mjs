import assert from 'node:assert/strict';
import { registerMemory } from './memory-evidence.mjs';

const [file, scope = 'release', ...extra] = process.argv.slice(2);
assert.ok(file && extra.length === 0, 'usage: node tests/compression-product/register-memory.mjs OUTPUT.json [release|instrumentation]');
const manifest = await registerMemory(file, scope);
console.log(JSON.stringify({ file, scope: manifest.scope, requiredScenarios: manifest.scenarios.length, candidate: manifest.candidate }));
