import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/utils/rasterDeviceConfig', () => ({
    getRasterDevice: frame => frame === 'surface-studio' ? { id: frame, available: true }
        : frame === 'surface-pro-8' ? { id: frame, available: false }
        : frame === 'pixel' ? { id: frame, available: true, licenseStatus: 'MIT' }
        : frame === 'shoteasy' ? { id: frame, available: true, sourceProject: 'Shoteasy', licenseStatus: 'unverified' }
        : frame === 'missing-shoteasy' ? { id: frame, available: false, sourceProject: 'Shoteasy' }
        : frame === 'monkr' ? { id: frame, available: true, sourceProject: 'Monkr', licenseStatus: 'unverified' }
        : frame === 'missing-pixel' ? { id: frame, available: false, licenseStatus: 'MIT' } : null,
}));
import { DeviceLicenseService } from '../../src/stores/deviceLicenseService';

describe('instance-scoped device license notice', () => {
    it('Shoteasy needs no modal while missing/aborted/disposed requests still fail', async () => {
        const service = new DeviceLicenseService();
        await expect(service.request('shoteasy')).resolves.toBeUndefined();
        await expect(service.request('shoteasy')).resolves.toBeUndefined();
        expect(service.pending).toBeNull();
        await expect(service.request('missing-shoteasy')).rejects.toMatchObject({ code: 'device-render-failed' });
        const controller = new AbortController(); controller.abort();
        await expect(service.request('shoteasy', { signal: controller.signal })).rejects.toMatchObject({ code: 'export-cancelled' });
        service.dispose();
        await expect(service.request('shoteasy')).rejects.toMatchObject({ code: 'export-cancelled' });
    });
    it('does not dismiss another source or another runtime notice when Shoteasy is requested', async () => {
        const first = new DeviceLicenseService(), second = new DeviceLicenseService();
        first.mount(); second.mount();
        const pending = first.request('monkr');
        await second.request('shoteasy');
        await first.request('shoteasy');
        expect(first.pending.id).toBe('monkr');
        expect(second.pending).toBeNull();
        first.resolve(true); await pending;
        first.dispose(); second.dispose();
    });
    it('MIT delivery needs no modal but still respects missing files, abort and dispose', async () => {
        const service = new DeviceLicenseService();
        await expect(service.request('pixel')).resolves.toBeUndefined(); expect(service.pending).toBeNull();
        await expect(service.request('missing-pixel')).rejects.toMatchObject({ code: 'device-render-failed' });
        const controller = new AbortController(); controller.abort();
        await expect(service.request('pixel', { signal: controller.signal })).rejects.toMatchObject({ code: 'export-cancelled' });
        service.dispose(); await expect(service.request('pixel')).rejects.toMatchObject({ code: 'export-cancelled' });
    });
    it('does not prompt for ordinary frames and never approves absent packs', async () => {
        const service = new DeviceLicenseService();
        await expect(service.request('none')).resolves.toBeUndefined();
        await expect(service.request('surface-pro-8')).rejects.toMatchObject({ code: 'device-render-failed' });
        await expect(service.request('surface-studio')).rejects.toMatchObject({ code: 'export-cancelled' });
    });
    it('supports cancel/confirm and requires fresh confirmation each time', async () => {
        const service = new DeviceLicenseService(); const unmount = service.mount();
        const cancelled = service.request('surface-studio');
        service.resolve(false);
        await expect(cancelled).rejects.toMatchObject({ code: 'export-cancelled' });
        const confirmed = service.request('surface-studio');
        service.resolve(true); service.resolve(true);
        await expect(confirmed).resolves.toBeUndefined();
        const again = service.request('surface-studio');
        expect(service.pending.id).toBe('surface-studio');
        unmount();
        await expect(again).rejects.toMatchObject({ code: 'export-cancelled' });
    });
    it('rejects concurrent requests, aborts, and does not share consent between runtimes', async () => {
        const first = new DeviceLicenseService(), second = new DeviceLicenseService();
        first.mount(); second.mount();
        const controller = new AbortController();
        const a = first.request('surface-studio', { signal: controller.signal });
        const b = second.request('surface-studio');
        await expect(first.request('surface-studio')).rejects.toMatchObject({ code: 'export-busy' });
        controller.abort();
        await expect(a).rejects.toMatchObject({ code: 'export-cancelled' });
        expect(first.pending).toBeNull(); expect(second.pending.id).toBe('surface-studio');
        second.dispose();
        await expect(b).rejects.toMatchObject({ code: 'export-cancelled' });
    });
});
