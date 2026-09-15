/** Small, locale-scoped static index: no service, query upload or extra fetch. */
/** @param {string} markdown */
export function plainText(markdown) {
    return markdown.replace(/^import .*;\s*$/gm, '')
        .replace(/<(?:BeforeAfter|GuideImage)\b[\s\S]*?\/>/g, '')
        .replace(/^#{1,6}\s+/gm, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[|>*`]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * @param {{id: string, title: string, text: string, url: string}[]} entries
 * @param {string} query
 */
export function searchDocs(entries, query) {
    const terms = query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return entries.map(entry => {
        const title = entry.title.normalize('NFKC').toLocaleLowerCase();
        const body = entry.text.normalize('NFKC').toLocaleLowerCase();
        if (!terms.every(term => title.includes(term) || body.includes(term))) return null;
        const at = Math.max(0, body.indexOf(terms[0]));
        return { ...entry, score: terms.reduce((sum, term) => sum + (title.includes(term) ? 10 : 1), 0),
            excerpt: `${at > 50 ? '…' : ''}${entry.text.slice(Math.max(0, at - 50), at + 150)}${entry.text.length > at + 150 ? '…' : ''}` };
    }).filter(entry => entry !== null).sort((a, b) => b.score - a.score);
}
