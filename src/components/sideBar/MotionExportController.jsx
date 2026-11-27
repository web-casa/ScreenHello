import useI18n from '../../i18n/useI18n';
import { createElement, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import useStores from '@stores/useStores';

let loadedMotionDialog = null;

export default observer(function MotionExportController() {
    const t = useI18n();
    const stores = useStores();
    const [open, setOpen] = useState(false);
    const returnFocusRef = useRef(null);
    const loadingRef = useRef(false);
    const openGenerationRef = useRef(0);

    const restoreFocus = useCallback(() => {
        const target = returnFocusRef.current;
        returnFocusRef.current = null;
        if (target && target.isConnected && typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => {
                if (target.isConnected) target.focus?.({ preventScroll: true });
            });
        }
    }, []);

    useLayoutEffect(() => {
        const dispose = stores.commands.registerUiAction('file.openMotionExport', async () => {
            if (loadingRef.current) return false;
            if (!stores.imageStore.list.length) return false;
            if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
                returnFocusRef.current = document.activeElement;
            } else {
                returnFocusRef.current = null;
            }

            const generation = openGenerationRef.current + 1;
            openGenerationRef.current = generation;

            if (loadedMotionDialog) {
                setOpen(true);
                return true;
            }

            loadingRef.current = true;
            try {
                const mod = await import('./MotionExportDialog');
                if (generation !== openGenerationRef.current || stores.isDisposed) return false;
                const Loaded = mod?.default;
                if (!Loaded) throw new Error('motion-export-module-invalid');
                loadedMotionDialog = Loaded;
                setOpen(true);
                return true;
            } catch {
                if (generation === openGenerationRef.current && !stores.isDisposed) {
                    stores.editor.message?.error?.(t("动图导出模块加载失败，请联网后重试"));
                    restoreFocus();
                }
                return false;
            } finally {
                loadingRef.current = false;
            }
        });
        return () => {
            openGenerationRef.current += 1;
            dispose();
        };
    }, [restoreFocus, stores, t]);

    const handleClose = useCallback(() => {
        openGenerationRef.current += 1;
        setOpen(false);
        restoreFocus();
    }, [restoreFocus]);

    if (!open || !loadedMotionDialog) return null;

    return createElement(loadedMotionDialog, { onClose: handleClose });
});
