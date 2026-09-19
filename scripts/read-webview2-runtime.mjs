#!/usr/bin/env node
// Resolves the pinned WebView2 fixed-version runtime for one architecture.
//
// The pin lives in config/webview2-runtime.json so it is reviewed like code
// instead of hiding in repository variables. CI writes the emitted environment
// lines into GITHUB_ENV and then verifies the downloaded archive against the
// recorded SHA-256; the packaging entry point independently requires a valid
// Microsoft Authenticode signature on the extracted msedgewebview2.exe.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const runtimeConfigPath = fileURLToPath(new URL('../config/webview2-runtime.json', import.meta.url));
export const supportedArchitectures = Object.freeze(['x64', 'arm64']);
const sha256Pattern = /^[0-9a-f]{64}$/u;

export const readWebView2Runtime = async (arch, configPath = runtimeConfigPath) => {
    if (!supportedArchitectures.includes(arch)) throw new Error(`webview2-architecture-unsupported:${arch}`);
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    const runtime = config?.runtimes?.[arch];
    if (!runtime) throw new Error(`webview2-runtime-missing:${arch}`);
    const { version, url, sha256 } = runtime;
    if (!version || !url || !sha256) throw new Error(`webview2-runtime-pin-incomplete:${arch}`);
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`webview2-runtime-url-invalid:${arch}`);
    }
    if (parsed.protocol !== 'https:') throw new Error(`webview2-runtime-url-not-https:${arch}`);
    if (!sha256Pattern.test(sha256)) throw new Error(`webview2-runtime-sha256-invalid:${arch}`);
    if (!version.startsWith(parsed.pathname.split('/').pop()?.match(/(\d+\.\d+\.\d+\.\d+)/u)?.[1] ?? version)) {
        throw new Error(`webview2-runtime-version-not-in-url:${arch}`);
    }
    return { version, url, sha256 };
};

export const runtimeEnvironment = ({ url, sha256, version }) => [
    `SCREENHELLO_WEBVIEW2_URL=${url}`,
    `SCREENHELLO_WEBVIEW2_SHA256=${sha256}`,
    `SCREENHELLO_WEBVIEW2_VERSION=${version}`,
].join('\n');

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    try {
        const { values } = parseArgs({ args: process.argv.slice(2), options: { arch: { type: 'string' } }, strict: true });
        if (!values.arch) throw new Error('webview2-arch-required');
        process.stdout.write(`${runtimeEnvironment(await readWebView2Runtime(values.arch))}\n`);
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}
