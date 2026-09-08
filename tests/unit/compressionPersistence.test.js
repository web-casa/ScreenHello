import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocument } from '../../src/utils/projectDocument.js';
import { createStylePreset } from '../../src/utils/stylePreset.js';
import { createPresetArchive, createProjectArchive, readWorkspaceArchive } from '../../src/utils/workspaceArchive.js';
import { exportSettingsWarnings, normalizeExportSettings } from '../../src/utils/exportSettings.js';
import { createPngFixture } from '../fixtures/createPngFixture.js';

const image = new Blob([createPngFixture(64, 48)], { type: 'image/png' });
const document = createDocument({ image: { width: 64, height: 48, type: 'image/png' }, shapes: [{ id: 'mark', type: 'Square', x: 2, y: 3 }] });
const rewriteSettings = async (blob, settings) => {
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    if (manifest.preset) manifest.preset.exportSettings = settings;
    else manifest.exportSettings = settings;
    entries['manifest.json'] = strToU8(JSON.stringify(manifest));
    return new Blob([zipSync(entries)], { type: blob.type });
};

describe('C3 archive compression compatibility', () => {
    it.each([
        { format: 'png', ratio: 3, compression: 'lossless' },
        ...[64, 128, 256].map(paletteColors => ({ format: 'png', ratio: 2, compression: 'lossy', paletteColors })),
        { format: 'webp', ratio: 1, compression: 'lossless' },
        ...['jpg', 'webp', 'avif'].map(format => ({ format, ratio: 1, compression: 'lossy', quality: 40 })),
    ])('roundtrips $format/$compression through both portable containers and tolerates legacy preference projection', async settings => {
        const project = await createProjectArchive({ document, image, exportSettings: settings });
        const preset = await createPresetArchive({ preset: createStylePreset({ option: document.option, exportSettings: settings }) });
        for (const blob of [project, preset]) {
            const decoded = await readWorkspaceArchive(blob);
            expect(decoded.preset?.exportSettings || decoded.exportSettings).toEqual(settings);
            expect(decoded.exportSettingsWarnings).toEqual([]);
            // Legacy readers only retained format/ratio. Dropping optional settings must never alter scene data.
            const legacy = { format: settings.format, ratio: settings.ratio };
            const reopened = await readWorkspaceArchive(await rewriteSettings(blob, legacy));
            expect(reopened.preset?.exportSettings || reopened.exportSettings).toEqual(legacy);
            expect(reopened.preset?.option || reopened.document).toEqual(decoded.preset?.option || decoded.document);
            if (decoded.image) expect(await reopened.image.arrayBuffer()).toEqual(await decoded.image.arrayBuffer());
        }
    });

    it.each([
        { format: 'png', ratio: 2, compression: 'future' },
        { format: 'avif', ratio: 1, compression: 'lossless' },
        { format: 'png', ratio: 3, compression: 'lossy', paletteColors: 63 },
        { format: 'webp', ratio: 1, compression: 'lossy', quality: 101 },
        { format: 'jpg', ratio: 2, compression: 'lossy', quality: NaN },
        { format: 'jpg', ratio: 2, compression: 'lossy', quality: '80' },
        { format: 'png', ratio: 1, compression: null },
        { format: 'webp', ratio: 2, compression: 'standard', quality: 50 },
    ])('warns and preserves readable content for invalid explicit compression: %j', async invalid => {
        expect(exportSettingsWarnings(invalid)).toEqual(['export-settings-reset']);
        const project = await createProjectArchive({ document, image });
        const preset = await createPresetArchive({ preset: createStylePreset({ option: document.option }) });
        for (const blob of [project, preset]) {
            const before = await readWorkspaceArchive(blob);
            const after = await readWorkspaceArchive(await rewriteSettings(blob, invalid));
            expect(after.exportSettingsWarnings).toEqual(['export-settings-reset']);
            expect(after.preset?.exportSettings || after.exportSettings).toEqual({ format: invalid.format, ratio: invalid.ratio });
            expect(after.preset?.option || after.document).toEqual(before.preset?.option || before.document);
        }
    });

    it('loads missing fields and orphan legacy quality without inferring lossy consent', () => {
        for (const input of [undefined, {}, { format: 'jpg', ratio: 1, quality: 20 }]) {
            expect(exportSettingsWarnings(input)).toEqual([]);
            expect(normalizeExportSettings(input).compression).toBeUndefined();
        }
    });
});
