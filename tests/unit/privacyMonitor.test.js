import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    isLocalTarget, measureBody, privacyInstrumentationState, privacySnapshot, resetPrivacyCounters, subscribePrivacy,
} from '../../src/utils/privacyMonitor.js';
import { PrivacyStore } from '../../src/stores/privacyStore.js';

/**
 * 隐私计数器的事实来源：出口监控必须只统计“真正发往外部源”的字节，
 * 且在最后一个订阅者退订后把补丁还原。这里的用例决定了 UI 上那个
 * 「已上传 0 B」是不是可信的。
 *
 * node 环境没有 XMLHttpRequest/WebSocket/navigator.sendBeacon，所以这些通道
 * 用假实现先 stub、再订阅，才能真正走到补丁逻辑上。
 */
let unsubscribe = null;

const startMonitoring = (listener = () => {}) => {
    unsubscribe?.();
    unsubscribe = subscribePrivacy(listener);
};

beforeEach(() => {
    resetPrivacyCounters();
});

afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
    resetPrivacyCounters();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('privacyMonitor classification', () => {
    it('treats local development, Tauri bridges and non-network schemes as local', () => {
        const origin = 'http://localhost:5173';
        for (const url of [
            '/api/x', 'assets/a.png', 'http://localhost:5173/upload', 'blob:http://localhost:5173/1',
            'data:image/png;base64,AAAA', 'file:///tmp/a.png', 'about:blank',
            'ws://localhost:5173/socket',
            'http://localhost:5173/x', 'http://127.0.0.1:4173/x', 'http://[::1]:8080/x',
            'ipc://localhost/plugin%3Aresources%7Cclose', 'http://ipc.localhost/plugin',
            'http://asset.localhost/asset.png', 'asset://localhost/asset.png', 'tauri://localhost/bridge',
            'http://tauri.localhost/app',
        ]) {
            expect(isLocalTarget(url, origin), url).toBe(true);
        }
        for (const url of ['https://example.com/x', 'http://192.168.1.9/x', '//cdn.example.com/a.js', 'wss://relay.example.com', ' https://example.com/upload', String.raw`\\example.com/upload`, String.raw`https:\\example.com/upload`]) {
            expect(isLocalTarget(url, origin), url).toBe(false);
        }
    });

    it('resolves relative file resources from an opaque page origin', () => {
        const fileOrigin = 'file:///tmp/screenhello/index.html';
        expect(isLocalTarget('assets/example.png', fileOrigin)).toBe(true);
        expect(isLocalTarget('file:///tmp/screenhello/example.png', 'null')).toBe(true);
    });

    it('counts HTTPS same-origin sends as public traffic', () => {
        const publicOrigin = 'https://screenhello.com';
        for (const url of ['/upload', 'https://screenhello.com/upload', 'wss://screenhello.com/socket']) {
            expect(isLocalTarget(url, publicOrigin), url).toBe(false);
        }
    });

    it('measures request bodies and admits when a stream cannot be measured', () => {
        expect(measureBody(null)).toEqual({ bytes: 0, unknown: false });
        expect(measureBody('abcd')).toEqual({ bytes: 4, unknown: false });
        expect(measureBody(new Blob(['12345']))).toEqual({ bytes: 5, unknown: false });
        expect(measureBody(new TextEncoder().encode('123456').buffer)).toEqual({ bytes: 6, unknown: false });
        // URLSearchParams 按序列化后的字节算：a=1&b=22
        expect(measureBody(new URLSearchParams({ a: '1', b: '22' }))).toEqual({ bytes: 8, unknown: false });
        const form = new FormData();
        form.append('text', 'abc');
        form.append('file', new Blob(['1234']));
        // multipart boundary、字段名和 Content-Disposition 都由浏览器在发送时补齐，不能冒充精确字节数
        expect(measureBody(form)).toEqual({ bytes: 0, unknown: true });
        expect(measureBody(new ReadableStream())).toEqual({ bytes: 0, unknown: true });
        expect(measureBody({ unexpected: true })).toEqual({ bytes: 0, unknown: true });
    });
});

describe('privacyMonitor instrumentation', () => {
    it('keeps retained XHR and beacon wrappers usable after teardown without recording', () => {
        const send = vi.fn(() => 'sent');
        class FakeXhr { open() {} }
        FakeXhr.prototype.send = send;
        const beacon = vi.fn(() => true);
        const navigator = Object.create({ sendBeacon: beacon });
        vi.stubGlobal('XMLHttpRequest', FakeXhr);
        vi.stubGlobal('navigator', navigator);
        startMonitoring();
        const retainedSend = FakeXhr.prototype.send;
        const retainedOpen = FakeXhr.prototype.open;
        const retainedBeacon = navigator.sendBeacon;
        unsubscribe(); unsubscribe = null;
        expect(navigator.sendBeacon).toBe(beacon);
        expect(Object.hasOwn(navigator, 'sendBeacon')).toBe(false);
        const xhr = new FakeXhr();
        retainedOpen.call(xhr, 'POST', 'https://example.com/upload');
        expect(retainedSend.call(xhr, 'bytes')).toBe('sent');
        expect(retainedBeacon.call(navigator, 'https://example.com/beacon', 'bytes')).toBe(true);
        expect(send).toHaveBeenCalledOnce();
        expect(beacon.mock.instances[0]).toBe(navigator);
        expect(privacySnapshot().remoteRequests).toBe(0);
    });

    it('does not overwrite host wrappers or double count on remount', async () => {
        const original = vi.fn().mockResolvedValue(new Response('ok'));
        vi.stubGlobal('fetch', original);
        startMonitoring();
        const retained = globalThis.fetch;
        const hostWrapper = vi.fn((...args) => retained(...args));
        globalThis.fetch = hostWrapper;
        unsubscribe(); unsubscribe = null;
        expect(globalThis.fetch).toBe(hostWrapper);
        await fetch('https://example.com/upload', { method: 'POST', body: 'old' });
        expect(privacySnapshot().remoteRequests).toBe(0);
        startMonitoring();
        await fetch('https://example.com/upload', { method: 'POST', body: 'new' });
        expect(privacySnapshot()).toMatchObject({ remoteRequests: 1, uploadedBytes: 3 });
        expect(original).toHaveBeenCalledTimes(2);
    });

    it('still forwards a request when its listener synchronously tears monitoring down', () => {
        const original = vi.fn(() => true);
        vi.stubGlobal('navigator', { sendBeacon: original });
        startMonitoring(() => unsubscribe());
        expect(navigator.sendBeacon('https://example.com/upload', 'body')).toBe(true);
        expect(original).toHaveBeenCalledOnce();
    });

    it('tolerates a read-only fetch property during mounting and disposal', () => {
        const original = globalThis.fetch;
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
        try {
            Object.defineProperty(globalThis, 'fetch', { value: original, writable: false, configurable: true });
            startMonitoring();
            expect(globalThis.fetch).toBe(original);
            unsubscribe(); unsubscribe = null;
        } finally {
            Object.defineProperty(globalThis, 'fetch', descriptor);
        }
    });

    it('preserves WebSocket subclass construction', () => {
        class OriginalSocket { constructor(url) { this.url = url; } }
        vi.stubGlobal('WebSocket', OriginalSocket);
        startMonitoring();
        class CustomSocket extends globalThis.WebSocket { custom() { return true; } }
        const socket = new CustomSocket('wss://example.com/socket');
        expect(socket).toBeInstanceOf(CustomSocket);
        expect(socket.custom()).toBe(true);
    });

    it('keeps independent subscriptions and restores APIs after repeated mount cycles', () => {
        const original = globalThis.fetch;
        const listener = vi.fn();
        for (let cycle = 0; cycle < 3; cycle++) {
            const first = subscribePrivacy(listener);
            const second = subscribePrivacy(listener);
            try {
                first(); first();
                expect(privacyInstrumentationState()).toMatchObject({ patched: true, listeners: 1 });
                expect(globalThis.fetch).not.toBe(original);
                second();
                expect(privacyInstrumentationState()).toMatchObject({ patched: false, listeners: 0 });
                expect(globalThis.fetch).toBe(original);
            } finally { first(); second(); }
        }
    });

    it('does not reactivate a disposed privacy store', () => {
        const store = new PrivacyStore();
        store.start();
        expect(privacyInstrumentationState()).toMatchObject({ listeners: 1, patched: true });
        store.dispose();
        store.start();
        expect(privacyInstrumentationState()).toMatchObject({ listeners: 0, patched: false });
    });

    it('only flags known or unknown public request bodies, not receive-only activity', () => {
        const store = new PrivacyStore();
        const base = {
            uploadedBytes: 0, remoteRequests: 1, localRequests: 0, unknownBody: 0,
            externalResourceLoads: 1, lastRemote: 'https://cdn.example.com/image.png', resourceObserver: true, channels: {},
        };
        store._apply(base);
        expect(store.isClean).toBe(true);
        store._apply({ ...base, unknownBody: 1 });
        expect(store.isClean).toBe(false);
        store._apply({ ...base, uploadedBytes: 1 });
        expect(store.isClean).toBe(false);
    });

    it('admits unknown length when the browser does not expose Request.body', async () => {
        class RequestWithoutBody {
            constructor() { this.url = 'https://example.com/upload'; this.method = 'POST'; }
        }
        vi.stubGlobal('Request', RequestWithoutBody);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')));
        startMonitoring();
        await fetch(new RequestWithoutBody());
        expect(privacySnapshot()).toMatchObject({ uploadedBytes: 0, unknownBody: 1 });
    });

    it('reports Request bodies as unknown without consuming them and honors init overrides', async () => {
        const bodies = [];
        vi.stubGlobal('fetch', vi.fn(async (request, init) => {
            bodies.push(await new Request(request, init).text());
            return new Response('ok');
        }));
        startMonitoring();
        await fetch(new Request('https://example.com/upload', { method: 'POST', body: 'image bytes' }));
        expect(privacySnapshot()).toMatchObject({ uploadedBytes: 0, unknownBody: 1, remoteRequests: 1 });
        await fetch(new Request('https://example.com/upload', { method: 'POST', body: 'old' }), { body: 'new bytes' });
        expect(privacySnapshot()).toMatchObject({ uploadedBytes: 9, unknownBody: 1, remoteRequests: 2 });
        expect(bodies).toEqual(['image bytes', 'new bytes']);
    });

    it('counts nothing for local or Tauri bridge traffic and bytes for public uploads', async () => {
        const events = [];
        const fakeFetch = vi.fn().mockResolvedValue(new Response('ok'));
        vi.stubGlobal('location', { origin: 'http://localhost:5173' });
        vi.stubGlobal('fetch', fakeFetch);
        startMonitoring((event) => events.push(event));

        await fetch('/local/thing', { method: 'POST', body: 'abc' });
        // Tauri 的资源插件会在关闭时经 IPC 交还 Blob；它可能很大，但不离开设备。
        await fetch('ipc://localhost/plugin%3Aresources%7Cclose', { method: 'POST', body: 'tauri bridge bytes' });
        await fetch('https://example.com/upload', { method: 'POST', body: 'abcde' });
        await fetch('https://example.com/ping');
        await fetch('https://example.com/ping2', { method: 'HEAD' });

        const snapshot = privacySnapshot();
        expect(snapshot.uploadedBytes).toBe(5);
        expect(snapshot.remoteRequests).toBe(3);
        expect(snapshot.localRequests).toBe(2);
        expect(snapshot.lastRemote).toBe('https://example.com/ping2');
        expect(snapshot.channels.fetch).toBe(5);
        // 监控不能吞掉调用或返回值
        expect(fakeFetch).toHaveBeenCalledTimes(5);
        expect(events.filter((event) => !event.local).map((event) => event.bytes)).toEqual([5, 0, 0]);
    });

    it('flags a streaming external body instead of counting it as zero bytes', async () => {
        const fakeFetch = vi.fn().mockResolvedValue(new Response('ok'));
        vi.stubGlobal('fetch', fakeFetch);
        startMonitoring();

        await fetch('https://example.com/stream', { method: 'POST', body: new ReadableStream() });
        expect(privacySnapshot()).toMatchObject({ uploadedBytes: 0, remoteRequests: 1, unknownBody: 1 });
    });

    it('restores the patched APIs after the last unsubscribe', () => {
        const originalFetch = globalThis.fetch;
        const originalXhr = globalThis.XMLHttpRequest;
        expect(privacyInstrumentationState().patched).toBe(false);
        startMonitoring();
        expect(privacyInstrumentationState().patched).toBe(true);
        expect(globalThis.fetch).not.toBe(originalFetch);
        unsubscribe();
        unsubscribe = null;
        expect(privacyInstrumentationState().patched).toBe(false);
        expect(globalThis.fetch).toBe(originalFetch);
        expect(globalThis.XMLHttpRequest).toBe(originalXhr);
    });

    it('counts external resource loads without calling them uploads', () => {
        const callbacks = [];
        class FakeObserver {
            constructor(callback) { callbacks.push(callback); }
            observe(options) { this.options = options; }
            disconnect() { this.disconnected = true; }
        }
        vi.stubGlobal('PerformanceObserver', FakeObserver);
        startMonitoring();

        expect(privacyInstrumentationState().patched).toBe(true);
        expect(privacySnapshot().resourceObserver).toBe(true);
        callbacks[0]({ getEntries: () => [
            { name: 'http://127.0.0.1:4173/assets/local.png' },
            { name: 'https://cdn.example.com/pixel.gif' },
            { name: 'https://cdn.example.com/app.js' },
        ] });

        const snapshot = privacySnapshot();
        expect(snapshot.externalResourceLoads).toBe(2);
        expect(snapshot.channels.resource).toBe(2);
        // 资源加载只接收数据，不算上传
        expect(snapshot.uploadedBytes).toBe(0);
        expect(snapshot.remoteRequests).toBe(0);
    });

    it('does not count buffered resource entries again after the observer remounts', () => {
        const callbacks = [];
        class FakeObserver {
            constructor(callback) { callbacks.push(callback); }
            observe() {}
            disconnect() {}
        }
        vi.stubGlobal('PerformanceObserver', FakeObserver);
        const replayedEntry = {
            name: 'https://cdn.example.com/buffered-replay.png',
            entryType: 'resource',
            initiatorType: 'img',
            startTime: 123,
            responseEnd: 130,
            duration: 7,
            transferSize: 512,
        };
        startMonitoring();
        callbacks[0]({ getEntries: () => [replayedEntry] });
        expect(privacySnapshot().externalResourceLoads).toBe(1);

        unsubscribe(); unsubscribe = null;
        startMonitoring();
        // 浏览器会在 buffered: true 的新 observer 上重放同一条；对象本身可能已经换了。
        callbacks[1]({ getEntries: () => [{ ...replayedEntry }] });
        expect(privacySnapshot()).toMatchObject({ externalResourceLoads: 1, channels: { resource: 1 } });
    });

    it('broadcasts a counter reset to every active subscription', () => {
        const firstListener = vi.fn();
        const secondListener = vi.fn();
        const first = subscribePrivacy(firstListener);
        const second = subscribePrivacy(secondListener);
        try {
            resetPrivacyCounters();
            expect(firstListener.mock.calls.at(-1)[0]).toMatchObject({
                channel: 'reset',
                snapshot: { uploadedBytes: 0, remoteRequests: 0, unknownBody: 0 },
            });
            expect(secondListener.mock.calls.at(-1)[0]).toMatchObject({
                channel: 'reset',
                snapshot: { uploadedBytes: 0, remoteRequests: 0, unknownBody: 0 },
            });
        } finally {
            first();
            second();
        }
    });

    it('counts XHR, beacon and WebSocket traffic through the same rules', () => {
        class FakeXhr {
            open(method, url) { this.method = method; this.url = url; }
            send() {}
        }
        const beacon = vi.fn().mockReturnValue(true);
        class FakeSocket {
            constructor(url) { this.url = url; }
            send(data) { this.data = data; }
        }
        vi.stubGlobal('XMLHttpRequest', FakeXhr);
        vi.stubGlobal('WebSocket', FakeSocket);
        vi.stubGlobal('location', { origin: 'http://localhost:5173' });
        Object.defineProperty(globalThis.navigator, 'sendBeacon', { value: beacon, configurable: true, writable: true });
        startMonitoring();

        const local = new FakeXhr();
        local.open('POST', '/local');
        local.send('ignored locally');
        const remote = new FakeXhr();
        remote.open('POST', 'https://example.com/xhr');
        remote.send('twelve bytes');
        globalThis.navigator.sendBeacon('https://example.com/beacon', 'abcd');
        const socket = new globalThis.WebSocket('wss://relay.example.com');
        socket.send('ping');

        const snapshot = privacySnapshot();
        expect(snapshot.uploadedBytes).toBe(20);
        expect(snapshot.remoteRequests).toBe(4);
        expect(snapshot.localRequests).toBe(1);
        expect(snapshot.channels).toMatchObject({ xhr: 2, beacon: 1, websocket: 2 });
        expect(beacon).toHaveBeenCalledOnce();
        expect(local.url).toBe('/local');
        expect(socket.data).toBe('ping');
    });

    it('upgrades local fetch requests to remote when redirected to a public origin or opaque redirect', async () => {
        const events = [];
        vi.stubGlobal('location', { origin: 'http://localhost:5173' });
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce({ redirected: true, url: 'https://evil.example/leak', type: 'basic' })
            .mockResolvedValueOnce({ redirected: false, url: '', type: 'opaqueredirect' }));
        startMonitoring((event) => events.push(event));

        await fetch('/local/bounce', { method: 'POST', body: 'secret' });
        await fetch('/local/opaque', { method: 'POST', body: '1234' });

        const snapshot = privacySnapshot();
        expect(snapshot.localRequests).toBe(0);
        expect(snapshot.remoteRequests).toBe(2);
        expect(snapshot.uploadedBytes).toBe(10);
        expect(snapshot.channels.fetch).toBe(2);
        expect(snapshot.lastRemote).toBe('/local/opaque');
        const transitions = events.filter((event) => event.redirectedToPublic);
        expect(transitions).toHaveLength(2);
        expect(transitions[0]).toMatchObject({ local: false, transition: true, bytes: 6, url: 'https://evil.example/leak' });
        expect(transitions[1]).toMatchObject({ local: false, transition: true, bytes: 4 });
    });

    it('does not corrupt post-reset counters when a pre-reset redirected fetch resolves later', async () => {
        let resolveFetch;
        vi.stubGlobal('location', { origin: 'http://localhost:5173' });
        vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; })));
        startMonitoring();

        const pending = fetch('/local/slow-bounce', { method: 'POST', body: 'stale' });
        resetPrivacyCounters();
        resolveFetch({ redirected: true, url: 'https://evil.example/after-reset', type: 'basic' });
        await pending;

        expect(privacySnapshot()).toMatchObject({
            localRequests: 0,
            remoteRequests: 0,
            uploadedBytes: 0,
            unknownBody: 0,
        });
    });

    it('upgrades redirected XHR requests and cleans up listeners when an XHR instance is reused', () => {
        class RedirectableXhr {
            constructor() {
                this._listeners = new Map();
                this.responseURL = '';
            }
            addEventListener(type, fn) {
                if (!this._listeners.has(type)) this._listeners.set(type, new Set());
                this._listeners.get(type).add(fn);
            }
            removeEventListener(type, fn) {
                this._listeners.get(type)?.delete(fn);
            }
            emit(type) {
                for (const fn of [...(this._listeners.get(type) || [])]) fn.call(this);
            }
            open(method, url) { this.method = method; this.url = url; }
            send() {}
        }
        vi.stubGlobal('XMLHttpRequest', RedirectableXhr);
        vi.stubGlobal('location', { origin: 'http://localhost:5173' });
        startMonitoring();

        const xhr = new RedirectableXhr();
        xhr.open('POST', '/local/first');
        xhr.send('aaaa');
        xhr.responseURL = 'http://localhost:5173/local/first';
        xhr.emit('loadend');

        // 复用同一 XHR 实例，第二次被重定向至公网
        xhr.open('POST', '/local/second');
        xhr.send('bbbbb');
        xhr.responseURL = 'https://public.example/collect';
        xhr.emit('loadend');

        const snapshot = privacySnapshot();
        expect(snapshot.localRequests).toBe(1);
        expect(snapshot.remoteRequests).toBe(1);
        expect(snapshot.uploadedBytes).toBe(5);
        expect(snapshot.channels.xhr).toBe(2);
        expect(snapshot.lastRemote).toBe('https://public.example/collect');
        expect(xhr._listeners.get('loadend')?.size ?? 0).toBe(0);
    });
});
