import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const staticCssPath = path.join(root, 'src', 'style', 'antd-static.css');
const generatorScript = path.join(root, 'scripts', 'generate-antd-static-css.mjs');

describe('Ant Design static CSS generation', () => {
    it('passes --check without emitting Ant Design deprecation warnings', () => {
        const result = spawnSync(process.execPath, [generatorScript, '--check'], {
            cwd: root,
            encoding: 'utf8',
        });
        expect(result.status, result.stderr).toBe(0);
        expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/deprecated|Input\.Group/i);
        const parsed = JSON.parse(result.stdout.trim());
        expect(parsed.status).toBe('current');
        expect(parsed.bytes).toBeGreaterThan(100_000);
    }, 30_000);

    it('retains required Ant Design selectors and dual dev/prod cssinjs scopes without Input.Group rules', () => {
        const css = readFileSync(staticCssPath, 'utf8');
        const scopeMatch = css.match(/:where\(\.css-dev-only-do-not-override-([a-z0-9]+),\s*\.css-\1\)/i);
        expect(scopeMatch).not.toBeNull();
        for (const selector of [
            '.ant-input',
            '.ant-input-affix-wrapper',
            '.ant-input-outlined',
            '.ant-input-number',
            '.ant-btn',
            '.ant-modal',
            '.ant-drawer',
            '.ant-popover',
            '.ant-dropdown',
            '.ant-select',
            '.ant-segmented',
            '.ant-tabs',
            '.ant-tooltip',
            '.ant-message',
        ]) {
            expect(css, `missing selector ${selector}`).toContain(selector);
        }
        expect(css).toContain('Input-Shared|ant-input');
        expect(css).toContain('Input-Component|ant-input');
        expect(css).toContain('Input-Search|ant-input-search');
        expect(css).toContain('Input-TextArea|ant-input');
        expect(css).toContain('Input-OTP|ant-otp');
        expect(css).toContain('Space-Compact|ant-space-compact');
    });
});
