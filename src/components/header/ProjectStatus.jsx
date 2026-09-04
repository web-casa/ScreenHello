import { useState } from 'react';
import { Input, Popover, Tag } from 'antd';
import { observer } from 'mobx-react-lite';
import useStores from '@stores/useStores';

const projectStatusLabel = {
    'never-saved': '项目文件从未保存',
    dirty: '项目文件有未保存更改',
    saving: '正在保存项目文件',
    saved: '项目文件已保存',
    error: '项目文件保存失败',
};

const draftStatusLabel = {
    idle: '尚无自动草稿',
    waiting: '自动草稿等待保存',
    saving: '正在保存本地草稿',
    saved: '草稿已保存到本机',
    error: '草稿保存失败，请导出项目备份',
    unavailable: '草稿不可用，请导出项目备份',
};

export default observer(function ProjectStatus() {
    const stores = useStores();
    const [open, setOpen] = useState(false);
    if (!stores.workspace.enabled) return null;

    const projectStatus = stores.workspace.projectFileStatus;
    const draftStatus = stores.draftService.status;
    const projectLabel = projectStatusLabel[projectStatus] || projectStatus;
    const draftLabel = draftStatusLabel[draftStatus] || draftStatus;
    const dirtyMark = stores.workspace.isDirty ? '*' : '';
    const content = (
        <div className="shoteasy-project-popover">
            <label htmlFor={`${stores.id}-project-name`}>项目名称</label>
            <Input
                id={`${stores.id}-project-name`}
                value={stores.workspace.projectName}
                maxLength={80}
                onChange={(event) => stores.workspace.setProjectName(event.target.value)}
            />
            <div className="shoteasy-project-popover__statuses">
                <Tag color={projectStatus === 'error' ? 'red' : (projectStatus === 'dirty' ? 'gold' : (projectStatus === 'saved' ? 'green' : undefined))}>{projectLabel}</Tag>
                <Tag color={['error', 'unavailable'].includes(draftStatus) ? 'red' : (draftStatus === 'saved' ? 'green' : undefined)}>{draftLabel}</Tag>
            </div>
            <p>项目文件需要主动保存；自动草稿只保留在此浏览器中。</p>
        </div>
    );

    return (
        <Popover
            content={content}
            trigger="click"
            open={open}
            onOpenChange={setOpen}
            placement="bottom"
            arrow={false}
            rootClassName="shoteasy-project-status-popover"
        >
            <button
                type="button"
                className="shoteasy-project-status"
                aria-label={`项目：${stores.workspace.projectName}${dirtyMark}；${projectLabel}；${draftLabel}`}
            >
                <strong>{stores.workspace.projectName}{dirtyMark}</strong>
                <span role="status" aria-live="polite">{projectLabel} · {draftLabel}</span>
            </button>
        </Popover>
    );
});
