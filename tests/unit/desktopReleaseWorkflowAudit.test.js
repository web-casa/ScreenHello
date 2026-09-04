import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { auditDesktopReleaseWorkflow } from '../../scripts/audit-desktop-release-workflow.mjs';

const workflow = await readFile(new URL('../../.github/workflows/desktop-release-gate.yml', import.meta.url), 'utf8');
const matrix = JSON.parse(await readFile(new URL('../../config/desktop-release-matrix.json', import.meta.url), 'utf8'));

describe('desktop release workflow audit', () => {
    it('accepts the read-only three-platform candidate gate', () => {
        expect(auditDesktopReleaseWorkflow(workflow, matrix)).toEqual([]);
    });

    it('accepts the same workflow after a Windows CRLF checkout', () => {
        expect(auditDesktopReleaseWorkflow(workflow.replaceAll('\n', '\r\n'), matrix)).toEqual([]);
    });

    it.each([
        ['a write permission', (source) => source.replace('contents: read', 'contents: write')],
        ['a floating runner', (source) => source.replace('runner: ubuntu-24.04', 'runner: ubuntu-latest')],
        ['a release operation', (source) => source.replace('pnpm desktop:sbom', 'gh release create desktop')],
        ['a feature binary upload', (source) => source.replace(
            'path: artifacts/release/desktop-matrix/',
            'path: src-tauri/target/release/desktop-test-driver',
        )],
        ['a skipped clean rebuild', (source) => source.replace(
            'cargo clean --manifest-path src-tauri/Cargo.toml',
            'echo skip-clean',
        )],
    ])('fails closed for %s', (_name, mutate) => {
        expect(auditDesktopReleaseWorkflow(mutate(workflow), matrix)).not.toEqual([]);
    });
});
