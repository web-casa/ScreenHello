// Serialized into WebDriver pages. Observe only the two registered ZIP handoffs.
// Keep native click/URL behavior; discard transient base64 after saving the bytes.
export function installBatchZipObserver() {
    const state = window.__screenhelloBatchDownloads = { records: [], overflow: false };
    const blobs = new Map();
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    const click = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = function (...args) {
        const url = Reflect.apply(create, this, args);
        if (args[0]?.type === 'application/zip') blobs.set(url, args[0]);
        return url;
    };
    URL.revokeObjectURL = function (...args) {
        const result = Reflect.apply(revoke, this, args);
        blobs.delete(args[0]);
        return result;
    };
    HTMLAnchorElement.prototype.click = function (...args) {
        const blob = blobs.get(this.href);
        if (this.download && blob) {
            if (state.records.length >= 2) state.overflow = true;
            else {
                const record = { name: this.download, type: blob.type, size: blob.size, base64: null, error: null };
                state.records.push(record);
                if (blob.size < 1 || blob.size > 262_144) record.error = 'batch-zip-size-invalid';
                else void blob.arrayBuffer().then(buffer => {
                    const bytes = new Uint8Array(buffer);
                    const parts = [];
                    for (let offset = 0; offset < bytes.length; offset += 8192) parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
                    record.base64 = btoa(parts.join(''));
                }).catch(error => { record.error = String(error?.message || error); });
            }
        }
        return Reflect.apply(click, this, args);
    };
}
