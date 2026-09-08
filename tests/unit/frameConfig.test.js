import { beforeAll, describe, expect, it, vi } from 'vitest';
import { RASTER_DEVICES, getDeviceVariants, getRasterDevice } from '../../src/utils/rasterDeviceConfig';

let FRAME_DEFINITIONS;
let VECTOR_DEVICE_INFO;
let createFrameDecorations;
let getFrameDefinition;
let getFrameMetrics;
let isDeviceFrame;
let getFrameGroups;
let getQuickFrameGroups;

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
        getFrameGroups,
        getQuickFrameGroups,
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
    it('provides bounded browser/device quick choices without mutating the full model lists', () => {
        const groups = getFrameGroups();
        const before = groups.map(group => group.items.map(item => item.id));
        const quick = getQuickFrameGroups('none', groups);
        expect(quick.browser.map(item => item.id)).toEqual(['none', 'macosBarLight', 'macosBarDark', 'windowsBarLight']);
        expect(quick.device.length).toBeLessThanOrEqual(4);
        expect(quick.device.every(item => item.available && !item.hidden && item.kind === 'raster-device')).toBe(true);
        expect(new Set(quick.device.map(item => item.model || item.id)).size).toBe(quick.device.length);
        for (const selected of ['arc', 'windowsBarDark', ...Object.keys(RASTER_DEVICES)]) {
            const result = getQuickFrameGroups(selected, groups);
            const definition = getFrameDefinition(selected);
            if (!definition.hidden) expect([...result.browser, ...result.device].map(item => item.id)).toContain(selected);
            else expect([...result.browser, ...result.device].map(item => item.id)).not.toContain(selected);
            expect(result.browser[0].id).toBe('none');
            expect(result.device.length).toBeLessThanOrEqual(4);
        }
        expect(groups.map(group => group.items.map(item => item.id))).toEqual(before);
    });

    it('does not invent device choices in empty or partial packs, even for a saved selection', () => {
        for (const selected of ['macbook-air-m2-midnight-v1', 'genericPhone', '__proto__']) {
            expect(getQuickFrameGroups(selected, []).device).toEqual([]);
        }
        const partial = getFrameGroups().map(group => ({...group, items: group.items.filter(item => item.id === 'surface-studio')}));
        expect(getQuickFrameGroups('macbook-air-m2-silver-v1', partial).device.map(item => item.id))
            .toEqual(RASTER_DEVICES['surface-studio'].available ? ['surface-studio'] : []);
    });

    it('keeps optional raster device geometry stable even without the external pack', () => {
        for (const id of ['surface-studio', 'surface-pro-8', 'macbook-pro-bitmap', 'macbook-air-bitmap', 'imac-bitmap', 'ipad-bitmap', 'iphone-bitmap']) {
            const definition = getFrameDefinition(id);
            expect(definition.kind).toBe('raster-device');
            expect(isDeviceFrame(id)).toBe(true);
            expect(definition.hidden).toBe(!definition.available || Boolean(definition.replacedBy && Object.values(RASTER_DEVICES).some(candidate => candidate.model === definition.replacedBy && candidate.available)));
            for (const { width, height } of LAYOUTS) {
                const metrics = getFrameMetrics(id, width, height);
                expect(metrics.deviceWidth / metrics.deviceHeight).toBeCloseTo(definition.width / definition.height);
                expect(metrics.deviceWidth).toBeLessThanOrEqual(width + 0.001);
                expect(metrics.deviceHeight).toBeLessThanOrEqual(height + 0.001);
            }
        }
    });
    it('keeps four stable vector definitions for old projects, not new choices', () => {
        expect(FRAME_DEFINITIONS.filter(({ kind, hidden }) => kind === 'vector-device' && !hidden).map(({ id }) => id))
            .toEqual([]);

        for (const id of VECTOR_DEVICE_IDS) {
            const definition = getFrameDefinition(id);
            expect(definition).toMatchObject({ id, group: 'simple-device', kind: 'vector-device' });
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

    it('shortens the red label without changing the saved variant or source color', () => {
        expect(getRasterDevice('imac-24-red-v1')).toMatchObject({
            id: 'imac-24-red-v1', color: 'red', colorTitle: '红色', swatch: '#ecc3bf',
        });
    });

    it('groups available device variants by model and never accepts prototype names', () => {
        const devices = getFrameGroups().find(group => group.id === 'device').items;
        const models = devices.map(item => item.model || item.id);
        expect(new Set(models).size).toBe(models.length);
        expect(getFrameGroups().find(group => group.id === 'simple-device').items).toEqual([]);
        for (const key of ['__proto__', 'constructor', 'toString', 'not-a-device']) {
            expect(getRasterDevice(key)).toBeNull(); expect(isDeviceFrame(key)).toBe(false);
            expect(getFrameDefinition(key).id).toBe('none');
        }
        for (const item of Object.values(RASTER_DEVICES).filter(item => item.model)) {
            expect(isDeviceFrame(item.id)).toBe(true);
            expect(getDeviceVariants(item.id).every(variant => variant.model === item.model && variant.available)).toBe(true);
            expect(Math.max(item.width, item.height)).toBeLessThanOrEqual(1440);
        }
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
