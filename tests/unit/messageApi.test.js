import { describe, expect, it, vi } from 'vitest';
import { createPassiveMessageApi, PASSIVE_MESSAGE_DURATION } from '../../src/utils/messageApi.js';

const createMessage = () => {
    const closes = [];
    const open = vi.fn(() => {
        const close = vi.fn();
        closes.push(close);
        return close;
    });
    return { open, closes, destroy: vi.fn() };
};

describe('createPassiveMessageApi', () => {
    it('uses native expiry while disabling rc-notification animation-frame timers', () => {
        const message = createMessage();
        const timers = [];
        const browser = {
            setTimeout: vi.fn((callback, delay) => {
                const id = timers.length + 1;
                timers.push({ id, callback, delay });
                return id;
            }),
            clearTimeout: vi.fn(),
        };
        const api = createPassiveMessageApi(message, { browser });

        api.success('Saved');
        expect(message.open).toHaveBeenCalledWith(expect.objectContaining({
            type: 'success', content: 'Saved', duration: 0, pauseOnHover: false,
        }));
        expect(timers[0].delay).toBe(PASSIVE_MESSAGE_DURATION);

        timers[0].callback();
        expect(message.closes[0]).toHaveBeenCalledOnce();
    });

    it('replaces keyed notices without allowing an older timer or close callback to dismiss the replacement', () => {
        const message = createMessage();
        const timers = [];
        const browser = {
            setTimeout: vi.fn((callback, delay) => {
                const id = timers.length + 1;
                timers.push({ id, callback, delay });
                return id;
            }),
            clearTimeout: vi.fn(),
        };
        const api = createPassiveMessageApi(message, { browser });

        const closeFirst = api.open({ key: 'download', type: 'loading', content: 'Working' });
        const closeSecond = api.open({ key: 'download', type: 'success', content: 'Done', duration: 1 });
        expect(browser.clearTimeout).toHaveBeenCalledWith(timers[0].id);

        closeFirst();
        expect(message.closes[0]).not.toHaveBeenCalled();
        timers[0].callback();
        expect(message.closes[0]).not.toHaveBeenCalled();

        timers[1].callback();
        expect(message.closes[1]).toHaveBeenCalledOnce();
        closeSecond();
        expect(message.closes[1]).toHaveBeenCalledOnce();
    });

    it('retains the injected API behavior outside a browser timer host', () => {
        const message = createMessage();
        const api = createPassiveMessageApi(message, { browser: undefined });
        const config = { type: 'error', content: 'Failed', duration: 2 };

        expect(api.open(config)).toBe(message.closes[0]);
        expect(message.open).toHaveBeenCalledWith(config);
    });

    it('can reactivate after an effect cleanup and closes duration-zero notices on disposal', () => {
        const message = createMessage();
        const browser = {
            setTimeout: vi.fn(() => 1),
            clearTimeout: vi.fn(),
        };
        const api = createPassiveMessageApi(message, { browser });

        api.info('First mount');
        api.dispose();
        expect(message.closes[0]).toHaveBeenCalledOnce();
        api.warning('Ignored while disposed');
        expect(message.open).toHaveBeenCalledOnce();

        api.activate();
        api.warning('Second mount');
        expect(message.open).toHaveBeenCalledTimes(2);
        api.dispose();
        expect(message.closes[1]).toHaveBeenCalledOnce();
    });
});
