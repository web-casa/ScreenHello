import { Channel, invoke as tauriInvoke } from '@tauri-apps/api/core';
import { DESKTOP_BRIDGE_EPOCH, createDesktopToken, isDesktopToken } from './desktopToken';

let exitSubscriptionSequence = 0;

export const subscribeDesktopExitRequests = async (decide, {
    invoke = tauriInvoke,
    ChannelType = Channel,
    tokenFactory = createDesktopToken,
    epoch = DESKTOP_BRIDGE_EPOCH,
} = {}) => {
    const subscriptionToken = tokenFactory();
    if (typeof decide !== 'function' || !isDesktopToken(subscriptionToken)) throw new Error('desktop-exit-subscription-invalid');
    exitSubscriptionSequence += 1;
    const sequence = exitSubscriptionSequence;
    let active = true;
    let pending = false;
    const channel = new ChannelType(async (event) => {
        if (!active || pending || !event || event.schemaVersion !== 1
            || Object.keys(event).length !== 2 || typeof event.requestId !== 'string'
            || !/^[1-9]\d{0,19}$/u.test(event.requestId)) return;
        let allow = false;
        pending = true;
        try { allow = (await decide()) === true; } catch { /* Failed decisions deny exit. */ }
        finally { pending = false; }
        if (!active) return;
        await invoke('desktop_resolve_exit_request', {
            subscriptionToken, requestId: event.requestId, allow,
        }).catch(() => {});
    });
    try {
        await invoke('desktop_subscribe_exit_requests', {
            subscriptionToken,
            onEvent: channel,
            epoch,
            sequence,
        });
    } catch (error) {
        active = false;
        await invoke('desktop_unsubscribe_exit_requests', { subscriptionToken }).catch(() => {});
        throw error;
    }
    return async () => {
        if (!active) return;
        active = false;
        await invoke('desktop_unsubscribe_exit_requests', { subscriptionToken }).catch(() => {});
    };
};
