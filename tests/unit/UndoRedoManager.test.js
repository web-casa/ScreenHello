import { describe, expect, it, vi } from 'vitest';
import UndoRedoManager from '../../src/utils/UndoRedoManager.js';

describe('UndoRedoManager', () => {
    it('starts with an empty history', () => {
        const history = new UndoRedoManager();

        expect(history.current).toBeUndefined();
        expect(history.count).toBe(0);
        expect(history.canUndo).toBe(false);
        expect(history.canRedo).toBe(false);
    });

    it('adds snapshots and moves backward and forward', () => {
        const onChange = vi.fn();
        const history = new UndoRedoManager({ onChange });

        history.add({ value: 1 });
        history.add({ value: 2 });

        expect(history.current).toEqual({ value: 2 });
        expect(history.canUndo).toBe(true);
        expect(history.undo()).toEqual({ value: 1 });
        expect(history.canRedo).toBe(true);
        expect(history.redo()).toEqual({ value: 2 });
        expect(onChange).toHaveBeenCalledTimes(4);
    });

    it('discards redo snapshots after a new edit', () => {
        const history = new UndoRedoManager();
        history.add('first');
        history.add('second');
        history.add('third');

        history.undo();
        history.add('replacement');

        expect(history.stacks).toEqual(['first', 'second', 'replacement']);
        expect(history.current).toBe('replacement');
        expect(history.canRedo).toBe(false);
    });

    it('keeps only the configured number of snapshots', () => {
        const history = new UndoRedoManager({ limit: 2 });

        history.add('first');
        history.add('second');
        history.add('third');

        expect(history.stacks).toEqual(['second', 'third']);
        expect(history.count).toBe(2);
        expect(history.undo()).toBe('second');
    });

    it('replaces and clears the current snapshot without advancing history', () => {
        const onChange = vi.fn();
        const history = new UndoRedoManager({ onChange });
        history.add('first');
        history.add('second');

        expect(history.replaceTop('updated')).toBe('updated');
        expect(history.count).toBe(2);
        expect(history.stacks).toEqual(['first', 'updated']);

        history.clear();
        expect(history.current).toBeUndefined();
        expect(history.count).toBe(0);
        expect(history.canUndo).toBe(false);
        expect(history.canRedo).toBe(false);
        expect(onChange).toHaveBeenCalledTimes(4);
    });

    it('handles unavailable undo/redo and ignores writes after destroy', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const history = new UndoRedoManager();

        expect(history.undo()).toBeUndefined();
        expect(history.redo()).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(2);

        history.destroy();
        expect(history.add('ignored')).toBeUndefined();
    });
});
