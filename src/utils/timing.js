/**
 * Trailing debounce supporting `.cancel()` and `.flush()` without external dependencies.
 * Matches existing editor/layer flusher contracts (`renderTaskTracker.registerFlusher`).
 */
export function debounce(fn, wait = 0) {
    const delay = Math.max(0, Number(wait) || 0);
    let timerId = null;
    let pendingArgs = null;
    let pendingContext;

    const invoke = () => {
        const args = pendingArgs;
        const context = pendingContext;
        timerId = null;
        pendingArgs = null;
        pendingContext = undefined;
        return fn.apply(context, args);
    };

    function debounced(...args) {
        pendingArgs = args;
        pendingContext = this;
        if (timerId !== null) clearTimeout(timerId);
        timerId = setTimeout(invoke, delay);
    }

    debounced.cancel = () => {
        if (timerId !== null) {
            clearTimeout(timerId);
            timerId = null;
        }
        pendingArgs = null;
        pendingContext = undefined;
    };

    debounced.flush = () => {
        if (timerId === null) return undefined;
        clearTimeout(timerId);
        return invoke();
    };

    return debounced;
}

/**
 * Returns the first element with the maximum numeric/comparable value produced by `iteratee`.
 */
export function maxBy(items, iteratee) {
    if (!Array.isArray(items) || items.length === 0) return undefined;
    let bestItem;
    let bestValue;
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const value = iteratee(item, index, items);
        if (value == null || Number.isNaN(value)) continue;
        if (bestItem === undefined || value > bestValue) {
            bestItem = item;
            bestValue = value;
        }
    }
    return bestItem;
}
