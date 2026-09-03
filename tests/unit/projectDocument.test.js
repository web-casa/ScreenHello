import { describe, expect, it } from 'vitest';
import {
    PROJECT_VERSION,
    createDocument,
    defaultDocument,
    normalizeOption,
    normalizeInnerBorder,
    normalizeProjectImage,
    normalizeShape,
    validateDocument,
} from '../../src/utils/projectDocument.js';
import { getBackgroundDefinition } from '../../src/utils/backgroundConfig.js';

describe('ProjectDocument V2', () => {
    it('creates a JSON-serializable default document', () => {
        const document = defaultDocument();

        expect(document.version).toBe(PROJECT_VERSION);
        expect(document.option.paddingBg).toBe('rgba(255,255,255,1)');
        expect(document.images).toEqual([]);
        expect(document.shapes).toEqual([]);
        expect(JSON.parse(JSON.stringify(document))).toEqual(document);
    });

    it('canonicalizes the legacy invalid padding alpha without changing valid colors', () => {
        expect(normalizeOption({ paddingBg: 'rgba(255,255,255, 100)' }).paddingBg)
            .toBe('rgba(255,255,255,1)');
        expect(normalizeOption({ paddingBg: 'rgba(255, 255, 255, 100)' }).paddingBg)
            .toBe('rgba(255,255,255,1)');
        expect(normalizeOption({ paddingBg: 'rgba(12, 34, 56, 0.25)' }).paddingBg)
            .toBe('rgba(12, 34, 56, 0.25)');
    });

    it('migrates a V1 image and its transform without runtime URLs', () => {
        const migrated = validateDocument({
            version: 1,
            option: { offsetX: 24, offsetY: -8, scale: 1.5, rotation: 12 },
            image: {
                assetId: 'image:draft',
                src: 'blob:must-not-persist',
                width: 640,
                height: 480,
                type: 'image/png',
                name: 'legacy.png',
            },
            shapes: [],
        });

        expect(migrated.ok).toBe(true);
        expect(migrated.doc.version).toBe(2);
        expect(migrated.doc.images).toEqual([expect.objectContaining({
            id: 'image-1',
            assetId: 'image:draft',
            transform: { x: 24, y: -8, scale: 1.5, rotation: 12 },
        })]);
        expect(migrated.doc.images[0]).not.toHaveProperty('src');
    });

    it('normalizes image layers and rejects documents above the image limit', () => {
        expect(normalizeProjectImage({
            id: 'hero',
            src: 'blob:runtime',
            width: '320',
            height: 200,
            transform: { x: '12', y: null, scale: 99, rotation: -999 },
            locked: true,
        })).toMatchObject({
            id: 'hero',
            width: 320,
            height: 200,
            transform: { x: 12, y: 0, scale: 3, rotation: -180 },
            locked: true,
        });

        const tooMany = validateDocument({
            version: PROJECT_VERSION,
            images: Array.from({ length: 13 }, (_, index) => ({ id: `image-${index}` })),
            shapes: [],
        });
        expect(tooMany.ok).toBe(false);
        expect(tooMany.errors).toContain('images exceeds limit 12');

        const duplicateIds = validateDocument({
            version: PROJECT_VERSION,
            images: [{ id: 'same' }, { id: 'same' }],
            shapes: [],
        });
        expect(duplicateIds.ok).toBe(false);
        expect(duplicateIds.errors).toContain('images contain duplicate ids');
    });

    it('normalizes shapes and removes invalid entries', () => {
        const document = createDocument({
            shapes: [
                { id: 'shape-1', type: 'Square', x: '12', rotation: 'invalid', color: '#123456' },
                { type: 'Circle', x: 10 },
            ],
        });

        expect(document.shapes).toHaveLength(1);
        expect(document.shapes[0]).toMatchObject({
            id: 'shape-1',
            x: 12,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            fill: '#123456',
        });
        expect(document.shapes[0]).not.toHaveProperty('color');
        expect(normalizeShape(null)).toBeNull();
    });

    it('normalizes empty-string numeric shape fields to their documented defaults', () => {
        expect(normalizeShape({
            id: 'shape-empty-numbers',
            type: 'Square',
            x: '',
            width: '',
            rotation: '',
            scaleX: '',
            scaleY: '',
        })).toMatchObject({
            x: 0,
            width: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
        });
    });

    it('clamps unsafe option values and removes retired 3D fields', () => {
        const option = normalizeOption({
            rotation: 999,
            browserHeaderSize: 1,
            backgroundBlur: -5,
            backgroundMaskOpacity: 4,
            backgroundNoise: 'invalid',
            rotationX: 20,
            rotationY: 30,
            perspective: 800,
        });

        expect(option.rotation).toBe(180);
        expect(option.browserHeaderSize).toBe(50);
        expect(option.backgroundBlur).toBe(0);
        expect(option.backgroundMaskOpacity).toBe(1);
        expect(option.backgroundNoise).toBe(0);
        expect(option).not.toHaveProperty('rotationX');
        expect(option).not.toHaveProperty('rotationY');
        expect(option).not.toHaveProperty('perspective');
    });

    it('normalizes the legacy strench frame mode to the canonical stretch value', () => {
        expect(normalizeOption({ frameMode: 'strench' }).frameMode).toBe('stretch');
        expect(normalizeOption({ frameMode: 'stretch' }).frameMode).toBe('stretch');
        expect(normalizeOption({ frameMode: 'unknown' }).frameMode).toBe('cover');
    });

    it('migrates legacy preset images and canonicalizes uploaded backgrounds without untrusted URLs', () => {
        const untrustedUrl = 'https://attacker.invalid/tracking.png';
        const builtin = normalizeOption({
            background: 'gh_img_65',
            frameConf: { background: { type: 'image', url: untrustedUrl, mode: 'fit' } },
        });
        const uploaded = normalizeOption({
            background: 'upload_image',
            backgroundAssetId: 'background:owned',
            frameConf: { background: { type: 'image', url: untrustedUrl, mode: 'fit' } },
        });
        const unknown = normalizeOption({
            background: 'not-a-real-background',
            frameConf: { background: [{ type: 'image', url: untrustedUrl }] },
        });

        expect(builtin.backgroundAssetId).toBeNull();
        expect(builtin.frameConf.background).toEqual(getBackgroundDefinition('gh_img_65').fill);
        expect(['linear', 'angular']).toContain(builtin.frameConf.background.type);
        expect(builtin.frameConf.background).not.toHaveProperty('url');
        expect(uploaded.frameConf.background).toMatchObject({ type: 'image', url: null });
        expect(JSON.stringify(unknown.frameConf.background)).not.toContain(untrustedUrl);
    });

    it('normalizes the independent inner border without changing the document version', () => {
        expect(normalizeInnerBorder({ visible: true, width: 99, color: '#11111180' })).toEqual({
            visible: true,
            width: 12,
            color: '#11111180',
        });
        const document = createDocument({ option: { frame: 'windowsBarLight', innerBorder: { visible: true, width: 2, color: '#0008' } } });
        expect(document.version).toBe(PROJECT_VERSION);
        expect(document.option).toMatchObject({
            frame: 'windowsBarLight',
            innerBorder: { visible: true, width: 2, color: '#0008' },
        });
    });

    it('reports malformed and unsupported documents without throwing', () => {
        const malformed = validateDocument(null);
        expect(malformed.ok).toBe(false);
        expect(malformed.errors).toContain('document is not an object');

        const unsupported = validateDocument({
            version: PROJECT_VERSION + 1,
            option: 'invalid',
            shapes: 'invalid',
        });
        expect(unsupported.ok).toBe(false);
        expect(unsupported.errors).toEqual([
            `unsupported version ${PROJECT_VERSION + 1}`,
            'option is not an object',
            'shapes is not an array',
        ]);
        expect(unsupported.doc.version).toBe(PROJECT_VERSION);
        expect(unsupported.doc.shapes).toEqual([]);
    });
});
