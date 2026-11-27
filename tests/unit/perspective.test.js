import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScreenHelloRuntime } from '../../src/stores/index.js';
import {
    DEFAULT_PERSPECTIVE,
    PERSPECTIVE_PRESETS,
    computePerspectiveGeometry,
    isPerspectiveActive,
    normalizePerspective,
    pointInQuad,
} from '../../src/utils/perspectiveSchema.js';
import { warpPerspectiveImage } from '../../src/utils/deviceProjection.js';
import { normalizeOption } from '../../src/utils/projectDocument.js';
import { createStylePreset, validateStylePreset } from '../../src/utils/stylePreset.js';

const runtimes = [];
const createRuntime = () => {
    const rt = createScreenHelloRuntime();
    runtimes.push(rt);
    rt.activate();
    rt.editor.setMessage({
        open: vi.fn(),
        success: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
    });
    return rt;
};

afterEach(() => {
    runtimes.splice(0).forEach((rt) => rt.dispose());
    vi.restoreAllMocks();
});

describe('3D perspective schema, projection math, and store mutual exclusion', () => {
    it('clamps angles, strips legacy scalar perspective, and computes bounded quad geometry', () => {
        expect(PERSPECTIVE_PRESETS).toHaveLength(8);
        const clamped = normalizePerspective({
            preset: 'unknown',
            rotateX: 999,
            rotateY: -999,
            rotateZ: 99,
            distance: 50,
            elevation: 999,
        });
        expect(clamped).toEqual({
            preset: 'custom',
            rotateX: 35,
            rotateY: -35,
            rotateZ: 25,
            distance: 600,
            elevation: 48,
        });
        expect(isPerspectiveActive(clamped)).toBe(true);
        expect(isPerspectiveActive(DEFAULT_PERSPECTIVE)).toBe(false);

        // Legacy numeric perspective is still stripped cleanly; structured perspective3d is preserved.
        const migrated = normalizeOption({
            perspective: 800,
            perspective3d: { preset: 'tilt-left', rotateX: 10, rotateY: -16, rotateZ: -2, distance: 1100, elevation: 20 },
        });
        expect(migrated).not.toHaveProperty('perspective');
        expect(migrated.perspective3d.preset).toBe('tilt-left');

        const geo = computePerspectiveGeometry(400, 300, migrated.perspective3d, { visible: true, blur: 18, x: 0, y: 12, spread: 0 });
        expect(geo.active).toBe(true);
        expect(geo.corners).toHaveLength(4);
        expect(geo.totalWidth).toBeGreaterThan(geo.quadWidth);
        expect(geo.totalHeight).toBeGreaterThan(geo.quadHeight);
        // Center point inside quad; far top-left corner outside quad.
        expect(pointInQuad(geo.totalWidth / 2, geo.totalHeight / 2, geo.corners)).toBe(true);
        expect(pointInQuad(0, 0, geo.corners)).toBe(false);
    });

    it('warps an RGBA source cleanly with feathered anti-aliased edges', () => {
        const w = 32, h = 24;
        const src = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < src.length; i += 4) {
            src[i] = 60; src[i + 1] = 140; src[i + 2] = 250; src[i + 3] = 255;
        }
        const geo = computePerspectiveGeometry(w, h, { rotateX: 12, rotateY: -18, rotateZ: -4, distance: 900, elevation: 8 }, { visible: false });
        const out = warpPerspectiveImage({
            pixels: src,
            width: w,
            height: h,
            outputWidth: geo.totalWidth,
            outputHeight: geo.totalHeight,
            corners: geo.corners,
        });
        expect(out.length).toBe(geo.totalWidth * geo.totalHeight * 4);
        const centerIdx = (Math.floor(geo.totalHeight / 2) * geo.totalWidth + Math.floor(geo.totalWidth / 2)) * 4;
        expect(out[centerIdx + 3]).toBeGreaterThan(240);
        // Top-left padding corner stays transparent.
        expect(out[3]).toBe(0);
    });

    it('round-trips perspective3d in document snapshots, history, style presets, and enforces bidirectional device-frame exclusion', () => {
        const rt = createRuntime();
        rt.editor.replaceImg({ src: 'data:image/png;base64,a', width: 640, height: 480, type: 'image/png', name: 'a.png' });
        rt.history.reset();

        // Apply 3D preset -> undo -> redo
        rt.option.applyPerspectivePreset('tilt-left');
        expect(rt.option.perspective3d.preset).toBe('tilt-left');
        expect(rt.editor.serializeProject().option.perspective3d.preset).toBe('tilt-left');

        // StylePreset round-trip preserves perspective3d
        const preset = createStylePreset({ name: '3D Card', option: rt.option.toDocument() });
        expect(validateStylePreset(preset).preset.option.perspective3d.preset).toBe('tilt-left');

        // Switching to a device frame while in 3D resets perspective to flat in ONE undoable step
        rt.option.setFrame('genericLaptop');
        expect(rt.option.frame).toBe('genericLaptop');
        expect(isPerspectiveActive(rt.option.perspective3d)).toBe(false);
        rt.history.undo();
        expect(rt.option.frame).toBe('none');
        expect(rt.option.perspective3d.preset).toBe('tilt-left');

        // Applying 3D preset while on a device frame switches frame to 'arc' in ONE undoable step
        rt.option.setFrame('genericLaptop');
        rt.option.applyPerspectivePreset('isometric-right');
        expect(rt.option.frame).toBe('arc');
        expect(rt.option.perspective3d.preset).toBe('isometric-right');
        rt.history.undo();
        expect(rt.option.frame).toBe('genericLaptop');
        expect(isPerspectiveActive(rt.option.perspective3d)).toBe(false);

        // normalizeOption enforces single-source exclusion on load
        const conflicted = normalizeOption({
            frame: 'genericLaptop',
            perspective3d: { preset: 'tilt-right', rotateX: 10, rotateY: 16, rotateZ: 2, distance: 1100, elevation: 20 },
        });
        expect(isPerspectiveActive(conflicted.perspective3d)).toBe(false);
    });
});
