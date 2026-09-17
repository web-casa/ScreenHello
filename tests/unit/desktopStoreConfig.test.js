import { describe, expect, it } from 'vitest';
import { assertPeArchitecture, masEntitlements, msixManifest, storeInputs } from '../../scripts/desktop-store-config.mjs';

const windows = {
    SCREENHELLO_MSIX_VERSION: '1.0.4.0',
    SCREENHELLO_MSIX_IDENTITY_NAME: 'Example.ScreenHello',
    SCREENHELLO_MSIX_PUBLISHER: 'CN=Example & Company',
    SCREENHELLO_MSIX_PUBLISHER_DISPLAY_NAME: 'Example "Company"',
    SCREENHELLO_WEBVIEW2_RUNTIME_DIR: '/fixture/runtime',
};
const apple = {
    SCREENHELLO_MAS_BUNDLE_ID: 'com.example.screenhello',
    APPLE_TEAM_ID: 'ABCDE12345',
    SCREENHELLO_MAS_BUILD_NUMBER: '4.1',
    SCREENHELLO_MAS_APP_IDENTITY: 'Apple Distribution: Example (ABCDE12345)',
    SCREENHELLO_MAS_INSTALLER_IDENTITY: '3rd Party Mac Developer Installer: Example (ABCDE12345)',
    SCREENHELLO_MAS_PROFILE: '/fixture/profile',
};

describe('desktop Store packaging contracts', () => {
    it.each(['x64', 'arm64'])('creates an MSIX identity for %s with escaped publisher values', (arch) => {
        const manifest = msixManifest(storeInputs('msix', arch, windows));
        expect(manifest).toContain(`ProcessorArchitecture="${arch}"`);
        expect(manifest).toContain('CN=Example &amp; Company');
        expect(manifest).toContain('Example &quot;Company&quot;');
        expect(manifest).toContain('runFullTrust');
        expect(manifest).not.toContain('internetClient');
    });
    it.each(['0.1.0.0', '1.0.0.1', '65536.0.0.0', '1.2.3', '01.0.0.0'])('rejects invalid Store version %s', (version) => {
        expect(() => storeInputs('msix', 'x64', { ...windows, SCREENHELLO_MSIX_VERSION: version })).toThrow();
    });
    it('requires real configured identities and explicit channels', () => {
        for (const [channel, arch, values] of [['msix', 'arm64', windows], ['mas', 'universal', apple]]) {
            for (const key of Object.keys(values)) {
                const env = { ...values };
                delete env[key];
                expect(() => storeInputs(channel, arch, env)).toThrow(key);
            }
        }
        expect(() => storeInputs('msix', 'universal', windows)).toThrow('store-target-invalid');
        expect(() => storeInputs('constructor', 'x64', windows)).toThrow('store-target-invalid');
        expect(() => storeInputs('msix', 'x64', { ...windows, SCREENHELLO_MSIX_PUBLISHER: 'CN=bad\nvalue' })).toThrow();
    });
    it('uses MAS sandbox and matching Store certificates, without temporary exceptions', () => {
        const input = storeInputs('mas', 'universal', apple);
        expect(input.target).toBe('universal-apple-darwin');
        const plist = masEntitlements(input);
        expect(plist).toContain('com.apple.security.app-sandbox');
        expect(plist).toContain('ABCDE12345.com.example.screenhello');
        expect(plist).not.toContain('network');
        expect(plist).not.toContain('temporary-exception');
        expect(() => masEntitlements({ ...input, team: 'OTHER12345' })).toThrow('team-mismatch');
        expect(() => storeInputs('mas', 'arm64', { ...apple, SCREENHELLO_MAS_APP_IDENTITY: 'Developer ID Application: Example (ABCDE12345)' })).toThrow();
    });
    it('checks actual PE machine headers, including truncated and mismatched binaries', () => {
        const pe = Buffer.alloc(128);
        pe.write('MZ'); pe.writeUInt32LE(64, 0x3c); pe.write('PE\0\0', 64); pe.writeUInt16LE(0xaa64, 68);
        expect(() => assertPeArchitecture(pe, 'arm64')).not.toThrow();
        expect(() => assertPeArchitecture(pe, 'x64')).toThrow('architecture-mismatch');
        expect(() => assertPeArchitecture(pe.subarray(0, 67), 'arm64')).toThrow('pe-invalid');
        pe.writeUInt32LE(0xffffffff, 0x3c);
        expect(() => assertPeArchitecture(pe, 'arm64')).toThrow('pe-invalid');
    });
});
