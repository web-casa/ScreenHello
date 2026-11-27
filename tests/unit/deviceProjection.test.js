import { describe, expect, it } from 'vitest';
import { fitRect, inverseHomography, mapPoint, screenMaskFromAlpha, warpImage } from '../../src/utils/deviceProjection';

describe('device pixel projection', () => {
    it('extracts only the enclosed screen while preserving opaque notches and outside alpha', () => {
        const width = 9, height = 9, pixels = new Uint8ClampedArray(width * height * 4);
        for (let y = 1; y < 8; y++) for (let x = 1; x < 8; x++) {
            if (x === 1 || x === 7 || y === 1 || y === 7 || (x === 4 && y === 2)) pixels[(y * width + x) * 4 + 3] = 255;
        }
        pixels[(3 * width + 2) * 4 + 3] = 80; // Screen-edge antialiasing belongs behind the original frame.
        const result = screenMaskFromAlpha({ pixels, width, height });
        expect(result.bounds).toEqual({ x: 2, y: 2, width: 5, height: 5 });
        expect(result.pixels[(4 * width + 4) * 4 + 3]).toBe(255);
        expect(result.pixels[(3 * width + 2) * 4 + 3]).toBe(255);
        expect(result.pixels[(2 * width + 4) * 4 + 3]).toBe(0);
        expect(result.pixels[3]).toBe(0);
        pixels[(1 * width + 3) * 4 + 3] = 0;
        expect(() => screenMaskFromAlpha({ pixels, width, height })).toThrow('Unclosed');
    });
    it('rejects invalid mask budgets and opaque screen seeds', () => {
        expect(() => screenMaskFromAlpha({ width: 5000, height: 5000 })).toThrow();
        expect(() => screenMaskFromAlpha({ width: 3, height: 3, pixels: new Uint8ClampedArray(36).fill(255) })).toThrow('Missing');
    });
    it.each([
        [[5, 7], [65, 7], [65, 47], [5, 47]],
        [[172.140745, 65.777565], [1233.097339, 62.766342], [1250.422018, 744.549779], [159.853211, 747.645048]],
    ])('maps the four PSD corners to the full image without inversion', (...corners) => {
        const matrix = inverseHomography(corners);
        [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], index) => {
            const point = mapPoint(matrix, ...corners[index]);
            expect(point[0]).toBeCloseTo(u, 8); expect(point[1]).toBeCloseTo(v, 8);
        });
    });
    it('covers/crops and contains/letterboxes without stretching', () => {
        expect(fitRect(200, 100, 100, 100, 'cover')).toEqual({ x: -50, y: 0, width: 200, height: 100 });
        expect(fitRect(200, 100, 100, 100, 'contain')).toEqual({ x: 0, y: 25, width: 100, height: 50 });
        expect(() => fitRect(0, 100, 100, 100, 'cover')).toThrow();
    });
    it('rejects invalid geometry and budgets before allocating an output', () => {
        expect(() => inverseHomography([[0, 0], [0, 0], [0, 0], [0, 0]])).toThrow();
        expect(() => inverseHomography([])).toThrow();
        expect(() => warpImage({ width: 5000, height: 5000, outputWidth: 5000, outputHeight: 5000 })).toThrow();
        expect(() => warpImage({ width: 1, height: 1, outputWidth: 1, outputHeight: 1, pixels: new Uint8ClampedArray(3) })).toThrow();
    });
    it('retains exact identity pixels', () => {
        const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]);
        expect(warpImage({ pixels, width: 2, height: 2, outputWidth: 2, outputHeight: 2,
            corners: [[0, 0], [2, 0], [2, 2], [0, 2]] })).toEqual(pixels);
    });
});
