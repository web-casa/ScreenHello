import { useEffect, useState } from 'react';
import { createScreenHelloRuntime } from './index';
import StoreContext from './storeContext';

export default function StoreProvider({ children, onRuntime }) {
    const [stores] = useState(() => createScreenHelloRuntime());

    useEffect(() => {
        stores.cancelScheduledDispose();
        stores.activate({ onlyIfNone: true });
        onRuntime?.(stores);
        return () => {
            onRuntime?.(null);
            // React Strict Mode 会执行模拟 cleanup/setup；延迟一个任务允许 setup 取消销毁。
            stores.scheduleDispose();
        };
    }, [onRuntime, stores]);

    return <StoreContext.Provider value={stores}>{children}</StoreContext.Provider>;
}
