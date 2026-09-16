/**
 * 网络出口监控（隐私计数器的事实来源）。
 *
 * 页面级只打一次补丁（fetch / XMLHttpRequest / sendBeacon / WebSocket），把每次请求分类成
 * 「本机」或「公网」，并统计**可精确测量的公网请求体字节数**。UI 只读这些计数，所以
 * 「公网发送 0 B」是运行时结论，不是静态文案：一旦有数据发往公共互联网，数字立刻变化。
 *
 * 边界（刻意写清楚，避免过度承诺）：
 * - 覆盖发送数据的 API：fetch、XMLHttpRequest、navigator.sendBeacon、WebSocket 连接与 send。
 * - 「本机」= 回环地址、非网络 URL，以及 Tauri WebView 的本地 IPC / asset bridge。它们可能承载
 *   大 Blob，但不会发到公网。只有当页面自身也运行在上述本地 origin 时，相对地址/同源地址才算本机；
 *   部署在 HTTPS 公网域名上的同源 POST 仍是公网发送。
 * - 请求体是流（ReadableStream）或 multipart FormData 时，无法在不消费/序列化它的情况下得知
 *   准确长度，标记 `unknownBody: true` 而不是猜 0；UI 会把已知字节作为下界单独提示。
 * - 标签/脚本/图片等纯 GET 资源加载不发送数据，因此不计入上传字节；
 *   它们由 Resource Timing 单独统计为 `externalResourceLoads`（仅接收）。
 */
const LOCAL_PROTOCOLS = new Set(['blob:', 'data:', 'file:', 'about:', 'filesystem:', 'asset:', 'tauri:']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);
// Tauri v2 会因平台和 WebView 后端使用两种本地 bridge 形式：`ipc://localhost/...`
// 与 HTTP asset/IPC host。它们由应用进程处理，不经过公网网络栈。
const TAURI_LOCAL_HOSTS = new Set(['ipc.localhost', 'asset.localhost', 'tauri.localhost']);
const CHANNELS = new Set(['fetch', 'xhr', 'beacon', 'websocket']);

const listeners = new Set();
let originals = null;
let resourceObserver = null;
// Resource Timing 在 observer 重建时会重放 buffered 条目。保留页面级签名可避免重复计数；
// 不能随 reset 清空，否则下一次订阅会把 reset 前的资源又算进新的会话。
const resourceEntryKeys = new Set();
const webSocketTargets = new WeakMap();
let counters = createCounters();

function createCounters() {
    return {
        uploadedBytes: 0, remoteRequests: 0, localRequests: 0, unknownBody: 0,
        externalResourceLoads: 0, lastRemote: null, resourceObserver: false, channels: {},
    };
}

const currentOrigin = () => {
    try {
        // `file:` 与其他 opaque origin 的 `location.origin` 是字符串 "null"；用 href
        // 才能继续把相对本地资源按浏览器规则解析。
        const location = globalThis.location;
        return location?.origin && location.origin !== 'null' ? location.origin : (location?.href || '');
    } catch {
        return '';
    }
};

const comparableOrigin = (url) => String(url?.origin || '')
    .replace(/^ws:/, 'http:')
    .replace(/^wss:/, 'https:');

const isLocalHost = (url) => LOOPBACK_HOSTS.has(url.hostname) || TAURI_LOCAL_HOSTS.has(url.hostname);

const isLocalOrigin = (origin) => {
    try {
        const url = new URL(origin);
        if (LOCAL_PROTOCOLS.has(url.protocol)) return true;
        if (url.protocol === 'ipc:') return isLocalHost(url);
        return ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && isLocalHost(url);
    } catch {
        return false;
    }
};

/** 判断目标地址是否属于「不出本机」。无法解析的地址按公网处理（保守）。 */
export const isLocalTarget = (rawUrl, origin = currentOrigin()) => {
    if (!rawUrl) return true; // 同文档请求（极少见）视为本地
    const value = String(rawUrl);
    // 使用浏览器相同的 URL 解析规则（空白、反斜杠和相对路径都不能靠前缀猜测）。
    const base = origin || 'https://screenhello-local.invalid';
    let url;
    let baseUrl = null;
    try {
        baseUrl = new URL(base);
    } catch {
        // 无法解析 opaque / 缺失页面 origin 时，绝对 URL 仍可被正确分类；相对 URL 没有
        // 可验证的归属，继续按公网处理。
        baseUrl = null;
    }
    try {
        url = new URL(value, baseUrl || undefined);
    } catch {
        return false;
    }
    if (LOCAL_PROTOCOLS.has(url.protocol)) return true;
    if (url.protocol === 'ipc:') return isLocalHost(url);
    if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
        if (isLocalHost(url)) return true;
        // 同源不等于本机：线上 ScreenHello 的同源 POST 仍会穿过公网。只有本地开发服务器
        // 或 Tauri WebView origin 的同源地址才能排除出公网计数。
        return baseUrl != null && comparableOrigin(url) === comparableOrigin(baseUrl) && isLocalOrigin(base);
    }
    return false;
};

const toBytes = (value) => {
    if (!value) return 0;
    if (typeof value === 'string') return new TextEncoder().encode(value).length;
    if (typeof Blob !== 'undefined' && value instanceof Blob) return value.size;
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    if (typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams) {
        return new TextEncoder().encode(value.toString()).length;
    }
    return 0;
};

/** 请求体的字节数与“无法估算”标记（流式与 multipart body 不猜数字）。 */
export const measureBody = (body) => {
    if (body == null) return { bytes: 0, unknown: false };
    if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return { bytes: 0, unknown: true };
    // 浏览器会在发送时添加随机 boundary、字段名与 Content-Disposition。只相加字段/Blob 大小
    // 会把“已上传”伪装成精确值，所以 FormData 统一按未知处理。
    if (typeof FormData !== 'undefined' && body instanceof FormData) return { bytes: 0, unknown: true };
    const bytes = toBytes(body);
    if (bytes > 0) return { bytes, unknown: false };
    const known = typeof body === 'string'
        || (typeof Blob !== 'undefined' && body instanceof Blob)
        || body instanceof ArrayBuffer
        || ArrayBuffer.isView(body)
        || (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams);
    return { bytes: 0, unknown: !known };
};

const record = ({ channel, url, bytes = 0, unknown = false, method = 'GET' }) => {
    const local = isLocalTarget(url);
    if (local) counters.localRequests += 1;
    else {
        counters.remoteRequests += 1;
        counters.uploadedBytes += bytes;
        if (unknown) counters.unknownBody += 1;
        counters.lastRemote = String(url).slice(0, 200);
    }
    counters.channels[channel] = (counters.channels[channel] || 0) + 1;
    const event = {
        channel,
        method: String(method || 'GET').toUpperCase(),
        url: String(url || ''),
        local,
        bytes,
        unknown,
        snapshot: { ...counters, channels: { ...counters.channels } },
    };
    for (const listener of [...listeners]) listener(event);
};

/** 当前页面的计数快照（只读副本）。 */
export const privacySnapshot = () => ({ ...counters, channels: { ...counters.channels } });

/** 把当前快照推给订阅者（Resource Timing 和手动重置都没有单次请求事件）。 */
const notify = (channel = 'resource') => {
    const snapshot = { ...counters, channels: { ...counters.channels } };
    for (const listener of [...listeners]) listener({ channel, snapshot });
};

export const resetPrivacyCounters = () => {
    counters = createCounters();
    counters.resourceObserver = Boolean(resourceObserver);
    notify('reset');
};

export const subscribePrivacy = (listener) => {
    if (typeof listener !== 'function') return () => {};
    ensurePatched();
    ensureResourceObserver();
    // 每次订阅拥有独立身份，即使调用方重复传入同一个函数。
    const subscription = event => listener(event);
    listeners.add(subscription);
    return () => {
        if (!listeners.delete(subscription)) return;
        if (!listeners.size) {
            restorePatched();
            stopResourceObserver();
        }
    };
};

/**
 * 资源加载只接收数据（图片/脚本/样式），不会上传，所以单独计数：
 * externalResourceLoads = 发往外部源的资源加载次数。
 * 浏览器不支持 Resource Timing 时保持 0 并置 resourceObserver=false，UI 不显示这一项。
 */
const resourceEntryKey = (entry) => [
    entry?.entryType ?? 'resource',
    entry?.name ?? '',
    entry?.initiatorType ?? '',
    entry?.startTime ?? '',
    entry?.responseEnd ?? '',
    entry?.duration ?? '',
    entry?.transferSize ?? '',
    entry?.encodedBodySize ?? '',
    entry?.decodedBodySize ?? '',
].join('\u0000');

const isNewResourceEntry = (entry) => {
    const key = resourceEntryKey(entry);
    if (resourceEntryKeys.has(key)) return false;
    resourceEntryKeys.add(key);
    return true;
};

const ensureResourceObserver = () => {
    if (resourceObserver) return;
    const PerformanceObserverRef = globalThis.PerformanceObserver;
    if (typeof PerformanceObserverRef !== 'function') return;
    try {
        resourceObserver = new PerformanceObserverRef((list) => {
            let changed = false;
            for (const entry of list.getEntries()) {
                if (!isLocalTarget(entry.name) && isNewResourceEntry(entry)) {
                    counters.externalResourceLoads += 1;
                    counters.channels.resource = (counters.channels.resource || 0) + 1;
                    counters.lastRemote = String(entry.name).slice(0, 200);
                    changed = true;
                }
            }
            if (changed) notify();
        });
        resourceObserver.observe({ type: 'resource', buffered: true });
        counters.resourceObserver = true;
    } catch {
        resourceObserver = null;
        counters.resourceObserver = false;
    }
};

const stopResourceObserver = () => {
    try {
        resourceObserver?.disconnect();
    } catch {
        // 断开失败不影响后续
    }
    resourceObserver = null;
    counters.resourceObserver = false;
};

// 每次挂载有独立代际。宿主可能保存或再包装我们的函数；旧包装在退订后只转发。
const installPatch = (target, key, create) => {
    if (!target || typeof target[key] !== 'function') return;
    const generation = originals;
    const original = target[key];
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    const replacement = create(original, () => originals === generation);
    try {
        target[key] = replacement;
        if (target[key] !== replacement) return;
        generation.restorers.push(() => {
            // 只撤销自己仍拥有的补丁，不能覆盖宿主后来安装的包装函数。
            if (target[key] !== replacement) return;
            if (descriptor) Object.defineProperty(target, key, descriptor);
            else delete target[key];
        });
    } catch {
        // 宿主可能冻结浏览器 API；监控失败不能阻止编辑器挂载。
    }
};

const ensurePatched = () => {
    if (originals) return;
    originals = { restorers: [] };
    patchFetch();
    patchXhr();
    patchBeacon();
    patchWebSocket();
};

const restorePatched = () => {
    if (!originals) return;
    const saved = originals;
    originals = null;
    for (const restore of saved.restorers.reverse()) {
        try { restore(); } catch { /* 宿主可能在运行期间冻结属性。 */ }
    }
};

const patchFetch = () => {
    installPatch(globalThis, 'fetch', (original, active) => function monitoredFetch(input, init = {}) {
        if (!active()) return original.apply(this, arguments);
        try {
            const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
            const url = request ? request.url : String(input?.url || input);
            const method = init?.method || request?.method || 'GET';
            // Request.body 是流，交给 measureBody 标记未知，不消费或克隆正文。
            const body = init?.body ?? request?.body ?? null;
            const simple = method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD';
            // Firefox 尚未暴露 Request.body；非 GET/HEAD 的 Request 不能据此认定无正文。
            const hiddenRequestBody = request && init?.body == null && !('body' in request);
            const measured = simple ? { bytes: 0, unknown: false }
                : hiddenRequestBody ? { bytes: 0, unknown: true } : measureBody(body);
            record({ channel: 'fetch', url, method, ...measured });
        } catch {
            // 监控自身绝不能影响请求
        }
        return original.apply(this, arguments);
    });
};

const patchXhr = () => {
    const Xhr = globalThis.XMLHttpRequest;
    if (!Xhr || !Xhr.prototype) return;
    installPatch(Xhr.prototype, 'open', (original, active) => function monitoredOpen(method, url) {
        if (!active()) return original.apply(this, arguments);
        try {
            Object.defineProperty(this, '__screenhelloRequest', {
                value: { method, url }, configurable: true, writable: true,
            });
        } catch {
            // 某些宿主把实例冻住时忽略
        }
        return original.apply(this, arguments);
    });
    installPatch(Xhr.prototype, 'send', (original, active) => function monitoredSend(body) {
        if (!active()) return original.apply(this, arguments);
        try {
            const info = this.__screenhelloRequest || {};
            const method = String(info.method || 'GET').toUpperCase();
            const simple = method === 'GET' || method === 'HEAD';
            record({ channel: 'xhr', url: info.url, method, ...(simple ? { bytes: 0, unknown: false } : measureBody(body)) });
        } catch {
            // 同上
        }
        return original.apply(this, arguments);
    });
};

const patchBeacon = () => {
    const navigatorRef = globalThis.navigator;
    if (!navigatorRef || typeof navigatorRef.sendBeacon !== 'function') return;
    installPatch(navigatorRef, 'sendBeacon', (original, active) => function monitoredBeacon(url, data) {
        if (!active()) return original.apply(this, arguments);
        try {
            record({ channel: 'beacon', url, method: 'POST', ...measureBody(data) });
        } catch {
            // 同上
        }
        return original.apply(this, arguments);
    });
};

const patchWebSocket = () => {
    const Socket = globalThis.WebSocket;
    if (Socket?.prototype) {
        installPatch(Socket.prototype, 'send', (original, active) => function monitoredWebSocketSend(body) {
            // 先让原生 send 校验并执行：无效调用抛错时不能算成已经发出数据。
            const result = original.apply(this, arguments);
            if (!active()) return result;
            try {
                const url = webSocketTargets.get(this) ?? this?.url;
                if (url !== undefined) record({ channel: 'websocket', url, method: 'SEND', ...measureBody(body) });
            } catch {
                // 监控自身绝不能影响已成功的发送
            }
            return result;
        });
    }
    installPatch(globalThis, 'WebSocket', (Original, active) => {
        const Monitored = function monitoredWebSocket(url, protocols) {
            if (!new.target) return Original.apply(this, arguments);
            const socket = Reflect.construct(Original, protocols === undefined ? [url] : [url, protocols], new.target);
            if (active()) {
                try {
                    webSocketTargets.set(socket, url);
                    record({ channel: 'websocket', url, method: 'CONNECT', bytes: 0, unknown: false });
                } catch { /* 监控不能影响连接 */ }
            }
            return socket;
        };
        Monitored.prototype = Original.prototype;
        Object.setPrototypeOf(Monitored, Original);
        return Monitored;
    });
};

/** 仅测试使用：确认补丁已还原。 */
export const privacyInstrumentationState = () => ({
    patched: Boolean(originals),
    listeners: listeners.size,
    channels: [...CHANNELS],
});
