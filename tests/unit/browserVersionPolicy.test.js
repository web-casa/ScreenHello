import { describe, expect, it } from 'vitest';
import { browserVersionIsAccepted } from '../../scripts/browser-version-policy.mjs';

describe('browser release version policy', () => {
    it('keeps exact-major and exact-minor targets strict', () => {
        expect(browserVersionIsAccepted('111.0.5563.146', { version: { major: 111 } })).toBe(true);
        expect(browserVersionIsAccepted('112.0', { version: { major: 111 } })).toBe(false);
        expect(browserVersionIsAccepted('16.5', { version: { major: 16, minor: 4 } })).toBe(false);
    });

    it('accepts a real Safari version at or above the declared floor', () => {
        const target = { versionPolicy: 'minimum', version: { major: 16, minor: 4 } };
        expect(browserVersionIsAccepted('16.4', target)).toBe(true);
        expect(browserVersionIsAccepted('16.3', target)).toBe(false);
        expect(browserVersionIsAccepted('26.5.2', target)).toBe(true);
    });

    it('rejects invalid versions and unsupported policies', () => {
        expect(browserVersionIsAccepted('', { version: { major: 16 } })).toBe(false);
        expect(() => browserVersionIsAccepted('16.4', {
            versionPolicy: 'range',
            version: { major: 16, minor: 4 },
        })).toThrow('Unsupported browser version policy');
    });
});
