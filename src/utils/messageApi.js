/** Ant Design 6 的默认 message 时长（毫秒）。 */
export const PASSIVE_MESSAGE_DURATION = 3_000;

const typedMessage = (open, type) => (content, duration, onClose) => {
    const config = content && typeof content === 'object' && 'content' in content
        ? { ...content }
        : { content };
    if (typeof duration === 'function') config.onClose = duration;
    else {
        if (duration !== undefined) config.duration = duration;
        if (onClose !== undefined) config.onClose = onClose;
    }
    return open({ ...config, type });
};

const timeoutFor = (duration, fallback) => {
    if (duration === false || duration === null || duration === 0) return 0;
    const seconds = duration === undefined ? fallback / 1_000 : duration;
    return Number.isFinite(seconds) ? Math.max(0, seconds * 1_000) : fallback;
};

/**
 * 给实例级 antd message API 加一层无 rAF 的寿命管理。
 *
 * rc-notification 即使没有进度条，也会在 `duration > 0` 时用 rAF 更新内部
 * 状态；这个更新可能与 MobX 驱动的并发 render 相交，从而产生 React 19 的
 * 跨组件更新警告。底层 notice 固定为 duration 0，自动关闭由原生定时器完成。
 *
 * `open`、info/success/warning/error/loading 和 destroy 保持 antd MessageInstance
 * 的常用调用形态。带 key 的更新会清除旧计时器，却不会误关闭刚替换的 notice。
 * `activate`/`dispose` 与 React effect 生命周期配套：StrictMode 会模拟一次
 * cleanup 再 setup，同一个 API 必须能在下一次 setup 重新启用。
 */
export function createPassiveMessageApi(message, {
    duration = PASSIVE_MESSAGE_DURATION,
    browser = globalThis.window,
} = {}) {
    const timers = new Map();
    const supportsTimers = typeof browser?.setTimeout === 'function';
    let disposed = false;

    const clearTimer = (entry) => {
        if (entry.timer !== null) browser?.clearTimeout?.(entry.timer);
        entry.timer = null;
    };

    const open = (config = {}) => {
        if (disposed || typeof message?.open !== 'function') return () => {};
        // 保留非浏览器宿主的原生 antd 行为；此 wrapper 只在 App 的浏览器 API 上安装。
        if (!supportsTimers) return message.open(config);

        const timerKey = config.key ?? Symbol('passive-message');
        const previous = timers.get(timerKey);
        // 同 key 在 antd 中是更新而不是关闭。只清旧 timer，避免它随后关闭更新后的 notice。
        if (previous) clearTimer(previous);

        const entry = { timer: null, close: null };
        timers.set(timerKey, entry);
        const rawClose = message.open({ ...config, duration: 0, pauseOnHover: false });
        const close = () => {
            // 旧调用方拿到的 close 不得关闭相同 key 的新 notice。
            if (timers.get(timerKey) !== entry) return;
            clearTimer(entry);
            timers.delete(timerKey);
            rawClose?.();
        };
        if (typeof rawClose?.then === 'function') close.then = rawClose.then.bind(rawClose);
        entry.close = close;

        const timeout = timeoutFor(config.duration, duration);
        if (timeout > 0) entry.timer = browser.setTimeout(close, timeout);
        return close;
    };

    const destroy = (key) => {
        if (key !== undefined) {
            const entry = timers.get(key);
            if (entry) entry.close?.();
            else message?.destroy?.(key);
            return;
        }
        for (const entry of [...timers.values()]) entry.close?.();
        message?.destroy?.();
    };

    return {
        open,
        info: typedMessage(open, 'info'),
        success: typedMessage(open, 'success'),
        warning: typedMessage(open, 'warning'),
        error: typedMessage(open, 'error'),
        loading: typedMessage(open, 'loading'),
        destroy,
        activate() {
            disposed = false;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            // 底层 notice 的 duration 固定为 0；只清定时器会把已经展示的
            // notice 永久留在 holder 中。逐个 close 同时保留同 key 的保护语义。
            for (const entry of [...timers.values()]) entry.close?.();
        },
    };
}
