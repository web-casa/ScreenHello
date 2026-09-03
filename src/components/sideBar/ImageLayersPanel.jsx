import { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Tooltip } from 'antd';
import Icon from '@components/Icon';
import useStores from '@stores/useStores';
import { supportImg } from '@utils/utils';
import { prepareWorkspaceImage } from '@utils/imageValidation';
import { browserPlatform } from '../../platform/browserPlatform';

const Action = ({ label, onClick, disabled, children }) => (
    <Tooltip title={label} placement="top" arrow={false}>
        <Button size="small" disabled={disabled} aria-label={label} onClick={onClick}>{children}</Button>
    </Tooltip>
);

export default observer(function ImageLayersPanel() {
    const stores = useStores();
    const input = useRef(null);
    const layers = [...stores.imageStore.list].reverse();
    const selected = new Set(stores.imageStore.selectedIds);
    const selectedLayers = stores.imageStore.selectedList;
    const hasSelection = selectedLayers.length > 0;
    const hasGroup = selectedLayers.some((layer) => layer.groupId);
    const allLocked = hasSelection && selectedLayers.every((layer) => layer.locked);

    const importFiles = async (event) => {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        if (!files.length) return;
        const preparedImages = [];
        let failingName = files[0].name;
        let installed = false;
        try {
            if (stores.imageStore.list.length + files.length > 12) {
                throw Object.assign(new Error('image-layer-limit'), { code: 'image-layer-limit' });
            }
            for (let index = 0; index < files.length; index += 1) {
                const file = files[index];
                failingName = file.name;
                const prepared = await prepareWorkspaceImage(file, {
                    retainObjectUrl: true,
                    role: `image-${index + 1}`,
                });
                preparedImages.push({
                    src: prepared.url,
                    width: prepared.width,
                    height: prepared.height,
                    type: file.type,
                    name: file.name,
                    blob: file,
                    _ownsObjectUrl: true,
                });
            }
            stores.imageStore.addMany(preparedImages, { commit: false });
            installed = true;
            stores.history.commit('image:add');
        } catch (error) {
            const code = `${error?.code || ''} ${error?.message || ''}`;
            stores.editor.message?.error?.(/limit|budget/.test(code)
                ? '图片数量或总像素超过当前项目上限'
                : `无法添加图片“${failingName}”`);
        } finally {
            if (!installed) {
                preparedImages.forEach((image) => browserPlatform.file.revokeObjectURL(image.src));
            }
        }
    };

    const selectLayer = (event, id) => {
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            const ids = new Set(stores.imageStore.selectedIds);
            if (ids.has(id)) ids.delete(id);
            else ids.add(id);
            stores.imageStore.select(Array.from(ids));
        } else {
            stores.imageStore.select([id]);
        }
    };

    return (
        <div className="shoteasy-layer-panel">
            <input ref={input} type="file" hidden multiple accept={supportImg.join(',')} onChange={importFiles} data-testid="add-image-input" />
            <div className="shoteasy-layer-actions is-primary">
                <Button size="small" icon={<Icon.ImagePlus size={14} />} onClick={() => input.current?.click()}>添加图片</Button>
                <Action label="复制图层" disabled={!hasSelection || stores.imageStore.list.length + selectedLayers.length > 12} onClick={() => stores.imageStore.duplicateSelected()}><Icon.Copy size={14} /></Action>
                <Action label="删除图层" disabled={!hasSelection || allLocked} onClick={() => stores.imageStore.removeSelected()}><Icon.Trash2 size={14} /></Action>
            </div>
            <div className="shoteasy-layer-list" aria-label="图片图层">
                {layers.map((layer) => (
                    <button
                        type="button"
                        key={layer.id}
                        className={selected.has(layer.id) ? 'is-selected' : ''}
                        aria-pressed={selected.has(layer.id)}
                        onClick={(event) => selectLayer(event, layer.id)}
                    >
                        <span className="shoteasy-layer-index">{layer.zIndex + 1}</span>
                        <span><strong>{layer.name}</strong><small>{layer.width} × {layer.height}{layer.groupId ? ' · 已编组' : ''}</small></span>
                        <span aria-label={layer.locked ? '已锁定' : '未锁定'}>{layer.locked ? '锁' : ''}</span>
                    </button>
                ))}
            </div>
            <div className="shoteasy-layer-actions">
                <Action label={hasGroup ? '取消编组' : '编组'} disabled={hasGroup ? !hasSelection : selectedLayers.filter((layer) => !layer.locked).length < 2} onClick={() => hasGroup ? stores.imageStore.ungroupSelected() : stores.imageStore.groupSelected()}>{hasGroup ? '解组' : '编组'}</Action>
                <Action label={allLocked ? '解锁图层' : '锁定图层'} disabled={!hasSelection} onClick={() => stores.imageStore.toggleLockSelected()}>{allLocked ? '解锁' : '锁定'}</Action>
                <Action label="上移一层" disabled={!hasSelection} onClick={() => stores.imageStore.reorderSelected('up')}>上移</Action>
                <Action label="下移一层" disabled={!hasSelection} onClick={() => stores.imageStore.reorderSelected('down')}>下移</Action>
            </div>
            <div className="shoteasy-layer-actions is-grid">
                {['left', 'center', 'right', 'top', 'middle', 'bottom'].map((axis) => (
                    <Action key={axis} label={`对齐 ${axis}`} disabled={!hasSelection || allLocked} onClick={() => stores.imageStore.alignSelected(axis)}>
                        {{ left: '左', center: '水平中', right: '右', top: '上', middle: '垂直中', bottom: '下' }[axis]}
                    </Action>
                ))}
                <Action label="水平等间距" disabled={selectedLayers.length < 3 || allLocked} onClick={() => stores.imageStore.distributeSelected('horizontal')}>水平分布</Action>
                <Action label="垂直等间距" disabled={selectedLayers.length < 3 || allLocked} onClick={() => stores.imageStore.distributeSelected('vertical')}>垂直分布</Action>
                <Action label="堆叠布局" disabled={selectedLayers.length < 2 || allLocked} onClick={() => stores.imageStore.stackSelected()}>堆叠</Action>
                <Action label="扇形布局" disabled={selectedLayers.length < 2 || allLocked} onClick={() => stores.imageStore.fanSelected()}>扇形</Action>
            </div>
        </div>
    );
});
