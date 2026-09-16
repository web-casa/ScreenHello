/** Fumadocs uses contextual translation keys, including separate accessible labels. */
export function frameworkTranslations(ui: Record<string, string>) {
    const groups: Record<string, string[]> = {
        Search: ['Search(search trigger)', 'Search(search dialog)', 'Open Search(search trigger)(aria-label)'],
        'Close Search': ['Close Search(search dialog)(aria-label)'],
        'No results found': ['No results found(search dialog)'],
        'Choose a language': ['Choose a language(language switcher)', 'Choose a language(language switcher)(aria-label)'],
        'Toggle Theme': ['Toggle Theme(theme switcher)(aria-label)'],
        Light: ['Light(theme switcher)(aria-label)'],
        Dark: ['Dark(theme switcher)(aria-label)'],
        System: ['System(theme switcher)(aria-label)'],
        'Open Sidebar': ['Open Sidebar(sidebar)(aria-label)'],
        'Close Sidebar': ['Close Sidebar(sidebar)(aria-label)', 'Close Sidebar(aria-label)'],
        'Collapse Sidebar': ['Collapse Sidebar(sidebar)(aria-label)'],
        'Hide Sidebar': ['Hide Sidebar(sidebar)'],
        'Show Sidebar': ['Show Sidebar(sidebar)'],
        'Next Page': ['Next Page(pagination)'],
        'Previous Page': ['Previous Page(pagination)'],
        'On this page': ['On this page(table of contents)', 'Table of Contents(inline table of contents)'],
        'No Headings': ['No Headings(table of contents)'],
        'Toggle Menu': ['Toggle Menu(mobile menu)(aria-label)'],
    };
    return Object.fromEntries(Object.entries(groups).flatMap(([key, targets]) => targets.map(target => [target, ui[key]])));
}
