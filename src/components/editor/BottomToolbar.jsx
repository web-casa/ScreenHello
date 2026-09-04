import { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Tooltip, Divider, Drawer } from 'antd';
import Icon from '@components/Icon';
import ColorPicker from '@components/ColorPicker';
import { NO_CSS_MOTION } from '@components/overlayMotion';
import { WidthDropdown } from '@components/header/WidthDropdown';
import EmojiSelect from '@components/header/EmojiSelect';
import { nanoid, cn } from '@utils/utils';
import useStores from '@stores/useStores';
import { browserPlatform } from '../../platform/browserPlatform';

const toolList = ['Square', 'SquareFill', 'Circle', 'Slash', 'MoveDownLeft', 'Pencil', 'Magnifier', 'Step', 'text', 'blur', 'mosaic', 'spotlight', 'Smile'];
const primaryTools = ['Square', 'SquareFill', 'Circle', 'Slash', 'MoveDownLeft', 'Pencil'];
const secondaryTools = ['Magnifier', 'Step', 'text', 'blur', 'mosaic', 'spotlight', 'Smile'];
const toolLabels = {
    Square: '矩形',
    SquareFill: '实心矩形',
    Circle: '圆形',
    Slash: '直线',
    MoveDownLeft: '箭头',
    Pencil: '画笔',
    Magnifier: '放大镜',
    Step: '步骤序号',
    text: '文字',
    blur: '模糊',
    mosaic: '马赛克',
    spotlight: '聚光',
    Smile: '表情',
};

// 收起状态持久化到 localStorage：不常用标注的用户可以一直保持收起，刷新后仍是收起态
const TOOLBAR_COLLAPSED_KEY = 'SHOTEASY_BOTTOM_TOOLBAR_COLLAPSED';

const toolIcon = (item, nextStep) => {
    if (item === 'Magnifier') return <Icon.Magnifier size={16} />;
    if (item === 'Step') return <span className="shoteasy-step-badge">{nextStep}</span>;
    if (item === 'text') return <Icon.Type size={16} />;
    if (item === 'blur') return <Icon.Blur size={16} />;
    if (item === 'mosaic') return <Icon.Mosaic size={16} />;
    if (item === 'spotlight') return <Icon.Spotlight size={16} />;
    const IconComp = Icon[item];
    return IconComp ? <IconComp size={16} /> : null;
};

export default observer(function BottomToolbar() {
    const stores = useStores();
    const [isMove, setIsMove] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [moreToolsOpen, setMoreToolsOpen] = useState(false);
    const mobileTriggerRef = useRef(null);
    const [isCollapsed, setIsCollapsed] = useState(() => {
        return browserPlatform.storage.getPreference(TOOLBAR_COLLAPSED_KEY) === '1';
    });
    const toggleCollapsed = () => setIsCollapsed((prev) => {
        browserPlatform.storage.setPreference(TOOLBAR_COLLAPSED_KEY, prev ? '0' : '1');
        return !prev;
    });
    const closeMobileSheet = () => {
        setMobileOpen(false);
        requestAnimationFrame(() => mobileTriggerRef.current?.focus({ preventScroll: true }));
    };
    const selectTool = (type, closeMobile = false) => {
        if (!stores.editor.ensureEditing()) return;
        const { useTool } = stores.editor;
        stores.editor.setUseTool(useTool === type ? null : type);
        setIsMove(false);
        if (type === 'Magnifier' || type === 'blur' || type === 'mosaic') stores.editor.createSnap('init');
        if (closeMobile) closeMobileSheet();
    };
    const handleSelectEmoji = (emoji, closeMobile = false) => {
        if (!stores.editor.ensureEditing()) return;
        const x = stores.option.frameConf.width / 2 - 24;
        const y = stores.option.frameConf.height / 2 - 24;
        stores.editor.setUseTool(null);
        setIsMove(false);
        stores.editor.addShape({
            id: nanoid(),
            type: 'emoji',
            text: emoji,
            zIndex: stores.editor.shapes.size + 1,
            x,
            y,
            editable: true,
        });
        stores.history.commit();
        if (closeMobile) closeMobileSheet();
    };
    const toggleMove = (closeMobile = false) => {
        if (!stores.editor.ensureEditing()) return;
        const is = !isMove;
        stores.editor.setUseTool(null);
        setIsMove(is);
        stores.editor.setMove(is);
        if (closeMobile) closeMobileSheet();
    };

    const renderTool = (item, mobile = false) => {
        const label = toolLabels[item];
        const control = item === 'Smile' ? (
            <EmojiSelect
                key={item}
                disabled={false}
                className="shoteasy-tool-button"
                theme={stores.editor.isDark ? 'dark' : 'light'}
                toSelect={(emoji) => handleSelectEmoji(emoji, mobile)}
            />
        ) : (
            <Button
                key={item}
                type="text"
                shape="circle"
                aria-label={label}
                icon={toolIcon(item, stores.editor.nextStep)}
                className={cn('shoteasy-tool-button', stores.editor.useTool === item && 'is-active')}
                onClick={() => selectTool(item, mobile)}
            />
        );
        if (mobile) {
            return (
                <div className="shoteasy-mobile-tool" key={item}>
                    {control}
                    <span aria-hidden="true">{label}</span>
                </div>
            );
        }
        return (
            <Tooltip key={item} placement="top" arrow={false} title={label}>
                {control}
            </Tooltip>
        );
    };

    return (
        <>
            <div
                className={cn('shoteasy-bottom-toolbar', isCollapsed && 'is-collapsed')}
                role="toolbar"
                aria-label="标注工具"
            >
            <div className="shoteasy-bottom-toolbar__tools">
                {toolList.map((item) => renderTool(item))}
            </div>
            <Divider orientation="vertical" className="shoteasy-toolbar-divider" />
            <div className="shoteasy-bottom-toolbar__controls">
                <ColorPicker
                    aria-label="标注颜色"
                    size="small"
                    placement="top"
                    presets={[{
                        label: '推荐',
                        colors: ['#ffffff', '#444444', '#df4b26', '#1677ff', '#52C41A', '#FA8C16', '#FADB14', '#EB2F96', '#722ED1'],
                    }]}
                    value={stores.editor.annotateColor}
                    onChange={(e) => stores.editor.setAnnotateColor(e.toHexString())}
                />
                <WidthDropdown
                    defaultValue={stores.editor.strokeWidth}
                    onChange={(e) => stores.editor.setStrokeWidth(e)}
                    placement="top"
                />
            </div>
            <Divider orientation="vertical" className="shoteasy-toolbar-divider" />
            <Tooltip placement="top" arrow={false} title="移动 / 拖动">
                <Button
                    type="text"
                    shape="circle"
                    aria-label="移动 / 拖动"
                    className={cn('shoteasy-tool-button', isMove && 'is-active')}
                    icon={<Icon.Hand size={16} />}
                    onClick={toggleMove}
                />
            </Tooltip>
            <Tooltip placement="top" arrow={false} title="收起工具栏">
                <Button
                    type="text"
                    shape="circle"
                    aria-label="收起工具栏"
                    className="shoteasy-tool-button"
                    icon={<Icon.Collapse size={16} />}
                    onClick={toggleCollapsed}
                />
            </Tooltip>
            </div>
            {/* 收起后的左下角入口：与工具栏互斥显隐，切换由 CSS 过渡完成顺滑衔接 */}
            <Tooltip placement="top" arrow={false} title="展开标注工具栏">
                <Button
                    type="text"
                    shape="circle"
                    aria-label="展开标注工具栏"
                    className={cn('shoteasy-bottom-toolbar-collapsed', !isCollapsed && 'is-hidden')}
                    icon={<Icon.Pencil size={16} />}
                    onClick={toggleCollapsed}
                />
            </Tooltip>
            <Button
                ref={mobileTriggerRef}
                type="text"
                shape="circle"
                className={cn('shoteasy-mobile-annotation-trigger', stores.editor.useTool && 'is-active')}
                aria-label={`打开标注工具${stores.editor.useTool ? `，当前${toolLabels[stores.editor.useTool] || stores.editor.useTool}` : ''}`}
                aria-haspopup="dialog"
                aria-expanded={mobileOpen}
                icon={<Icon.Pencil size={18} />}
                onClick={() => setMobileOpen(true)}
            />
            {mobileOpen && (
                <Drawer
                    title="标注工具"
                    placement="bottom"
                    size="min(76dvh, 620px)"
                    open
                    onClose={closeMobileSheet}
                    motion={NO_CSS_MOTION}
                    maskMotion={NO_CSS_MOTION}
                    keyboard
                    focusable={{ trap: true, focusTriggerAfterClose: false }}
                    rootClassName="shoteasy-mobile-annotation-drawer"
                    styles={{ body: { padding: 0 } }}
                >
                    <div className="shoteasy-mobile-annotation-sheet">
                        <section aria-labelledby="shoteasy-mobile-primary-tools">
                            <h3 id="shoteasy-mobile-primary-tools">形状与线条</h3>
                            <div className="shoteasy-mobile-tool-grid">
                                {primaryTools.map((item) => renderTool(item, true))}
                            </div>
                        </section>
                        <details
                            open={moreToolsOpen}
                            onToggle={(event) => setMoreToolsOpen(event.currentTarget.open)}
                        >
                            <summary>更多标注工具</summary>
                            <div className="shoteasy-mobile-tool-grid">
                                {secondaryTools.map((item) => renderTool(item, true))}
                            </div>
                        </details>
                        <section aria-labelledby="shoteasy-mobile-tool-style">
                            <h3 id="shoteasy-mobile-tool-style">样式与画布</h3>
                            <div className="shoteasy-mobile-annotation-settings">
                                <div>
                                    <ColorPicker
                                        aria-label="标注颜色"
                                        size="small"
                                        placement="top"
                                        rootClassName="shoteasy-annotation-popup"
                                        presets={[{
                                            label: '推荐',
                                            colors: ['#ffffff', '#444444', '#df4b26', '#1677ff', '#52C41A', '#FA8C16', '#FADB14', '#EB2F96', '#722ED1'],
                                        }]}
                                        value={stores.editor.annotateColor}
                                        onChange={(color) => stores.editor.setAnnotateColor(color.toHexString())}
                                    />
                                    <span>颜色</span>
                                </div>
                                <div>
                                    <WidthDropdown
                                        defaultValue={stores.editor.strokeWidth}
                                        onChange={(width) => stores.editor.setStrokeWidth(width)}
                                        placement="top"
                                    />
                                    <span>线宽</span>
                                </div>
                                <div>
                                    <Button
                                        type="text"
                                        shape="circle"
                                        aria-label="移动 / 拖动"
                                        className={cn('shoteasy-tool-button', isMove && 'is-active')}
                                        icon={<Icon.Hand size={16} />}
                                        onClick={() => toggleMove(true)}
                                    />
                                    <span>移动</span>
                                </div>
                            </div>
                        </section>
                        <p className="shoteasy-mobile-annotation-hint">选择工具后会回到画布；再次点击当前工具可退出标注。</p>
                    </div>
                </Drawer>
            )}
        </>
    );
});
