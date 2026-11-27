import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { parseProbeRun, probeCompileArguments, validateProbeCapture } from '../../scripts/screencapturekit-probe.mjs';

const result = { status: 'passed', backend: 'screencapturekit', width: 3840, height: 2160, imageBytesPersisted: false };
describe('ScreenCaptureKit probe boundary', () => {
    it.each(['arm64', 'x86_64'])('compiles %s for the screenshot API baseline', (arch) => {
        const args = probeCompileArguments(arch, '/tmp/output with spaces');
        expect(args).toContain(`${arch}-apple-macos14.0`);
        expect(args.at(-1)).toBe('/tmp/output with spaces');
        expect(args).not.toContain('--capture-main-display');
    });
    it('records permission denial and timeout without leaking native error output', () => {
        expect(parseProbeRun({ status: 2, stdout: '{"status":"system-permission-required"}' })).toEqual({ status: 'system-permission-required' });
        expect(parseProbeRun({ error: { code: 'ETIMEDOUT' }, stdout: 'private' })).toEqual({ status: 'timed-out' });
        expect(parseProbeRun({ status: 2, stdout: '{"status":"capture-failed","path":"private"}' })).toEqual({ status: 'process-failed' });
        expect(parseProbeRun({ status: 0, stdout: JSON.stringify(result) })).toEqual(result);
        expect(parseProbeRun({ status: 0, stdout: '{}' })).toEqual({ status: 'invalid-response' });
    });
    it('rejects unsupported architectures', () => {
        expect(() => probeCompileArguments('amd64', '/tmp/output')).toThrow('sck-probe-architecture-invalid');
    });
    it('accepts only bounded dimensions and no persisted image payload', () => {
        expect(validateProbeCapture(result)).toEqual(result);
        for (const value of [null, {}, { ...result, width: 0 }, { ...result, height: -1 },
            { ...result, width: 7681, height: 4320 }, { ...result, width: 1.2 },
            { ...result, imageBytesPersisted: true }, { ...result, title: 'private' }, { ...result, status: 'failed' }]) {
            expect(() => validateProbeCapture(value)).toThrow('sck-probe-capture-invalid');
        }
    });
    it.skipIf(process.platform === 'darwin')('fails closed on a non-macOS host', () => {
        const processResult = spawnSync(process.execPath, ['scripts/screencapturekit-probe.mjs', '--output', '/tmp/should-not-create-sck-output'], { encoding: 'utf8' });
        expect(processResult.status).toBe(1);
        expect(processResult.stderr).toContain('sck-probe-native-macos-required');
    });
});
