import { observer } from 'mobx-react-lite';
import { useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button, Dropdown } from 'antd';
import Icon from '@components/Icon';
import { NO_CSS_TRANSITION_NAME } from '@components/overlayMotion';
import useStores from '@stores/useStores';
import useI18n from '../../i18n/useI18n';
import { localeOptions } from '../../i18n/locales';

const IRIS_CLASS = 'shoteasy-theme-transition';
let irisRuns = 0;

// The standalone site opens the new theme from the toggle like an iris. An embedded
// editor never animates the host document, and reduced motion switches instantly.
const switchThemeFrom = (trigger, stores) => {
    const apply = () => stores.commands.execute('view.setTheme');
    const doc = trigger.ownerDocument;
    const view = doc.defaultView;
    if (!stores.workspace.enabled || typeof doc.startViewTransition !== 'function'
        || view.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        void apply();
        return;
    }
    const root = doc.documentElement;
    const box = trigger.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    root.style.setProperty('--se-iris-x', `${x}px`);
    root.style.setProperty('--se-iris-y', `${y}px`);
    root.style.setProperty('--se-iris-r', `${Math.hypot(Math.max(x, view.innerWidth - x), Math.max(y, view.innerHeight - y))}px`);
    root.classList.add(IRIS_CLASS);
    irisRuns += 1;
    const transition = doc.startViewTransition(async () => {
        await apply();
        flushSync(() => {});
    });
    transition.finished.catch(() => {}).finally(() => {
        // A quick second toggle supersedes the first; only the last one cleans up.
        irisRuns -= 1;
        if (irisRuns > 0) return;
        root.classList.remove(IRIS_CLASS);
        for (const name of ['--se-iris-x', '--se-iris-y', '--se-iris-r']) root.style.removeProperty(name);
    });
};

export default observer(function AppearanceControls() {
    const stores = useStores();
    const t = useI18n();
    const [languageOpen, setLanguageOpen] = useState(false);
    const languageTrigger = useRef(null);
    const languageMenuId = useId();
    const current = localeOptions.find(({ value }) => value === stores.i18n.locale);
    // 显示「当前状态」而不是「切换目标」，并跟随界面语言（原来是无条件英文 Light/Dark）。
    const themeLabel = stores.editor.isDark ? '深色' : '浅色';
    return (
        <div className="shoteasy-appearance-controls">
            <Button type="text" className="shoteasy-theme-trigger" aria-label={`${t('切换主题')}: ${t(themeLabel)}`}
                title={t(stores.editor.isDark ? '亮色主题' : '暗色主题')}
                icon={stores.editor.isDark ? <Icon.Sun size={18} /> : <Icon.Moon size={18} />}
                onClick={(event) => switchThemeFrom(event.currentTarget, stores)}>
                <span className="shoteasy-appearance-label">{t(themeLabel)}</span>
            </Button>
            <Dropdown trigger={['click']} placement="bottomRight" transitionName={NO_CSS_TRANSITION_NAME} autoFocus
                open={languageOpen} onOpenChange={setLanguageOpen}
                menu={{
                    id: languageMenuId,
                    lang: stores.i18n.locale,
                    'aria-label': t('语言'),
                    onKeyDown: (event) => {
                        if (event.key === 'Escape') {
                            event.preventDefault();
                            event.stopPropagation();
                            setLanguageOpen(false);
                            languageTrigger.current?.focus({ preventScroll: true });
                        }
                    },
                    selectable: true,
                    selectedKeys: [stores.i18n.locale],
                    items: localeOptions.map(({ value, label }) => ({
                        key: value,
                        role: 'menuitemradio',
                        'aria-checked': value === stores.i18n.locale,
                        label: <span lang={value}>{label}</span>,
                    })),
                    onClick: ({ key, domEvent }) => {
                        // Menu activation happens on keydown. Suppress its native
                        // button click before returning focus, or Enter reopens it.
                        domEvent.preventDefault();
                        stores.i18n.setOptions(key, stores.i18n.messages);
                        setLanguageOpen(false);
                        languageTrigger.current?.focus({ preventScroll: true });
                    },
                }}>
                <Button ref={languageTrigger} type="text" className="shoteasy-language-trigger"
                    aria-label={`${t('语言')}: ${current.label}, ${current.short}`}
                    title={current.label} aria-haspopup="menu" aria-expanded={languageOpen}
                    aria-controls={languageOpen ? languageMenuId : undefined}
                    onKeyDown={(event) => {
                        if (event.key === 'ArrowDown' && !languageOpen) {
                            event.preventDefault();
                            setLanguageOpen(true);
                        }
                    }}>
                    <span lang={current.value} className="shoteasy-appearance-label">{current.label}</span>
                    <span aria-hidden="true" className="shoteasy-language-short">{current.short}</span>
                    <Icon.ChevronDown size={12} />
                </Button>
            </Dropdown>
        </div>
    );
});
