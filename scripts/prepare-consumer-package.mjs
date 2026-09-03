import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const artifactsDirectory = path.join(root, 'artifacts');
const packDirectory = path.join(artifactsDirectory, 'consumer-pack');
const consumerDirectory = path.join(root, 'tests', 'consumer');
const packageArchive = path.join(artifactsDirectory, 'screenhello-package.tgz');

const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, {
        cwd: root,
        encoding: 'utf8',
        stdio: 'pipe',
        maxBuffer: 32 * 1024 * 1024,
        ...options,
    });
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
    }
    return result.stdout.trim();
};

await mkdir(packDirectory, { recursive: true });
const packedOutput = run('pnpm', ['pack', '--pack-destination', packDirectory]);
const packedPath = packedOutput.split(/\r?\n/).at(-1);
if (!packedPath?.endsWith('.tgz')) {
    throw new Error(`Unable to locate packed archive in pnpm output: ${packedOutput}`);
}
await copyFile(path.resolve(root, packedPath), packageArchive);

// 只删除 fixture 自己生成且被忽略的安装目录，保证每次都从真实 tarball 重新解析。
await rm(path.join(consumerDirectory, 'node_modules'), { recursive: true, force: true });
run('pnpm', ['install', '--lockfile=false', '--force', '--strict-peer-dependencies'], { cwd: consumerDirectory });
run('pnpm', [
    'exec', 'tsc', '--noEmit', '--strict', '--skipLibCheck',
    '--jsx', 'react-jsx', '--module', 'ESNext', '--moduleResolution', 'Bundler',
    '--target', 'ES2022', 'tests/consumer/typecheck.tsx',
]);
// 开发服务器与生产构建走不同的依赖/资源处理链路；发布包必须同时通过。
run('pnpm', ['exec', 'vite', 'build', '--config', 'vite.config.js'], { cwd: consumerDirectory });

const virtualStoreEntries = await readdir(path.join(consumerDirectory, 'node_modules', '.pnpm'));
const singletonPackages = [
    ['react', 'react@'],
    ['react-dom', 'react-dom@'],
    ['mobx', 'mobx@'],
    ['@ant-design/cssinjs', '@ant-design+cssinjs@'],
];
for (const [name, encodedPrefix] of singletonPackages) {
    const physicalInstalls = virtualStoreEntries.filter((entry) => entry.startsWith(encodedPrefix));
    if (physicalInstalls.length !== 1) {
        throw new Error(`Expected one physical ${name} install, found: ${physicalInstalls.join(', ') || 'none'}`);
    }
}
