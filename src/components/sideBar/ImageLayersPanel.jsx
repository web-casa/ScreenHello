import { useLayoutEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Tooltip } from 'antd';
import Icon from '@components/Icon';
import useStores from '@stores/useStores';
import { supportImg } from '@utils/utils';

const Action = ({ label, onClick, disabled, disabledReason, children }) => (
    <Tooltip title={disabled && disabledReason ? `${label}：${disabledReason}` : label} placement="top" arrow={false}>
        <Button
            size="small"
            disabled={disabled}
            aria-label={disabled && disabledReason ? `${label}：${disabledReason}` : label}
            onClick={onClick}
        >{children}</Button>
    </Tooltip>
);

const ORDER_LABELS = Object.freeze({
    top: '移到顶层',
    up: '上移一层',
    down: '下移一层',
    bottom: '移到底层',
});

export default observer(function ImageLayersPanel() {
    const stores = useStores();
    const input = useRef(null);
    const draggingLayer = useRef(null);
    const dropTargetRef = useRef(null);
    const [dropTarget, setDropTarget] = useState(null);
    const [orderAnnouncement, setOrderAnnouncement] = useState('');
    const layers = [...stores.imageStore.list].reverse();
    const selected = new Set(stores.imageStore.selectedIds);
    const selectedLayers = stores.imageStore.selectedList;
    const hasSelection = selectedLayers.length > 0;
    const hasGroup = selectedLayers.some((layer) => layer.groupId);
    const allLocked = hasSelection && selectedLayers.every((layer) => layer.locked);
    const hasLockedSelection = selectedLayers.some((layer) => layer.locked);
    const orderBusy = stores.commands.isBusy;
    const addCommand = stores.commands.get('file.addImages');
    const duplicateCommand = stores.commands.get('edit.duplicateSelection');
    const deleteCommand = stores.commands.get('edit.deleteSelection');
    const groupCommand = stores.commands.get('edit.groupSelection');
    const ungroupCommand = stores.commands.get('edit.ungroupSelection');
    const lockCommand = stores.commands.get('edit.toggleSelectionLock');

    useLayoutEffect(() => stores.commands.registerUiAction('file.selectImages', () => {
        input.current?.click();
        return true;
    }), [stores]);

    const importFiles = async (event) => {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        if (!files.length) return;
        if (stores.workspace.enabled) await stores.commands.execute('file.addImages', { files });
        else await stores.commands.addImages(files);
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

    const disabledOrderReason = (direction) => {
        if (!hasSelection) return '请先选择图层';
        if (hasLockedSelection) return '请先解锁选中图层';
        if (orderBusy) return '正在处理其他本地任务';
        if (!stores.imageStore.canReorderSelected(direction)) return direction === 'up' || direction === 'top'
            ? '已经位于顶层'
            : '已经位于底层';
        return null;
    };

    const reorder = (direction) => {
        const moved = stores.imageStore.reorderSelected(direction);
        if (moved) setOrderAnnouncement(`已${ORDER_LABELS[direction]}：${selectedLayers.length} 个图层`);
        return moved;
    };

    const ensureSelected = (id) => {
        if (!stores.imageStore.selectedIds.includes(id)) stores.imageStore.select([id]);
    };

    const selectedBlockContainsLocked = (id) => stores.imageStore.selectedIds.includes(id)
        && stores.imageStore.selectedList.some((selectedLayer) => selectedLayer.locked);

    const handleLayerKeyDown = (event, layer) => {
        if (!event.altKey) return;
        const direction = {
            ArrowUp: 'up',
            ArrowDown: 'down',
            Home: 'top',
            End: 'bottom',
        }[event.key];
        if (!direction) return;
        event.preventDefault();
        if (orderBusy || layer.locked || selectedBlockContainsLocked(layer.id)) {
            setOrderAnnouncement(`${layer.name}：正在处理任务或选中项含锁定图层，无法调整层级`);
            return;
        }
        ensureSelected(layer.id);
        const moved = stores.imageStore.reorderSelected(direction);
        if (moved) setOrderAnnouncement(`${layer.name}：${ORDER_LABELS[direction]}`);
    };

    const handleDragStart = (event, layer) => {
        if (orderBusy || layer.locked || selectedBlockContainsLocked(layer.id)) {
            event.preventDefault();
            return;
        }
        ensureSelected(layer.id);
        draggingLayer.current = layer.id;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', layer.id);
    };

    const dropPosition = (event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        return event.clientY < bounds.top + bounds.height / 2 ? 'above' : 'below';
    };

    const handleDragOver = (event, targetId) => {
        if (!draggingLayer.current || stores.imageStore.selectedIds.includes(targetId)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const position = dropPosition(event);
        dropTargetRef.current = { id: targetId, position };
        setDropTarget((current) => current?.id === targetId && current.position === position
            ? current
            : { id: targetId, position });
    };

    const clearDrag = () => {
        draggingLayer.current = null;
        dropTargetRef.current = null;
        setDropTarget(null);
    };

    const handleDrop = (event, target) => {
        if (!draggingLayer.current || stores.imageStore.selectedIds.includes(target.id)) {
            clearDrag();
            return;
        }
        event.preventDefault();
        const lastTarget = dropTargetRef.current;
        const position = lastTarget?.id === target.id ? lastTarget.position : dropPosition(event);
        const count = stores.imageStore.selectedIds.length;
        const moved = stores.imageStore.moveSelectedTo(target.id, position);
        if (moved) setOrderAnnouncement(`已将 ${count} 个图层移到“${target.name}”${position === 'above' ? '上方' : '下方'}`);
        clearDrag();
    };

    return (
        <div className="shoteasy-layer-panel">
            <input ref={input} type="file" hidden multiple accept={supportImg.join(',')} onChange={importFiles} data-testid="add-image-input" />
            <div className="shoteasy-layer-actions is-primary">
                <Button
                    size="small"
                    disabled={stores.workspace.enabled ? !addCommand.enabled : (stores.commands.imageBusy || stores.imageStore.list.length >= 12)}
                    icon={<Icon.ImagePlus size={14} />}
                    onClick={() => {
                        if (stores.workspace.enabled) void addCommand.execute();
                        else input.current?.click();
                    }}
                >添加图片</Button>
                <Action label="复制图层" disabled={!duplicateCommand.enabled} onClick={() => { void duplicateCommand.execute(); }}><Icon.Copy size={14} /></Action>
                <Action label="删除图层" disabled={!deleteCommand.enabled} onClick={() => { void deleteCommand.execute(); }}><Icon.Trash2 size={14} /></Action>
            </div>
            <div className="shoteasy-layer-summary" role="status" aria-live="polite">
                <strong>已选 {selectedLayers.length} / 共 {layers.length} 层</strong>
                <span>{hasLockedSelection ? '选中项含锁定图层' : '拖动可排序'}</span>
            </div>
            <div className="shoteasy-layer-list" role="list" aria-label="图片图层" aria-describedby={`${stores.id}-layer-order-help`}>
                {layers.map((layer) => {
                    const resource = stores.imageStore.resolve(layer);
                    const indicator = dropTarget?.id === layer.id ? `is-drop-${dropTarget.position}` : '';
                    return (
                    <div
                        key={layer.id}
                        role="listitem"
                        draggable={!orderBusy && !layer.locked && !selectedBlockContainsLocked(layer.id)}
                        data-layer-name={layer.name}
                        className={`shoteasy-layer-row ${selected.has(layer.id) ? 'is-selected' : ''} ${indicator}`.trim()}
                        onDragStart={(event) => handleDragStart(event, layer)}
                        onDragOver={(event) => handleDragOver(event, layer.id)}
                        onDrop={(event) => handleDrop(event, layer)}
                        onDragEnd={clearDrag}
                    >
                        <button
                            type="button"
                            aria-pressed={selected.has(layer.id)}
                            onClick={(event) => selectLayer(event, layer.id)}
                            onKeyDown={(event) => handleLayerKeyDown(event, layer)}
                        >
                            <span className="shoteasy-layer-drag" aria-hidden="true"><Icon.Hand size={13} /></span>
                            <span className="shoteasy-layer-thumb" aria-hidden="true">
                                {resource?.src ? <img src={resource.src} alt="" draggable={false} /> : <Icon.ImagePlus size={14} />}
                            </span>
                            <span className="shoteasy-layer-copy"><strong>{layer.name}</strong><small>{layer.width} × {layer.height}</small></span>
                            <span className="shoteasy-layer-state">
                                <small>{layer.groupId ? '组' : ''}</small>
                                <small aria-label={layer.locked ? '已锁定' : '未锁定'}>{layer.locked ? '锁' : ''}</small>
                            </span>
                            <span className="shoteasy-layer-index">{layer.zIndex + 1}</span>
                        </button>
                    </div>
                );})}
            </div>
            <p id={`${stores.id}-layer-order-help`} className="shoteasy-layer-order-help">拖动图层调整层级；也可使用下方按钮，或在图层上按 Alt + 方向键。</p>
            <span className="sr-only" role="status" aria-live="polite">{orderAnnouncement}</span>
            <div className="shoteasy-layer-actions">
                <Action label={hasGroup ? '取消编组' : '编组'} disabled={hasGroup ? !ungroupCommand.enabled : !groupCommand.enabled} onClick={() => { void (hasGroup ? ungroupCommand.execute() : groupCommand.execute()); }}>{hasGroup ? '解组' : '编组'}</Action>
                <Action label={allLocked ? '解锁图层' : '锁定图层'} disabled={!lockCommand.enabled} onClick={() => { void lockCommand.execute(); }}>{allLocked ? '解锁' : '锁定'}</Action>
            </div>
            <div className="shoteasy-layer-actions is-order">
                {['top', 'up', 'down', 'bottom'].map((direction) => {
                    const disabledReason = disabledOrderReason(direction);
                    return (
                        <Action
                            key={direction}
                            label={ORDER_LABELS[direction]}
                            disabled={Boolean(disabledReason)}
                            disabledReason={disabledReason}
                            onClick={() => reorder(direction)}
                        >
                            {{ top: '置顶', up: '上移', down: '下移', bottom: '置底' }[direction]}
                        </Action>
                    );
                })}
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
