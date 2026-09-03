import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScreenHelloRuntime } from '../../src/stores/index.js';

const runtimes = [];
const runtime = () => {
    const value = createScreenHelloRuntime();
    runtimes.push(value);
    return value;
};

const image = (name) => ({
    src: `data:image/png;base64,${name}`,
    width: 64,
    height: 48,
    type: 'image/png',
    name: `${name}.png`,
});

afterEach(() => {
    runtimes.splice(0).forEach((value) => value.dispose());
    vi.restoreAllMocks();
});

describe('BaseSnapshotService multi-image behavior', () => {
    it('tracks every image layer but ignores active-layer-only selection changes', () => {
        const root = runtime();
        root.editor.replaceImg(image('first'));
        root.baseSnapshot.schedule(root.editor);
        const firstRevision = root.baseSnapshot.revision;
        const firstId = root.imageStore.activeId;

        const second = root.imageStore.add(image('second'));
        root.baseSnapshot.schedule(root.editor);
        const multiRevision = root.baseSnapshot.revision;
        expect(multiRevision).not.toBe(firstRevision);

        root.imageStore.select([firstId]);
        root.baseSnapshot.schedule(root.editor);
        const beforeSelection = root.baseSnapshot.revision;
        root.imageStore.select([second.id]);
        root.baseSnapshot.schedule(root.editor);

        expect(root.baseSnapshot.revision).toBe(beforeSelection);
    });

    it('keeps all image nodes visible while hiding and restoring annotation nodes', async () => {
        const root = runtime();
        const first = { __screenhelloImageId: 'first', visible: true };
        const second = { __screenhelloImageId: 'second', visible: true };
        const legacy = { id: 'screenshot-box', visible: true };
        const annotation = { id: 'shape', visible: true };
        const hiddenAnnotation = { id: 'hidden-shape', visible: false };
        const snapshot = { data: 'png', width: 10, height: 10 };
        let visibilityDuringExport = null;
        const frame = {
            children: [first, second, legacy, annotation, hiddenAnnotation],
            export: vi.fn(async () => {
                visibilityDuringExport = root.editor.app.tree.children[0].children
                    .map((child) => child.visible);
                return snapshot;
            }),
        };
        root.editor.app = { tree: { children: [frame] }, destroy: vi.fn() };
        root.baseSnapshot.revision = 'current';
        const onUpdate = vi.fn();
        root.baseSnapshot.onUpdate = onUpdate;

        await root.baseSnapshot._generate(root.editor, 'current');

        expect(visibilityDuringExport).toEqual([true, true, true, false, false]);
        expect(onUpdate).toHaveBeenCalledWith(snapshot);
        expect(root.editor.app.tree.children[0].children.map((child) => child.visible))
            .toEqual([true, true, true, true, false]);
    });
});
