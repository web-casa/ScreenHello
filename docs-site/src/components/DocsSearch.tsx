import { createContext, useContext, useState } from 'react';
import {
    SearchDialog, SearchDialogClose, SearchDialogContent, SearchDialogHeader,
    SearchDialogIcon, SearchDialogInput, SearchDialogList, SearchDialogListItem,
    SearchDialogOverlay, type SharedProps,
} from 'fumadocs-ui/components/dialog/search';
import { searchDocs } from '@/lib/search.mjs';

export interface SearchEntry { id: string; title: string; text: string; url: string }
export const DocsSearchContext = createContext<{ entries: SearchEntry[]; hint: string }>({ entries: [], hint: '' });

export default function DocsSearch(props: SharedProps) {
    const { entries, hint } = useContext(DocsSearchContext);
    const [query, setQuery] = useState('');
    const matches = searchDocs(entries, query);
    const items = matches.map(match => ({ id: match.id, type: 'page' as const, content: match.title, url: match.url }));
    return (
        <SearchDialog {...props} search={query} onSearchChange={setQuery}>
            <SearchDialogOverlay />
            <SearchDialogContent>
                <SearchDialogHeader>
                    <SearchDialogIcon /><SearchDialogInput /><SearchDialogClose />
                </SearchDialogHeader>
                {!query.trim() ? <p className="sh-search-hint" role="status">{hint}</p> : (
                    <SearchDialogList items={items} Item={({ item, onClick }) => (
                        <SearchDialogListItem item={item} onClick={onClick}>
                            <span className="sh-search-result">
                                <strong>{matches.find(match => match.id === item.id)?.title}</strong>
                                <span>{matches.find(match => match.id === item.id)?.excerpt}</span>
                            </span>
                        </SearchDialogListItem>
                    )} />
                )}
            </SearchDialogContent>
        </SearchDialog>
    );
}
