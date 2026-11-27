import useI18n from '../../i18n/useI18n';
import { createElement, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import useStores from '@stores/useStores';

let loadedTemplateModal = null;

export default observer(function SceneTemplateController() {
    const t = useI18n();
    const stores = useStores();
    const [open, setOpen] = useState(false);
    const returnFocusRef = useRef(null);
    const loadingRef = useRef(false);
    const generationRef = useRef(0);

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
        const dispose = stores.commands.registerUiAction('file.openTemplates', async () => {
            if (loadingRef.current) return false;
            if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
                returnFocusRef.current = document.activeElement;
            } else {
                returnFocusRef.current = null;
            }

            const generation = generationRef.current + 1;
            generationRef.current = generation;

            if (loadedTemplateModal) {
                setOpen(true);
                return true;
            }

            loadingRef.current = true;
            try {
                const mod = await import('./SceneTemplateModal');
                if (generation !== generationRef.current || stores.isDisposed) return false;
                const Loaded = mod?.default;
                if (!Loaded) throw new Error('scene-templates-module-invalid');
                loadedTemplateModal = Loaded;
                setOpen(true);
                return true;
            } catch {
                if (generation === generationRef.current && !stores.isDisposed) {
                    stores.editor.message?.error?.(t("场景模板加载失败，请联网后重试"));
                    restoreFocus();
                }
                return false;
            } finally {
                loadingRef.current = false;
            }
        });
        return () => {
            generationRef.current += 1;
            dispose();
        };
    }, [restoreFocus, stores, t]);

    const handleClose = useCallback(() => {
        generationRef.current += 1;
        setOpen(false);
        restoreFocus();
    }, [restoreFocus]);

    if (!open || !loadedTemplateModal) return null;

    return createElement(loadedTemplateModal, { onClose: handleClose });
});
