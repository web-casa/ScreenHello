import { EXTERNAL_HELP, openHelpLink } from '../../utils/helpLinks';
import useI18n from '../../i18n/useI18n';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Button, Modal, Select } from 'antd';
import { useId } from 'react';
import { version as packageVersion } from '../../../package.json';
import { NO_CSS_TRANSITION_NAME } from '@components/overlayMotion';
import useStores from '@stores/useStores';
import { PrivacyCounter } from './PrivacyBadge';
import { localeOptions } from '../../i18n/locales';

const CONTENT = (t, desktop = false, openHelp = () => {}) => ({
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
        body: <>
            <p>{desktop
                ? t('桌面版在本机处理图片、项目、草稿与预设，无需云账号。请定期保存 .screenhello 项目文件；清理应用数据可能删除本地恢复副本。')
                : t('图片编辑、项目、草稿和预设均在当前设备与浏览器中处理。ScreenHello 不要求云账号，也不会把图片上传到云端。清除浏览器站点数据可能移除草稿和资料库记录，请定期保存项目文件。')}</p>
            {desktop && <p>{t('Windows 的 WebView2 运行时可能向 Microsoft 发送诊断与安全检查数据；页面计数为零不代表整个应用没有联网，也不代表图片被上传。')}</p>}
            {desktop && <Button onClick={() => void openHelp('help.runtimePrivacy')}>WebView2 · {t('隐私')}</Button>}
            <p><PrivacyCounter /></p>
        </>,
    },
    'help.recovery': {
        title: t('项目恢复与备份'),
        body: <p>{desktop
            ? t('桌面版在本机处理图片、项目、草稿与预设，无需云账号。请定期保存 .screenhello 项目文件；清理应用数据可能删除本地恢复副本。')
            : t('项目文件是你主动保存的可移动备份；自动草稿只是当前浏览器中的恢复副本，可能因空间不足或清理站点数据而消失。重要工作应保存为 `.screenhello` 项目文件。')}</p>,
    },
    'help.about': {
        title: t('关于 ScreenHello'),
        body: <p>ScreenHello {desktop ? 'Desktop' : 'Web'} {packageVersion} · {t('本地优先的截图美化与标注工具')} · MIT License.</p>,
    },
});

export default function HelpCenter({ returnFocus }) {
    const t = useI18n();
    const stores = useStores();
    const languageId = useId();
    const [topic, setTopic] = useState(null);
    const returnTarget = useRef(null);
    const active = useRef(false);
    const openHelp = useCallback(async (id) => {
        const opened = await openHelpLink(stores.platform, id);
        if (!opened && active.current) stores.editor.message?.error?.(t('无法打开系统浏览器，请检查默认浏览器设置。'));
        return opened;
    }, [stores, t]);

    useLayoutEffect(() => {
        active.current = true;
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
        const external = Object.keys(EXTERNAL_HELP).map((id) => (
            stores.commands.registerUiAction(id, () => openHelp(id))
        ));
        return () => {
            active.current = false;
            [...internal, ...external].forEach((cleanup) => cleanup());
        };
    }, [stores, t, openHelp]);

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
    const content = topic ? CONTENT(t, stores.platform?.kind === 'desktop', openHelp)[topic] : null;

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
