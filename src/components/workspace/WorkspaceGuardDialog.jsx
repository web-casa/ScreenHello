import { useLayoutEffect, useRef } from 'react';
import { Button, Modal } from 'antd';
import { observer } from 'mobx-react-lite';
import { NO_CSS_TRANSITION_NAME } from '@components/overlayMotion';
import useStores from '@stores/useStores';

export default observer(function WorkspaceGuardDialog() {
    const stores = useStores();
    const guard = stores.commands.guard;
    const canSave = stores.imageStore.list.length > 0;
    const returnTarget = useRef(null);

    useLayoutEffect(() => {
        if (guard.open) {
            const activeElement = globalThis.document?.activeElement;
            const HTMLElementConstructor = globalThis.HTMLElement;
            returnTarget.current = typeof HTMLElementConstructor === 'function'
                && activeElement instanceof HTMLElementConstructor
                ? activeElement
                : null;
            return;
        }
        const target = returnTarget.current;
        returnTarget.current = null;
        if (target) requestAnimationFrame(() => {
            if (target.isConnected) target.focus({ preventScroll: true });
        });
    }, [guard.open]);

    if (!guard.open) return null;

    return (
        <Modal
            rootClassName="shoteasy-workspace-guard"
            zIndex={1100}
            title={`${guard.label || '替换当前项目'}？`}
            open
            closable={!guard.busy}
            mask={{ closable: false }}
            transitionName={NO_CSS_TRANSITION_NAME}
            maskTransitionName={NO_CSS_TRANSITION_NAME}
            keyboard={!guard.busy}
            onCancel={() => { void stores.commands.resolveWorkspaceGuard('cancel'); }}
            focusable={{ focusTriggerAfterClose: false }}
            footer={[
                <Button key="cancel" disabled={guard.busy} onClick={() => { void stores.commands.resolveWorkspaceGuard('cancel'); }}>取消</Button>,
                <Button key="discard" danger disabled={guard.busy} onClick={() => { void stores.commands.resolveWorkspaceGuard('discard'); }}>不保存并继续</Button>,
                <Button key="save" type="primary" loading={guard.busy} disabled={!canSave} onClick={() => { void stores.commands.resolveWorkspaceGuard('save'); }}>保存项目并继续</Button>,
            ]}
        >
            <p>此操作会替换当前编辑内容。自动草稿和项目文件是两份独立的本地保存。</p>
            {guard.error ? <p role="status" aria-live="polite" className="text-red-500">{guard.error}</p> : null}
        </Modal>
    );
});
