import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, firefox, webkit } from '@playwright/test';

const baseURL = process.env.SCREENHELLO_AVIF_SPIKE_URL || 'http://127.0.0.1:4195';
const width = Number(process.env.SCREENHELLO_AVIF_WIDTH) || 2048;
const height = Number(process.env.SCREENHELLO_AVIF_HEIGHT) || 2048;
const repeat = Number(process.env.SCREENHELLO_AVIF_REPEAT) || 6;
const qualityMetrics = process.env.SCREENHELLO_AVIF_QUALITY === '1';
const selectedEngine = process.env.SCREENHELLO_AVIF_ENGINE || '';
const engines = { chromium, firefox, webkit };

const readText = (path) => {
    try {
        return readFileSync(path, 'utf8');
    } catch {
        return '';
    }
};

const processTree = (rootPid) => {
    const pending = [rootPid];
    const visited = new Set();
    while (pending.length) {
        const pid = pending.pop();
        if (!pid || visited.has(pid)) continue;
        visited.add(pid);
        const children = readText(`/proc/${pid}/task/${pid}/children`).trim();
        if (children) pending.push(...children.split(/\s+/).map(Number));
    }
    return visited;
};

const rssMiB = (rootPid) => {
    let kib = 0;
    for (const pid of processTree(rootPid)) {
        const match = readText(`/proc/${pid}/status`).match(/^VmRSS:\s+(\d+)\s+kB$/m);
        if (match) kib += Number(match[1]);
    }
    return Math.round(kib / 1024 * 10) / 10;
};

const output = [];
for (const [name, launcher] of Object.entries(engines)) {
    if (selectedEngine && selectedEngine !== name) continue;
    const server = await launcher.launchServer();
    const rootPid = server.process().pid;
    const browser = await launcher.connect(server.wsEndpoint());
    try {
        const page = await browser.newPage();
        await page.goto(`${baseURL}/?manual=1`, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => typeof globalThis.__screenhelloRunAvifProductionSpike === 'function');
        const baselineRssMiB = rssMiB(rootPid);
        let peakRssMiB = baselineRssMiB;
        const sampler = setInterval(() => {
            peakRssMiB = Math.max(peakRssMiB, rssMiB(rootPid));
        }, 25);
        let result;
        try {
            result = await page.evaluate(
                (options) => globalThis.__screenhelloRunAvifProductionSpike(options),
                { width, height, repeat, qualityMetrics }
            );
        } finally {
            clearInterval(sampler);
            peakRssMiB = Math.max(peakRssMiB, rssMiB(rootPid));
        }
        assert.equal(result.mimeType, 'image/avif');
        assert.equal(result.validBrand, true);
        assert.equal(result.width, width);
        assert.equal(result.height, height);
        output.push({
            name,
            width,
            height,
            repeat,
            baselineRssMiB,
            peakRssMiB,
            deltaRssMiB: Math.round((peakRssMiB - baselineRssMiB) * 10) / 10,
            ...result,
        });
    } finally {
        await browser.close();
        await server.close();
    }
}

console.log(JSON.stringify(output, null, 2));
