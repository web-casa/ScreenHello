import { observer } from 'mobx-react-lite';
import { useId, useRef, useState } from 'react';
import { Button, Dropdown } from 'antd';
import Icon from '@components/Icon';
import { NO_CSS_TRANSITION_NAME } from '@components/overlayMotion';
import useStores from '@stores/useStores';
import useI18n from '../../i18n/useI18n';
import { localeOptions } from '../../i18n/locales';

export default observer(function AppearanceControls() {
    const stores = useStores();
    const t = useI18n();
    const [languageOpen, setLanguageOpen] = useState(false);
    const languageTrigger = useRef(null);
    const languageMenuId = useId();
    const current = localeOptions.find(({ value }) => value === stores.i18n.locale);
    const targetTheme = stores.editor.isDark ? 'Light' : 'Dark';
    return (
        <div className="shoteasy-appearance-controls">
            <Button type="text" className="shoteasy-theme-trigger" aria-label={`${t('切换主题')} (${targetTheme})`}
                title={t(stores.editor.isDark ? '亮色主题' : '暗色主题')}
                icon={stores.editor.isDark ? <Icon.Sun size={18} /> : <Icon.Moon size={18} />}
                onClick={() => { void stores.commands.execute('view.setTheme'); }}>
                <span className="shoteasy-appearance-label">{targetTheme}</span>
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
                    aria-label={`${t('语言')}: ${current.label} (${current.short})`}
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
