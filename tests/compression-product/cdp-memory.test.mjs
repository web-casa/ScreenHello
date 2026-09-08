import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readCdpAllocations, readCdpMemory } from './cdp-memory.mjs';

const heap = { usedSize: 100, totalSize: 200, embedderHeapUsedSize: 30, backingStorageSize: 40 };
const dom = { documents: 1, nodes: 20, jsEventListeners: 5 };
test('native allocation profiles use only the sampling query and preserve raw attribution', async () => {
    const profile = { samples: [{ size: 16, total: 128, stack: ['Allocate', '0x12'] }], modules: [] };
    const calls = [];
    const result = await readCdpAllocations({ async send(command) { calls.push(command); return { profile }; } });
    assert.deepEqual(calls, ['Memory.getSamplingProfile']);
    assert.deepEqual(result, { available: true, coverage: 'samples-present', scope: 'renderer-native-sampling', units: 'bytes', profile });
});
test('native sampling rejects malformed data and reports unsupported calls explicitly', async () => {
    for (const profile of [null, {}, { samples: [{ size: -1, total: 0, stack: [] }], modules: [] },
        { samples: [{ size: 1, total: 1, stack: [42] }], modules: [] }]) {
        assert.equal((await readCdpAllocations({ async send() { return { profile }; } })).available, false);
    }
    assert.deepEqual(await readCdpAllocations({ async send() { throw new Error('unsupported'); } }), { available: false, error: 'unsupported' });
    const empty = await readCdpAllocations({ async send() { return { profile: { samples: [], modules: [] } }; } });
    assert.equal(empty.available, true);
    assert.equal(empty.coverage, 'empty-unproven');
});
test('reads only non-GC counters and preserves scope, bytes and values', async () => {
    const calls = [];
    const result = await readCdpMemory({ async send(command) {
        calls.push(command);
        return command === 'Runtime.getHeapUsage' ? heap : dom;
    } });
    assert.deepEqual(calls, ['Runtime.getHeapUsage', 'Memory.getDOMCounters']);
    assert.deepEqual(result, { available: true, scope: 'page-isolate', units: 'bytes', heap, dom });
});
test('unsupported protocol does not masquerade as zero memory', async () => {
    const result = await readCdpMemory({ async send() { throw new Error('method not found'); } });
    assert.deepEqual(result, { available: false, error: 'method not found' });
    assert.deepEqual(await readCdpMemory({ async send() { throw null; } }), { available: false, error: 'null' });
});
test('rejects incomplete or invalid counters, but allows missing optional heap fields', async () => {
    for (const invalid of [{}, { ...heap, usedSize: -1 }, { ...heap, backingStorageSize: NaN }]) {
        assert.equal((await readCdpMemory({ async send(command) { return command === 'Runtime.getHeapUsage' ? invalid : dom; } })).available, false);
    }
    assert.equal((await readCdpMemory({ async send(command) { return command === 'Runtime.getHeapUsage' ? heap : { ...dom, nodes: 1.5 }; } })).available, false);
    assert.equal((await readCdpMemory({ async send(command) { return command === 'Runtime.getHeapUsage' ? { usedSize: 0, totalSize: 0 } : dom; } })).available, true);
});
