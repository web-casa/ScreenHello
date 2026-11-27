import { afterEach, describe, expect, it, vi } from 'vitest';
import { debounce, maxBy } from '@utils/timing';

describe('timing utilities', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('coalesces rapid trailing calls and forwards latest arguments and context', () => {
        vi.useFakeTimers();
        const spy = vi.fn(function record(value) {
            return `${this?.tag || 'none'}:${value}`;
        });
        const debounced = debounce(spy, 100);
        const context = { tag: 'ctx' };

        debounced.call(context, 'a');
        vi.advanceTimersByTime(50);
        debounced.call(context, 'b');
        vi.advanceTimersByTime(99);
        expect(spy).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('b');
        expect(spy.mock.instances[0]).toBe(context);
    });

    it('supports cancel() and prevents subsequent flush() from executing', () => {
        vi.useFakeTimers();
        const spy = vi.fn();
        const debounced = debounce(spy, 100);

        debounced('x');
        debounced.cancel();
        vi.advanceTimersByTime(200);
        expect(debounced.flush()).toBeUndefined();
        expect(spy).not.toHaveBeenCalled();
    });

    it('executes pending work synchronously on flush() once and becomes no-op afterwards', () => {
        vi.useFakeTimers();
        const spy = vi.fn((n) => n * 2);
        const debounced = debounce(spy, 100);

        expect(debounced.flush()).toBeUndefined();

        debounced(3);
        debounced(7);
        expect(debounced.flush()).toBe(14);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(7);

        expect(debounced.flush()).toBeUndefined();
        vi.advanceTimersByTime(200);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('defaults missing wait to 0ms like lodash/debounce', () => {
        vi.useFakeTimers();
        const spy = vi.fn();
        const debounced = debounce(spy);

        debounced('immediate-next-tick');
        expect(spy).not.toHaveBeenCalled();
        vi.advanceTimersByTime(0);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('immediate-next-tick');
    });

    it('computes maxBy safely across empty arrays, NaN values, and numeric strings', () => {
        expect(maxBy([], (item) => item)).toBeUndefined();
        expect(maxBy([{ text: 'bad' }, { text: undefined }], (item) => Number(item.text))).toBeUndefined();
        expect(maxBy([{ text: '2' }, { text: '10' }, { text: '5' }], (item) => Number(item.text))).toEqual({ text: '10' });
        expect(maxBy([{ id: 'first', n: 5 }, { id: 'second', n: 5 }], (item) => item.n)).toEqual({ id: 'first', n: 5 });
    });
});
