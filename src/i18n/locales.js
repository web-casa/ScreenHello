// Native language names stay readable even when the current UI language is unfamiliar.
export const localeOptions = Object.freeze([
    { value: 'en-US', label: 'English', short: 'EN' },
    { value: 'zh-CN', label: '简体中文', short: '简' },
    { value: 'zh-TW', label: '繁體中文', short: '繁' },
    { value: 'de-DE', label: 'Deutsch', short: 'DE' },
    { value: 'ko-KR', label: '한국어', short: 'KO' },
    { value: 'es-ES', label: 'Español', short: 'ES' },
    { value: 'pt-PT', label: 'Português', short: 'PT' },
]);

export const normalizeLocale = (locale) => {
    const value = String(locale || '').replaceAll('_', '-').toLowerCase();
    if (/^zh(?:-|$)/.test(value)) {
        if (/(?:^|-)hans(?:-|$)/.test(value)) return 'zh-CN';
        return /(?:^|-)hant(?:-|$)|(?:^|-)(?:tw|hk|mo)(?:-|$)/.test(value) ? 'zh-TW' : 'zh-CN';
    }
    const language = value.split('-')[0];
    const aliases = { en: 'en-US', de: 'de-DE', ko: 'ko-KR', es: 'es-ES', pt: 'pt-PT' };
    return Object.hasOwn(aliases, language) ? aliases[language] : 'zh-CN';
};
