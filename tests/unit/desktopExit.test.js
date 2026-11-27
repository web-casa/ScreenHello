import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeDesktopExitRequests } from '../../src/desktop/desktopExit.js';
import { createScreenHelloRuntime } from '../../src/stores/index.js';

const runtimes = [];
afterEach(() => { runtimes.splice(0).forEach(runtime => runtime.dispose()); vi.restoreAllMocks(); });
const runtime = () => {
    const value = createScreenHelloRuntime();
    runtimes.push(value);
    value.activate();
    value.workspace.enabled = true;
    value.editor.setMessage({ info: vi.fn() });
    return value;
};
const bridge = (decide, invoke = vi.fn().mockResolvedValue(undefined)) => {
    let channel;
    class ChannelType { constructor(handler) { this.handler = handler; channel = this; } }
    return { invoke, channel: () => channel, subscribing: subscribeDesktopExitRequests(decide, {
        invoke, ChannelType, tokenFactory: () => 'a'.repeat(48),
    }) };
};

describe('desktop exit lifecycle', () => {
    it('validates requests, waits for the decision, and ignores late results after cleanup', async () => {
        let finish;
        const decide = vi.fn(() => new Promise(resolve => { finish = resolve; }));
        const harness = bridge(decide);
        const cleanup = await harness.subscribing;
        await harness.channel().handler({ schemaVersion: 2, requestId: '1' });
        await harness.channel().handler({ schemaVersion: 1, requestId: '1', path: '/private' });
        expect(decide).not.toHaveBeenCalled();
        const pending = harness.channel().handler({ schemaVersion: 1, requestId: '1' });
        expect(harness.invoke).not.toHaveBeenCalledWith('desktop_resolve_exit_request', expect.anything());
        await cleanup();
        finish(true);
        await pending;
        await cleanup();
        expect(harness.invoke).not.toHaveBeenCalledWith('desktop_resolve_exit_request', expect.anything());
        expect(harness.invoke.mock.calls.filter(([command]) => command === 'desktop_unsubscribe_exit_requests')).toHaveLength(1);
    });

    it.each([true, false])('returns the exact request and subscription when approval is %s', async allow => {
        const harness = bridge(async () => allow);
        const cleanup = await harness.subscribing;
        await harness.channel().handler({ schemaVersion: 1, requestId: '12' });
        expect(harness.invoke).toHaveBeenCalledWith('desktop_resolve_exit_request', {
            subscriptionToken: 'a'.repeat(48), requestId: '12', allow,
        });
        await cleanup();
    });

    it('denies exit if the frontend decision fails', async () => {
        const harness = bridge(async () => { throw new Error('save failed'); });
        const cleanup = await harness.subscribing;
        await harness.channel().handler({ schemaVersion: 1, requestId: '1' });
        expect(harness.invoke).toHaveBeenCalledWith('desktop_resolve_exit_request', expect.objectContaining({ allow: false }));
        await cleanup();
    });

    it.each(['cancel', 'discard', 'save'])('handles the dirty-project choice %s', async choice => {
        const root = runtime();
        root.workspace.isDirty = true;
        const save = vi.spyOn(root.workspace, 'saveProject').mockImplementation(async () => { root.workspace.isDirty = false; return true; });
        const exiting = root.commands.requestApplicationExit();
        expect(root.commands.guardOpen).toBe(true);
        await root.commands.resolveWorkspaceGuard(choice);
        expect(await exiting).toBe(choice !== 'cancel');
        expect(save).toHaveBeenCalledTimes(choice === 'save' ? 1 : 0);
    });

    it('keeps the exit dialog open after failed or incomplete saves', async () => {
        const root = runtime();
        root.workspace.isDirty = true;
        const save = vi.spyOn(root.workspace, 'saveProject').mockResolvedValue(false);
        const exiting = root.commands.requestApplicationExit();
        expect(await root.commands.resolveWorkspaceGuard('save')).toBe(false);
        expect(root.commands.guardOpen).toBe(true);
        save.mockResolvedValue(true); // A saved snapshot still leaves later edits dirty.
        expect(await root.commands.resolveWorkspaceGuard('save')).toBe(false);
        expect(root.commands.guardOpen).toBe(true);
        await root.commands.resolveWorkspaceGuard('cancel');
        expect(await exiting).toBe(false);
    });

    it('waits for draft flush and cancels if new edits arrive while flushing', async () => {
        const root = runtime();
        let finish;
        vi.spyOn(root.draftService, 'isEnabled').mockReturnValue(true);
        vi.spyOn(root.draftService, 'flush').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        const exiting = root.commands.requestApplicationExit();
        root.workspace.setProjectName('New edit');
        finish('saved');
        expect(await exiting).toBe(false);
    });

    it('blocks exit during a file write or export handoff', async () => {
        const root = runtime();
        root.workspace.busy = 'save';
        expect(await root.commands.requestApplicationExit()).toBe(false);
        root.workspace.busy = null;
        root.commands.exportActive = true;
        expect(await root.commands.requestApplicationExit()).toBe(false);
        expect(root.commands.guardOpen).toBe(false);
    });
});
