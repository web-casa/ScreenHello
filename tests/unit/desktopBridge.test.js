import { describe, expect, it, vi } from 'vitest';
import {
    DESKTOP_ENVIRONMENT_SCHEMA_VERSION,
    DESKTOP_STATE_SCHEMA_VERSION,
    DESKTOP_SYSTEM_SCHEMA_VERSION,
    normalizeDesktopEnvironment,
    normalizeDesktopStateStatus,
    normalizeDesktopSystemStatus,
    readDesktopEnvironment,
    readDesktopStateStatus,
    readDesktopSystemStatus,
    subscribeDesktopSystemEvents,
    setDesktopLocale,
} from '../../src/desktop/desktopBridge.js';

const validEnvironment = Object.freeze({
    schemaVersion: DESKTOP_ENVIRONMENT_SCHEMA_VERSION,
    runtime: 'tauri',
    platform: 'linux',
    arch: 'aarch64',
    appVersion: '1.0.4',
    debug: true,
});

const validSystemStatus = Object.freeze({
    schemaVersion: DESKTOP_SYSTEM_SCHEMA_VERSION,
    shortcut: 'registered',
    shortcutAccelerator: 'Ctrl+Shift+H',
    tray: 'ready',
    singleInstance: 'ready',
});

const validDesktopState = Object.freeze({
    schemaVersion: DESKTOP_STATE_SCHEMA_VERSION,
    status: 'ready',
    dataSchemaVersion: 1,
});

describe('desktop bridge', () => {
    it('only sends bounded native locale choices', async () => {
        const invoke = vi.fn().mockResolvedValue(undefined);
        await setDesktopLocale('en-US', invoke);
        expect(invoke).toHaveBeenCalledExactlyOnceWith('desktop_set_locale', { locale: 'en-US' });
        await expect(setDesktopLocale('../secret', invoke)).rejects.toThrow();
        expect(invoke).toHaveBeenCalledTimes(1);
        for (const locale of ['zh-TW', 'de-DE', 'ko-KR', 'es-ES', 'pt-PT']) {
            await setDesktopLocale(locale, invoke);
            expect(invoke).toHaveBeenLastCalledWith('desktop_set_locale', { locale: 'en-US' });
        }
    });
    it('accepts the bounded desktop environment schema', () => {
        expect(normalizeDesktopEnvironment(validEnvironment)).toEqual(validEnvironment);
        expect(normalizeDesktopEnvironment(validEnvironment)).not.toBe(validEnvironment);
    });

    it.each([
        null,
        { ...validEnvironment, schemaVersion: 2 },
        { ...validEnvironment, runtime: 'node' },
        { ...validEnvironment, platform: 'android' },
        { ...validEnvironment, arch: '/private/path' },
        { ...validEnvironment, appVersion: '' },
        { ...validEnvironment, debug: 'true' },
    ])('rejects invalid or over-broad environment data %#', (value) => {
        expect(() => normalizeDesktopEnvironment(value)).toThrowError('desktop-environment-invalid');
    });

    it('invokes only the registered environment command', async () => {
        const invoke = vi.fn().mockResolvedValue(validEnvironment);
        await expect(readDesktopEnvironment(invoke)).resolves.toEqual({
            status: 'ready',
            environment: validEnvironment,
        });
        expect(invoke).toHaveBeenCalledOnce();
        expect(invoke).toHaveBeenCalledWith('desktop_environment');
    });

    it('maps command and schema failures to one non-sensitive state', async () => {
        const rejected = vi.fn().mockRejectedValue(new Error('internal-command-detail'));
        const invalid = vi.fn().mockResolvedValue({ ...validEnvironment, platform: 'unknown' });
        await expect(readDesktopEnvironment(rejected)).resolves.toEqual({
            status: 'unavailable',
            reason: 'desktop-bridge-unavailable',
        });
        await expect(readDesktopEnvironment(invalid)).resolves.toEqual({
            status: 'unavailable',
            reason: 'desktop-bridge-unavailable',
        });
    });

    it('normalizes only the bounded desktop state marker response', async () => {
        expect(normalizeDesktopStateStatus(validDesktopState)).toEqual(validDesktopState);
        expect(normalizeDesktopStateStatus(validDesktopState)).not.toBe(validDesktopState);
        for (const value of [
            { ...validDesktopState, path: '/private/state' },
            { ...validDesktopState, status: 'new' },
            { ...validDesktopState, dataSchemaVersion: 2 },
            { ...validDesktopState, schemaVersion: 2 },
        ]) {
            expect(() => normalizeDesktopStateStatus(value)).toThrowError('desktop-state-invalid');
        }
        const invoke = vi.fn().mockResolvedValue(validDesktopState);
        await expect(readDesktopStateStatus(invoke)).resolves.toEqual({
            status: 'ready',
            state: validDesktopState,
        });
        expect(invoke).toHaveBeenCalledWith('desktop_state_status');
        await expect(readDesktopStateStatus(vi.fn().mockRejectedValue(new Error('private marker path'))))
            .resolves.toEqual({ status: 'unavailable', reason: 'desktop-state-unavailable' });
    });

    it('normalizes the bounded system integration status and hides invalid responses', async () => {
        expect(normalizeDesktopSystemStatus(validSystemStatus)).toEqual(validSystemStatus);
        expect(normalizeDesktopSystemStatus({ ...validSystemStatus, singleInstance: 'unavailable' }))
            .toEqual({ ...validSystemStatus, singleInstance: 'unavailable' });
        expect(() => normalizeDesktopSystemStatus({ ...validSystemStatus, singleInstance: 'broken' }))
            .toThrow();
        expect(() => normalizeDesktopSystemStatus({ ...validSystemStatus, cwd: '/private/path', tray: 'broken' }))
            .toThrowError('desktop-system-status-invalid');
        expect(() => normalizeDesktopSystemStatus({ ...validSystemStatus, shortcut: 'ready' }))
            .toThrowError('desktop-system-status-invalid');
        expect(() => normalizeDesktopSystemStatus({ ...validSystemStatus, tray: 'registered' }))
            .toThrowError('desktop-system-status-invalid');
        const invoke = vi.fn().mockResolvedValue(validSystemStatus);
        await expect(readDesktopSystemStatus(invoke)).resolves.toEqual({
            status: 'ready',
            system: validSystemStatus,
        });
        expect(invoke).toHaveBeenCalledWith('desktop_system_status');
        await expect(readDesktopSystemStatus(vi.fn().mockRejectedValue(new Error('private detail'))))
            .resolves.toEqual({ status: 'unavailable', reason: 'desktop-system-unavailable' });
    });

    it('subscribes with an opaque token, ignores malformed events and cleans up exactly once', async () => {
        const channels = [];
        class FakeChannel {
            constructor(handler) {
                this.handler = handler;
                channels.push(this);
            }
        }
        const token = 'a'.repeat(48);
        const invoke = vi.fn().mockResolvedValue(undefined);
        const handler = vi.fn();
        const cleanup = await subscribeDesktopSystemEvents(handler, {
            invoke,
            ChannelType: FakeChannel,
            tokenFactory: () => token,
        });
        expect(invoke).toHaveBeenCalledWith('desktop_subscribe_system_events', {
            subscriptionToken: token,
            onEvent: channels[0],
        });
        channels[0].handler({ schemaVersion: 1, action: 'capture-primary', source: 'shortcut' });
        channels[0].handler({ schemaVersion: 1, action: 'open-path', source: '/private/path' });
        expect(handler).toHaveBeenCalledOnce();
        expect(handler).toHaveBeenCalledWith({ schemaVersion: 1, action: 'capture-primary', source: 'shortcut' });
        await cleanup();
        await cleanup();
        expect(invoke).toHaveBeenLastCalledWith('desktop_unsubscribe_system_events', {
            subscriptionToken: token,
        });
        expect(invoke).toHaveBeenCalledTimes(2);
    });
});
