import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { createScreenHelloRuntime } from '../../src/stores/index.js';
import { createDocument } from '../../src/utils/projectDocument.js';
import {
    CODE_CARD_MAX_UTF8_BYTES,
    PROJECT_CODE_CARDS_MAX_BYTES,
    estimateProjectCodeCardBytes,
    normalizeCodeCard,
} from '../../src/utils/codeCardSchema.js';
import { createProjectArchive, readWorkspaceArchive } from '../../src/utils/workspaceArchive.js';

let preparedSeq = 0;

vi.mock('../../src/utils/runtimeImage.js', () => ({
    prepareRuntimeImage: vi.fn(async (input) => {
        preparedSeq += 1;
        const width = input?.__width || 1280;
        const height = input?.__height || 720;
        return {
            src: `blob:code-card-${preparedSeq}`,
            width,
            height,
            type: input?.type || 'image/png',
            name: input?.name || `code-card-${preparedSeq}.png`,
            blob: input instanceof Blob ? input : new Blob(['png'], { type: 'image/png' }),
            _ownsObjectUrl: true,
        };
    }),
    releaseRuntimeImage: vi.fn((image, platform) => {
        if (image?._ownsObjectUrl && typeof image.src === 'string') {
            platform?.file?.revokeObjectURL?.(image.src);
        }
    }),
}));

const runtimes = [];
const createRuntime = (options = {}) => {
    const runtime = createScreenHelloRuntime(options);
    runtimes.push(runtime);
    runtime.activate();
    runtime.workspace.enabled = options.workspaceEnabled ?? true;
    runtime.editor.setMessage({
        open: vi.fn(),
        success: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
    });
    return runtime;
};

const pngBlob = (tag = 'card', { width = 1280, height = 720 } = {}) => {
    const file = new File([`png:${tag}`], `${tag}.png`, { type: 'image/png' });
    file.__width = width;
    file.__height = height;
    return file;
};

const plainImage = (name = 'photo') => ({
    src: `data:image/png;base64,${name}`,
    width: 640,
    height: 480,
    type: 'image/png',
    name: `${name}.png`,
});

beforeEach(() => {
    preparedSeq = 0;
});

afterEach(() => {
    runtimes.splice(0).forEach((runtime) => runtime.dispose());
    vi.restoreAllMocks();
});

describe('Code card lifecycle and store contract', () => {
    it('creates, edits, undoes, and redoes code cards while keeping redo assets alive across pruneResources', async () => {
        const runtime = createRuntime({ workspaceEnabled: false });
        const revokeSpy = vi.spyOn(runtime.platform.file, 'revokeObjectURL').mockImplementation(() => {});

        // Available in both library (workspace=false) and standalone modes
        expect(runtime.commands.get('file.createCodeCard')).toMatchObject({
            visible: true,
            enabled: true,
        });

        const firstCard = {
            code: 'const hello = () => "world";',
            language: 'javascript',
            theme: 'dracula',
            title: 'hello.js',
            windowStyle: 'mac',
            showLineNumbers: true,
            fontSize: 15,
            padding: 32,
            cardWidth: 680,
            tabSize: 2,
        };

        await expect(runtime.commands.applyCodeCard(pngBlob('v1', { width: 1360, height: 640 }), firstCard, { mode: 'create' }))
            .resolves.toBe(true);

        expect(runtime.imageStore.list).toHaveLength(1);
        const firstLayer = runtime.imageStore.activeLayer;
        expect(firstLayer.codeCard).toEqual(normalizeCodeCard(firstCard));
        expect(runtime.commands.getEditableCodeCardLayer()?.id).toBe(firstLayer.id);
        expect(runtime.commands.get('edit.editCodeCard')).toMatchObject({ enabled: true });
        expect(runtime.history.canUndo).toBe(false);

        // Edit the code card -> commits a discrete undo step
        const editedCard = {
            ...firstCard,
            code: 'export const hello = (name: string) => `Hi, ${name}`;',
            language: 'typescript',
            theme: 'github-light',
            title: 'hello.ts',
        };
        await expect(runtime.commands.applyCodeCard(pngBlob('v2', { width: 1400, height: 700 }), editedCard, {
            mode: 'edit',
            targetId: firstLayer.id,
        })).resolves.toBe(true);

        const editedLayer = runtime.imageStore.activeLayer;
        const editedAssetId = editedLayer.assetId;
        const editedSrc = runtime.imageStore.resources.get(editedAssetId)?.src;
        expect(editedLayer.codeCard.title).toBe('hello.ts');
        expect(editedLayer.codeCard.theme).toBe('github-light');
        expect(editedAssetId).not.toBe(firstLayer.assetId);
        expect(runtime.history.canUndo).toBe(true);

        // Undo back to v1 and explicitly run _pruneResources(); redo asset must stay retained!
        runtime.history.undo();
        runtime.history._pruneResources();
        expect(runtime.imageStore.activeLayer.codeCard.title).toBe('hello.js');
        expect(runtime.imageStore.activeLayer.assetId).toBe(firstLayer.assetId);
        expect(runtime.imageStore.resources.has(editedAssetId)).toBe(true);
        expect(revokeSpy).not.toHaveBeenCalledWith(editedSrc);

        // Redo back to v2 restores both metadata and bitmap resource
        runtime.history.redo();
        expect(runtime.imageStore.activeLayer.codeCard.title).toBe('hello.ts');
        expect(runtime.imageStore.activeLayer.assetId).toBe(editedAssetId);
        expect(runtime.imageStore.resources.get(editedAssetId)?.src).toBe(editedSrc);

        // Create a second code card -> commits another discrete undo step
        await expect(runtime.commands.applyCodeCard(pngBlob('second'), {
            code: 'fn main() { println!("hi"); }',
            language: 'rust',
            title: 'main.rs',
        }, { mode: 'create' })).resolves.toBe(true);
        expect(runtime.imageStore.list).toHaveLength(2);
        expect(runtime.imageStore.activeLayer.codeCard.language).toBe('rust');
        runtime.history.undo();
        expect(runtime.imageStore.list).toHaveLength(1);
    });

    it('clears codeCard on replaceActiveImage and cropActiveImage while preserving on undefined', async () => {
        const runtime = createRuntime();
        await expect(runtime.commands.applyCodeCard(pngBlob('card'), {
            code: 'SELECT * FROM users;',
            language: 'sql',
            title: 'query.sql',
        }, { mode: 'create' })).resolves.toBe(true);

        const targetId = runtime.imageStore.activeId;
        expect(runtime.imageStore.activeLayer.codeCard?.language).toBe('sql');

        // Default undefined preserves existing codeCard
        runtime.imageStore.replaceActiveResource(plainImage('internal-refresh'), { targetId, commit: false });
        expect(runtime.imageStore.activeLayer.codeCard?.language).toBe('sql');

        // Crop clears codeCard explicitly (undo restores it)
        await expect(runtime.commands.cropActiveImage(pngBlob('cropped', { width: 800, height: 400 }), { targetId }))
            .resolves.toBe(true);
        expect(runtime.imageStore.activeLayer.codeCard).toBeUndefined();
        expect('codeCard' in runtime.imageStore.activeLayer).toBe(false);
        expect(runtime.commands.get('edit.editCodeCard').enabled).toBe(false);

        // Undo restores codeCard metadata
        runtime.history.undo();
        expect(runtime.imageStore.activeLayer.codeCard?.language).toBe('sql');

        // Replacing active image with another photo clears codeCard
        await expect(runtime.commands.replaceActiveImage(pngBlob('photo-replacement'))).resolves.toBe(true);
        expect(runtime.imageStore.activeLayer.codeCard).toBeUndefined();
        expect('codeCard' in runtime.imageStore.activeLayer).toBe(false);
    });

    it('blocks invalid edits (empty code, locked, multi-select, non-code layer) and enforces 360 KiB duplicate budget', async () => {
        const runtime = createRuntime();

        // Reject whitespace-only code
        await expect(runtime.commands.applyCodeCard(pngBlob('blank'), { code: '   \n\t  ' }, { mode: 'create' }))
            .resolves.toBe(false);
        expect(runtime.imageStore.list).toHaveLength(0);

        // Plain image layer cannot be edited as code card
        runtime.editor.replaceImg(plainImage('ordinary'));
        const serializedOrdinary = runtime.editor.serializeProject();
        expect('codeCard' in serializedOrdinary.images[0]).toBe(false);
        expect(runtime.commands.get('edit.editCodeCard').enabled).toBe(false);
        await expect(runtime.commands.applyCodeCard(pngBlob('bad-edit'), { code: 'const x = 1;' }, {
            mode: 'edit',
            targetId: runtime.imageStore.activeId,
        })).resolves.toBe(false);

        // Add code card, lock it -> edit disabled
        await expect(runtime.commands.applyCodeCard(pngBlob('c1'), { code: 'const a = 1;' }, { mode: 'create' }))
            .resolves.toBe(true);
        const cardId = runtime.imageStore.activeId;
        runtime.imageStore.toggleLockSelected();
        expect(runtime.commands.get('edit.editCodeCard').enabled).toBe(false);
        await expect(runtime.commands.applyCodeCard(pngBlob('c1-edit'), { code: 'const a = 2;' }, {
            mode: 'edit',
            targetId: cardId,
        })).resolves.toBe(false);

        // Unlock + multi-select -> edit disabled
        runtime.imageStore.toggleLockSelected();
        runtime.imageStore.select(runtime.imageStore.list.map((layer) => layer.id));
        expect(runtime.commands.get('edit.editCodeCard').enabled).toBe(false);

        // Duplicating a code card clones its metadata; 12 max cards remain safely under 360 KiB
        runtime.imageStore.select([cardId]);
        expect(runtime.imageStore.duplicateSelected()).toBe(true);
        expect(runtime.imageStore.list).toHaveLength(3);
        expect(runtime.imageStore.activeLayer.codeCard).toEqual(runtime.imageStore.layers.get(cardId).codeCard);

        const nearMaxLine = '中'.repeat(7_900); // ~23.7 KiB UTF-8 per card
        const denseCard = normalizeCodeCard({ code: nearMaxLine, language: 'plaintext', title: 'dense.txt' });
        expect(estimateProjectCodeCardBytes([{ codeCard: denseCard }])).toBeLessThanOrEqual(CODE_CARD_MAX_UTF8_BYTES + 512);
        const twelveDense = Array.from({ length: 12 }, () => ({ codeCard: denseCard }));
        expect(estimateProjectCodeCardBytes(twelveDense)).toBeLessThan(PROJECT_CODE_CARDS_MAX_BYTES);
    });

    it('preserves codeCard across serializeProject, replaceProject, restoreLayers, and .screenhello archive round-trip', async () => {
        const runtime = createRuntime();
        const card = normalizeCodeCard({
            code: 'def greet(name):\n    return f"Hello {name}"',
            language: 'python',
            theme: 'nord',
            title: 'greet.py',
            windowStyle: 'minimal',
            showLineNumbers: false,
            fontSize: 16,
            padding: 40,
            cardWidth: 720,
            tabSize: 4,
        });

        await expect(runtime.commands.applyCodeCard(pngBlob('py'), card, { mode: 'create' })).resolves.toBe(true);
        const exportedDoc = runtime.editor.serializeProject();
        expect(exportedDoc.images[0].codeCard).toEqual(card);

        // Restore into a fresh runtime via replaceProject & verify editable
        const restoredRuntime = createRuntime();
        restoredRuntime.imageStore.replaceProject(exportedDoc.images, [{
            ...plainImage('restored-py'),
            assetId: exportedDoc.images[0].assetId,
        }]);
        expect(restoredRuntime.imageStore.activeLayer.codeCard).toEqual(card);
        expect(restoredRuntime.commands.getEditableCodeCardLayer()?.codeCard).toEqual(card);

        // Archive round-trip + 12-card worst-case manifest size check (< 512 KiB)
        const maxPerCardCode = '中'.repeat(7_800); // ~23.4 KiB UTF-8
        const twelveLayers = Array.from({ length: 12 }, (_, index) => ({
            id: `code-${index}`,
            assetId: 'asset-shared-code',
            width: 1200,
            height: 800,
            type: 'image/png',
            name: `snippet-${index}.png`,
            codeCard: {
                code: maxPerCardCode,
                language: 'javascript',
                theme: 'dracula',
                title: `snippet-${index}.js`,
            },
        }));
        const fullDoc = createDocument({ images: twelveLayers });
        const sharedFile = new File(['png-bytes'], 'snippet.png', { type: 'image/png' });
        const archive = await createProjectArchive({
            name: '代码卡片压测项目',
            document: fullDoc,
            images: fullDoc.images.map((metadata) => ({ blob: sharedFile, metadata })),
        });

        const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));
        const manifestBytes = entries['manifest.json'].byteLength;
        expect(manifestBytes).toBeLessThan(512 * 1024);
        const manifest = JSON.parse(strFromU8(entries['manifest.json']));
        expect(manifest.document.images).toHaveLength(12);
        expect(manifest.document.images[0].codeCard.title).toBe('snippet-0.js');

        const parsed = await readWorkspaceArchive(archive, { expectedKind: 'project' });
        expect(parsed.document.images).toHaveLength(12);
        expect(parsed.document.images[11].codeCard.title).toBe('snippet-11.js');
    });
});
