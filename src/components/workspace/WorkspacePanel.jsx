import useI18n from '../../i18n/useI18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Drawer, Empty, Input, Modal, Popconfirm, Tabs, Tag, Tooltip } from 'antd';
import Icon from '@components/Icon';
import useStores from '@stores/useStores';
import {
    PRESET_ARCHIVE_MIME,
    PRESET_EXTENSION,
    PROJECT_ARCHIVE_MIME,
    PROJECT_EXTENSION,
} from '@utils/workspaceFormat';

const formatDate = (value, locale, t) => value
    ? new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value)
    : t('尚未保存');

const formatBytes = (value, t) => {
    if (!Number.isFinite(value)) return t('未知');
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
};

function EmptyList({ description }) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} />;
}

const ItemActions = ({ children }) => <div className="shoteasy-workspace-item__actions">{children}</div>;

export default observer(function WorkspacePanel() {
    const t = useI18n();
    const stores = useStores();
    const workspace = stores.workspace;
    const [open, setOpen] = useState(false);
    const [presetName, setPresetName] = useState(t("我的风格"));
    const [renameTarget, setRenameTarget] = useState(null);
    const [renameValue, setRenameValue] = useState('');
    const projectInput = useRef(null);
    const presetInput = useRef(null);
    const hasImage = Boolean(stores.editor.img?.src);
    const libraryCommand = stores.commands.get('file.openLibrary');

    useEffect(() => {
        if (!open) return;
        void workspace.refreshLibrary();
        void workspace.refreshStorage();
    }, [open, workspace]);

    useLayoutEffect(() => {
        const cleanups = [
            stores.commands.registerUiAction('file.openLibrary', () => { setOpen(true); return true; }),
            stores.commands.registerUiAction('file.selectProjectFile', () => { projectInput.current?.click(); return true; }),
        ];
        return () => cleanups.forEach((cleanup) => cleanup());
    }, [stores]);

    if (!workspace.enabled) return null;

    const onProjectInput = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) await stores.commands.execute('file.openProject', { file });
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
    const libraryTabs = [
        {
            key: 'recent',
            label: t("最近项目"),
            children: (
                <section className="shoteasy-workspace-section">
                    <div className="shoteasy-workspace-heading">
                        <div><span>{t("最近项目")}</span><small>{t("最多显示 12 条，仅保存在此浏览器")}</small></div>
                    </div>
                    {workspace.libraryStatus === 'unavailable'
                        ? <EmptyList description={t("本地项目库不可用；项目文件导入与导出仍可使用")} />
                        : workspace.recentProjects.length === 0 ? <EmptyList description={t("还没有最近项目")} /> : (
                        <div className="shoteasy-workspace-list">
                            {workspace.recentProjects.slice(0, 12).map((item) => {
                                const openRecent = stores.commands.get('file.openRecentProject', { id: item.id });
                                return (
                                    <div className="shoteasy-workspace-item" key={item.id}>
                                        <button
                                            type="button"
                                            disabled={!openRecent.enabled}
                                            title={openRecent.disabledReason || undefined}
                                            onClick={() => { void openRecent.execute(); }}
                                        >
                                            <strong>{item.name}</strong>
                                            <small>{formatDate(item.updatedAt, stores.i18n.locale, t)} · {formatBytes(item.size, t)}</small>
                                        </button>
                                        <ItemActions>
                                            <Popconfirm title={t("移除最近项目记录？")} onConfirm={() => workspace.deleteRecentProject(item.id)}>
                                                <Button type="text" danger size="small" aria-label={t("移除最近项目 {0}", { 0: item.name })} icon={<Icon.Trash2 size={14} />} />
                                            </Popconfirm>
                                        </ItemActions>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    <p className="shoteasy-workspace-note">{t("移除记录不会删除你已经保存到磁盘的 `.screenhello` 项目文件。")}</p>
                </section>
            ),
        },
        {
            key: 'drafts',
            label: t("恢复草稿"),
            children: (
                <section className="shoteasy-workspace-section">
                    <div className="shoteasy-workspace-heading">
                        <div><span>{t("恢复草稿")}</span><small>{t("浏览器可能在空间不足或清理站点数据时删除草稿")}</small></div>
                    </div>
                    {workspace.libraryStatus === 'unavailable'
                        ? <EmptyList description={t("当前无法读取自动草稿")} />
                        : workspace.drafts.length === 0 ? <EmptyList description={t("暂无可恢复草稿")} /> : (
                        <div className="shoteasy-workspace-list">
                            {workspace.drafts.map((item) => (
                                <div className="shoteasy-workspace-item" key={item.key}>
                                    <button type="button" onClick={() => { void stores.commands.openDraft(item.key); }}>
                                        <strong>{item.name || t("自动草稿")}</strong>
                                        <small>{formatDate(item.updatedAt, stores.i18n.locale, t)} · {t('恢复会替换当前工作区')}</small>
                                    </button>
                                    <ItemActions>
                                        <Popconfirm title={t("永久删除这个草稿？")} onConfirm={() => workspace.deleteDraft(item.key)}>
                                            <Button type="text" danger size="small" aria-label={t("删除草稿 {0}", { 0: item.name || item.key })} icon={<Icon.Trash2 size={14} />} />
                                        </Popconfirm>
                                    </ItemActions>
                                </div>
                            ))}
                        </div>
                    )}
                    <p className="shoteasy-workspace-note">{t("草稿是恢复副本，不是长期备份；重要内容请通过“文件 → 保存项目”另存到本地。")}</p>
                </section>
            ),
        },
        {
            key: 'presets',
            label: t("风格预设"),
            children: (
                <section className="shoteasy-workspace-section">
                    <div className="shoteasy-workspace-heading">
                        <div><span>{t("风格预设")}</span><small>{t("包含背景、画布、外框、阴影和导出设置")}</small></div>
                        <Button size="small" onClick={() => presetInput.current?.click()}>{t("导入")}</Button>
                    </div>
                    <div className="shoteasy-workspace-preset-create">
                        <Input value={presetName} maxLength={80} onChange={(event) => setPresetName(event.target.value)} aria-label={t("新预设名称")} />
                        <Button type="primary" disabled={!hasImage} onClick={() => workspace.savePreset(presetName)}>{t("保存当前风格")}</Button>
                    </div>
                    {workspace.presets.length === 0 ? <EmptyList description={t("还没有自定义预设")} /> : (
                        <div className="shoteasy-workspace-list">
                            {workspace.presets.map((item) => (
                                <div className="shoteasy-workspace-item" key={item.id}>
                                    <button type="button" onClick={() => workspace.applyPreset(item.id)} disabled={!hasImage}>
                                        <strong>{item.name}</strong>
                                        <small>{item.hasBackgroundAsset ? t("含本地背景 · ") : ''}{formatDate(item.updatedAt, stores.i18n.locale, t)}</small>
                                    </button>
                                    <ItemActions>
                                        <Button type="text" size="small" aria-label={t("复制预设 {0}", { 0: item.name })} icon={<Icon.Copy size={14} />} onClick={() => workspace.duplicatePreset(item.id)} />
                                        <Button type="text" size="small" aria-label={t("重命名预设 {0}", { 0: item.name })} icon={<Icon.Pencil size={14} />} onClick={() => { setRenameTarget(item); setRenameValue(item.name); }} />
                                        <Button type="text" size="small" aria-label={t("导出预设 {0}", { 0: item.name })} icon={<Icon.Download size={14} />} onClick={() => workspace.exportPreset(item.id)} />
                                        <Popconfirm title={t("删除这个预设？")} onConfirm={() => workspace.deletePreset(item.id)}>
                                            <Button type="text" danger size="small" aria-label={t("删除预设 {0}", { 0: item.name })} icon={<Icon.Trash2 size={14} />} />
                                        </Popconfirm>
                                    </ItemActions>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            ),
        },
        {
            key: 'storage',
            label: t("存储"),
            children: (
                <section className="shoteasy-workspace-section">
                    <div className="shoteasy-workspace-heading">
                        <div><span>{t("本地存储")}</span><small>{t("容量为浏览器估算值")}</small></div>
                        <div className="shoteasy-workspace-status-tags">
                            <Tag color={workspace.libraryStatus === 'unavailable' ? 'red' : undefined}>
                                {workspace.libraryStatus === 'unavailable' ? t("资料库不可用") : t("资料库正常")}
                            </Tag>
                            <Tag>{workspace.storage.persistence === 'granted' ? t("已持久化") : t("可能被清理")}</Tag>
                        </div>
                    </div>
                    <div className="shoteasy-storage-meter" aria-label={t("本地存储使用情况")}>
                        <i style={{ width: `${storagePercent ?? 0}%` }} />
                    </div>
                    <p className="shoteasy-workspace-note">
                        {workspace.storage.supported
                            ? t("已用约 {0} / 可用约 {1}", { 0: formatBytes(workspace.storage.usage, t), 1: formatBytes(workspace.storage.quota, t) })
                            : t("当前浏览器不提供容量估算，项目文件导出仍可正常使用。")}
                    </p>
                    <Button size="small" onClick={() => workspace.requestPersistentStorage()}>{t("请求持久保存")}</Button>
                </section>
            ),
        },
    ];

    return (
        <>
            <Tooltip placement="bottom" arrow={false} title={t("最近项目、草稿、预设与存储")}>
                <Button
                    type="text"
                    className="shoteasy-workspace-trigger"
                    icon={<Icon.Upload size={16} />}
                    onClick={() => { void libraryCommand.execute(); }}
                    aria-label={t("打开本地资料库")}
                >{t("资料库")}</Button>
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
                title={t("本地资料库")}
                placement="left"
                size={560}
                open={open}
                onClose={() => setOpen(false)}
                className="shoteasy-workspace-drawer"
                rootClassName="shoteasy-overlay-drawer"
                styles={{ body: { padding: 0 } }}
            >
                <div className="shoteasy-workspace">
                    <Tabs defaultActiveKey="recent" items={libraryTabs} destroyOnHidden={false} />
                </div>
            </Drawer>
            <Modal
                rootClassName="shoteasy-workspace-modal"
                zIndex={1100}
                title={t("重命名预设")}
                open={Boolean(renameTarget)}
                onOk={renamePreset}
                onCancel={() => setRenameTarget(null)}
                okText={t("保存")}
                cancelText={t("取消")}
                destroyOnHidden
            >
                <Input value={renameValue} maxLength={80} onChange={(event) => setRenameValue(event.target.value)} aria-label={t("预设名称")} />
            </Modal>
        </>
    );
});
