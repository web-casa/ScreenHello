import { afterEach, describe, expect, it, vi } from 'vitest';
import { showUndoToast, UNDO_TOAST_DURATION } from '../../src/utils/undoToast.jsx';

const createRoot = ({ withMessage = true, withI18n = true } = {}) => {
    const open = vi.fn(() => vi.fn());
    const t = vi.fn((key) => (key === '撤销' ? 'Undo' : key));
    return {
        open,
        root: {
            editor: withMessage ? { message: { open } } : {},
            i18n: withI18n ? { t } : undefined,
        },
    };
};

const lastNotice = (open) => open.mock.calls.at(-1)[0];
const labelElement = (open) => lastNotice(open).content.props.children[0];
const labelOf = (open) => labelElement(open).props.children;
const actionOf = (open) => lastNotice(open).content.props.children[1];

afterEach(() => vi.unstubAllGlobals());

describe('showUndoToast', () => {
    it('returns null and does not touch message when the host injected nothing', () => {
        const onUndo = vi.fn();
        for (const { root, open } of [
            createRoot({ withMessage: false }),
            { root: { editor: { message: {} } }, open: vi.fn() },
        ]) {
            expect(showUndoToast(root, { label: 'Deleted 1 layer', onUndo })).toBeNull();
            expect(open).not.toHaveBeenCalled();
        }
        expect(onUndo).not.toHaveBeenCalled();
    });

    it('skips a notice without text or without an undo callback', () => {
        const { root, open } = createRoot();
        expect(showUndoToast(root, { onUndo: () => {} })).toBeNull();
        expect(showUndoToast(root, { label: 'Deleted 1 layer' })).toBeNull();
        expect(open).not.toHaveBeenCalled();
    });

    it('renders the label with a translated undo action and the default duration', () => {
        const { root, open } = createRoot();
        const close = vi.fn();
        open.mockReturnValue(close);

        expect(showUndoToast(root, { label: 'Deleted 2 layers', onUndo: () => {} })).toBe(close);
        expect(open).toHaveBeenCalledOnce();
        expect(lastNotice(open).duration).toBe(UNDO_TOAST_DURATION / 1000);
        expect(lastNotice(open).pauseOnHover).toBe(true);
        expect(labelOf(open)).toBe('Deleted 2 layers');
        expect(actionOf(open).props.children).toBe('Undo');
    });

    it('falls back to the source-language action when the instance has no i18n', () => {
        const { root, open } = createRoot({ withI18n: false });
        showUndoToast(root, { label: '已删除 1 个图层', onUndo: () => {} });
        expect(actionOf(open).props.children).toBe('撤销');
    });

    it('announces the label and replaces same-key notices', () => {
        const { root, open } = createRoot();
        showUndoToast(root, { label: 'Deleted 1 layer', onUndo: () => {}, key: 'undo:selection-delete' });
        expect(lastNotice(open).key).toBe('undo:selection-delete');
        // antd 的 message 容器没有 role/aria-live，标签自己必须是 live region
        expect(labelElement(open).props.role).toBe('status');
        expect(labelElement(open).props['aria-live']).toBe('polite');

        showUndoToast(root, { label: 'Deleted 1 layer', onUndo: () => {} });
        expect(lastNotice(open)).not.toHaveProperty('key');
    });

    it('defers browser notification writes until after the current render task', () => {
        const { root, open } = createRoot();
        const close = vi.fn();
        open.mockReturnValue(close);
        const pending = [];
        const browser = {
            setTimeout: vi.fn((callback) => {
                pending.push(callback);
                return 17;
            }),
            clearTimeout: vi.fn(),
        };
        vi.stubGlobal('window', browser);

        const cancel = showUndoToast(root, { label: 'Deleted 1 layer', onUndo: () => {} });
        expect(typeof cancel).toBe('function');
        expect(open).not.toHaveBeenCalled();

        pending.shift()();
        expect(open).toHaveBeenCalledOnce();
        expect(lastNotice(open).duration).toBe(0);
        expect(lastNotice(open).pauseOnHover).toBe(false);

        cancel();
        expect(close).toHaveBeenCalledOnce();
    });

    it('cancels a queued browser notification before it reaches an unmounted host', () => {
        const { root, open } = createRoot();
        const pending = [];
        vi.stubGlobal('window', {
            setTimeout: vi.fn((callback) => {
                pending.push(callback);
                return 18;
            }),
            clearTimeout: vi.fn(),
        });

        showUndoToast(root, { label: 'Deleted 1 layer', onUndo: () => {} })();
        pending.shift()();
        expect(open).not.toHaveBeenCalled();
    });

    it('pauses and resumes the browser expiry timer while the undo action is hovered', () => {
        const { root, open } = createRoot();
        const timers = [];
        vi.stubGlobal('window', {
            setTimeout: vi.fn((callback, delay) => {
                timers.push({ callback, delay });
                return timers.length;
            }),
            clearTimeout: vi.fn(),
        });
        vi.spyOn(Date, 'now').mockReturnValue(100);

        showUndoToast(root, { label: 'Deleted 1 layer', onUndo: () => {} });
        timers[0].callback();
        expect(timers[1].delay).toBe(UNDO_TOAST_DURATION);

        const content = lastNotice(open).content;
        vi.spyOn(Date, 'now').mockReturnValue(2_100);
        content.props.onPointerEnter();
        expect(window.clearTimeout).toHaveBeenCalledWith(2);

        content.props.onPointerLeave();
        expect(timers[2].delay).toBe(6_000);
    });

    it('replaces a keyed browser notice without letting its old timer close the replacement', () => {
        const { root, open } = createRoot();
        const firstClose = vi.fn();
        const secondClose = vi.fn();
        const closes = [firstClose, secondClose];
        const timers = [];
        vi.stubGlobal('window', {
            setTimeout: vi.fn((callback, delay) => {
                const id = timers.length + 1;
                timers.push({ id, callback, delay });
                return id;
            }),
            clearTimeout: vi.fn(),
        });
        open.mockImplementation(() => closes.shift());

        showUndoToast(root, { label: 'First deletion', key: 'undo:shared', onUndo: () => {} });
        timers[0].callback();
        expect(open).toHaveBeenCalledOnce();
        expect(timers[1].delay).toBe(UNDO_TOAST_DURATION);

        showUndoToast(root, { label: 'Second deletion', key: 'undo:shared', onUndo: () => {} });
        expect(window.clearTimeout).toHaveBeenCalledWith(timers[1].id);
        expect(firstClose).toHaveBeenCalledOnce();

        timers[2].callback();
        expect(open).toHaveBeenCalledTimes(2);
        expect(timers[3].delay).toBe(UNDO_TOAST_DURATION);
        timers[3].callback();
        expect(secondClose).toHaveBeenCalledOnce();
    });

    it('closes the notice and runs the undo exactly once per click', () => {
        const { root, open } = createRoot();
        const close = vi.fn();
        const onUndo = vi.fn();
        open.mockReturnValue(close);

        showUndoToast(root, { label: 'Deleted 1 layer', onUndo, duration: 2_000 });
        expect(lastNotice(open).duration).toBe(2);

        actionOf(open).props.onClick();
        expect(close).toHaveBeenCalledOnce();
        expect(onUndo).toHaveBeenCalledOnce();

        // 关闭动画期间按钮仍可能被点到：重复点击不能撤销第二步
        actionOf(open).props.onClick();
        expect(onUndo).toHaveBeenCalledOnce();
    });

    it('lets the caller explain when the undo token has expired', () => {
        const { root, open } = createRoot();
        const onUnavailable = vi.fn();
        showUndoToast(root, {
            label: 'Deleted 1 layer',
            onUndo: () => false,
            onUnavailable,
        });

        actionOf(open).props.onClick();
        expect(onUnavailable).toHaveBeenCalledOnce();
    });
});
