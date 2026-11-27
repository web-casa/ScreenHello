import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const effectCleanups = [];

vi.mock('react', () => ({
    useEffect: (effect) => {
        const cleanup = effect();
        if (typeof cleanup === 'function') effectCleanups.push(cleanup);
    },
}));

const createMockWindow = () => {
    const listeners = new Map();
    return {
        listeners,
        addEventListener(type, fn, options) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add({ fn, options });
        },
        removeEventListener(type, fn) {
            const set = listeners.get(type);
            if (!set) return;
            for (const entry of set) {
                if (entry.fn === fn) set.delete(entry);
            }
        },
        dispatchKeydown(event) {
            const set = listeners.get('keydown');
            if (!set) return;
            for (const { fn } of [...set]) fn(event);
        },
    };
};

const createKeyEvent = ({
    key,
    code,
    ctrl = false,
    meta = false,
    shift = false,
    alt = false,
    isComposing = false,
    repeat = false,
    target = { tagName: 'DIV', isContentEditable: false },
    currentTarget = null,
}) => {
    const mods = new Set();
    if (ctrl) mods.add('Control');
    if (meta) mods.add('Meta');
    if (shift) mods.add('Shift');
    if (alt) mods.add('Alt');
    const event = {
        type: 'keydown',
        key,
        code,
        ctrlKey: ctrl,
        metaKey: meta,
        shiftKey: shift,
        altKey: alt,
        isComposing,
        repeat,
        target,
        currentTarget,
        defaultPrevented: false,
        preventDefault() {
            this.defaultPrevented = true;
        },
        getModifierState(mod) {
            return mods.has(mod);
        },
    };
    return event;
};

const createRuntime = ({ isActive = true, workspaceEnabled = true } = {}) => ({
    isActive,
    workspace: { enabled: workspaceEnabled },
    commands: {
        execute: vi.fn(),
        downloadCurrentImage: vi.fn(),
    },
});

describe('useKeyboardShortcuts (tinykeys 4 integration)', () => {
    let mockWindow;
    let useKeyboardShortcuts;

    beforeEach(async () => {
        effectCleanups.length = 0;
        mockWindow = createMockWindow();
        vi.stubGlobal('window', mockWindow);
        vi.stubGlobal('navigator', { platform: 'Linux x86_64' });
        vi.resetModules();
        ({ default: useKeyboardShortcuts } = await import('../../src/hooks/useKeyboardShortcuts.js'));
    });

    afterEach(() => {
        while (effectCleanups.length) effectCleanups.pop()();
        vi.unstubAllGlobals();
    });

    it('dispatches all workspace and library shortcuts and prevents default browser actions', () => {
        const workspaceRuntime = createRuntime({ workspaceEnabled: true });
        useKeyboardShortcuts(workspaceRuntime);

        const cases = [
            [{ key: 's', code: 'KeyS', ctrl: true }, 'file.saveProject'],
            [{ key: 'S', code: 'KeyS', ctrl: true, shift: true }, 'file.saveProjectAs'],
            [{ key: 'o', code: 'KeyO', ctrl: true }, 'file.openProject'],
            [{ key: 'E', code: 'KeyE', ctrl: true, shift: true }, 'file.openExport'],
            [{ key: 'c', code: 'KeyC', ctrl: true }, 'file.copyFinalImage'],
            [{ key: 'z', code: 'KeyZ', ctrl: true }, 'edit.undo'],
            [{ key: 'Z', code: 'KeyZ', ctrl: true, shift: true }, 'edit.redo'],
            [{ key: 'Backspace', code: 'Backspace' }, 'edit.deleteSelection'],
            [{ key: 'Delete', code: 'Delete' }, 'edit.deleteSelection'],
            [{ key: '-', code: 'Minus', ctrl: true }, 'view.zoomOut'],
            [{ key: '=', code: 'Equal', ctrl: true }, 'view.zoomIn'],
            [{ key: '0', code: 'Digit0', ctrl: true }, 'view.fitCanvas'],
        ];

        for (const [spec, expectedCommand] of cases) {
            workspaceRuntime.commands.execute.mockClear();
            const event = createKeyEvent({ ...spec, currentTarget: mockWindow });
            mockWindow.dispatchKeydown(event);
            expect(workspaceRuntime.commands.execute, expectedCommand).toHaveBeenCalledExactlyOnceWith(expectedCommand);
            expect(event.defaultPrevented, expectedCommand).toBe(true);
        }

        // Unmount workspace instance and verify library mode routes $mod+KeyS to downloadCurrentImage
        // while ignoring workspaceOnly shortcuts.
        while (effectCleanups.length) effectCleanups.pop()();
        const libraryRuntime = createRuntime({ workspaceEnabled: false });
        useKeyboardShortcuts(libraryRuntime);

        const saveEvent = createKeyEvent({ key: 's', code: 'KeyS', ctrl: true, currentTarget: mockWindow });
        mockWindow.dispatchKeydown(saveEvent);
        expect(libraryRuntime.commands.downloadCurrentImage).toHaveBeenCalledTimes(1);
        expect(libraryRuntime.commands.execute).not.toHaveBeenCalled();
        expect(saveEvent.defaultPrevented).toBe(true);

        for (const spec of [
            { key: 'S', code: 'KeyS', ctrl: true, shift: true },
            { key: 'o', code: 'KeyO', ctrl: true },
            { key: 'E', code: 'KeyE', ctrl: true, shift: true },
        ]) {
            const event = createKeyEvent({ ...spec, currentTarget: mockWindow });
            mockWindow.dispatchKeydown(event);
            expect(libraryRuntime.commands.execute).not.toHaveBeenCalled();
            expect(event.defaultPrevented).toBe(false);
        }
    });

    it('ignores IME composition and editable targets including nested contenteditable descendants', () => {
        const runtime = createRuntime();
        useKeyboardShortcuts(runtime);

        const ignoredEvents = [
            createKeyEvent({ key: 'z', code: 'KeyZ', ctrl: true, isComposing: true, currentTarget: mockWindow }),
            createKeyEvent({ key: 'Backspace', code: 'Backspace', target: { tagName: 'INPUT', isContentEditable: false }, currentTarget: mockWindow }),
            createKeyEvent({ key: 'Delete', code: 'Delete', target: { tagName: 'TEXTAREA', isContentEditable: false }, currentTarget: mockWindow }),
            createKeyEvent({ key: 's', code: 'KeyS', ctrl: true, target: { tagName: 'SELECT', isContentEditable: false }, currentTarget: mockWindow }),
            createKeyEvent({ key: 'z', code: 'KeyZ', ctrl: true, target: { tagName: 'SPAN', isContentEditable: true }, currentTarget: mockWindow }),
        ];

        for (const event of ignoredEvents) {
            mockWindow.dispatchKeydown(event);
            expect(event.defaultPrevented).toBe(false);
        }
        expect(runtime.commands.execute).not.toHaveBeenCalled();
    });

    it('does not throw when event.target lacks Element.matches (document, window, Text node, null)', () => {
        const runtime = createRuntime();
        useKeyboardShortcuts(runtime);

        const nonElementTargets = [
            { nodeType: 9 }, // document-like object without .matches
            { nodeType: 3 }, // Text node without .matches
            mockWindow,
            null,
        ];

        for (const target of nonElementTargets) {
            runtime.commands.execute.mockClear();
            const event = createKeyEvent({ key: 'z', code: 'KeyZ', ctrl: true, target, currentTarget: mockWindow });
            expect(() => mockWindow.dispatchKeydown(event)).not.toThrow();
            expect(runtime.commands.execute).toHaveBeenCalledExactlyOnceWith('edit.undo');
            expect(event.defaultPrevented).toBe(true);
        }
    });

    it('isolates multiple instances by isActive and unregisters listeners on cleanup', () => {
        const runtimeA = createRuntime({ isActive: false });
        const runtimeB = createRuntime({ isActive: true });
        useKeyboardShortcuts(runtimeA);
        useKeyboardShortcuts(runtimeB);

        const event = createKeyEvent({ key: 'z', code: 'KeyZ', ctrl: true, currentTarget: mockWindow });
        mockWindow.dispatchKeydown(event);
        expect(runtimeA.commands.execute).not.toHaveBeenCalled();
        expect(runtimeB.commands.execute).toHaveBeenCalledExactlyOnceWith('edit.undo');

        while (effectCleanups.length) effectCleanups.pop()();
        expect(mockWindow.listeners.get('keydown')?.size ?? 0).toBe(0);

        runtimeB.commands.execute.mockClear();
        mockWindow.dispatchKeydown(createKeyEvent({ key: 'z', code: 'KeyZ', ctrl: true, currentTarget: mockWindow }));
        expect(runtimeB.commands.execute).not.toHaveBeenCalled();
    });
});
