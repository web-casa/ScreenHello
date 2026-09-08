import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const testDriverBuildEnvironment = (root, environment = process.env) => ({
    ...environment,
    SCREENHELLO_TEST_DRIVER_BUILD: 'runner-only',
    CARGO_TARGET_DIR: path.resolve(root, 'src-tauri/target-test-driver'),
});

export const resolveTestDriverCli = () => fileURLToPath(import.meta.resolve('@tauri-apps/cli/tauri.js'));

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const cli = resolveTestDriverCli();
    const child = spawn(process.execPath, [cli, 'build', '--no-bundle', '--ci', '--features', 'desktop-test-driver'], {
        cwd: root,
        env: testDriverBuildEnvironment(root),
        stdio: 'inherit',
    });
    child.once('error', () => { process.exitCode = 1; });
    child.once('exit', (code) => { process.exitCode = code ?? 1; });
}
