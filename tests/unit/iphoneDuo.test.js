import { afterEach, expect, it, vi } from 'vitest';
import geometry from '../../src/utils/iphoneDuoGeometry.json';

afterEach(() => { vi.doUnmock('../../src/utils/iphoneDuoAssets'); vi.resetModules(); });

it.each(['complete', 'absent', 'missing-mask', 'missing-foreground'])('Duo optional pack: %s', async state => {
    vi.resetModules();
    const assets = {};
    for (const device of geometry) {
        for (const suffix of ['', '-screen', '-foreground']) {
            if (state === 'absent' || (state === 'missing-mask' && suffix === '-screen')
                || (state === 'missing-foreground' && suffix === '-foreground')) continue;
            assets[`../../local-device-assets/${device.id}${suffix}.png`] = `/assets/${device.id}${suffix}.png`;
        }
    }
    vi.doMock('../../src/utils/iphoneDuoAssets', () => ({ IPHONE_DUO_ASSETS: assets }));
    const { getRasterDevice, isDeviceFrameId } = await import('../../src/utils/rasterDeviceConfig');
    for (const entry of geometry) {
        const device = getRasterDevice(entry.id);
        expect(isDeviceFrameId(entry.id)).toBe(true); // Saved IDs survive missing packs.
        expect(device.available).toBe(!entry.hasForeground && (state === 'complete' || state === 'missing-foreground'));
        expect(device.retired).toBe(entry.hasForeground);
        expect(device.licenseStatus).toBe('unverified');
        expect(device.sourceProject).toBe('Good Mockups');
        if (!entry.hasForeground) expect(device.foreground).toBeUndefined();
        expect(device.title).toContain('iPhone Duo');
        expect(device.width * device.height).toBeLessThanOrEqual(3_000_000);
        for (const [x, y] of device.corners) {
            expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(device.width);
            expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(device.height);
        }
    }
    expect(getRasterDevice('iphone-bitmap')).toMatchObject({ title: 'iPhone', maskFromAlpha: true });
});
