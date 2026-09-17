import { describe, expect, it } from 'vitest';
import { libraryDeviceBoundaryPlugin } from '../../config/libraryDeviceBoundaryPlugin.mjs';
import manifest from '../../src/assets/devicescss/manifest.json';

describe('library device metadata boundary', () => {
    it('never bundles the optional Duo artwork into library consumers', async () => {
        const plugin = libraryDeviceBoundaryPlugin();
        const code = plugin.load(plugin.resolveId('./iphoneDuoAssets'));
        const { IPHONE_DUO_ASSETS } = await import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(code)}`);
        expect(IPHONE_DUO_ASSETS).toEqual({});
        expect(code).not.toContain('.png');
    });
    it('retains every saved device ID and geometry without referencing image assets', async () => {
        const plugin = libraryDeviceBoundaryPlugin();
        const code = plugin.load(plugin.resolveId('./devicesCssConfig'));
        const { DEVICESCSS_DEVICES } = await import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(code)}`);
        expect(Object.keys(DEVICESCSS_DEVICES)).toHaveLength(manifest.length);
        for (const entry of manifest) {
            expect(DEVICESCSS_DEVICES[entry.id]).toMatchObject({
                width: entry.sourceWidth, height: entry.sourceHeight, corners: entry.corners,
                available: false, image: null, mask: null, thumb: null,
            });
        }
        expect(code).not.toContain('.png');
    });
});
