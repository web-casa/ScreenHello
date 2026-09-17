import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, firefox, webkit } from '@playwright/test';
import { processTreeRssMiB as rss } from './rss.mjs';

const url = process.env.SCREENHELLO_COMPRESSION_URL || 'http://127.0.0.1:4196/';
const width = Number(process.env.SCREENHELLO_COMPRESSION_WIDTH || 2048);
const height = Number(process.env.SCREENHELLO_COMPRESSION_HEIGHT || 1024);
const selected = process.env.SCREENHELLO_COMPRESSION_ENGINE;
const pairMode = process.env.SCREENHELLO_COMPRESSION_PAIR === '1';
const engines = { chromium, firefox, webkit };
assert.ok([width, height].every(n => Number.isInteger(n) && n > 0 && n <= 8192)
    && width * height <= 2_097_152, 'unsupported benchmark size');
if (selected) assert.ok(Object.hasOwn(engines, selected), 'unknown engine');
const output = [];
const directory = new URL('../../../artifacts/compression-evidence/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const [name, launcher] of Object.entries(engines)) {
    if (selected && selected !== name) continue;
    for (const kind of pairMode ? ['noise'] : ['screenshot', 'noise']) {
        for (const mode of pairMode ? ['pair'] : ['png-lossless', 'png-lossy', 'webp-lossless']) {
            const server = await launcher.launchServer();
            const browser = await launcher.connect(server.wsEndpoint());
            try {
                const page = await browser.newPage();
                await page.goto(url, { waitUntil: 'networkidle' });
                const baselineRssMiB = rss(server.process().pid);
                assert.ok(baselineRssMiB > 0, 'RSS unavailable: run on Linux or provide a different sampler');
                let peakRssMiB = baselineRssMiB;
                const rssTimeline = [];
                const activePhases = new Map();
                const phasePeakRssMiB = {};
                const phaseSamples = [];
                const sampleRss = () => {
                    const sample = rss(server.process().pid);
                    peakRssMiB = Math.max(peakRssMiB, sample);
                    rssTimeline.push(sample);
                    const phase = [...activePhases.values()].sort().join('+') || 'setup';
                    phasePeakRssMiB[phase] = Math.max(phasePeakRssMiB[phase] || 0, sample);
                    phaseSamples.push({ phase, rssMiB: sample });
                };
                await page.exposeFunction('__compressionSamplePhase', (client, phase) => {
                    activePhases.set(client, phase);
                    sampleRss();
                });
                const sampler = setInterval(sampleRss, 50);
                let result;
                try {
                    result = await page.evaluate(options => {
                        const run = mode => globalThis.__compressionProbe.run({ ...options, mode,
                            onPhase: phase => globalThis.__compressionSamplePhase(mode, phase),
                        });
                        return options.mode === 'pair' ? Promise.all(['png-lossless', 'webp-lossless'].map(run)) : run(options.mode);
                    },
                        { mode, kind, width, height, repeat: 6, includeBytes: false });
                } finally { clearInterval(sampler); }
                peakRssMiB = Math.max(peakRssMiB, rss(server.process().pid));
                const results = pairMode ? result : [result];
                for (const item of results) {
                    assert.equal(item.samples.length, 6);
                    assert.equal(item.decodedWidth, width); assert.equal(item.decodedHeight, height);
                }
                if (!pairMode) {
                    for (const phase of ['source', 'encoding', 'decode', 'released']) {
                        assert.ok(phasePeakRssMiB[phase] > 0, `missing ${phase} sample`);
                    }
                }
                const entry = { name, version: browser.version(), ...(pairMode ? { mode, kind, width, height, results } : result), baselineRssMiB, peakRssMiB,
                    deltaRssMiB: Math.round((peakRssMiB - baselineRssMiB) * 10) / 10,
                    rssTimeline, phaseSamples, phasePeakRssMiB,
                    // Resident codec memory carries into decode; these are stage
                    // observations, not allocations attributable to each stage.
                    phaseDeltaRssMiB: Object.fromEntries(Object.entries(phasePeakRssMiB)
                        .map(([phase, peak]) => [phase, Math.round((peak - baselineRssMiB) * 10) / 10])),
                    rssSampler: 'all-thread-child-tree-v2', memoryIsApproximate: true };
                // 384 MiB is a single-operation review line, not a two-instance quota.
                entry.withinReviewLine = pairMode ? null : entry.deltaRssMiB <= 384;
                output.push(entry);
                await writeFile(new URL(`benchmark-${width}x${height}${pairMode ? '-pair' : ''}${selected ? `-${selected}` : ''}.json`, directory), JSON.stringify(output, null, 2));
                console.log(JSON.stringify({ name, mode, kind, width, height, deltaRssMiB: entry.deltaRssMiB,
                    withinReviewLine: entry.withinReviewLine, milliseconds: results.map(item => item.samples.map(x => Math.round(x.totalMs))) }));
            } finally { await browser.close(); await server.close(); }
        }
    }
}
// A recorded over-budget result is evidence to revise the proposed cap, not GO.
if (output.some(result => result.withinReviewLine === false)) process.exitCode = 1;
