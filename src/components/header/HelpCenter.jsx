import useI18n from '../../i18n/useI18n';
import { useLayoutEffect, useRef, useState } from 'react';
import { Button, Modal, Select } from 'antd';
import { useId } from 'react';
import { version as packageVersion } from '../../../package.json';
import { NO_CSS_TRANSITION_NAME } from '@components/overlayMotion';
import useStores from '@stores/useStores';
import { localeOptions } from '../../i18n/locales';

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

const CONTENT = (t) => ({
    'help.quickStart': {
        title: t('快速入门'),
        body: (
            <ol className="shoteasy-help-steps">
                <li><strong>{t('添加图片')}</strong><span>{t('导入截图后，用左右面板调整画布、外框、背景和图层。')}</span></li>
                <li><strong>{t('完成标注')}</strong><span>{t('使用底部工具添加箭头、文字、模糊、马赛克或步骤序号。')}</span></li>
                <li><strong>{t('保存与导出')}</strong><span>{t('保存 `.screenhello` 项目用于继续编辑；导出图片用于分享。')}</span></li>
            </ol>
        ),
    },
    'help.shortcuts': {
        title: t('快捷键列表'),
        body: (
            <dl className="shoteasy-shortcut-list">
                <div><dt>{t('打开 / 保存 / 另存为')}</dt><dd><kbd>Ctrl/⌘ O</kbd> <kbd>Ctrl/⌘ S</kbd> <kbd>Ctrl/⌘ ⇧ S</kbd></dd></div>
                <div><dt>{t('导出面板 / 复制最终图片')}</dt><dd><kbd>Ctrl/⌘ ⇧ E</kbd> <kbd>Ctrl/⌘ C</kbd></dd></div>
                <div><dt>{t('撤销 / 重做 / 删除')}</dt><dd><kbd>Ctrl/⌘ Z</kbd> <kbd>Ctrl/⌘ ⇧ Z</kbd> <kbd>Delete</kbd></dd></div>
                <div><dt>{t('缩放 / 适应画布')}</dt><dd><kbd>Ctrl/⌘ +</kbd> <kbd>Ctrl/⌘ −</kbd> <kbd>Ctrl/⌘ 0</kbd></dd></div>
            </dl>
        ),
    },
    'help.localPrivacy': {
        title: t('本地数据与隐私'),
        body: <p>{t('图片编辑、项目、草稿和预设均在当前设备与浏览器中处理。ScreenHello 不要求云账号，也不会把图片上传到云端。清除浏览器站点数据可能移除草稿和资料库记录，请定期保存项目文件。')}</p>,
    },
    'help.recovery': {
        title: t('项目恢复与备份'),
        body: <p>{t('项目文件是你主动保存的可移动备份；自动草稿只是当前浏览器中的恢复副本，可能因空间不足或清理站点数据而消失。重要工作应保存为 `.screenhello` 项目文件。')}</p>,
    },
    'help.about': {
        title: t('关于 ScreenHello'),
        body: <p>ScreenHello Web {packageVersion} · {t('本地优先的截图美化与标注工具')} · MIT License.</p>,
    },
});

export default function HelpCenter({ returnFocus }) {
    const t = useI18n();
    const stores = useStores();
    const languageId = useId();
    const [topic, setTopic] = useState(null);
    const returnTarget = useRef(null);

    useLayoutEffect(() => {
        const internal = Object.keys(CONTENT(t)).map((id) => (
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
    }, [stores, t]);

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
    const content = topic ? CONTENT(t)[topic] : null;

    if (!content) return null;

    return (
        <Modal
            rootClassName="shoteasy-help-modal"
            zIndex={1100}
            title={content.title}
            open
            onCancel={close}
            transitionName={NO_CSS_TRANSITION_NAME}
            maskTransitionName={NO_CSS_TRANSITION_NAME}
            focusable={{ focusTriggerAfterClose: false }}
            footer={<Button type="primary" data-testid="help-close" onClick={close}>{t("关闭")}</Button>}
        >
            <label htmlFor={languageId}>{t('语言')}</label>
            <Select
                id={languageId}
                value={stores.i18n.locale}
                onChange={(locale) => stores.i18n.setOptions(locale, stores.i18n.messages)}
                options={localeOptions}
                style={{ minWidth: 140, marginInlineStart: 12, marginBottom: 12 }}
            />
            <div className="shoteasy-help-content">{content.body}</div>
        </Modal>
    );
}
