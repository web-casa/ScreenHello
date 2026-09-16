// Serialized into the page. Explicitly armed only around the six registered AVIF
// exports. Preserve real URL/click behavior; release bytes after each handoff.
export function installContinuousDownloadObserver() {
    const state = window.__screenhelloContinuousDownloads = { active: false, records: [], overflow: false };
    const blobs = new Map();
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    const click = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = function (...args) {
        const url = Reflect.apply(create, this, args);
        if (state.active && args[0]?.type === 'image/avif') blobs.set(url, args[0]);
        return url;
    };
    URL.revokeObjectURL = function (...args) {
        const result = Reflect.apply(revoke, this, args);
        blobs.delete(args[0]);
        return result;
    };
    HTMLAnchorElement.prototype.click = function (...args) {
        const blob = blobs.get(this.href);
        if (state.active && this.download && blob) {
            blobs.delete(this.href);
            if (state.records.length >= 6) state.overflow = true;
            else {
                const record = { name: this.download, type: blob.type, size: blob.size, base64: null, error: null };
                state.records.push(record);
                if (blob.size < 1 || blob.size > 8_388_608) record.error = 'continuous-avif-size-invalid';
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
