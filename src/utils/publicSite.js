const localePaths = { 'en-US': 'en', 'zh-CN': 'zh-cn', 'zh-TW': 'zh-tw', 'de-DE': 'de', 'ko-KR': 'ko', 'es-ES': 'es', 'pt-PT': 'pt-pt' };

export const publicGuidePath = (locale, base = '/') => `${base}${Object.hasOwn(localePaths, locale) ? localePaths[locale] : 'en'}/guide/`;

// URL preference applies only to an explicit entry link, not browser-language detection.
export const entryLocale = (search, fallback) => {
    const requested = new URLSearchParams(search).get('lang');
    const aliases = { en: 'en-US', de: 'de-DE', ko: 'ko-KR', es: 'es-ES' };
    const normalized = aliases[requested] || requested;
    return Object.hasOwn(localePaths, normalized) ? normalized : fallback;
};
