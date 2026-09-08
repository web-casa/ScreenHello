import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserPlatform } from '../../src/platform/browserPlatform.js';
import { createScreenHelloRuntime } from '../../src/stores/index.js';

const runtimes = [];
const runtime = () => {
    const value = createScreenHelloRuntime();
    runtimes.push(value);
    return value;
};
const image = (name, width = 640, height = 480, extra = {}) => ({
    src: `data:image/png;base64,${name}`,
    width,
    height,
    type: 'image/png',
    name: `${name}.png`,
    ...extra,
});

afterEach(() => {
    runtimes.splice(0).forEach((value) => value.dispose());
    vi.restoreAllMocks();
});

describe('ImageStore', () => {
    it('keeps editor.img as the active-layer compatibility view', () => {
        const root = runtime();
        root.editor.replaceImg(image('first'));
        const second = root.imageStore.add(image('second'), { transform: { x: 40, y: 20, scale: 0.8, rotation: 5 } });

        expect(root.imageStore.list).toHaveLength(2);
        expect(root.editor.img.name).toBe('second.png');
        expect(root.option).toMatchObject({ offsetX: 40, offsetY: 20, scale: 0.8, rotation: 5 });

        root.imageStore.select([root.imageStore.list[0].id]);
        expect(root.editor.img.name).toBe('first.png');
        expect(root.imageStore.layers.get(second.id).transform.x).toBe(40);
    });

    it('restores add/remove operations through project history without serializing URLs', () => {
        const root = runtime();
        root.editor.replaceImg(image('first'));
        root.history.reset();
        root.imageStore.add(image('second'), { commit: true });

        expect(root.editor.serializeProject().images).toHaveLength(2);
        expect(root.editor.serializeProject().images[0]).not.toHaveProperty('src');
        root.history.undo();
        expect(root.imageStore.list).toHaveLength(1);
        root.history.redo();
        expect(root.imageStore.list).toHaveLength(2);
    });

    it('groups, expands selection, locks, reorders, and lays out selected layers', () => {
        const root = runtime();
        root.option.setFrameSize(1000, 800);
        root.editor.replaceImg(image('one', 100, 100));
        const two = root.imageStore.add(image('two', 100, 100), { transform: { x: 200, y: 20, scale: 1, rotation: 0 } });
        const three = root.imageStore.add(image('three', 100, 100), { transform: { x: 500, y: 20, scale: 1, rotation: 0 } });
        root.history.reset();

        root.imageStore.select([two.id, three.id]);
        expect(root.imageStore.groupSelected()).toBe(true);
        root.imageStore.select([two.id]);
        expect(root.imageStore.selectedIds).toHaveLength(2);
        expect(root.imageStore.toggleLockSelected()).toBe(true);
        expect(root.imageStore.selectedList.every((layer) => layer.locked)).toBe(true);
        expect(root.imageStore.alignSelected('left')).toBe(false);
        root.imageStore.toggleLockSelected();
        expect(root.imageStore.alignSelected('left')).toBe(true);
        expect(root.imageStore.selectedList.every((layer) => layer.transform.x === 0)).toBe(true);
        expect(root.imageStore.reorderSelected('bottom')).toBe(true);
        expect(root.imageStore.list.slice(0, 2).every((layer) => root.imageStore.selectedIds.includes(layer.id))).toBe(true);
    });

    it('rejects a pixel-budget overflow without changing the current project', () => {
        const root = runtime();
        root.editor.replaceImg(image('large', 10_000, 10_000));
        const before = root.editor.serializeProject();

        expect(() => root.imageStore.add(image('overflow', 5_000, 5_000))).toThrowError('image-pixel-budget');
        expect(root.editor.serializeProject()).toEqual(before);
        expect(root.imageStore.list).toHaveLength(1);
    });

    it('rejects an overflowing multi-image batch without partially appending it', () => {
        const root = runtime();
        root.editor.replaceImg(image('base', 1000, 1000));
        const before = root.editor.serializeProject();
        const resourceCount = root.imageStore.resources.size;

        expect(() => root.imageStore.addMany([
            image('large-one', 10_000, 6000),
            image('large-two', 10_000, 6000),
        ])).toThrowError('image-pixel-budget');

        expect(root.editor.serializeProject()).toEqual(before);
        expect(root.imageStore.resources.size).toBe(resourceCount);
    });

    it('rejects conflicting runtime sources for a shared asset without replacing the project', () => {
        const root = runtime();
        root.editor.replaceImg(image('current'));
        const before = root.editor.serializeProject();

        expect(() => root.imageStore.replaceProject([
            { id: 'one', assetId: 'shared', width: 64, height: 48 },
            { id: 'two', assetId: 'shared', width: 64, height: 48 },
        ], [
            image('one', 64, 48, { assetId: 'shared', src: 'blob:one' }),
            image('two', 64, 48, { assetId: 'shared', src: 'blob:two' }),
        ])).toThrowError('image-asset-conflict');

        expect(root.editor.serializeProject()).toEqual(before);
        expect(root.imageStore.list).toHaveLength(1);
    });

    it('releases each owned object URL when replacing the project', () => {
        const root = runtime();
        const revoke = vi.spyOn(browserPlatform.file, 'revokeObjectURL').mockImplementation(() => {});
        root.editor.replaceImg(image('first', 10, 10, { src: 'blob:first', _ownsObjectUrl: true }));
        root.editor.replaceImg(image('second', 10, 10, { src: 'blob:second', _ownsObjectUrl: true }));

        expect(revoke).toHaveBeenCalledWith('blob:first');
        root.dispose();
        expect(revoke).toHaveBeenCalledWith('blob:second');
    });

    it('detaches a duplicated layer before replacing its cropped source', () => {
        const root = runtime();
        root.editor.replaceImg(image('original'));
        const originalId = root.imageStore.activeId;
        root.imageStore.duplicateSelected();
        const duplicateId = root.imageStore.activeId;

        root.editor.setImg(image('cropped', 320, 240));

        expect(root.imageStore.layers.get(originalId).assetId).not.toBe(root.imageStore.layers.get(duplicateId).assetId);
        root.imageStore.select([originalId]);
        expect(root.editor.img.name).toBe('original.png');
        root.imageStore.select([duplicateId]);
        expect(root.editor.img.name).toBe('cropped.png');
    });

    it('clears the persisted draft hook when the final image layer is removed', () => {
        const root = runtime();
        const clearDraft = vi.fn();
        root.editor.setClearDraftHook(clearDraft);
        root.editor.replaceImg(image('only'));
        root.history.reset();

        expect(root.imageStore.removeSelected()).toBe(true);

        expect(root.imageStore.list).toHaveLength(0);
        expect(clearDraft).toHaveBeenCalledOnce();
        expect(root.history.canUndo).toBe(true);
    });

    it('releases orphan resources after their final history snapshot is evicted', () => {
        const root = runtime();
        const revoke = vi.spyOn(browserPlatform.file, 'revokeObjectURL').mockImplementation(() => {});
        root.editor.replaceImg(image('base', 10, 10, { src: 'blob:base', _ownsObjectUrl: true }));
        root.history.manager.options.limit = 2;
        root.history.reset();

        root.imageStore.add(image('temporary', 10, 10, { src: 'blob:temporary', _ownsObjectUrl: true }), { commit: true });
        root.imageStore.removeSelected();
        expect(revoke).not.toHaveBeenCalledWith('blob:temporary');

        root.imageStore.add(image('next', 10, 10, { src: 'blob:next', _ownsObjectUrl: true }), { commit: true });
        expect(revoke).toHaveBeenCalledWith('blob:temporary');
        expect(root.imageStore.resources.size).toBe(2);
    });

    it('replaces only the active image resource and restores both resources through undo and redo', () => {
        const root = runtime();
        const revoke = vi.spyOn(browserPlatform.file, 'revokeObjectURL').mockImplementation(() => {});
        root.editor.replaceImg(image('first', 100, 80));
        const target = root.imageStore.add(image('second', 200, 120, {
            src: 'blob:second',
            _ownsObjectUrl: true,
        }), { transform: { x: 37, y: 29, scale: 0.75, rotation: 12 } });
        root.imageStore.layers.set(target.id, { ...root.imageStore.layers.get(target.id), groupId: 'group:1' });
        root.history.reset();
        root.editor.snap = { data: 'stale-snapshot' };
        root.baseSnapshot.snapshot = { data: 'stale-snapshot' };

        expect(root.imageStore.replaceActiveResource(image('replacement', 320, 240, {
            src: 'blob:replacement',
            _ownsObjectUrl: true,
        }), { targetId: target.id, commit: true })).toBeTruthy();

        expect(root.imageStore.list).toHaveLength(2);
        expect(root.editor.img).toMatchObject({
            name: 'replacement.png',
            groupId: 'group:1',
            transform: { x: 37, y: 29, scale: 0.75, rotation: 12 },
        });
        expect(root.editor.snap).toBeNull();
        expect(root.baseSnapshot.getSnapshot()).toBeNull();
        expect(revoke).not.toHaveBeenCalledWith('blob:second');

        root.history.undo();
        expect(root.editor.img.name).toBe('second.png');
        root.history.redo();
        expect(root.editor.img.name).toBe('replacement.png');
    });

    it('reclaims a replaced object URL only after its final history snapshot is evicted', () => {
        const root = runtime();
        const revoke = vi.spyOn(browserPlatform.file, 'revokeObjectURL').mockImplementation(() => {});
        root.editor.replaceImg(image('old', 10, 10, { src: 'blob:old', _ownsObjectUrl: true }));
        root.history.manager.options.limit = 2;
        root.history.reset();

        root.imageStore.replaceActiveResource(image('new', 10, 10, {
            src: 'blob:new',
            _ownsObjectUrl: true,
        }), { commit: true });
        expect(revoke).not.toHaveBeenCalledWith('blob:old');

        root.option.setPadding(10);
        expect(revoke).toHaveBeenCalledWith('blob:old');
        expect(root.editor.img.name).toBe('new.png');
    });

    it('moves an unlocked selection block to a visual drop target and restores order through history', () => {
        const root = runtime();
        root.editor.replaceImg(image('one'));
        const two = root.imageStore.add(image('two'));
        const three = root.imageStore.add(image('three'));
        const four = root.imageStore.add(image('four'));
        root.history.reset();
        root.imageStore.select([two.id, three.id], { expandGroup: false });

        expect(root.imageStore.moveSelectedTo(four.id, 'above')).toBe(true);
        expect(root.imageStore.list.map((layer) => layer.name)).toEqual([
            'one.png',
            'four.png',
            'two.png',
            'three.png',
        ]);
        expect(root.imageStore.toDocument().map((layer) => layer.zIndex)).toEqual([0, 1, 2, 3]);

        root.history.undo();
        expect(root.imageStore.list.map((layer) => layer.name)).toEqual([
            'one.png',
            'two.png',
            'three.png',
            'four.png',
        ]);
        root.history.redo();
        expect(root.imageStore.list.map((layer) => layer.name)).toEqual([
            'one.png',
            'four.png',
            'two.png',
            'three.png',
        ]);
    });

    it('does not reorder locked, boundary, selected-target, or otherwise unchanged layers', () => {
        const root = runtime();
        root.editor.replaceImg(image('one'));
        const two = root.imageStore.add(image('two'));
        root.imageStore.add(image('three'));
        root.history.reset();

        root.imageStore.select([two.id]);
        const initialOrder = root.imageStore.list.map((layer) => layer.id);
        expect(root.imageStore.canReorderSelected('up')).toBe(true);
        expect(root.imageStore.canReorderSelected('down')).toBe(true);
        expect(root.imageStore.list.map((layer) => layer.id)).toEqual(initialOrder);

        root.imageStore.select([root.imageStore.list.at(-1).id]);
        const initialHistoryCount = root.history.manager.count;
        expect(root.imageStore.canReorderSelected('up')).toBe(false);
        expect(root.imageStore.reorderSelected('up')).toBe(false);
        expect(root.imageStore.moveSelectedTo(two.id, 'above')).toBe(false);
        expect(root.history.manager.count).toBe(initialHistoryCount);

        root.imageStore.toggleLockSelected();
        root.history.reset();
        expect(root.imageStore.canReorderSelected('down')).toBe(false);
        expect(root.imageStore.moveSelectedTo(root.imageStore.list[0].id, 'below')).toBe(false);
        expect(root.history.manager.count).toBe(1);
    });
});
