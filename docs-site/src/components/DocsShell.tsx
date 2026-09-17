import type { ReactNode } from 'react';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsBody, DocsPage } from 'fumadocs-ui/page';
import { RootProvider } from 'fumadocs-ui/provider/astro';
import type { Root } from 'fumadocs-core/page-tree';
import type { TOCItemType } from 'fumadocs-core/toc';
import { DOCS_LOCALES, docsPagePath } from '@/lib/content.mjs';
import { frameworkTranslations } from '@/lib/ui';
import DocsSearch, { DocsSearchContext, type SearchEntry } from './DocsSearch';

const DISPLAY_NAMES: Record<string, string> = {
    en: 'English', 'zh-cn': '简体中文', 'zh-tw': '繁體中文',
    de: 'Deutsch', ko: '한국어', es: 'Español', 'pt-pt': 'Português',
};

interface Props {
    tree: Root;
    locale: string;
    topic: string;
    catalog: { ui: Record<string, string>; editorLanguage: string; open: string; skip: string; updated: string };
    searchEntries: SearchEntry[];
    title: string;
    description?: string;
    reviewed: string;
    toc: TOCItemType[];
    pathname: string;
    params: Record<string, string | string[] | undefined>;
    children: ReactNode;
}

/** Keep layout, body and search in one island so framework contexts stay shared. */
export default function DocsShell({ tree, locale, topic, catalog, searchEntries, title, description, reviewed, toc, pathname, params, children }: Props) {
    const editorUrl = `${import.meta.env.BASE_URL}?lang=${encodeURIComponent(catalog.editorLanguage)}`;
    return (
        <DocsSearchContext value={{ entries: searchEntries, hint: catalog.ui.searchHint }}>
            <RootProvider
                pathname={pathname}
                params={params}
                search={{ SearchDialog: DocsSearch }}
                i18n={{
                    locale,
                    translations: frameworkTranslations(catalog.ui),
                    locales: DOCS_LOCALES.map(code => ({ locale: code, name: DISPLAY_NAMES[code] })),
                    onLocaleChange: nextLocale => { window.location.assign(docsPagePath(nextLocale, topic)); },
                }}
            >
                <a className="sh-skip" href="#docs-content">{catalog.skip}</a>
                <DocsLayout
                    tree={tree}
                    nav={{ title: 'ScreenHello', url: docsPagePath(locale, '') }}
                    links={[{ type: 'button', text: catalog.open, url: editorUrl, active: 'none' }]}
                    i18n
                >
                    <DocsPage id="docs-content" toc={toc} breadcrumb={{ enabled: false }}
                        footer={topic ? undefined : { items: { next: tree.children.find(item => item.type === 'page') as { name: ReactNode; url: string } } }}>
                        <h1>{title}</h1>
                        {description ? <p className="sh-description">{description}</p> : null}
                        {(!topic || topic === 'guide') && <p><a className="sh-editor-link" href={editorUrl}>{catalog.open}<span aria-hidden="true"> →</span></a></p>}
                        <DocsBody>{children}</DocsBody>
                        <p className="sh-reviewed"><span>{catalog.updated}</span> <time dateTime={reviewed}>{reviewed}</time></p>
                    </DocsPage>
                </DocsLayout>
            </RootProvider>
        </DocsSearchContext>
    );
}
