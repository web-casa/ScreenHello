import { readFileSync, readdirSync } from 'node:fs';

const read = path => { try { return readFileSync(path, 'utf8'); } catch { return ''; } };
const list = path => { try { return readdirSync(path); } catch { return []; } };

// Approximate Linux process-tree RSS, including children forked by helper
// threads. Shared pages can be counted more than once; this is not a JS quota.
export function processTreeRssMiB(pid, { readText = read, listThreads = list } = {}) {
    const pending = [pid], visited = new Set();
    let kib = 0;
    while (pending.length) {
        const current = pending.pop();
        if (!current || visited.has(current)) continue;
        visited.add(current);
        const match = readText(`/proc/${current}/status`).match(/^VmRSS:\s+(\d+)\s+kB$/m);
        if (match) kib += Number(match[1]);
        const threads = listThreads(`/proc/${current}/task`);
        for (const tid of threads.length ? threads : [String(current)]) {
            pending.push(...readText(`/proc/${current}/task/${tid}/children`).trim().split(/\s+/).map(Number));
        }
    }
    return Math.round(kib / 1024 * 10) / 10;
}

// V2 adds diagnostics without changing the historical function or its injected
// read semantics. ENOENT for a child is normal exit; a missing root is invalid.
export function processTreeRssSnapshot(pid, {
    readText = path => readFileSync(path, 'utf8'),
    listThreads = path => readdirSync(path),
} = {}) {
    const pending = [pid], visited = new Set(), processes = [], errors = [];
    let kib = 0, rootReadable = false;
    const attempt = (path, fn, current, mayDisappear = current !== pid) => {
        try { return fn(path); }
        catch (error) {
            errors.push({ pid: current, path, code: error.code || 'READ_ERROR', normalExit: mayDisappear && error.code === 'ENOENT' });
            return null;
        }
    };
    while (pending.length) {
        const current = pending.pop();
        if (!Number.isInteger(current) || current <= 0 || visited.has(current)) continue;
        visited.add(current);
        const status = attempt(`/proc/${current}/status`, readText, current);
        const match = status?.match(/^VmRSS:\s+(\d+)\s+kB$/m);
        // Zombies have no RSS; accept them only as exited children.
        const zombie = /^State:\s+Z/m.test(status || '');
        if (match) { kib += Number(match[1]); if (current === pid) rootReadable = Number(match[1]) > 0; }
        else if (status !== null && !(current !== pid && zombie)) errors.push({ pid: current, code: 'RSS_MISSING', normalExit: false });
        processes.push({ pid: current, rssKiB: match ? Number(match[1]) : null });
        if (status === null || zombie) continue;
        const threads = attempt(`/proc/${current}/task`, listThreads, current);
        for (const tid of threads?.length ? threads : [String(current)]) {
            // A non-leader thread can exit between listing /task and reading
            // /children, even while the browser root process remains alive.
            const children = attempt(`/proc/${current}/task/${tid}/children`, readText, current, current !== pid || String(tid) !== String(current));
            if (children !== null) pending.push(...children.trim().split(/\s+/).map(Number));
        }
    }
    return { rssMiB: Math.round(kib / 1024 * 10) / 10, rootPid: pid, rootReadable,
        status: rootReadable && !errors.some(error => !error.normalExit) ? 'ok' : 'invalid', processes, errors };
}
