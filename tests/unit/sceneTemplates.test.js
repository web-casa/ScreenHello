import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScreenHelloRuntime } from '../../src/stores/index.js';
import {
    SCENE_TEMPLATES,
    computeMultiLayerLayout,
    getSceneTemplate,
} from '../../src/utils/sceneTemplates.js';

const runtimes = [];
const createRuntime = () => {
    const rt = createScreenHelloRuntime();
    runtimes.push(rt);
    rt.activate();
    rt.editor.setMessage({
        open: vi.fn(),
        success: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
    });
    return rt;
};

const sampleImg = (name = 'one') => ({
    src: `data:image/png;base64,${name}`,
    width: 640,
    height: 480,
    type: 'image/png',
    name: `${name}.png`,
});

afterEach(() => {
    runtimes.splice(0).forEach((rt) => rt.dispose());
    vi.restoreAllMocks();
});

describe('Scene template library and atomic command transaction', () => {
    it('defines 18 valid templates and computes deterministic multi-layer layouts', () => {
        expect(SCENE_TEMPLATES).toHaveLength(18);
        expect(getSceneTemplate('tilt-left-hero')?.category).toBe('3d');
        expect(getSceneTemplate('unknown')).toBeNull();

        const trio = computeMultiLayerLayout('trio-fan', [
            { id: 'a' },
            { id: 'b' },
            { id: 'c' },
        ], 1920, 1080);
        expect(trio).toHaveLength(3);
        expect(trio[0].transform.rotation).toBe(-8);
        expect(trio[1].transform.rotation).toBe(0);
        expect(trio[2].transform.rotation).toBe(8);
    });

    it('applies a template atomically in a single undoable history step while preserving user images and shapes', async () => {
        const rt = createRuntime();
        rt.editor.replaceImg(sampleImg('first'));
        rt.imageStore.add(sampleImg('second'), { commit: false });
        rt.history.reset();

        const beforeCount = rt.history.manager.count;
        const beforeFrame = rt.option.frame;
        const beforeBg = rt.option.background;

        await expect(rt.commands.applySceneTemplate('tilt-left-hero')).resolves.toBe(true);
        expect(rt.option.frame).toBe('arc');
        expect(rt.option.perspective3d.preset).toBe('tilt-left');
        expect(rt.option.background).toBe('gradient_18');
        expect(rt.imageStore.list).toHaveLength(2);
        // Exactly ONE history entry added!
        expect(rt.history.manager.count).toBe(beforeCount + 1);

        // Single undo restores all fields atomically.
        rt.history.undo();
        expect(rt.option.frame).toBe(beforeFrame);
        expect(rt.option.background).toBe(beforeBg);
        expect(rt.option.perspective3d.preset).toBe('flat');

        // Multi-layer template updates both unlocked layers in a single undo step.
        await expect(rt.commands.applySceneTemplate('duo-side-by-side')).resolves.toBe(true);
        expect(rt.imageStore.list[0].transform.x).toBeLessThan(0);
        expect(rt.imageStore.list[1].transform.x).toBeGreaterThan(0);
        rt.history.undo();
        expect(rt.imageStore.list[0].transform.x).toBe(0);
    });

    it('drops stale concurrent template applications cleanly without leaving partial state', async () => {
        const rt = createRuntime();
        rt.editor.replaceImg(sampleImg('base'));
        rt.history.reset();

        const first = rt.commands.applySceneTemplate('browser-dark');
        const second = rt.commands.applySceneTemplate('product-hunt-gallery');
        const [firstResult, secondResult] = await Promise.all([first, second]);

        expect(firstResult).toBe(false);
        expect(secondResult).toBe(true);
        expect(rt.option.frame).toBe('macosBarLight');
        expect(rt.option.frameConf.width).toBe(1270);
        expect(rt.option.frameConf.height).toBe(760);
    });
});
