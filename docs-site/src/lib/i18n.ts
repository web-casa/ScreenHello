import { defineI18n } from 'fumadocs-core/i18n';
import { DOCS_DEFAULT_LOCALE, DOCS_LOCALES } from './content.mjs';

/* 只服务语言切换器：内容路由由 source.ts 显式接管（见那里的注释），
   这里仅提供 defineI18n 的 translations() 与语言列表。
   客户端 island 会导入本模块，因此不能引用 astro:content。 */
export const i18n = defineI18n({
    languages: [...DOCS_LOCALES],
    defaultLanguage: DOCS_DEFAULT_LOCALE,
    hideLocale: 'never',
});
