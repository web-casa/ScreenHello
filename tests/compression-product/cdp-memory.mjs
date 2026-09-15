import assert from 'node:assert/strict';

export async function readCdpAllocations(session) {
    try {
        const { profile } = await session.send('Memory.getSamplingProfile');
        assert.ok(Array.isArray(profile?.samples) && Array.isArray(profile?.modules), 'cdp-invalid-profile');
        for (const sample of profile.samples) {
            assert.ok(Number.isFinite(sample.size) && sample.size >= 0
                && Number.isFinite(sample.total) && sample.total >= 0
                && Array.isArray(sample.stack) && sample.stack.every(frame => typeof frame === 'string'), 'cdp-invalid-sample');
        }
        // Sampled allocation attribution is not resident memory, nor a census.
        // Preserve raw stacks/modules for investigation; never sum them as RSS.
        return { available: true, coverage: profile.samples.length ? 'samples-present' : 'empty-unproven',
            scope: 'renderer-native-sampling', units: 'bytes', profile };
    } catch (error) {
        return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
}

// Read-only counters for the attached page isolate, not the entire browser or
// Worker heaps. Never prepareForLeakDetection, collectGarbage, or take snapshots.
export async function readCdpMemory(session) {
    try {
        const heap = await session.send('Runtime.getHeapUsage');
        const dom = await session.send('Memory.getDOMCounters');
        for (const key of ['usedSize', 'totalSize']) {
            assert.ok(Number.isFinite(heap[key]) && heap[key] >= 0, `cdp-invalid-${key}`);
        }
        for (const key of ['embedderHeapUsedSize', 'backingStorageSize']) {
            assert.ok(heap[key] === undefined || (Number.isFinite(heap[key]) && heap[key] >= 0), `cdp-invalid-${key}`);
        }
        for (const key of ['documents', 'nodes', 'jsEventListeners']) {
            assert.ok(Number.isInteger(dom[key]) && dom[key] >= 0, `cdp-invalid-${key}`);
        }
        return { available: true, scope: 'page-isolate', units: 'bytes', heap, dom };
    } catch (error) {
        return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
}
