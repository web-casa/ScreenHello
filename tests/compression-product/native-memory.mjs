// Linux diagnostic only. Mapping labels describe VMAs, not JS object ownership.
import { readFileSync } from 'node:fs';

const FIELDS = ['Size', 'Rss', 'Pss', 'Private_Clean', 'Private_Dirty', 'Anonymous', 'LazyFree', 'Swap'];
const emptyTotals = () => Object.fromEntries(FIELDS.map(key => [key, 0]));

export function processRole(commandLine) {
    // Chromium can rewrite argv as a space-separated process title on Linux.
    // Never preserve the full command line (it can contain unrelated URLs).
    if (!commandLine) return 'unavailable';
    return commandLine.match(/(?:^|[\s\0])--type=([a-z-]+)(?=[\s\0]|$)/)?.[1] || 'browser-or-helper';
}

export function parseSmaps(text) {
    const mappings = [];
    let current;
    let fields = new Set();
    const assertComplete = () => {
        if (current && (!fields.has('Size') || !fields.has('Rss'))) throw new Error('smaps-incomplete-mapping');
    };
    for (const line of text.split('\n')) {
        const header = line.match(/^([a-f\d]+)-([a-f\d]+)\s+([rwxps-]{4})\s+[a-f\d]+\s+[a-f\d]+:[a-f\d]+\s+\d+\s*(.*)$/i);
        if (header) {
            assertComplete();
            fields = new Set();
            current = { start: header[1], end: header[2], permissions: header[3], name: header[4] || '(anonymous)', ...emptyTotals() };
            mappings.push(current);
            continue;
        }
        const field = line.match(/^(\w+):\s+(\d+) kB$/);
        if (current && field && FIELDS.includes(field[1])) {
            fields.add(field[1]);
            current[field[1]] = Number(field[2]);
        }
    }
    assertComplete();
    if (!mappings.length) throw new Error('smaps-empty-or-invalid');
    const groups = new Map(), totals = emptyTotals();
    for (const mapping of mappings) {
        const key = `${mapping.permissions} ${mapping.name}`;
        if (!groups.has(key)) groups.set(key, { name: mapping.name, permissions: mapping.permissions, count: 0, ...emptyTotals() });
        const group = groups.get(key);
        group.count++;
        for (const field of FIELDS) { group[field] += mapping[field]; totals[field] += mapping[field]; }
    }
    return { units: 'KiB', mappingCount: mappings.length, totals,
        groups: [...groups.values()].sort((a, b) => b.Rss - a.Rss),
        // Preserve address identity for stage comparisons, including large
        // reserved mappings with only a small resident portion.
        largestMappings: mappings.sort((a, b) => b.Rss - a.Rss || b.Size - a.Size).slice(0, 40) };
}

export function readNativeMemory(pid) {
    if (!Number.isInteger(pid) || pid < 1) throw new Error('smaps-invalid-pid');
    try {
        return { available: true, ...parseSmaps(readFileSync(`/proc/${pid}/smaps`, 'utf8')) };
    } catch (error) {
        return { available: false, error: error.code || error.message };
    }
}
