import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    readWebView2Runtime,
    runtimeEnvironment,
    supportedArchitectures,
} from '../../scripts/read-webview2-runtime.mjs';

const workflow = readFileSync(new URL('../../.github/workflows/windows-msix-store-candidate.yml', import.meta.url), 'utf8');
const expression = '$' + '{{';
const directories = [];

const pinnedConfig = async (runtimes) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'webview2-pin-'));
    directories.push(directory);
    const file = path.join(directory, 'webview2-runtime.json');
    await writeFile(file, JSON.stringify({ schemaVersion: 1, runtimes }));
    return file;
};

afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Windows MSIX store candidate workflow', () => {
    it('is a manual packaging gate that also proves its toolchain on push', () => {
        expect(workflow).toContain('workflow_dispatch:');
        expect(workflow).toContain("inputs.confirm == 'package-msix-store-candidate'");
        expect(workflow).toContain('default: do-not-package');
        expect(workflow).toContain("github.repository_id == '1353846676'");
        expect(workflow).toContain('branches: [build/msix-store-candidate-20260919]');
        expect(workflow).not.toMatch(/^\s{2}(?:pull_request|pull_request_target|schedule|workflow_run):/mu);
    });

    it('packages only when both a dispatch and the explicit confirmation are present', () => {
        const packageJob = workflow.slice(workflow.indexOf('\n  package:'));
        expect(packageJob).toContain("github.event_name == 'workflow_dispatch'");
        expect(packageJob).toContain("inputs.confirm == 'package-msix-store-candidate'");
        // The preflight must stay credential-free so a push can never package.
        const preflightJob = workflow.slice(workflow.indexOf('\n  preflight:'), workflow.indexOf('\n  package:'));
        expect(preflightJob).not.toContain('secrets.');
        expect(preflightJob).not.toContain('desktop:store:package');
    });

    it('builds both architectures on their native runners', () => {
        for (const expected of [
            'arch: x64',
            'target: x86_64-pc-windows-msvc',
            'runner: windows-2025',
            'arch: arm64',
            'target: aarch64-pc-windows-msvc',
            'runner: windows-11-arm',
        ]) {
            expect(workflow.match(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu'))).toHaveLength(2);
        }
        expect(workflow).toContain('pnpm desktop:store:package --channel msix --arch ${{ matrix.arch }}');
    });

    it('pins the WebView2 runtime by hash and never trusts the archive alone', () => {
        expect(workflow).toContain('node scripts/read-webview2-runtime.mjs --arch ${{ matrix.arch }}');
        expect(workflow).toContain('Get-FileHash -LiteralPath $cab -Algorithm SHA256');
        expect(workflow).toContain('SCREENHELLO_WEBVIEW2_SHA256');
        expect(workflow).toContain('scripts/find-makeappx.ps1');
        expect(workflow).toContain('SCREENHELLO_MAKEAPPX');
        // The packager re-checks the Microsoft signature, so the workflow must not skip it.
        expect(workflow).not.toContain('--no-verify');
    });

    it('requires the Partner Center identity instead of inventing one', () => {
        for (const variable of [
            'SCREENHELLO_MSIX_IDENTITY_NAME',
            'SCREENHELLO_MSIX_PUBLISHER',
            'SCREENHELLO_MSIX_PUBLISHER_DISPLAY_NAME',
        ]) {
            expect(workflow).toContain(`${expression} vars.${variable} }}`);
        }
        expect(workflow).toContain('Required MSIX configuration is unavailable');
        // Identity values must only ever arrive from repository variables.
        expect(workflow).not.toMatch(/Identity Name="[^"$]/u);
        expect(workflow).not.toMatch(/Publisher="CN=[^$]/u);
    });

    it('records honest evidence and never uploads to Partner Center', () => {
        expect(workflow).toContain("e.channel!=='msix'");
        expect(workflow).toContain("e.releaseReady!==false");
        expect(workflow).not.toMatch(/msstore|store-submission|partner\.microsoft|windowsstore/iu);
        expect(workflow).toContain('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a');
        expect(workflow).toContain('if-no-files-found: error');
    });
});

describe('WebView2 runtime pin', () => {
    const valid = {
        version: '153.0.4234.48',
        url: 'https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/abc/Microsoft.WebView2.FixedVersionRuntime.153.0.4234.48.x64.cab',
        sha256: 'a'.repeat(64),
    };

    it('resolves a complete pin and emits the environment lines CI consumes', async () => {
        const file = await pinnedConfig({ x64: valid, arm64: { ...valid, url: valid.url.replace('.x64.', '.arm64.') } });
        await expect(readWebView2Runtime('x64', file)).resolves.toEqual(valid);
        expect(runtimeEnvironment(valid)).toBe([
            `SCREENHELLO_WEBVIEW2_URL=${valid.url}`,
            `SCREENHELLO_WEBVIEW2_SHA256=${valid.sha256}`,
            `SCREENHELLO_WEBVIEW2_VERSION=${valid.version}`,
        ].join('\n'));
        expect(supportedArchitectures).toEqual(['x64', 'arm64']);
    });

    it('fails closed while the pin is still empty', async () => {
        const file = await pinnedConfig({ x64: { version: '', url: '', sha256: '' } });
        await expect(readWebView2Runtime('x64', file)).rejects.toThrow(/webview2-runtime-pin-incomplete:x64/u);
    });

    it('rejects malformed pins instead of falling back to a guess', async () => {
        const cases = [
            [{ ...valid, url: 'http://example.com/x.cab' }, /url-not-https/u],
            [{ ...valid, url: 'not-a-url' }, /url-invalid/u],
            [{ ...valid, sha256: 'deadbeef' }, /sha256-invalid/u],
            [{ ...valid, url: valid.url.replace('153.0.4234.48', '152.0.1.1') }, /version-not-in-url/u],
        ];
        for (const [runtime, message] of cases) {
            const file = await pinnedConfig({ x64: runtime });
            await expect(readWebView2Runtime('x64', file)).rejects.toThrow(message);
        }
        await expect(readWebView2Runtime('mips', await pinnedConfig({}))).rejects.toThrow(/architecture-unsupported/u);
    });
});
