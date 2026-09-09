import { afterEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { BATCH_RECOVERY_SCOPE, BATCH_TARGET_SCOPE, batchRecoveryNames, inspectBatchRecoveryZip, validateBatchRecoveryEvidence, validateTargetBatchEvidence } from '../release/batch-recovery-contract.mjs';
import { installBatchZipObserver } from '../release/batch-zip-observer.mjs';
import { setBatchFiles } from '../release/batch-recovery.mjs';

const checksum = 'a'.repeat(64);
const fixture = (mode = 'all') => {
    const completed = { id: 2, workerId: 2, compression: 'standard', width: 73, height: 55, failed: false,
        startedAt: 4, completedAt: 5, cancelRequestedAt: null, terminatedAt: 6 };
    return { scope: BATCH_RECOVERY_SCOPE, status: 'passed', mode,
        registration: { mode, attemptsPerCase: 1, memoryMeasurement: false, registeredAt: '2026-09-09T00:00:00Z',
            webSha256: checksum, runnerSha256: checksum, pcSha256: checksum, smallSha256: checksum },
        environment: { engine: 'chromium', version: 'test-only', platform: 'linux', arch: 'arm64' },
        foreground: { visibility: 'visible', focused: true }, overflow: false, samePage: true, productionEditor: true,
        layersBefore: ['original'], layersAfter: ['original'], pageErrors: [], blockedRequests: [], setupDownloads: 1,
        downloadsBeforeZip: 0, downloadsAfterZip: 1, cancellationMs: 10,
        cancelledStatuses: mode === 'all' ? ['已取消', '已取消'] : ['已取消', '已完成'],
        recoveredStatuses: mode === 'all' ? ['已完成', '已完成'] : ['已取消', '已完成'],
        jobsAtCancellationReady: mode === 'all' ? 1 : 2, zipEnabledAfterCancel: mode === 'current',
        jobs: [{ id: 1, workerId: 1, width: 2223, height: 1667, compression: 'standard', startedAt: 1,
            cancelRequestedAt: 2, terminatedAt: 3, completedAt: null, failed: false }, completed,
        ...(mode === 'all' ? [{ ...completed, id: 3, startedAt: 7, completedAt: 8, terminatedAt: 9 }] : [])],
        archive: { name: 'ScreenHello-batch-20260909T0700.zip', size: 700, sha256: checksum,
            entries: batchRecoveryNames(mode).map(name => ({ name, size: 200, sha256: checksum,
                decoded: { width: 73, height: 55, corner: [0, 0, 0, 0], decoder: 'jsquash-avif-2.1.1-node-wasm' } })) },
    };
};

describe('batch cancellation and recovery evidence', () => {
    it.each(['all', 'current'])('accepts the exact %s cancellation contract', mode => {
        expect(() => validateBatchRecoveryEvidence(fixture(mode))).not.toThrow();
    });
    it.each([
        ['false pass', e => { e.status = 'failed'; }],
        ['missing preregistration', e => { delete e.registration; }],
        ['different preregistration', e => { e.registration.mode = 'current'; }],
        ['repeated trial', e => { e.registration.attemptsPerCase = 2; }],
        ['false memory claim', e => { e.registration.memoryMeasurement = true; }],
        ['missing build', e => { delete e.registration.webSha256; }],
        ['not foreground', e => { e.foreground.focused = false; }],
        ['trace overflow', e => { e.overflow = true; }],
        ['reloaded page', e => { e.samePage = false; }],
        ['non-production store exposed', e => { e.productionEditor = false; }],
        ['project changed', e => { e.layersAfter = []; }],
        ['page crashed', e => { e.pageErrors.push('crash'); }],
        ['unexpected network', e => { e.blockedRequests.push('https://example.com/upload'); }],
        ['automatic ZIP', e => { e.downloadsBeforeZip = 1; }],
        ['late extra download', e => { e.downloadsAfterZip = 2; }],
        ['queue continued after cancel all', e => { e.jobsAtCancellationReady = 2; }],
        ['unconfirmed ZIP', e => { e.zipEnabledAfterCancel = true; }],
        ['wrong cancellation status', e => { e.cancelledStatuses[0] = '已完成'; }],
        ['failed recovery', e => { e.recoveredStatuses[1] = '失败'; }],
        ['no terminate', e => { e.jobs[0].terminatedAt = null; }],
        ['already completed', e => { e.jobs[0].completedAt = 1.5; }],
        ['no real click', e => { e.jobs[0].cancelRequestedAt = null; }],
        ['terminated before click', e => { e.jobs[0].terminatedAt = 1.5; }],
        ['small cancellation fixture', e => { e.jobs[0].width = 64; }],
        ['cancelled worker reused', e => { e.jobs[1].workerId = 1; }],
        ['parallel encodes', e => { e.jobs[2].startedAt = 4; }],
        ['changed compression', e => { e.jobs[1].compression = 'lossy'; }],
        ['extra job', e => { e.jobs.push(e.jobs[2]); }],
        ['failed worker', e => { e.jobs[1].failed = true; }],
        ['wrong ZIP name', e => { e.archive.name = 'image.avif'; }],
        ['missing ZIP entry', e => { e.archive.entries.pop(); }],
        ['cancelled entry leaked', e => { e.archive.entries[0].name = 'cancel-pc-screenhello.avif'; }],
        ['undecoded output', e => { delete e.archive.entries[0].decoded; }],
        ['wrong dimensions', e => { e.archive.entries[0].decoded.width = 64; }],
        ['lost transparency', e => { e.archive.entries[0].decoded.corner[3] = 255; }],
    ])('rejects %s', (_name, mutate) => {
        const evidence = fixture(); mutate(evidence);
        expect(() => validateBatchRecoveryEvidence(evidence)).toThrow();
    });
    it('rejects unexpected files, missing entries and oversized output before decoding', async () => {
        await expect(inspectBatchRecoveryZip(zipSync({ '../extra.avif': new Uint8Array([1]) }), 'all')).rejects.toThrow('unexpected');
        await expect(inspectBatchRecoveryZip(zipSync({}), 'all')).rejects.toThrow();
        await expect(inspectBatchRecoveryZip(zipSync({ 'recover-a-screenhello.avif': new Uint8Array(131_073) }), 'all')).rejects.toThrow('entry size');
        await expect(inspectBatchRecoveryZip(new Uint8Array(262_145), 'all')).rejects.toThrow('ZIP size');
    });
    it('does not accept arbitrary bytes under an AVIF filename', async () => {
        await expect(inspectBatchRecoveryZip(zipSync({ 'queued-small-screenhello.avif': new Uint8Array([1, 2, 3]) }), 'current')).rejects.toThrow();
    });
    it('rejects duplicate central-directory entries before decoding', async () => {
        const zip = zipSync({ 'recover-a-screenhello.avif': new Uint8Array([1]), 'recover-b-screenhello.avif': new Uint8Array([2]) });
        const duplicate = Buffer.from(Buffer.from(zip).toString('latin1').replaceAll('recover-b-screenhello.avif', 'recover-a-screenhello.avif'), 'latin1');
        await expect(inspectBatchRecoveryZip(duplicate, 'all')).rejects.toThrow('duplicate ZIP entry');
    });
});

const target = { id: 'chrome-111', browser: 'chrome' };
const targetContext = { target, observed: { browserVersion: '111.0.0' }, releaseCandidate: 'b'.repeat(40) };
const targetFixture = () => ({
    scope: BATCH_TARGET_SCOPE, status: 'passed', target: target.id, deliveryEvidence: 'native-anchor-blob-bytes',
    zipObserverOverflow: false, zipHandoffs: 2,
    candidate: { commit: targetContext.releaseCandidate, webBuildSha256: checksum, runnerSha256: checksum,
        optionalDevicePackIncluded: false, deploymentAuthorized: false, batchChecks: true, environment: { platform: 'linux', arch: 'x64' } },
    registration: { modes: ['all', 'current'], attemptsPerCase: 1, memoryMeasurement: false,
        registeredAt: '2026-09-09T00:00:00Z', pcSha256: checksum, smallSha256: checksum },
    cases: ['all', 'current'].map(mode => {
        const item = fixture(mode);
        item.scope = BATCH_TARGET_SCOPE;
        item.environment = { engine: 'chrome', version: '111.0.0', platform: 'linux', arch: 'x64' };
        item.externalResourceRequests = [];
        Object.assign(item.archive, { type: 'application/zip', evidenceFile: `${target.id}-batch-${mode}.zip` });
        return item;
    }),
});

describe('target batch identity and registration', () => {
    it('accepts two exact target cases with native-anchor evidence distinct from OS persistence', () => {
        expect(() => validateTargetBatchEvidence(targetFixture(), targetContext)).not.toThrow();
    });
    it.each([
        ['local scope reused', e => { e.scope = BATCH_RECOVERY_SCOPE; }],
        ['missing case', e => { e.cases.pop(); }],
        ['different candidate', e => { e.candidate.commit = 'c'.repeat(40); }],
        ['device pack included', e => { e.candidate.optionalDevicePackIncluded = true; }],
        ['missing batch registration', e => { delete e.candidate.batchChecks; }],
        ['wrong browser version', e => { e.cases[0].environment.version = 'current'; }],
        ['wrong architecture', e => { e.cases[0].environment.arch = 'arm64'; }],
        ['wrong Web bytes', e => { e.cases[0].registration.webSha256 = 'c'.repeat(64); }],
        ['wrong runner', e => { e.cases[1].registration.runnerSha256 = 'c'.repeat(64); }],
        ['wrong fixture', e => { e.cases[1].registration.pcSha256 = 'c'.repeat(64); }],
        ['ZIP path traversal', e => { e.cases[0].archive.evidenceFile = '../extra.zip'; }],
        ['missing ZIP', e => { e.zipHandoffs = 1; }],
        ['trace overflow', e => { e.zipObserverOverflow = true; }],
        ['false OS persistence claim', e => { e.deliveryEvidence = 'os-file-saved'; }],
        ['unexpected request', e => { e.cases[0].externalResourceRequests = ['https://example.com']; }],
    ])('rejects %s', (_name, mutate) => {
        const evidence = targetFixture(); mutate(evidence);
        expect(() => validateTargetBatchEvidence(evidence, targetContext)).toThrow();
    });
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('lazy batch input readiness', () => {
    it('waits for the lazy input and dispatches only one change event', async () => {
        let mounted = false;
        const input = { files: null, dispatchEvent: vi.fn() };
        vi.stubGlobal('document', { querySelector: selector => {
            expect(selector).toBe('[data-testid="batch-file-input"]');
            return mounted ? input : null;
        } });
        vi.stubGlobal('DataTransfer', class {
            files = [];
            items = { add: file => this.files.push(file) };
        });
        const driver = { executeScript: vi.fn(async (fn, ...args) => fn(...args)),
            wait: vi.fn(async (predicate, timeout) => {
                expect(timeout).toBe(20_000);
                expect(await predicate()).toBe(false);
                expect(input.dispatchEvent).not.toHaveBeenCalled();
                mounted = true;
                expect(await predicate()).toBe(true);
            }) };
        await setBatchFiles(driver, ['a.png', 'b.png'].map(name => ({ name, type: 'image/png', base64: btoa('fixture') })));
        expect(input.files.map(file => file.name)).toEqual(['a.png', 'b.png']);
        expect(input.dispatchEvent).toHaveBeenCalledOnce();
        expect(input.dispatchEvent.mock.calls[0][0].type).toBe('change');
        expect(input.dispatchEvent.mock.calls[0][0].bubbles).toBe(true);
    });
    it('does not inject files after a readiness timeout', async () => {
        const driver = { wait: vi.fn().mockRejectedValue(new Error('input did not mount')), executeScript: vi.fn() };
        await expect(setBatchFiles(driver, [])).rejects.toThrow('input did not mount');
        expect(driver.executeScript).not.toHaveBeenCalled();
    });
});
describe('ZIP handoff observer', () => {
    function setup() {
        vi.stubGlobal('window', {});
        const click = vi.fn(function (...args) { return [this.href, ...args]; });
        class Anchor {}
        Anchor.prototype.click = click;
        vi.stubGlobal('HTMLAnchorElement', Anchor);
        vi.spyOn(URL, 'createObjectURL');
        vi.spyOn(URL, 'revokeObjectURL');
        installBatchZipObserver();
        return { Anchor, click };
    }
    it('preserves native click and captures bytes even when the URL is immediately revoked', async () => {
        const { Anchor, click } = setup();
        const blob = new Blob(['zip bytes'], { type: 'application/zip' });
        const anchor = Object.assign(new Anchor(), { href: URL.createObjectURL(blob), download: 'batch.zip' });
        expect(anchor.click('argument')).toEqual([anchor.href, 'argument']);
        URL.revokeObjectURL(anchor.href);
        expect(click).toHaveBeenCalledExactlyOnceWith('argument');
        await vi.waitFor(() => expect(window.__screenhelloBatchDownloads.records[0].base64).toBe(btoa('zip bytes')));
        anchor.click();
        expect(window.__screenhelloBatchDownloads.records).toHaveLength(1);
    });
    it('does not observe images or read oversized ZIPs, and rejects an extra ZIP attempt', () => {
        const { Anchor, click } = setup();
        const blobs = [new Blob(['image'], { type: 'image/avif' }), new Blob([new Uint8Array(262_145)], { type: 'application/zip' })];
        const read = vi.spyOn(blobs[1], 'arrayBuffer');
        const urls = blobs.map(blob => URL.createObjectURL(blob));
        const anchor = Object.assign(new Anchor(), { href: urls[0], download: 'file' });
        anchor.click();
        expect(window.__screenhelloBatchDownloads.records).toHaveLength(0);
        anchor.href = urls[1]; anchor.click(); anchor.click(); anchor.click();
        expect(read).not.toHaveBeenCalled();
        expect(window.__screenhelloBatchDownloads).toMatchObject({ overflow: true, records: [{ error: 'batch-zip-size-invalid' }, { error: 'batch-zip-size-invalid' }] });
        expect(click).toHaveBeenCalledTimes(4);
        urls.forEach(url => URL.revokeObjectURL(url));
    });
});
