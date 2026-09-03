import { describe, expect, it } from 'vitest';
import backgroundConfig, {
    getBackgroundDefinition,
    normalizeBackgroundKey,
    QUICK_ACCENT_GRADIENT_KEYS,
} from '../../src/utils/backgroundConfig.js';

describe('offline background catalog', () => {
    it('maps every featured compatibility token to a code-native gradient', () => {
        expect(QUICK_ACCENT_GRADIENT_KEYS).toHaveLength(10);
        for (const key of QUICK_ACCENT_GRADIENT_KEYS) {
            const definition = getBackgroundDefinition(key);
            expect(key).toMatch(/^gh_img_\d+$/);
            expect(definition.type).toBe('gradient');
            expect(['linear', 'angular']).toContain(definition.fill.type);
            expect(definition.previewStyle.background).toMatch(/^(linear|conic)-gradient\(/);
            expect(definition).not.toHaveProperty('preview');
            expect(definition.fill).not.toHaveProperty('url');
        }
    });

    it('contains no runtime remote background and preserves safe legacy migrations', () => {
        expect(JSON.stringify(backgroundConfig)).not.toContain('images.unsplash.com');
        expect(JSON.stringify(backgroundConfig)).not.toContain('/gradients/');
        expect(getBackgroundDefinition('gh_img_10').type).toBe('gradient');
        expect(getBackgroundDefinition('gh_img_65').type).toBe('gradient');
        expect(normalizeBackgroundKey('cosmic_img_1')).toBe('default_1');
        expect(normalizeBackgroundKey('cloud_img_4')).toBe('default_1');
        expect(normalizeBackgroundKey('desktop_img_2')).toBe('default_1');
    });
});
