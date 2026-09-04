import { useLayoutEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Tooltip, Divider, Drawer } from 'antd';
import Icon from '@components/Icon';
import useStores from '@stores/useStores';
import DownloadBar from '@components/sideBar/DownloadBar';
import { LeftRailContent } from '@components/sideBar/LeftRail';
import { InspectorContent } from '@components/sideBar/RightInspector';
import Logo from './Logo';
import MediaLogo from './MediaLogo';
import WorkspacePanel from '@components/workspace/WorkspacePanel';
import AppMenuBar from './AppMenuBar';
import ProjectStatus from './ProjectStatus';

export default observer(function TopBar({ headLeft, headRight }) {
    const stores = useStores();
    const [compactPanels, setCompactPanels] = useState(() => (
        globalThis.matchMedia?.('(max-width: 1023px)')?.matches || false
    ));
    const compactTransition = useRef({ active: null, desktopFrame: true, desktopInspector: true });
    const undo = stores.commands.get('edit.undo');
    const redo = stores.commands.get('edit.redo');
    const resetStyle = stores.commands.get('edit.resetImageStyle');

    const handleSetTheme = () => {
        void stores.commands.execute('view.setTheme');
    };

    useLayoutEffect(() => {
        const media = globalThis.matchMedia?.('(max-width: 1023px)');
        if (!media) return undefined;
        const sync = () => {
            const nextCompact = media.matches;
            setCompactPanels(nextCompact);
            if (nextCompact && compactTransition.current.active !== true) {
                compactTransition.current.desktopFrame = stores.commands.framePanelVisible;
                compactTransition.current.desktopInspector = stores.commands.inspectorVisible;
                stores.commands.setPanelVisibility('frame', false);
                stores.commands.setPanelVisibility('inspector', false);
            } else if (!nextCompact && compactTransition.current.active === true) {
                stores.commands.setPanelVisibility('frame', compactTransition.current.desktopFrame);
                stores.commands.setPanelVisibility('inspector', compactTransition.current.desktopInspector);
            }
            compactTransition.current.active = nextCompact;
        };
        sync();
        media.addEventListener?.('change', sync);
        return () => media.removeEventListener?.('change', sync);
    }, [stores]);

    return (
        <div className={`shoteasy-topbar select-none${stores.workspace.enabled ? ' is-workspace' : ''}`}>
            <div className="shoteasy-topbar__brand">
                {headLeft || <Logo />}
            </div>

            <Divider orientation="vertical" className="shoteasy-topbar__divider" />

            <AppMenuBar />

            {!stores.workspace.enabled && <div className="shoteasy-history" aria-label="历史操作">
                <Tooltip placement="bottom" arrow={false} title="撤销">
                    <Button
                        type="text"
                        shape="circle"
                        className="shoteasy-icon-button"
                        aria-label="撤销"
                        disabled={!undo.enabled}
                        icon={<Icon.Undo2 size={16} />}
                        onClick={() => { void undo.execute(); }}
                    />
                </Tooltip>
                <Tooltip placement="bottom" arrow={false} title="重做">
                    <Button
                        type="text"
                        shape="circle"
                        className="shoteasy-icon-button"
                        aria-label="重做"
                        disabled={!redo.enabled}
                        icon={<Icon.Redo2 size={16} />}
                        onClick={() => { void redo.execute(); }}
                    />
                </Tooltip>
                <Tooltip placement="bottom" arrow={false} title="重置图片样式">
                    <Button
                        type="text"
                        shape="circle"
                        className="shoteasy-icon-button"
                        aria-label="重置图片样式"
                        disabled={!resetStyle.enabled}
                        icon={<Icon.RotateCcw size={16} />}
                        onClick={() => { void resetStyle.execute(); }}
                    />
                </Tooltip>
            </div>}

            <div className="shoteasy-mobile-actions">
                <Divider orientation="vertical" className="shoteasy-topbar__divider" />
                <Tooltip placement="bottom" arrow={false} title="尺寸与外框">
                    <Button
                        type="text"
                        shape="circle"
                        className="shoteasy-icon-button"
                        aria-label="打开尺寸与外框"
                        aria-pressed={compactPanels && stores.commands.framePanelVisible}
                        icon={<Icon.LayoutGrid size={16} />}
                        onClick={() => stores.commands.setPanelVisibility('frame', true)}
                    />
                </Tooltip>
                <Tooltip placement="bottom" arrow={false} title="检查器">
                    <Button
                        type="text"
                        shape="circle"
                        className="shoteasy-icon-button"
                        aria-label="打开检查器"
                        aria-pressed={compactPanels && stores.commands.inspectorVisible}
                        icon={<Icon.Settings2 size={16} />}
                        onClick={() => stores.commands.setPanelVisibility('inspector', true)}
                    />
                </Tooltip>
            </div>

            <div className="shoteasy-topbar__spacer" />
            <ProjectStatus />
            <WorkspacePanel />
            <DownloadBar />
            {(headRight || !stores.workspace.enabled) && (
                <>
                    <Divider orientation="vertical" className="shoteasy-topbar__divider shoteasy-topbar__divider--meta" />
                    <div className="shoteasy-topbar__meta">
                        {headRight || (
                            <MediaLogo>
                                <Tooltip placement="bottom" arrow={false} title="切换主题">
                                    <Button
                                        type="text"
                                        shape="circle"
                                        className="shoteasy-icon-button"
                                        aria-label="切换主题"
                                        icon={stores.editor.isDark ? <Icon.Moon size={16} /> : <Icon.Sun size={16} />}
                                        onClick={handleSetTheme}
                                    />
                                </Tooltip>
                            </MediaLogo>
                        )}
                    </div>
                </>
            )}

            <Drawer
                title="尺寸与外框"
                placement="left"
                open={compactPanels && stores.commands.framePanelVisible}
                onClose={() => stores.commands.setPanelVisibility('frame', false)}
                size={300}
                rootClassName="shoteasy-compact-panel-drawer"
                styles={{ body: { padding: 12 } }}
            >
                <div className="relative h-full">
                    <LeftRailContent />
                </div>
            </Drawer>
            <Drawer
                title="检查器"
                placement="right"
                open={compactPanels && stores.commands.inspectorVisible}
                onClose={() => stores.commands.setPanelVisibility('inspector', false)}
                size={340}
                rootClassName="shoteasy-compact-panel-drawer"
                styles={{ body: { padding: 0 } }}
            >
                <InspectorContent />
            </Drawer>
        </div>
    );
});
