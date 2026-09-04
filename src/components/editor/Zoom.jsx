import { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Icon from '@components/Icon';
import { NO_CSS_TRANSITION_NAME } from '@components/overlayMotion';
import { Button, Dropdown, Tooltip } from 'antd';
import useStores from '@stores/useStores';

const items = [
    { key: 0.25, label: '25%' },
    { key: 0.5, label: '50%' },
    { key: 1, label: '100%' },
    { key: 1.5, label: '150%' },
    { key: 2, label: '200%' },
    { key: 3, label: '300%' },
    { key: 5, label: '500%' },
];

const mobileItems = [
    { key: 'in', label: '放大' },
    { key: 'out', label: '缩小' },
    { key: '100', label: '100%' },
    { key: 'fit', label: '适应画布' },
];

export default observer(function Zoom() {
    const stores = useStores();
    const [mobileOpen, setMobileOpen] = useState(false);
    const mobileTriggerRef = useRef(null);
    const setMobileMenuOpen = (open) => {
        setMobileOpen(open);
        if (!open) setTimeout(() => mobileTriggerRef.current?.focus({ preventScroll: true }), 0);
    };
    const handleZoom = (key) => {
        void stores.commands.execute(key === 'in' ? 'view.zoomIn' : 'view.zoomOut');
    };
    const handleMenuClick = (item) => {
        const num = Number(item.key);
        if (num === 4) {
            void stores.commands.execute('view.fitCanvas');
        } else if (num === 1) {
            void stores.commands.execute('view.zoom100');
        } else if (stores.editor.app?.tree) {
            stores.editor.app.tree.zoom(num);
            stores.editor.setScale(stores.editor.app.tree.scale);
        } else {
            stores.editor.setScale(num);
        }
    };
    const handleMobileMenuClick = ({ key }) => {
        const commandId = {
            in: 'view.zoomIn',
            out: 'view.zoomOut',
            100: 'view.zoom100',
            fit: 'view.fitCanvas',
        }[key];
        if (commandId) void stores.commands.execute(commandId);
        setMobileMenuOpen(false);
    };

    return (
        <div className="shoteasy-zoom-controls">
            <div className="shoteasy-zoom-controls__group">
                <Tooltip placement="top" arrow={false} title="放大">
                    <Button type="text" aria-label="放大" icon={<Icon.ZoomIn size={16} />} onClick={() => handleZoom('in')} />
                </Tooltip>
                <Dropdown menu={{ items, onClick: handleMenuClick }} placement="top">
                    <Button type="text" className="shoteasy-zoom-value" aria-label="选择缩放比例">
                        {stores.editor.scale}%
                    </Button>
                </Dropdown>
                <Tooltip placement="top" arrow={false} title="缩小">
                    <Button type="text" aria-label="缩小" icon={<Icon.ZoomOut size={16} />} onClick={() => handleZoom('out')} />
                </Tooltip>
            </div>
            <Tooltip placement="top" arrow={false} title="适应画布">
                <Button
                    type="text"
                    className="shoteasy-zoom-controls__fit"
                    aria-label="适应画布"
                    icon={<Icon.Maximize size={16} />}
                    onClick={() => handleMenuClick({ key: 4 })}
                />
            </Tooltip>
            <Dropdown
                trigger={['click']}
                placement="topRight"
                rootClassName="shoteasy-mobile-zoom-menu"
                open={mobileOpen}
                onOpenChange={setMobileMenuOpen}
                destroyOnHidden
                transitionName={NO_CSS_TRANSITION_NAME}
                menu={{
                    items: mobileItems,
                    onClick: handleMobileMenuClick,
                    'aria-label': '缩放与画布',
                }}
            >
                <Button
                    ref={mobileTriggerRef}
                    type="text"
                    className="shoteasy-mobile-zoom-trigger"
                    aria-label={`打开缩放菜单，当前 ${stores.editor.scale}%`}
                    aria-haspopup="menu"
                    aria-expanded={mobileOpen}
                >
                    {stores.editor.scale}%
                </Button>
            </Dropdown>
        </div>
    );
});
