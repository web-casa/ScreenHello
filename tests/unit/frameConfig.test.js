import { beforeAll, describe, expect, it, vi } from 'vitest';

let FRAME_DEFINITIONS;
let VECTOR_DEVICE_INFO;
let createFrameDecorations;
let getFrameDefinition;
let getFrameMetrics;
let isDeviceFrame;

beforeAll(async () => {
    // Unit scope is pure geometry. Real Leafer rendering/export is covered by E2E;
    // use data-compatible nodes here instead of emulating the full browser canvas.
    class VectorNode {
        constructor(props) {
            Object.assign(this, props);
        }
    }
    vi.doMock('leafer-ui', () => ({ Rect: VectorNode, Text: VectorNode }));
    ({
        FRAME_DEFINITIONS,
        VECTOR_DEVICE_INFO,
        createFrameDecorations,
        getFrameDefinition,
        getFrameMetrics,
        isDeviceFrame,
    } = await import('../../src/utils/frameConfig.js'));
});

const VECTOR_DEVICE_IDS = [
    'genericLaptop',
    'genericDesktop',
    'genericTablet',
    'genericPhone',
];

const LAYOUTS = [
    { width: 1600, height: 900 },
    { width: 900, height: 1600 },
    { width: 2400, height: 180 },
];

describe('generic vector device frames', () => {
    it('registers four stable, unbranded, code-native definitions', () => {
        expect(FRAME_DEFINITIONS.filter(({ kind, hidden }) => kind === 'vector-device' && !hidden).map(({ id }) => id))
            .toEqual(VECTOR_DEVICE_IDS);

        for (const id of VECTOR_DEVICE_IDS) {
            const definition = getFrameDefinition(id);
            expect(definition).toMatchObject({ id, group: 'device', kind: 'vector-device' });
            expect(definition).not.toHaveProperty('image');
            expect(VECTOR_DEVICE_INFO[id]).toEqual(expect.objectContaining({
                width: expect.any(Number),
                height: expect.any(Number),
                screen: expect.objectContaining({
                    x: expect.any(Number),
                    y: expect.any(Number),
                    width: expect.any(Number),
                    height: expect.any(Number),
                    radius: expect.any(Number),
                }),
                parts: expect.any(Array),
                overlays: expect.any(Array),
            }));
            expect(isDeviceFrame(id)).toBe(true);
        }

        expect(isDeviceFrame('iphonepro')).toBe(true);
        expect(getFrameDefinition('iphonepro')).toMatchObject({
            kind: 'vector-device',
            hidden: true,
            thumbnail: 'generic-phone',
        });
        expect(VECTOR_DEVICE_INFO.iphonepro).toBe(VECTOR_DEVICE_INFO.genericPhone);
        expect(isDeviceFrame('none')).toBe(false);
    });

    it.each(VECTOR_DEVICE_IDS)('%s keeps its screen and vector nodes inside extreme layout bounds', (id) => {
        for (const layout of LAYOUTS) {
            const metrics = getFrameMetrics(id, layout.width, layout.height);
            const deviceRight = metrics.deviceX + metrics.deviceWidth;
            const deviceBottom = metrics.deviceY + metrics.deviceHeight;

            expect(metrics).toMatchObject({
                totalWidth: layout.width,
                totalHeight: layout.height,
                screenRadius: expect.any(Number),
            });
            expect(metrics.deviceWidth).toBeGreaterThan(0);
            expect(metrics.deviceHeight).toBeGreaterThan(0);
            expect(metrics.deviceX).toBeGreaterThanOrEqual(0);
            expect(metrics.deviceY).toBeGreaterThanOrEqual(0);
            expect(deviceRight).toBeLessThanOrEqual(layout.width);
            expect(deviceBottom).toBeLessThanOrEqual(layout.height);
            expect(metrics.boxX).toBeGreaterThanOrEqual(metrics.deviceX);
            expect(metrics.boxY).toBeGreaterThanOrEqual(metrics.deviceY);
            expect(metrics.boxX + metrics.boxWidth).toBeLessThanOrEqual(deviceRight);
            expect(metrics.boxY + metrics.boxHeight).toBeLessThanOrEqual(deviceBottom);
            expect(metrics.screenRadius).toBeLessThanOrEqual(Math.min(metrics.boxWidth, metrics.boxHeight) / 2);

            const { nodes, overlays } = createFrameDecorations(id, metrics, {
                shadow: { visible: true, x: 0, y: 12, blur: 24, spread: 0, color: '#00000045' },
            });
            const vectors = [...nodes, ...overlays];
            expect(nodes.length).toBeGreaterThanOrEqual(2);
            expect(vectors.length).toBeGreaterThanOrEqual(nodes.length);
            expect(vectors.every((node) => node.hittable === false)).toBe(true);
            expect(vectors.every((node) => node.strokeAlign === 'inside')).toBe(true);
            expect(vectors.some((node) => node.shadow)).toBe(true);
            expect(vectors.every((node) => typeof node.fill !== 'object')).toBe(true);
            for (const node of vectors) {
                expect(node.x).toBeGreaterThanOrEqual(metrics.deviceX - 0.01);
                expect(node.y).toBeGreaterThanOrEqual(metrics.deviceY - 0.01);
                expect(node.x + node.width).toBeLessThanOrEqual(deviceRight + 0.01);
                expect(node.y + node.height).toBeLessThanOrEqual(deviceBottom + 0.01);
            }
        }
    });
});
