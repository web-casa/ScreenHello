import { makeAutoObservable } from 'mobx';
import { englishMessages } from './catalog';
import { catalogs } from './messages';
import { normalizeLocale } from './locales';

export { normalizeLocale } from './locales';

export const translateMessage = (source, locale = 'zh-CN', messages = {}, parameters = {}) => {
    if (typeof source !== 'string') return source;
    const custom = messages && Object.hasOwn(messages, source) && typeof messages[source] === 'string' ? messages[source] : null;
    const normalized = normalizeLocale(locale);
    const catalog = catalogs[normalized];
    const localized = catalog && Object.hasOwn(catalog, source) ? catalog[source] : null;
    const fallback = normalized !== 'zh-CN' && Object.hasOwn(englishMessages, source) ? englishMessages[source] : source;
    const template = custom ?? localized ?? fallback;
    return template.replace(/\{(\w+)\}/g, (match, key) => parameters && Object.hasOwn(parameters, key) ? String(parameters[key]) : match);
};

export class I18nStore {
    locale = 'zh-CN';
    messages = {};
    version = 0;
    constructor({ locale, messages } = {}) {
        this.setOptions(locale, messages);
        makeAutoObservable(this, {}, { autoBind: true });
    }
    setOptions(locale, messages) {
        this.locale = normalizeLocale(locale);
        this.messages = messages && typeof messages === 'object' && !Array.isArray(messages) ? { ...messages } : {};
        this.version += 1;
    }
    t(source, parameters) { return translateMessage(source, this.locale, this.messages, parameters); }
}
