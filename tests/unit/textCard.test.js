import { describe, expect, it } from 'vitest';
import {
    DEFAULT_CODE_CARD,
    normalizeCodeCard,
    parseHighlightLines,
} from '../../src/utils/codeCardSchema.js';
import { layoutCodeCard } from '../../src/utils/codeCardRenderer.js';
import {
    DEFAULT_TEXT_CARD,
    PROJECT_MANIFEST_SOFT_LIMIT_BYTES,
    TEXT_CARD_AVATAR_MAX_BYTES,
    TEXT_CARD_MAX_BODY_CHARS,
    TEXT_CARD_MAX_CHANGELOG_ITEMS,
    estimateSerializedManifestBytes,
    hasRenderableTextCard,
    isValidAvatarDataUrl,
    normalizeTextCard,
} from '../../src/utils/textCardSchema.js';
import { layoutTextCard, wrapRichParagraphs } from '../../src/utils/textCardRenderer.js';
import { createDocument, normalizeProjectImage, validateDocument } from '../../src/utils/projectDocument.js';
import { createScreenHelloRuntime } from '../../src/stores/index.js';

const mockMeasure = (text) => String(text || '').length * 9;

describe('Code card v2 highlight & diff', () => {
    it('parses single lines, ranges, reverse ranges, and filters out-of-bound values', () => {
        expect([...parseHighlightLines('1, 3-5, 8', 10)]).toEqual([1, 3, 4, 5, 8]);
        expect([...parseHighlightLines('5-3, 0, 99, abc', 6)]).toEqual([3, 4, 5]);
        expect(parseHighlightLines('', 10).size).toBe(0);
    });

    it('normalizes highlightLines and diffMode safely', () => {
        const normalized = normalizeCodeCard({
            ...DEFAULT_CODE_CARD,
            highlightLines: '1, 2-4; <script>',
            diffMode: true,
        });
        expect(normalized.highlightLines).toBe('1, 2-4');
        expect(normalized.diffMode).toBe(true);
    });

    it('marks highlighted rows and +/- diff rows in layoutCodeCard', () => {
        const layout = layoutCodeCard(mockMeasure, {
            ...DEFAULT_CODE_CARD,
            code: ['const a = 1;', '-const oldVal = 2;', '+const newVal = 3;', '+++ header', '--- footer'].join('\n'),
            highlightLines: '1',
            diffMode: true,
        });
        expect(layout.hasHighlightFocus).toBe(true);
        expect(layout.renderedRows[0].highlighted).toBe(true);
        expect(layout.renderedRows[0].diffKind).toBeNull();
        expect(layout.renderedRows[1].diffKind).toBe('remove');
        expect(layout.renderedRows[2].diffKind).toBe('add');
        expect(layout.renderedRows[3].diffKind).toBeNull();
        expect(layout.renderedRows[4].diffKind).toBeNull();
    });
});

describe('Text / Social card schema and renderer', () => {
    it('normalizes fields, clamps bounds, and rejects unsafe or oversized avatar URLs', () => {
        const validAvatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        expect(isValidAvatarDataUrl(validAvatar)).toBe(true);
        expect(isValidAvatarDataUrl('https://evil.example/a.png')).toBe(false);
        expect(isValidAvatarDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false);
        expect(isValidAvatarDataUrl(`data:image/png;base64,${'A'.repeat(TEXT_CARD_AVATAR_MAX_BYTES + 10)}`)).toBe(false);

        const normalized = normalizeTextCard({
            kind: 'social',
            authorHandle: 'screenhello',
            avatarDataUrl: 'https://evil.example/avatar.png',
            body: 'A'.repeat(TEXT_CARD_MAX_BODY_CHARS + 500),
            cardWidth: 9999,
            padding: 2,
            fontSize: 99,
            changelogItems: Array.from({ length: 20 }, (_, i) => ({ tag: 'invalid', text: `item-${i}` })),
        });
        expect(normalized.authorHandle).toBe('@screenhello');
        expect(normalized.avatarDataUrl).toBeNull();
        expect(normalized.body.length).toBe(TEXT_CARD_MAX_BODY_CHARS);
        expect(normalized.cardWidth).toBe(1080);
        expect(normalized.padding).toBe(20);
        expect(normalized.fontSize).toBe(26);
        expect(normalized.changelogItems).toHaveLength(TEXT_CARD_MAX_CHANGELOG_ITEMS);
        expect(normalized.changelogItems[0].tag).toBe('new');
    });

    it('evaluates renderable state per card kind', () => {
        expect(hasRenderableTextCard({ ...DEFAULT_TEXT_CARD, kind: 'social', body: '   ' })).toBe(false);
        expect(hasRenderableTextCard({ ...DEFAULT_TEXT_CARD, kind: 'quote', body: 'Design is how it works.' })).toBe(true);
        expect(hasRenderableTextCard({
            ...DEFAULT_TEXT_CARD,
            kind: 'changelog',
            changelogTitle: '',
            changelogItems: [{ tag: 'fix', text: '   ' }],
        })).toBe(false);
        expect(hasRenderableTextCard({
            ...DEFAULT_TEXT_CARD,
            kind: 'changelog',
            changelogTitle: '',
            changelogItems: [{ tag: 'fix', text: 'Fixed crash' }],
        })).toBe(true);
    });

    it('wraps CJK and Latin text cleanly and lays out all three card kinds within pixel budget', () => {
        const wrapped = wrapRichParagraphs('ScreenHello 本地截图美化工具支持3D透视与文本卡片', 120, mockMeasure);
        expect(wrapped.length).toBeGreaterThan(1);

        for (const kind of ['social', 'quote', 'changelog']) {
            const layout = layoutTextCard(mockMeasure, { ...DEFAULT_TEXT_CARD, kind }, { pixelRatio: 2 });
            expect(layout.pixelWidth).toBe(layout.logicalWidth * 2);
            expect(layout.pixelHeight).toBeGreaterThanOrEqual(400);
            expect(layout.pixelWidth * layout.pixelHeight).toBeLessThanOrEqual(16_777_216);
        }
    });

    it('preserves textCard in projectDocument and enforces mutual exclusivity with codeCard', () => {
        const textLayer = normalizeProjectImage({
            id: 'img-text-1',
            assetId: 'asset-1',
            width: 1280,
            height: 640,
            textCard: { ...DEFAULT_TEXT_CARD, kind: 'quote', body: 'Hello world' },
        });
        expect(textLayer.textCard?.kind).toBe('quote');
        expect(textLayer.codeCard).toBeUndefined();

        const both = normalizeProjectImage({
            id: 'img-both',
            assetId: 'asset-2',
            width: 1280,
            height: 640,
            codeCard: { ...DEFAULT_CODE_CARD },
            textCard: { ...DEFAULT_TEXT_CARD },
        });
        expect(both.codeCard).toBeTruthy();
        expect(both.textCard).toBeUndefined();

        const doc = createDocument({ images: [textLayer] });
        const validated = validateDocument(doc);
        expect(validated.ok).toBe(true);
        expect(validated.doc.images[0].textCard?.body).toBe('Hello world');
    });

    it('enforces the 480 KiB serialized manifest soft limit across text and code cards', () => {
        const runtime = createScreenHelloRuntime();
        try {
            const bigBody = 'x'.repeat(3900);
            const bigAvatar = `data:image/png;base64,${'A'.repeat(31_000)}`;
            const heavyTextCard = normalizeTextCard({
                ...DEFAULT_TEXT_CARD,
                body: bigBody,
                avatarDataUrl: bigAvatar,
            });
            expect(heavyTextCard.avatarDataUrl).toBeTruthy();

            // Create enough layers so total manifest exceeds 480 KiB
            const manyLayers = Array.from({ length: 16 }, (_, idx) => ({
                id: `img-${idx}`,
                textCard: heavyTextCard,
            }));
            expect(estimateSerializedManifestBytes({ version: 2, images: manyLayers }))
                .toBeGreaterThan(PROJECT_MANIFEST_SOFT_LIMIT_BYTES);
            expect(runtime.commands._exceedsManifestBudget(manyLayers)).toBe(true);
        } finally {
            runtime.dispose();
        }
    });
});
