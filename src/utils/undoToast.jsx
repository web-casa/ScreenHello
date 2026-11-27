/** 危险操作 toast 撤销的默认展示时长（毫秒）：够看清并点击，又不至于长期遮挡画布。 */
export const UNDO_TOAST_DURATION = 8000;

// Keyed notices replace each other through AntD. Browser-managed expiry timers
// must do the same, otherwise an earlier notice can close its replacement.
// The message API is instance-scoped; weak keys preserve that isolation without
// retaining a disposed ImageBeautifier instance.
const keyedBrowserNotices = new WeakMap();

/**
 * 危险操作执行后的一次性 toast 撤销。
 *
 * 与已审阅的危险操作交互决策一致：高频、易恢复的破坏性操作
 * 直接执行，再用 toast 提供一次撤销，而不是先弹确认框。
 *
 * - 只使用 App 注入的 antd message 实例；宿主没有注入（例如只直接调用 Store 的库用法）
 *   时返回 null，操作本身不受影响。
 * - 撤销按钮是 content 的一部分：antd 6 的 message 没有 `btn` 字段（那是 notification 的），
 *   所以不能用 `message.open({ content, btn })`。
 * - 这里刻意不引入 antd `Button`：Store 侧只需要一个原生按钮，样式由
 *   `.shoteasy-undo-toast__action` 负责。多引入一个 antd 组件会让库/站点构建多切出
 *   一个仅供预加载的小 chunk，并让 PWA 预缓存审计失败。
 * - 点击撤销先关闭 toast 再执行 onUndo，重复点击不会触发第二次。
 * - 是否真的还有可撤销的一步由调用方用 `history.undoTo(token)` 判断，避免撤销掉之后的新操作；
 *   失效时可用 `onUnavailable` 给用户明确反馈。
 * - `key` 用于同一种操作：传入时新提示会替换旧提示，不会留下一个点不动的“僵尸撤销”。
 * - 浏览器中把通知写入放到当前渲染完成后的下一个任务，并用一个原生到期计时器替代
 *   antd Notification 的逐帧进度状态更新，避免它与 MobX 驱动的 React render 交叉；
 *   卸载后的实例不会再打开提示。
 *
 * @param {object} root 实例 root store，读取 `editor.message` 与 `i18n`
 * @param {object} options
 * @param {string} options.label 已翻译好的提示文案
 * @param {() => boolean | void} options.onUndo 点击「撤销」时执行的回调；返回 false 表示操作已失效
 * @param {() => void} [options.onUnavailable] `onUndo` 返回 false 时执行的反馈
 * @param {number} [options.duration] 展示时长，默认 {@link UNDO_TOAST_DURATION}
 * @param {string} [options.key] 同类别提示的替换键
 * @returns {(() => void) | null} 可取消的关闭函数；未展示时为 null
 */
export function showUndoToast(root, { label, onUndo, onUnavailable, duration = UNDO_TOAST_DURATION, key } = {}) {
    const message = root?.editor?.message;
    if (!label || typeof onUndo !== 'function' || typeof message?.open !== 'function') return null;
    const i18n = root?.i18n;
    const actionLabel = typeof i18n?.t === 'function' ? i18n.t('撤销') : '撤销';
    const browser = globalThis.window;
    const managesBrowserLifetime = typeof browser?.setTimeout === 'function';
    let close = null;
    let handled = false;
    let cancelled = false;
    let openTimer = null;
    let expiryTimer = null;
    let expiryStartedAt = 0;
    const displayDuration = Number.isFinite(duration) ? Math.max(0, duration) : UNDO_TOAST_DURATION;
    let remaining = displayDuration;
    let releaseKey = () => {};

    const clearExpiry = () => {
        if (expiryTimer !== null) browser?.clearTimeout?.(expiryTimer);
        expiryTimer = null;
        expiryStartedAt = 0;
    };
    const closeNotice = () => {
        clearExpiry();
        close?.();
        releaseKey();
    };
    const pauseExpiry = () => {
        if (!managesBrowserLifetime || expiryStartedAt === 0) return;
        remaining = Math.max(0, remaining - (Date.now() - expiryStartedAt));
        clearExpiry();
    };
    const resumeExpiry = () => {
        if (!managesBrowserLifetime || cancelled || !close || remaining <= 0 || expiryTimer !== null) return;
        expiryStartedAt = Date.now();
        expiryTimer = browser.setTimeout(() => {
            expiryTimer = null;
            expiryStartedAt = 0;
            remaining = 0;
            closeNotice();
        }, remaining);
    };
    const content = (
        <span
            className="shoteasy-undo-toast"
            onPointerEnter={managesBrowserLifetime ? pauseExpiry : undefined}
            onPointerLeave={managesBrowserLifetime ? resumeExpiry : undefined}
        >
            {/* antd 的 message 容器没有 role/aria-live；自己播报，屏幕阅读器才不会漏掉这次删除 */}
            <span className="shoteasy-undo-toast__label" role="status" aria-live="polite">{label}</span>
            <button
                type="button"
                className="shoteasy-undo-toast__action"
                onClick={() => {
                    // 关闭动画期间按钮仍可能被再次点到：只处理第一次
                    if (handled) return;
                    handled = true;
                    closeNotice();
                    if (onUndo() === false) onUnavailable?.();
                }}
            >{actionLabel}</button>
        </span>
    );
    // 对外保持毫秒；antd message 的 duration 单位为秒。
    const seconds = displayDuration / 1000;
    // Browser notifications use duration=0 to avoid rc-notification's rAF state
    // updates. Hover-pausing is handled by the content handlers above instead.
    const config = { content, duration: managesBrowserLifetime ? 0 : seconds, pauseOnHover: !managesBrowserLifetime };
    const notice = key === undefined ? config : { ...config, key };
    if (!managesBrowserLifetime) {
        close = message.open(notice);
        return typeof close === 'function' ? close : null;
    }

    const cancelNotice = () => {
        cancelled = true;
        if (openTimer !== null) browser.clearTimeout?.(openTimer);
        closeNotice();
    };
    if (key !== undefined) {
        let notices = keyedBrowserNotices.get(message);
        if (!notices) {
            notices = new Map();
            keyedBrowserNotices.set(message, notices);
        }
        notices.get(key)?.cancel();
        const entry = { cancel: cancelNotice };
        notices.set(key, entry);
        releaseKey = () => {
            if (notices.get(key) !== entry) return;
            notices.delete(key);
            if (!notices.size) keyedBrowserNotices.delete(message);
        };
    }

    openTimer = browser.setTimeout(() => {
        openTimer = null;
        // App cleanup clears the injected API. Do not reopen a notification after
        // its context holder has unmounted or after this action was cancelled.
        if (cancelled || root?.isDisposed || root?.editor?.message !== message) {
            releaseKey();
            return;
        }
        const opened = message.open(notice);
        close = typeof opened === 'function' ? opened : null;
        resumeExpiry();
    }, 0);
    return cancelNotice;
}
