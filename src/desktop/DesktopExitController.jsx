import { useEffect } from 'react';
import useStores from '../stores/useStores';
import { subscribeDesktopExitRequests } from './desktopExit';

export default function DesktopExitController() {
    const stores = useStores();
    useEffect(() => {
        let active = true;
        let unsubscribe;
        void subscribeDesktopExitRequests(() => active && stores.commands.requestApplicationExit())
            .then(cleanup => {
                if (active) unsubscribe = cleanup;
                else void cleanup();
            }).catch(() => { /* Native confirmation remains available if the bridge is unavailable. */ });
        return () => { active = false; void unsubscribe?.(); };
    }, [stores]);
    return null;
}
