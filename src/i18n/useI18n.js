import useStores from '../stores/useStores';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { reaction } from 'mobx';

export default function useI18n() {
    const { i18n } = useStores();
    const subscribe = useCallback((notify) => reaction(() => i18n.version, notify), [i18n]);
    const snapshot = useCallback(() => i18n.version, [i18n]);
    const version = useSyncExternalStore(subscribe, snapshot, snapshot);
    return useMemo(() => {
        void version;
        return (source, parameters) => i18n.t(source, parameters);
    }, [i18n, version]);
}
