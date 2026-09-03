import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const outputDirectory = path.join(root, 'lib');

await mkdir(outputDirectory, { recursive: true });
await copyFile(path.join(root, 'types', 'index.d.ts'), path.join(outputDirectory, 'index.d.ts'));
