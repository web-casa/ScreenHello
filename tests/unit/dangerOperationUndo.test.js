import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScreenHelloRuntime } from '../../src/stores/index.js';

/**
 * 危险操作三件套（删图层 / 重置样式 / 移除背景）共用同一套 toast 撤销约定：
 * 直接执行 + 一次撤销机会，且撤销凭据只在它仍是历史栈顶时有效。
 * 这些用例按实例运行，message 用与 App 相同的注入方式（editor.setMessage）。
 */

const runtimes = [];

const createRuntime = ({ withMessage = true } = {}) => {
    const runtime = createScreenHelloRuntime({ locale: 'en-US' });
    runtimes.push(runtime);
    runtime.activate();
    const open = vi.fn(() => vi.fn());
    const info = vi.fn();
    if (withMessage) {
        runtime.editor.setMessage({ open, success: vi.fn(), info, warning: vi.fn(), error: vi.fn() });
    }
    return { runtime, open, info };
};

const layer = (name) => ({ src: `data:image/png;base64,${name}`, width: 64, height: 48, type: 'image/png', name });

const lastNotice = (open) => open.mock.calls.at(-1)[0];
const toastLabel = (open) => lastNotice(open).content.props.children[0].props.children;
const clickUndo = (open) => lastNotice(open).content.props.children[1].props.onClick();

afterEach(() => {
    runtimes.splice(0).forEach((runtime) => runtime.dispose());
    vi.restoreAllMocks();
});

describe('danger operations expose one-click undo', () => {
    it('restores a deleted image layer, its order and the selection', () => {
        const { runtime, open } = createRuntime();
        const layers = runtime.imageStore.addMany([layer('a'), layer('b'), layer('c')], { commit: true });
        runtime.history.reset();
        const before = runtime.imageStore.list.map((item) => item.name);

        runtime.imageStore.select([layers[1].id]);
        expect(runtime.commands.deleteSelection()).toBe(true);
        expect(runtime.imageStore.list.map((item) => item.name)).toEqual(['a', 'c']);
        expect(toastLabel(open)).toBe('Deleted 1 layers');

        clickUndo(open);
        expect(runtime.imageStore.list.map((item) => item.name)).toEqual(before);
        expect(runtime.imageStore.list.map((item) => item.zIndex)).toEqual([0, 1, 2]);
    });

    it('reports the number of deleted layers and counts only unlocked ones', () => {
        const { runtime, open } = createRuntime();
        const layers = runtime.imageStore.addMany([layer('a'), layer('b'), layer('c')], { commit: true });
        runtime.history.reset();

        runtime.imageStore.select([layers[0].id, layers[1].id, layers[2].id]);
        runtime.imageStore.select([layers[2].id]);
        runtime.imageStore.toggleLockSelected();
        runtime.imageStore.select([layers[0].id, layers[1].id, layers[2].id]);
        expect(runtime.commands.deleteSelection()).toBe(true);
        expect(toastLabel(open)).toBe('Deleted 2 layers');
    });

    it('reports nothing when every selected layer is locked', () => {
        const { runtime, open } = createRuntime();
        const [first] = runtime.imageStore.addMany([layer('a')], { commit: true });
        runtime.history.reset();
        runtime.imageStore.select([first.id]);
        runtime.imageStore.toggleLockSelected();
        runtime.imageStore.select([first.id]);

        expect(runtime.commands.deleteSelection()).toBe(false);
        expect(open).not.toHaveBeenCalled();
    });

    it('keeps each delete as its own history step and replaces the previous notice', () => {
        const { runtime, open } = createRuntime();
        const layers = runtime.imageStore.addMany([layer('a'), layer('b'), layer('c')], { commit: true });
        runtime.history.reset();

        runtime.imageStore.select([layers[0].id]);
        expect(runtime.commands.deleteSelection()).toBe(true);
        runtime.imageStore.select([layers[1].id]);
        expect(runtime.commands.deleteSelection()).toBe(true);
        expect(runtime.imageStore.list.map((item) => item.name)).toEqual(['c']);
        expect(lastNotice(open).key).toBe('undo:selection-delete');

        // 两次删除不再被 400ms 合并窗口并成一步：一次撤销只恢复一层，与提示文案一致
        clickUndo(open);
        expect(runtime.imageStore.list.map((item) => item.name)).toEqual(['b', 'c']);
    });

    it('does not undo later work through a stale delete notice', () => {
        const { runtime, open, info } = createRuntime();
        const layers = runtime.imageStore.addMany([layer('a'), layer('b')], { commit: true });
        runtime.history.reset();
        runtime.imageStore.select([layers[0].id]);
        expect(runtime.commands.deleteSelection()).toBe(true);
        expect(runtime.imageStore.list.map((item) => item.name)).toEqual(['b']);

        // 删除之后又有一次真实编辑：旧 toast 的撤销凭据必须失效
        runtime.imageStore.addMany([layer('c')], { commit: true });
        clickUndo(open);

        expect(runtime.imageStore.list.map((item) => item.name)).toEqual(['b', 'c']);
        expect(info).toHaveBeenCalledWith('Nothing to undo');
    });

    it('undoes an image style reset back to the previous style', () => {
        const { runtime, open } = createRuntime();
        runtime.option.setPadding(24);
        runtime.history.reset();

        expect(runtime.option.resetImageStyle()).toBe(true);
        expect(runtime.option.padding).toBe(0);
        expect(toastLabel(open)).toBe('Image style reset');

        clickUndo(open);
        expect(runtime.option.padding).toBe(24);
    });

    it('undoes removing the background back to the previous preset', () => {
        const { runtime, open } = createRuntime();
        runtime.option.setBackground('default_1');
        runtime.history.reset();

        expect(runtime.option.setBackground('none')).toBe(true);
        expect(runtime.option.background).toBe('none');
        expect(toastLabel(open)).toBe('Background removed');

        clickUndo(open);
        expect(runtime.option.background).toBe('default_1');
    });

    it('stays quiet when the background is already empty', () => {
        const { runtime, open } = createRuntime();
        runtime.option.setBackground('default_1');
        runtime.history.reset();

        runtime.option.setBackground('none');
        runtime.option.setBackground('none');
        expect(open).toHaveBeenCalledOnce();
    });

    it('keeps deleting, resetting and clearing usable without a host message api', () => {
        const { runtime, open } = createRuntime({ withMessage: false });
        const [first] = runtime.imageStore.addMany([layer('a'), layer('b')], { commit: true });
        runtime.option.setPadding(12);
        runtime.history.reset();

        runtime.imageStore.select([first.id]);
        expect(runtime.commands.deleteSelection()).toBe(true);
        expect(runtime.option.resetImageStyle()).toBe(true);
        expect(runtime.option.setBackground('none')).toBe(true);
        expect(open).not.toHaveBeenCalled();
        expect(runtime.imageStore.list).toHaveLength(1);
    });
});
