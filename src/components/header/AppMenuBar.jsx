import { useLayoutEffect, useRef, useState } from 'react';
import { Drawer, Dropdown, Menu, Tabs } from 'antd';
import { observer } from 'mobx-react-lite';
import Icon from '@components/Icon';
import { NO_CSS_MOTION } from '@components/overlayMotion';
import useStores from '@stores/useStores';
import HelpCenter from './HelpCenter';

const MENU_IDS = ['file', 'edit', 'view', 'help'];
const MENU_LABELS = { file: '文件', edit: '编辑', view: '视图', help: '帮助' };

const divider = (key) => ({ key, type: 'divider' });

function focusPopup(popup) {
    const menuSurface = popup?.querySelector('[role="menu"]');
    const focusTarget = popup?.querySelector([
        '[role="menuitem"]:not([aria-disabled="true"])',
        '[role="menuitemcheckbox"]:not([aria-disabled="true"])',
    ].join(','))
        || menuSurface;
    if (menuSurface && focusTarget === menuSurface && !menuSurface.hasAttribute('tabindex')) {
        menuSurface.tabIndex = -1;
    }
    focusTarget?.focus({ preventScroll: true });
}

function CommandLabel({ command }) {
    return (
        <span className="shoteasy-command-label">
            <span className="shoteasy-command-label__copy">
                <span>
                    {command.checked != null && (
                        <span className="shoteasy-command-label__check" aria-hidden="true">
                            {command.checked ? <Icon.Check size={13} /> : null}
                        </span>
                    )}
                    {command.label}
                </span>
                {command.disabledReason && (
                    <small>{command.disabledReason}</small>
                )}
            </span>
            {command.shortcut && <kbd>{command.shortcut}</kbd>}
        </span>
    );
}

export default observer(function AppMenuBar() {
    const stores = useStores();
    const [openMenu, setOpenMenu] = useState(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [mobileSection, setMobileSection] = useState('file');
    const triggerRefs = useRef([]);
    const mobileTriggerRef = useRef(null);
    const helpReturnTargetRef = useRef(null);
    const popupRefs = useRef({});
    const openMenuRef = useRef(null);
    const popupRefCallbacks = useRef(null);
    if (!popupRefCallbacks.current) {
        popupRefCallbacks.current = Object.fromEntries(MENU_IDS.map((menuId) => [menuId, (node) => {
            popupRefs.current[menuId] = node;
            if (node && openMenuRef.current === menuId) focusPopup(node);
        }]));
    }

    useLayoutEffect(() => {
        if (!openMenu) return undefined;
        focusPopup(popupRefs.current[openMenu]);
        return undefined;
    }, [openMenu]);

    if (!stores.workspace.enabled) return null;

    const commandEntries = new Map();
    const commandItem = (id, payload, key = id) => {
        const command = stores.commands.get(id, payload);
        commandEntries.set(key, { command, payload });
        return {
            key,
            disabled: !command.enabled,
            title: command.disabledReason || undefined,
            ...(command.checked == null ? {} : {
                role: 'menuitemcheckbox',
                'aria-checked': command.checked,
            }),
            label: <CommandLabel command={command} />,
        };
    };

    const recentChildren = stores.workspace.libraryStatus === 'loading'
        ? [{ key: 'recent-loading', disabled: true, label: '正在读取本地项目…' }]
        : stores.workspace.libraryStatus === 'unavailable'
            ? [{ key: 'recent-unavailable', disabled: true, label: '本地资料库不可用' }]
            : stores.workspace.recentProjects.slice(0, 12).map((item) => (
                commandItem('file.openRecentProject', { id: item.id }, `recent:${item.id}`)
            ));
    if (!recentChildren.length) recentChildren.push({ key: 'recent-empty', disabled: true, label: '暂无最近项目' });

    const menus = {
        file: [
            commandItem('file.newProject'),
            commandItem('file.openProject'),
            { key: 'recent-projects', label: '最近项目', children: recentChildren },
            divider('file-divider-save'),
            commandItem('file.saveProject'),
            commandItem('file.saveProjectAs'),
            divider('file-divider-images'),
            commandItem('file.addImages'),
            commandItem('file.replaceActiveImage'),
            commandItem('file.captureScreen'),
            divider('file-divider-export'),
            commandItem('file.openExport'),
            commandItem('file.quickExport'),
            commandItem('file.copyFinalImage'),
            divider('file-divider-tools'),
            commandItem('file.openBatch'),
            commandItem('file.openLibrary'),
        ],
        edit: [
            commandItem('edit.undo'),
            commandItem('edit.redo'),
            divider('edit-divider-selection'),
            commandItem('edit.duplicateSelection'),
            commandItem('edit.deleteSelection'),
            commandItem('edit.selectAllImages'),
            divider('edit-divider-groups'),
            commandItem('edit.groupSelection'),
            commandItem('edit.ungroupSelection'),
            commandItem('edit.toggleSelectionLock'),
            divider('edit-divider-reset'),
            commandItem('edit.resetImageStyle'),
        ],
        view: [
            commandItem('view.zoomIn'),
            commandItem('view.zoomOut'),
            commandItem('view.zoom100'),
            commandItem('view.fitCanvas'),
            divider('view-divider-panels'),
            commandItem('view.toggleFramePanel'),
            commandItem('view.toggleInspector'),
            commandItem('view.toggleAnnotationTools'),
            divider('view-divider-theme'),
            commandItem('view.setTheme', { theme: 'light' }, 'view.theme.light'),
            commandItem('view.setTheme', { theme: 'dark' }, 'view.theme.dark'),
        ],
        help: [
            commandItem('help.quickStart'),
            commandItem('help.shortcuts'),
            commandItem('help.localPrivacy'),
            commandItem('help.recovery'),
            divider('help-divider-external'),
            commandItem('help.documentation'),
            commandItem('help.reportIssue'),
            commandItem('help.github'),
            divider('help-divider-about'),
            commandItem('help.about'),
        ],
    };

    const focusTrigger = (index, shouldFocus = true) => {
        const normalized = (index + MENU_IDS.length) % MENU_IDS.length;
        setActiveIndex(normalized);
        if (shouldFocus) triggerRefs.current[normalized]?.focus({ preventScroll: true });
        return normalized;
    };

    const closeAndRestoreFocus = (menuId) => {
        openMenuRef.current = null;
        setOpenMenu(null);
        const index = MENU_IDS.indexOf(menuId);
        if (index >= 0) focusTrigger(index);
    };

    const showMenu = (menuId) => {
        openMenuRef.current = menuId;
        setOpenMenu(menuId);
    };

    const handleTriggerKeyDown = (event, index, menuId) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault();
            const direction = event.key === 'ArrowRight' ? 1 : -1;
            const switchingOpenMenu = Boolean(openMenuRef.current);
            const nextIndex = focusTrigger(index + direction, !switchingOpenMenu);
            if (switchingOpenMenu) showMenu(MENU_IDS[nextIndex]);
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            showMenu(menuId);
            if (menuId === 'file') void stores.workspace.refreshLibrary();
            return;
        }
        if (event.key === 'Escape' && openMenuRef.current) {
            event.preventDefault();
            closeAndRestoreFocus(menuId);
        }
        if (event.key === 'Tab') {
            openMenuRef.current = null;
            setOpenMenu(null);
        }
    };

    const handleMenuKeyDown = (event, index) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeAndRestoreFocus(MENU_IDS[index]);
            return;
        }
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        const activeElement = globalThis.document?.activeElement;
        const submenuTitle = activeElement?.closest?.('.ant-dropdown-menu-submenu-title');
        const submenuPopup = activeElement?.closest?.('.ant-dropdown-menu-submenu-popup');
        if ((event.key === 'ArrowRight' && submenuTitle) || (event.key === 'ArrowLeft' && submenuPopup)) return;
        event.preventDefault();
        event.stopPropagation();
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        const nextIndex = focusTrigger(index + direction, false);
        showMenu(MENU_IDS[nextIndex]);
    };

    const executeItem = async (menuId, key) => {
        const entry = commandEntries.get(key);
        if (!entry) return;
        if (menuId === 'help') helpReturnTargetRef.current = triggerRefs.current[3];
        closeAndRestoreFocus(menuId);
        await entry.command.execute(entry.payload);
    };

    const executeMobileItem = (menuId, key) => {
        const entry = commandEntries.get(key);
        if (!entry) return;
        if (menuId === 'help') helpReturnTargetRef.current = mobileTriggerRef.current;
        setMobileOpen(false);
        requestAnimationFrame(() => {
            mobileTriggerRef.current?.focus({ preventScroll: true });
            const payload = key === 'file.openExport'
                ? { ...entry.payload, returnFocus: mobileTriggerRef.current }
                : entry.payload;
            void entry.command.execute(payload);
        });
    };

    const closeMobileMenu = () => {
        setMobileOpen(false);
        requestAnimationFrame(() => mobileTriggerRef.current?.focus({ preventScroll: true }));
    };

    const mobileTabs = MENU_IDS.map((menuId) => ({
        key: menuId,
        label: MENU_LABELS[menuId],
        children: (
            <Menu
                aria-label={`${MENU_LABELS[menuId]}命令`}
                mode="inline"
                selectable={false}
                items={menus[menuId]}
                onClick={({ key }) => executeMobileItem(menuId, key)}
            />
        ),
    }));

    return (
        <>
            <nav className="shoteasy-app-menu" role="menubar" aria-label="应用菜单">
                {MENU_IDS.map((menuId, index) => (
                    <Dropdown
                        key={menuId}
                        open={openMenu === menuId}
                        destroyOnHidden
                        placement="bottomLeft"
                        trigger={['click']}
                        rootClassName={`shoteasy-command-menu shoteasy-command-menu--${menuId}`}
                        popupRender={(menuNode) => (
                            <div
                                ref={popupRefCallbacks.current[menuId]}
                                className="shoteasy-command-menu__content"
                            >
                                {menuNode}
                            </div>
                        )}
                        menu={{
                            items: menus[menuId],
                            onClick: ({ key }) => { void executeItem(menuId, key); },
                            onKeyDown: (event) => handleMenuKeyDown(event, index),
                        }}
                        onOpenChange={(nextOpen) => {
                            if (nextOpen) {
                                showMenu(menuId);
                                setActiveIndex(index);
                                if (menuId === 'file') void stores.workspace.refreshLibrary();
                            } else if (openMenuRef.current === menuId) {
                                closeAndRestoreFocus(menuId);
                            }
                        }}
                    >
                        <button
                            ref={(node) => { triggerRefs.current[index] = node; }}
                            type="button"
                            role="menuitem"
                            tabIndex={activeIndex === index ? 0 : -1}
                            aria-haspopup="menu"
                            aria-expanded={openMenu === menuId}
                            className="shoteasy-app-menu__trigger"
                            onFocus={() => setActiveIndex(index)}
                            onMouseEnter={() => {
                                if (openMenuRef.current && openMenuRef.current !== menuId) showMenu(menuId);
                            }}
                            onKeyDown={(event) => handleTriggerKeyDown(event, index, menuId)}
                        >
                            {MENU_LABELS[menuId]}
                        </button>
                    </Dropdown>
                ))}
            </nav>
            <button
                ref={mobileTriggerRef}
                type="button"
                className="shoteasy-mobile-menu-trigger"
                aria-label="打开应用菜单"
                aria-haspopup="dialog"
                aria-expanded={mobileOpen}
                onClick={() => {
                    setMobileSection('file');
                    setMobileOpen(true);
                    void stores.workspace.refreshLibrary();
                }}
            >
                菜单
            </button>
            {mobileOpen && (
                <Drawer
                    title="应用菜单"
                    placement="bottom"
                    size="min(78dvh, 680px)"
                    open
                    onClose={closeMobileMenu}
                    motion={NO_CSS_MOTION}
                    maskMotion={NO_CSS_MOTION}
                    keyboard
                    focusable={{ trap: true, focusTriggerAfterClose: false }}
                    rootClassName="shoteasy-mobile-menu-drawer"
                    styles={{ body: { padding: 0 } }}
                >
                    <Tabs
                        activeKey={mobileSection}
                        items={mobileTabs}
                        destroyOnHidden
                        onChange={(menuId) => {
                            setMobileSection(menuId);
                            if (menuId === 'file') void stores.workspace.refreshLibrary();
                        }}
                    />
                </Drawer>
            )}
            <HelpCenter returnFocus={() => (helpReturnTargetRef.current || triggerRefs.current[3])?.focus()} />
        </>
    );
});
