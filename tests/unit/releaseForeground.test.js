import { describe, expect, it, vi } from 'vitest';
import { activateEditorWindow } from '../release/foreground.mjs';

function harness(states) {
    const activate = vi.fn().mockResolvedValue(undefined);
    const driver = {
        switchTo: () => ({ window: activate }),
        executeScript: vi.fn().mockImplementation(async () => states.shift()),
        wait: vi.fn(async (predicate, timeout, message) => {
            expect(activate).toHaveBeenCalledWith('original-editor');
            expect(timeout).toBe(10_000);
            while (states.length) if (await predicate()) return;
            throw new Error(message);
        }),
    };
    return { driver, activate };
}

describe('foreground browser release precondition', () => {
    it('reactivates the original editor and waits for visible AND focused', async () => {
        const { driver, activate } = harness([
            { visibility: 'hidden', focused: false },
            { visibility: 'visible', focused: false },
            { visibility: 'visible', focused: true },
        ]);
        await expect(activateEditorWindow(driver, 'original-editor'))
            .resolves.toEqual({ visibility: 'visible', focused: true });
        expect(activate).toHaveBeenCalledOnce();
        expect(driver.executeScript).toHaveBeenCalledTimes(3);
    });

    it('fails closed rather than exporting in a background tab', async () => {
        const { driver } = harness([{ visibility: 'hidden', focused: true }]);
        await expect(activateEditorWindow(driver, 'original-editor'))
            .rejects.toThrow('editor window did not return to the foreground');
    });

    it('does not hide window activation errors or keep retrying', async () => {
        const { driver, activate } = harness([]);
        activate.mockRejectedValueOnce(new Error('no such window'));
        await expect(activateEditorWindow(driver, 'original-editor')).rejects.toThrow('no such window');
        expect(driver.wait).not.toHaveBeenCalled();
    });
});
