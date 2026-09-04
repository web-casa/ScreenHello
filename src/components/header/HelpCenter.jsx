import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from 'antd';
import { version as packageVersion } from '../../../package.json';
import useStores from '@stores/useStores';

const EXTERNAL_HELP = Object.freeze({
    'help.documentation': 'https://github.com/web-casa/ScreenHello/tree/main/DOCS',
    'help.reportIssue': 'https://github.com/web-casa/ScreenHello/issues',
    'help.github': 'https://github.com/web-casa/ScreenHello',
});

const openExternal = (url) => {
    const documentApi = globalThis.document;
    if (!documentApi?.body) return false;
    const anchor = documentApi.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.style.display = 'none';
    documentApi.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
};

const CONTENT = {
    'help.quickStart': {
        title: '快速入门',
        body: (
            <ol className="shoteasy-help-steps">
                <li><strong>添加图片</strong><span>导入截图后，用左右面板调整画布、外框、背景和图层。</span></li>
                <li><strong>完成标注</strong><span>使用底部工具添加箭头、文字、模糊、马赛克或步骤序号。</span></li>
                <li><strong>保存与导出</strong><span>保存 `.screenhello` 项目用于继续编辑；导出图片用于分享。</span></li>
            </ol>
        ),
    },
    'help.shortcuts': {
        title: '快捷键列表',
        body: (
            <dl className="shoteasy-shortcut-list">
                <div><dt>打开 / 保存 / 另存为</dt><dd><kbd>Ctrl/⌘ O</kbd> <kbd>Ctrl/⌘ S</kbd> <kbd>Ctrl/⌘ ⇧ S</kbd></dd></div>
                <div><dt>导出面板 / 复制最终图片</dt><dd><kbd>Ctrl/⌘ ⇧ E</kbd> <kbd>Ctrl/⌘ C</kbd></dd></div>
                <div><dt>撤销 / 重做 / 删除</dt><dd><kbd>Ctrl/⌘ Z</kbd> <kbd>Ctrl/⌘ ⇧ Z</kbd> <kbd>Delete</kbd></dd></div>
                <div><dt>缩放 / 适应画布</dt><dd><kbd>Ctrl/⌘ +</kbd> <kbd>Ctrl/⌘ −</kbd> <kbd>Ctrl/⌘ 0</kbd></dd></div>
            </dl>
        ),
    },
    'help.localPrivacy': {
        title: '本地数据与隐私',
        body: <p>图片编辑、项目、草稿和预设均在当前设备与浏览器中处理。ScreenHello 不要求云账号，也不会把图片上传到云端。清除浏览器站点数据可能移除草稿和资料库记录，请定期保存项目文件。</p>,
    },
    'help.recovery': {
        title: '项目恢复与备份',
        body: <p>项目文件是你主动保存的可移动备份；自动草稿只是当前浏览器中的恢复副本，可能因空间不足或清理站点数据而消失。重要工作应保存为 `.screenhello` 项目文件。</p>,
    },
    'help.about': {
        title: '关于 ScreenHello',
        body: <p>ScreenHello Web {packageVersion} · 本地优先的截图美化与标注工具 · MIT License。</p>,
    },
};

export default function HelpCenter({ returnFocus }) {
    const stores = useStores();
    const [topic, setTopic] = useState(null);
    const returnTarget = useRef(null);

    useEffect(() => {
        const internal = Object.keys(CONTENT).map((id) => (
            stores.commands.registerUiAction(id, () => {
                const activeElement = globalThis.document?.activeElement;
                const HTMLElementConstructor = globalThis.HTMLElement;
                returnTarget.current = typeof HTMLElementConstructor === 'function'
                    && activeElement instanceof HTMLElementConstructor
                    ? activeElement
                    : null;
                setTopic(id);
                return true;
            })
        ));
        const external = Object.entries(EXTERNAL_HELP).map(([id, url]) => (
            stores.commands.registerUiAction(id, () => openExternal(url))
        ));
        return () => [...internal, ...external].forEach((cleanup) => cleanup());
    }, [stores]);

    const restoreReturnFocus = () => {
        const target = returnTarget.current;
        returnTarget.current = null;
        if (target?.isConnected) target.focus({ preventScroll: true });
        else returnFocus?.();
    };

    const close = () => {
        setTopic(null);
        requestAnimationFrame(restoreReturnFocus);
    };
    const content = topic ? CONTENT[topic] : null;

    if (!content) return null;

    return (
        <Modal
            rootClassName="shoteasy-help-modal"
            zIndex={1100}
            title={content.title}
            open
            onCancel={close}
            focusable={{ focusTriggerAfterClose: false }}
            footer={<Button type="primary" data-testid="help-close" onClick={close}>关闭</Button>}
        >
            <div className="shoteasy-help-content">{content.body}</div>
        </Modal>
    );
}
