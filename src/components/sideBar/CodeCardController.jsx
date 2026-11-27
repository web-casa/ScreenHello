import useI18n from '../../i18n/useI18n';
import { createElement, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import useStores from '@stores/useStores';

let loadedCodeCardDialog = null;

export default observer(function CodeCardController() {
    const t = useI18n();
    const stores = useStores();
    const [session, setSession] = useState(null);
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
        const dispose = stores.commands.registerUiAction('file.openCodeCard', async (payload = {}) => {
            if (loadingRef.current) return false;
            if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
                returnFocusRef.current = document.activeElement;
            } else {
                returnFocusRef.current = null;
            }
            const mode = payload?.mode === 'edit' ? 'edit' : 'create';
            let nextSession;
            if (mode === 'edit') {
                const layer = (payload?.targetId ? stores.imageStore.layers.get(payload.targetId) : null)
                    || stores.commands.getEditableCodeCardLayer();
                if (!layer || layer.locked || !layer.codeCard) {
                    returnFocusRef.current = null;
                    return false;
                }
                nextSession = {
                    mode: 'edit',
                    targetId: layer.id,
                    initialCard: layer.codeCard,
                };
            } else {
                nextSession = {
                    mode: 'create',
                    targetId: null,
                    initialCard: null,
                };
            }

            const generation = openGenerationRef.current + 1;
            openGenerationRef.current = generation;

            if (loadedCodeCardDialog) {
                setSession(nextSession);
                return true;
            }

            loadingRef.current = true;
            try {
                const mod = await import('./CodeCardDialog');
                if (generation !== openGenerationRef.current || stores.isDisposed) return false;
                const Loaded = mod?.default;
                if (!Loaded) throw new Error('code-card-module-invalid');
                loadedCodeCardDialog = Loaded;
                setSession(nextSession);
                return true;
            } catch {
                if (generation === openGenerationRef.current && !stores.isDisposed) {
                    stores.editor.message?.error?.(t("代码卡片模块加载失败，请联网后重试"));
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
        setSession(null);
        restoreFocus();
    }, [restoreFocus]);

    if (!session || !loadedCodeCardDialog) return null;

    return createElement(loadedCodeCardDialog, {
        mode: session.mode,
        targetId: session.targetId,
        initialCard: session.initialCard,
        onClose: handleClose,
    });
});
