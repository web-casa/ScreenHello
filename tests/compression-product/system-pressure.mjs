import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const integer = value => {
    assert.match(value || '', /^\d+$/);
    const number = Number(value);
    assert.ok(Number.isSafeInteger(number));
    return number;
};
export function parseMeminfo(text) {
    const result = {};
    for (const key of ['MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree']) {
        const matches = [...text.matchAll(new RegExp(`^${key}:\\s+(\\d+) kB$`, 'gm'))];
        assert.equal(matches.length, 1, `missing or duplicate ${key}`);
        result[key] = integer(matches[0][1]);
    }
    assert.ok(result.MemTotal > 0 && result.MemAvailable <= result.MemTotal && result.SwapFree <= result.SwapTotal);
    return { units: 'KiB', ...result };
}
export function parseMemoryPressure(text) {
    const result = {};
    for (const kind of ['some', 'full']) {
        const matches = [...text.matchAll(new RegExp(`^${kind} avg10=(\\d+\\.\\d+) avg60=(\\d+\\.\\d+) avg300=(\\d+\\.\\d+) total=(\\d+)$`, 'gm'))];
        assert.equal(matches.length, 1, `missing or duplicate PSI ${kind}`);
        const values = matches[0].slice(1, 4).map(Number);
        assert.ok(values.every(value => Number.isFinite(value) && value >= 0 && value <= 100));
        result[kind] = { avg10: values[0], avg60: values[1], avg300: values[2], totalUs: integer(matches[0][4]) };
    }
    return result;
}
export function parseOomKills(text) {
    const matches = [...text.matchAll(/^oom_kill (\d+)$/gm)];
    assert.equal(matches.length, 1, 'missing or duplicate oom_kill');
    return integer(matches[0][1]);
}
export function readSystemPressure({ read = file => readFileSync(file, 'utf8'), platform = process.platform } = {}) {
    const observe = (file, parse) => {
        try {
            assert.equal(platform, 'linux', 'Linux only');
            return { available: true, value: parse(read(file)) };
        } catch (error) { return { available: false, reason: String(error.code || error.message), value: null }; }
    };
    return { scope: 'linux-host-before-after/v1', observedAt: new Date().toISOString(),
        memory: observe('/proc/meminfo', parseMeminfo),
        pressure: observe('/proc/pressure/memory', parseMemoryPressure),
        oomKills: observe('/proc/vmstat', parseOomKills) };
}
export function compareSystemPressure(before, after) {
    const warnings = [];
    for (const snapshot of [before, after]) {
        assert.equal(snapshot?.scope, 'linux-host-before-after/v1');
        assert.ok(Number.isFinite(Date.parse(snapshot.observedAt)));
        for (const key of ['memory', 'pressure', 'oomKills']) {
            const field = snapshot[key];
            assert.equal(typeof field?.available, 'boolean');
            if (!field.available) { assert.equal(field.value, null); assert.ok(field.reason); }
        }
    }
    assert.ok(Date.parse(after.observedAt) >= Date.parse(before.observedAt), 'reversed snapshots');
    for (const key of ['memory', 'pressure', 'oomKills']) {
        if (!before?.[key]?.available || !after?.[key]?.available) warnings.push(`${key}-unavailable`);
    }
    const delta = (key, get) => {
        if (!before?.[key]?.available || !after?.[key]?.available) return null;
        const value = get(after[key].value) - get(before[key].value);
        if (!Number.isFinite(value) || value < 0) { warnings.push(`${key}-counter-reset-or-invalid`); return null; }
        return value;
    };
    const oomKillDelta = delta('oomKills', value => value);
    const someStallUs = delta('pressure', value => value.some.totalUs);
    const fullStallUs = delta('pressure', value => value.full.totalUs);
    if (oomKillDelta > 0) warnings.push('host-oom-kills-observed-not-attributed');
    if (someStallUs > 0 || fullStallUs > 0) warnings.push('host-memory-stalls-observed');
    return { scope: 'host-only-not-browser-attribution', oomKillDelta, someStallUs, fullStallUs, warnings: [...new Set(warnings)] };
}
