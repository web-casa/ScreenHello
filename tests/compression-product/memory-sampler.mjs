import { performance } from 'node:perf_hooks';
import { processTreeRssSnapshot } from '../spikes/compression/rss.mjs';

// One traversal stream; the export window is a bookmark, not another timer.
export function createMemorySampler(pid, { read = processTreeRssSnapshot, now = () => performance.now(), wall = () => Date.now() } = {}) {
    const start = now(), wallStart = wall();
    const samples = [];
    let phase = 'before-navigation', timer;
    function sample(nextPhase = phase) {
        phase = nextPhase;
        const atMs = now() - start;
        const wallElapsedMs = wall() - wallStart;
        const snapshot = read(pid);
        const value = { atMs, wallElapsedMs, wallClockPosition: 'sample-start', phase, ...snapshot, readMs: now() - start - atMs };
        samples.push(value);
        return value;
    }
    return {
        samples, sample,
        start() { if (timer) throw new Error('sampler-already-started'); sample(); timer = setInterval(sample, 50); },
        stop() { clearInterval(timer); timer = undefined; },
        now: () => now() - start,
    };
}
