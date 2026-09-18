import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../../.github/workflows/macos-mas-universal-candidate.yml', import.meta.url), 'utf8');
const packager = readFileSync(new URL('../../scripts/package-desktop-store.mjs', import.meta.url), 'utf8');
const expression = '$' + '{{';

describe('MAS universal candidate workflow', () => {
    it('is manually gated to the public repository candidate branches', () => {
        expect(workflow).toContain('workflow_dispatch:');
        expect(workflow).toContain("inputs.confirm == 'package-mas-universal-candidate'");
        expect(workflow).toContain("github.repository_id == '1353846676'");
        expect(workflow).toContain("github.ref == 'refs/heads/build/mas-universal-candidate-20260918'");
        expect(workflow).toContain('branches: [build/mas-universal-candidate-20260918]');
        expect(workflow).not.toMatch(/^\s{2}(?:pull_request|pull_request_target|schedule|workflow_run):/mu);
    });

    it('uses the configured MAS identities and only scopes secrets to credential steps', () => {
        for (const variable of [
            'SCREENHELLO_MAS_BUNDLE_ID',
            'SCREENHELLO_MAS_APP_IDENTITY',
            'SCREENHELLO_MAS_INSTALLER_IDENTITY',
        ]) expect(workflow).toContain(`${expression} vars.${variable} }}`);
        for (const secret of [
            'APPLE_TEAM_ID',
            'MAS_APP_CERTIFICATE_P12_BASE64',
            'MAS_INSTALLER_CERTIFICATE_P12_BASE64',
            'MAS_PROVISIONING_PROFILE_BASE64',
        ]) expect(workflow).toContain(`${expression} secrets.${secret} }}`);
        expect(workflow).not.toContain('APPLE_ID:');
        expect(workflow).not.toContain('APPLE_APP_SPECIFIC_PASSWORD');
    });

    it('imports both empty-password P12 files and removes all temporary signing material', () => {
        expect(workflow.match(/security import[^\n]+-P ''/gu)).toHaveLength(2);
        expect(workflow).toContain('security find-identity -v -p codesigning "$keychain"');
        expect(workflow).toContain('security find-identity -v "$keychain"');
        expect(workflow).toContain('security delete-keychain "$SCREENHELLO_MAS_KEYCHAIN"');
        expect(workflow).toContain('"${SCREENHELLO_MAS_PROFILE:-}"');
        expect(workflow.indexOf("printf 'SCREENHELLO_MAS_PROFILE=%s\\n'")).toBeLessThan(workflow.indexOf('security import "$app_certificate"'));
    });

    it('builds one locked universal package and records incomplete external acceptance honestly', () => {
        expect(workflow).toContain('rustup target add aarch64-apple-darwin x86_64-apple-darwin');
        expect(workflow).toContain('pnpm desktop:store:package --channel mas --arch universal');
        expect(packager).toContain("'--config', config, '--', '--locked'");
        expect(workflow).toContain('evidence.dirty !== false');
        expect(workflow).toContain("find \"$app\" -type f -print0");
        expect(workflow).toContain("lipo -archs \"$candidate\"");
        expect(workflow).toContain('Authority=$SCREENHELLO_MAS_APP_IDENTITY');
        expect(workflow).toContain('$SCREENHELLO_MAS_INSTALLER_IDENTITY');
        expect(workflow).toContain('installation=not-run');
        expect(workflow).toContain('store-upload=not-run');
        expect(workflow).toContain('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a');
    });
});
