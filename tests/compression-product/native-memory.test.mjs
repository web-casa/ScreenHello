import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSmaps, processRole, readNativeMemory } from './native-memory.mjs';

test('process roles accept argv and rewritten process titles without storing arguments', () => {
    assert.equal(processRole('chrome\0--type=renderer\0--lang=en\0'), 'renderer');
    assert.equal(processRole('chrome --type=gpu-process --lang=en\0'), 'gpu-process');
    assert.equal(processRole('chrome --type=utility'), 'utility');
    assert.equal(processRole('chrome --example=--type=renderer'), 'browser-or-helper');
    assert.equal(processRole(''), 'unavailable');
});

test('groups exact native labels, sums resident pages, and does not count virtual size as RSS', () => {
    const data = parseSmaps(`1000-2000 rw-p 00000000 00:00 0
Size: 1048576 kB
Rss: 16 kB
Pss: 12 kB
Private_Dirty: 8 kB
Anonymous: 16 kB
LazyFree: 4 kB
VmFlags: rd wr
2000-3000 rw-p 00000000 00:00 0
Size: 64 kB
Rss: 32 kB
Swap: 8 kB
3000-4000 r--p 00000000 08:01 12 /opt/test file.so
Size: 100 kB
Rss: 20 kB
4000-5000 rw-p 00000000 00:00 0 [anon:JS heap]
Size: 100 kB
Rss: 24 kB
`);
    assert.equal(data.mappingCount, 4);
    assert.equal(data.totals.Rss, 92);
    assert.equal(data.totals.Pss, 12);
    assert.equal(data.totals.Swap, 8);
    assert.equal(data.totals.LazyFree, 4);
    assert.equal(data.groups[0].name, '(anonymous)');
    assert.equal(data.groups[0].count, 2);
    assert.equal(data.groups[0].Rss, 48);
    assert.equal(data.largestMappings[0].start, '2000');
    assert.ok(data.groups.some(group => group.name === '/opt/test file.so'));
    assert.ok(data.groups.some(group => group.name === '[anon:JS heap]'));
});

test('missing or invalid data is not reported as zero memory', () => {
    assert.throws(() => parseSmaps(''), /smaps-empty-or-invalid/);
    assert.throws(() => parseSmaps('1000-2000 rw-p 00000000 00:00 0\nSize: 4 kB\n'), /smaps-incomplete-mapping/);
    assert.throws(() => parseSmaps('1000-2000 rw-p 00000000 00:00 0\n2000-3000 rw-p 00000000 00:00 0\nSize: 4 kB\nRss: 4 kB\n'), /smaps-incomplete-mapping/);
    assert.throws(() => readNativeMemory('../1'), /smaps-invalid-pid/);
    assert.equal(readNativeMemory(2147483647).available, false);
});

test('reads current Linux process without mutating it', { skip: process.platform !== 'linux' }, () => {
    const data = readNativeMemory(process.pid);
    assert.equal(data.available, true);
    assert.ok(data.totals.Rss > 0);
    assert.equal(data.units, 'KiB');
});
