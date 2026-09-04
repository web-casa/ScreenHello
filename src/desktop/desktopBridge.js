import { Channel, invoke as tauriInvoke } from '@tauri-apps/api/core';
import { createDesktopToken, isDesktopToken } from './desktopToken';

export const DESKTOP_ENVIRONMENT_SCHEMA_VERSION = 1;
const SUPPORTED_PLATFORMS = new Set(['linux', 'macos', 'windows']);
const SAFE_TOKEN = /^[a-zA-Z0-9._+-]{1,64}$/;

const invalidEnvironment = () => new Error('desktop-environment-invalid');

export const normalizeDesktopEnvironment = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidEnvironment();
    const environment = /** @type {Record<string, unknown>} */ (value);
    if (environment.schemaVersion !== DESKTOP_ENVIRONMENT_SCHEMA_VERSION) throw invalidEnvironment();
    if (environment.runtime !== 'tauri') throw invalidEnvironment();
    if (typeof environment.platform !== 'string' || !SUPPORTED_PLATFORMS.has(environment.platform)) {
        throw invalidEnvironment();
    }
    if (typeof environment.arch !== 'string' || !SAFE_TOKEN.test(environment.arch)) throw invalidEnvironment();
    if (typeof environment.appVersion !== 'string' || !SAFE_TOKEN.test(environment.appVersion)) {
        throw invalidEnvironment();
    }
    if (typeof environment.debug !== 'boolean') throw invalidEnvironment();

    return Object.freeze({
        schemaVersion: DESKTOP_ENVIRONMENT_SCHEMA_VERSION,
        runtime: 'tauri',
        platform: environment.platform,
        arch: environment.arch,
        appVersion: environment.appVersion,
        debug: environment.debug,
    });
};

export const readDesktopEnvironment = async (invoke = tauriInvoke) => {
    try {
        const environment = normalizeDesktopEnvironment(await invoke('desktop_environment'));
        return Object.freeze({ status: 'ready', environment });
    } catch {
        return Object.freeze({ status: 'unavailable', reason: 'desktop-bridge-unavailable' });
    }
};

export const DESKTOP_SYSTEM_SCHEMA_VERSION = 1;
const SHORTCUT_AVAILABILITY = new Set(['registered', 'unavailable']);
const TRAY_AVAILABILITY = new Set(['ready', 'unavailable']);

const invalidSystemStatus = () => new Error('desktop-system-status-invalid');

export const normalizeDesktopSystemStatus = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidSystemStatus();
    const status = /** @type {Record<string, unknown>} */ (value);
    if (status.schemaVersion !== DESKTOP_SYSTEM_SCHEMA_VERSION
        || !SHORTCUT_AVAILABILITY.has(status.shortcut)
        || !['Ctrl+Shift+H', 'Command+Shift+H'].includes(String(status.shortcutAccelerator))
        || !TRAY_AVAILABILITY.has(status.tray)
        || status.singleInstance !== 'ready') {
        throw invalidSystemStatus();
    }
    return Object.freeze({
        schemaVersion: DESKTOP_SYSTEM_SCHEMA_VERSION,
        shortcut: status.shortcut,
        shortcutAccelerator: status.shortcutAccelerator,
        tray: status.tray,
        singleInstance: 'ready',
    });
};

export const readDesktopSystemStatus = async (invoke = tauriInvoke) => {
    try {
        return Object.freeze({
            status: 'ready',
            system: normalizeDesktopSystemStatus(await invoke('desktop_system_status')),
        });
    } catch {
        return Object.freeze({ status: 'unavailable', reason: 'desktop-system-unavailable' });
    }
};

const normalizeSystemEvent = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || value.schemaVersion !== DESKTOP_SYSTEM_SCHEMA_VERSION
        || value.action !== 'capture-primary'
        || !['shortcut', 'tray'].includes(value.source)) return null;
    return Object.freeze({
        schemaVersion: DESKTOP_SYSTEM_SCHEMA_VERSION,
        action: 'capture-primary',
        source: value.source,
    });
};

/**
 * @param {(event: {schemaVersion: number, action: 'capture-primary', source: 'shortcut' | 'tray'}) => void} handler
 * @param {{invoke?: typeof tauriInvoke, ChannelType?: typeof Channel, tokenFactory?: () => string}} [options]
 */
export const subscribeDesktopSystemEvents = async (handler, {
    invoke = tauriInvoke,
    ChannelType = Channel,
    tokenFactory = createDesktopToken,
} = {}) => {
    if (typeof handler !== 'function') throw new Error('desktop-system-handler-invalid');
    const subscriptionToken = tokenFactory();
    if (!isDesktopToken(subscriptionToken)) throw new Error('desktop-system-subscription-invalid');
    const channel = new ChannelType((value) => {
        const event = normalizeSystemEvent(value);
        if (event) handler(event);
    });
    try {
        await invoke('desktop_subscribe_system_events', { subscriptionToken, onEvent: channel });
    } catch {
        throw new Error('desktop-system-subscribe-failed');
    }
    let active = true;
    return async () => {
        if (!active) return;
        active = false;
        await invoke('desktop_unsubscribe_system_events', { subscriptionToken }).catch(() => {});
    };
};
