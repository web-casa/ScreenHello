import { describe, expect, it } from 'vitest';
import { analyzeRgbaEdges } from '../../src/utils/imageSuggestions.js';

const solid = (width, height, [red, green, blue, alpha = 255]) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < data.length; index += 4) {
        data.set([red, green, blue, alpha], index);
    }
    return data;
};

describe('local image suggestions', () => {
    it('suggests a light inner border and dark browser frame for dark landscape edges', () => {
        const result = analyzeRgbaEdges(solid(4, 3, [16, 16, 16]), 4, 3, 1600, 900);
        expect(result).toMatchObject({
            edgeColor: '#101010',
            orientation: 'landscape',
            frame: 'windowsBarDark',
            innerBorder: { visible: true, width: 1, color: '#ffffff99' },
        });
    });

    it('suggests a dark inner border and phone frame for light portrait edges', () => {
        const result = analyzeRgbaEdges(solid(3, 4, [240, 240, 240]), 3, 4, 900, 1600);
        expect(result).toMatchObject({
            edgeColor: '#f0f0f0',
            orientation: 'portrait',
            frame: 'genericPhone',
            innerBorder: { color: '#00000066' },
        });
    });

    it('uses a neutral fallback for fully transparent edges', () => {
        expect(analyzeRgbaEdges(solid(2, 2, [0, 0, 0, 0]), 2, 2, 100, 100))
            .toMatchObject({ edgeColor: '#f5f5f5', orientation: 'square', frame: 'card' });
    });
});
