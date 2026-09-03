import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Drawer, Empty, Input, Modal, Popconfirm, Tag, Tooltip } from 'antd';
import Icon from '@components/Icon';
import useStores from '@stores/useStores';
import { browserPlatform } from '../../platform/browserPlatform';
import {
    PRESET_ARCHIVE_MIME,
    PRESET_EXTENSION,
    PROJECT_ARCHIVE_MIME,
    PROJECT_EXTENSION,
} from '@utils/workspaceFormat';
import { getFrameDefinition } from '@utils/frameConfig';

const formatDate = (value) => value
    ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value)
    : '尚未保存';

const formatBytes = (value) => {
    if (!Number.isFinite(value)) return '未知';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
};

function EmptyList({ description }) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} />;
}

const ItemActions = ({ children }) => <div className="shoteasy-workspace-item__actions">{children}</div>;

export default observer(function WorkspacePanel() {
    const stores = useStores();
    const workspace = stores.workspace;
    const [open, setOpen] = useState(false);
    const [presetName, setPresetName] = useState('我的风格');
    const [renameTarget, setRenameTarget] = useState(null);
    const [renameValue, setRenameValue] = useState('');
    const projectInput = useRef(null);
    const presetInput = useRef(null);
    const [modal, modalHolder] = Modal.useModal();
    const hasImage = Boolean(stores.editor.img?.src);

    useEffect(() => {
        if (!open) return;
        void workspace.refreshLibrary();
        void workspace.refreshStorage();
    }, [open, workspace]);

    if (!workspace.enabled) return null;

    const withDiscardConfirmation = (action) => {
        if (!workspace.isDirty) {
            void action();
            return;
        }
        modal.confirm({
            title: '放弃未保存的更改？',
            content: '打开其他项目会替换当前编辑内容。建议先保存项目文件。',
            okText: '继续打开',
            cancelText: '取消',
            onOk: action,
        });
    };

    const openProject = () => withDiscardConfirmation(async () => {
        if (browserPlatform.file.supportsFileSystemAccess()) {
            await workspace.openProjectPicker();
        } else {
            projectInput.current?.click();
        }
    });

    const onProjectInput = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) await workspace.openProjectFile(file);
    };

    const onPresetInput = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) await workspace.importPresetFile(file);
    };

    const renamePreset = async () => {
        if (!renameTarget) return;
        await workspace.renamePreset(renameTarget.id, renameValue);
        setRenameTarget(null);
    };

    const storagePercent = workspace.storage.usage != null && workspace.storage.quota
        ? Math.min(100, workspace.storage.usage / workspace.storage.quota * 100)
        : null;
    const suggestion = workspace.suggestions.result;

    return (
        <>
            {modalHolder}
            <Tooltip placement="bottom" arrow={false} title="项目、预设与草稿">
                <Button
                    type="text"
                    className="shoteasy-workspace-trigger"
                    icon={<Icon.Upload size={16} />}
                    onClick={() => setOpen(true)}
                    aria-label="打开项目中心"
                >项目</Button>
            </Tooltip>
            <input
                ref={projectInput}
                data-testid="project-file-input"
                hidden
                type="file"
                accept={`${PROJECT_EXTENSION},application/zip,${PROJECT_ARCHIVE_MIME}`}
                onChange={onProjectInput}
            />
            <input
                ref={presetInput}
                data-testid="preset-file-input"
                hidden
                type="file"
                accept={`${PRESET_EXTENSION},application/zip,${PRESET_ARCHIVE_MIME}`}
                onChange={onPresetInput}
            />
            <Drawer
                title="项目中心"
                placement="left"
                size={480}
                open={open}
                onClose={() => setOpen(false)}
                className="shoteasy-workspace-drawer"
                styles={{ body: { padding: 0 } }}
            >
                <div className="shoteasy-workspace">
                    <section className="shoteasy-workspace-section is-project">
                        <div className="shoteasy-workspace-heading">
                            <div>
                                <span>当前项目</span>
                                <small>{workspace.isDirty ? '有未保存更改' : `已同步 · ${formatDate(workspace.lastSavedAt)}`}</small>
                            </div>
                            <Tag color={workspace.isDirty ? 'gold' : 'green'}>{workspace.isDirty ? '未保存' : '已保存'}</Tag>
                        </div>
                        <Input
                            value={workspace.projectName}
                            onChange={(event) => workspace.setProjectName(event.target.value)}
                            maxLength={80}
                            aria-label="项目名称"
                        />
                        <div className="shoteasy-workspace-actions">
                            <Button icon={<Icon.Upload size={16} />} onClick={openProject}>打开项目</Button>
                            <Button
                                type="primary"
                                icon={<Icon.Download size={16} />}
                                disabled={!hasImage}
                                loading={workspace.busy === 'save'}
                                onClick={() => workspace.saveProject()}
                            >保存</Button>
                            <Button
                                disabled={!hasImage}
                                loading={workspace.busy === 'save-as'}
                                onClick={() => workspace.saveProject({ saveAs: true })}
                            >另存为</Button>
                        </div>
                        <p className="shoteasy-workspace-note">
                            {browserPlatform.file.supportsFileSystemAccess()
                                ? '当前浏览器可直接写入本地项目文件；Firefox/Safari 会自动使用下载备份。'
                                : '当前浏览器使用下载方式保存；导出的项目文件包含原图与背景，可稍后重新打开。'}
                        </p>
                    </section>

                    <section className="shoteasy-workspace-section">
                        <div className="shoteasy-workspace-heading">
                            <div><span>智能建议</span><small>只在本机采样图片边缘，不上传图片</small></div>
                            {workspace.suggestions.status === 'analyzing' && <Tag color="blue">分析中</Tag>}
                        </div>
                        {suggestion ? (
                            <div className="shoteasy-suggestion-grid">
                                <button type="button" onClick={() => workspace.applySuggestion('background')}>
                                    <i className="shoteasy-color-swatch" style={{ background: suggestion.edgeColor }} />
                                    <span><strong>边缘色背景</strong><small>{suggestion.edgeColor}</small></span>
                                </button>
                                <button type="button" onClick={() => workspace.applySuggestion('inner-border')}>
                                    <i className="shoteasy-border-swatch" style={{ borderColor: suggestion.innerBorder.color }} />
                                    <span><strong>内描边</strong><small>{suggestion.innerBorder.color}</small></span>
                                </button>
                                <button type="button" onClick={() => workspace.applySuggestion('frame')}>
                                    <Icon.Box size={18} />
                                    <span><strong>{suggestion.orientation === 'landscape' ? '横图外框' : (suggestion.orientation === 'portrait' ? '竖图外框' : '方图外框')}</strong><small>{getFrameDefinition(suggestion.frame).title}</small></span>
                                </button>
                            </div>
                        ) : (
                            <p className="shoteasy-workspace-note">
                                {hasImage && workspace.suggestions.status === 'unavailable'
                                    ? '当前图片无法读取颜色数据；编辑与保存不受影响。'
                                    : (hasImage ? '正在生成可选样式建议…' : '添加图片后会在这里提供边缘色、内描边和外框建议。')}
                            </p>
                        )}
                    </section>

                    <section className="shoteasy-workspace-section">
                        <div className="shoteasy-workspace-heading">
                            <div><span>最近项目</span><small>仅保存在此浏览器</small></div>
                        </div>
                        {workspace.libraryStatus === 'unavailable'
                            ? <EmptyList description="本地项目库不可用；项目文件导入与导出仍可使用" />
                            : workspace.recentProjects.length === 0 ? <EmptyList description="还没有最近项目" /> : (
                            <div className="shoteasy-workspace-list">
                                {workspace.recentProjects.map((item) => (
                                    <div className="shoteasy-workspace-item" key={item.id}>
                                        <button type="button" onClick={() => withDiscardConfirmation(() => workspace.openRecentProject(item.id))}>
                                            <strong>{item.name}</strong>
                                            <small>{formatDate(item.updatedAt)} · {formatBytes(item.size)}</small>
                                        </button>
                                        <ItemActions>
                                            <Popconfirm title="移除最近项目记录？" onConfirm={() => workspace.deleteRecentProject(item.id)}>
                                                <Button type="text" danger size="small" aria-label={`移除最近项目 ${item.name}`} icon={<Icon.Trash2 size={14} />} />
                                            </Popconfirm>
                                        </ItemActions>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    <section className="shoteasy-workspace-section">
                        <div className="shoteasy-workspace-heading">
                            <div><span>自动草稿</span><small>浏览器可能在空间不足时清理，请导出项目备份</small></div>
                        </div>
                        {workspace.libraryStatus === 'unavailable'
                            ? <EmptyList description="当前无法读取自动草稿" />
                            : workspace.drafts.length === 0 ? <EmptyList description="暂无可恢复草稿" /> : (
                            <div className="shoteasy-workspace-list">
                                {workspace.drafts.map((item) => (
                                    <div className="shoteasy-workspace-item" key={item.key}>
                                        <button type="button" onClick={() => withDiscardConfirmation(() => workspace.openDraft(item.key))}>
                                            <strong>{item.name || '自动草稿'}</strong>
                                            <small>{formatDate(item.updatedAt)}</small>
                                        </button>
                                        <ItemActions>
                                            <Popconfirm title="永久删除这个草稿？" onConfirm={() => workspace.deleteDraft(item.key)}>
                                                <Button type="text" danger size="small" aria-label={`删除草稿 ${item.name || item.key}`} icon={<Icon.Trash2 size={14} />} />
                                            </Popconfirm>
                                        </ItemActions>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    <section className="shoteasy-workspace-section">
                        <div className="shoteasy-workspace-heading">
                            <div><span>风格预设</span><small>包含背景、画布、外框、阴影和导出设置</small></div>
                            <Button size="small" onClick={() => presetInput.current?.click()}>导入</Button>
                        </div>
                        <div className="shoteasy-workspace-preset-create">
                            <Input value={presetName} maxLength={80} onChange={(event) => setPresetName(event.target.value)} aria-label="新预设名称" />
                            <Button type="primary" disabled={!hasImage} onClick={() => workspace.savePreset(presetName)}>保存当前风格</Button>
                        </div>
                        {workspace.presets.length === 0 ? <EmptyList description="还没有自定义预设" /> : (
                            <div className="shoteasy-workspace-list">
                                {workspace.presets.map((item) => (
                                    <div className="shoteasy-workspace-item" key={item.id}>
                                        <button type="button" onClick={() => workspace.applyPreset(item.id)} disabled={!hasImage}>
                                            <strong>{item.name}</strong>
                                            <small>{item.hasBackgroundAsset ? '含本地背景 · ' : ''}{formatDate(item.updatedAt)}</small>
                                        </button>
                                        <ItemActions>
                                            <Button type="text" size="small" aria-label={`复制预设 ${item.name}`} icon={<Icon.Copy size={14} />} onClick={() => workspace.duplicatePreset(item.id)} />
                                            <Button type="text" size="small" aria-label={`重命名预设 ${item.name}`} icon={<Icon.Pencil size={14} />} onClick={() => { setRenameTarget(item); setRenameValue(item.name); }} />
                                            <Button type="text" size="small" aria-label={`导出预设 ${item.name}`} icon={<Icon.Download size={14} />} onClick={() => workspace.exportPreset(item.id)} />
                                            <Popconfirm title="删除这个预设？" onConfirm={() => workspace.deletePreset(item.id)}>
                                                <Button type="text" danger size="small" aria-label={`删除预设 ${item.name}`} icon={<Icon.Trash2 size={14} />} />
                                            </Popconfirm>
                                        </ItemActions>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    <section className="shoteasy-workspace-section">
                        <div className="shoteasy-workspace-heading">
                            <div><span>本地存储</span><small>容量为浏览器估算值</small></div>
                            <div className="shoteasy-workspace-status-tags">
                                <Tag color={workspace.libraryStatus === 'unavailable' ? 'red' : undefined}>
                                    {workspace.libraryStatus === 'unavailable' ? '项目库不可用' : '项目库正常'}
                                </Tag>
                                <Tag>{workspace.storage.persistence === 'granted' ? '已持久化' : '可能被清理'}</Tag>
                            </div>
                        </div>
                        <div className="shoteasy-storage-meter" aria-label="本地存储使用情况">
                            <i style={{ width: `${storagePercent ?? 0}%` }} />
                        </div>
                        <p className="shoteasy-workspace-note">
                            {workspace.storage.supported
                                ? `已用约 ${formatBytes(workspace.storage.usage)} / 可用约 ${formatBytes(workspace.storage.quota)}`
                                : '当前浏览器不提供容量估算，项目文件导出仍可正常使用。'}
                        </p>
                        <Button size="small" onClick={() => workspace.requestPersistentStorage()}>请求持久保存</Button>
                    </section>
                </div>
            </Drawer>
            <Modal
                title="重命名预设"
                open={Boolean(renameTarget)}
                onOk={renamePreset}
                onCancel={() => setRenameTarget(null)}
                okText="保存"
                cancelText="取消"
                destroyOnHidden
            >
                <Input value={renameValue} maxLength={80} onChange={(event) => setRenameValue(event.target.value)} aria-label="预设名称" />
            </Modal>
        </>
    );
});
