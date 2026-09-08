import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import useStores from '../stores/useStores';

export default observer(function StandaloneLocale({ updateTitle = true }) {
    const { i18n, platform } = useStores();
    const locale = i18n.locale;
    useEffect(() => {
        document.documentElement.lang = locale;
        if (updateTitle) document.title = `ScreenHello — ${i18n.t('本地优先的截图美化与标注工具')}`;
        platform.storage.setPreference('SCREENHELLO_LOCALE', locale);
    }, [locale, platform, updateTitle, i18n]);
    return null;
});
