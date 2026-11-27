import { makeAutoObservable, observableRef } from 'mobx';
import { getRasterDevice } from '../utils/rasterDeviceConfig';
import { exportError } from '../utils/exportAsync';

// One pending notice per runtime; approval is neither persisted nor shared.
export class DeviceLicenseService {
    pending = null;
    constructor() {
        this._resolve = null;
        this._disposed = false;
        this._mounted = 0;
        makeAutoObservable(this, { pending: observableRef, _resolve: false, _disposed: false, _mounted: false });
    }
    mount() {
        this._mounted++;
        return () => { this._mounted--; if (!this._mounted) this.resolve(false); };
    }
    async request(frame, { signal } = {}) {
        const device = getRasterDevice(frame);
        if (!device) return;
        if (!device.available) throw exportError('device-render-failed');
        if (this._disposed || signal?.aborted) throw exportError('export-cancelled');
        // Shoteasy delivery notices are disabled by product choice, not by
        // relabeling asset rights. Attribution/metadata and safety checks remain.
        if (device.licenseStatus === 'MIT' || device.sourceProject === 'Shoteasy') return;
        if (this._disposed || signal?.aborted || !this._mounted) throw exportError('export-cancelled');
        if (this.pending) throw exportError('export-busy');
        const abort = () => this.resolve(false);
        try {
            const result = new Promise(resolve => { this._resolve = resolve; });
            this.pending = device;
            signal?.addEventListener('abort', abort, { once: true });
            if (!(await result)) throw exportError('export-cancelled');
        } finally { signal?.removeEventListener('abort', abort); }
    }
    resolve(accepted) {
        const resolve = this._resolve;
        this._resolve = null;
        this.pending = null;
        resolve?.(accepted === true && !this._disposed);
    }
    dispose() { this._disposed = true; this.resolve(false); }
}
