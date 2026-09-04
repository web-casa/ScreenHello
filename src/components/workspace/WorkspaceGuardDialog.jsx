import { Button, Modal } from 'antd';
import { observer } from 'mobx-react-lite';
import useStores from '@stores/useStores';

export default observer(function WorkspaceGuardDialog() {
    const stores = useStores();
    const guard = stores.commands.guard;
    const canSave = stores.imageStore.list.length > 0;

    return (
        <Modal
            rootClassName="shoteasy-workspace-guard"
            zIndex={1100}
            title={`${guard.label || '替换当前项目'}？`}
            open={guard.open}
            closable={!guard.busy}
            mask={{ closable: false }}
            keyboard={!guard.busy}
            onCancel={() => { void stores.commands.resolveWorkspaceGuard('cancel'); }}
            footer={[
                <Button key="cancel" disabled={guard.busy} onClick={() => { void stores.commands.resolveWorkspaceGuard('cancel'); }}>取消</Button>,
                <Button key="discard" danger disabled={guard.busy} onClick={() => { void stores.commands.resolveWorkspaceGuard('discard'); }}>不保存并继续</Button>,
                <Button key="save" type="primary" loading={guard.busy} disabled={!canSave} onClick={() => { void stores.commands.resolveWorkspaceGuard('save'); }}>保存项目并继续</Button>,
            ]}
            destroyOnHidden
        >
            <p>此操作会替换当前编辑内容。自动草稿和项目文件是两份独立的本地保存。</p>
            {guard.error ? <p role="status" aria-live="polite" className="text-red-500">{guard.error}</p> : null}
        </Modal>
    );
});
