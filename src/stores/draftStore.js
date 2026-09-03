/**
 * IndexedDB 草稿存储（M6.1–M6.5）。
 *
 * 纯 Promise 封装，不持有 MobX 可观察状态。数据库名 `shoteasy`，当前版本为 2：
 *   - `projects` 仓库：keyPath='key'，记录 { key, doc, updatedAt }，doc 为 ProjectDocument。
 *   - `assets` 仓库：keyPath='id'，记录图片字节、MIME 与元数据；读取时恢复 Blob。
 *   - `presets` 仓库：保存完整样式预设和可选背景字节，读取时恢复 Blob。
 *   - `recentProjects` 仓库：保存最近项目的便携 ZIP 字节，读取时恢复 Blob，供新会话本地重开。
 *
 * 多个 persistence key 共用一个数据库但互不干扰：projects 以 key 隔离，assets 以 key 字段归属，
 * 清空某 key 时只删该 key 的 project 与归属 assets。
 *
 * 异常策略：IndexedDB 不可用（无 API / 打开失败 / 被阻塞）时标记 unavailable 并在后续调用直接 reject，
 * 由 draftService 降级为「无草稿模式」，不影响编辑与导出（technical-design「IndexedDB 草稿·异常处理」）。
 */

import { browserPlatform } from '../platform/browserPlatform';

const DEFAULT_DB_NAME = 'shoteasy';
const DB_VERSION = 2;
const PROJECTS = 'projects';
const ASSETS = 'assets';
const PRESETS = 'presets';
const RECENT_PROJECTS = 'recentProjects';

const blobToBytes = async (blob) => {
    if (!(blob instanceof Blob)) return null;
    return new Uint8Array(await blob.arrayBuffer());
};

const bytesToBlob = (bytes, type) => {
    if (!bytes) return null;
    if (bytes instanceof Blob) return bytes;
    if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) return null;
    return new Blob([bytes], { type: type || 'application/octet-stream' });
};

export class DraftStore {
    constructor({ databaseName = DEFAULT_DB_NAME } = {}) {
        this.databaseName = databaseName;
        this._dbPromise = null;
        this._unavailable = false; // 一旦确认不可用，避免重复尝试打开
    }

    /** IndexedDB 是否可用（供 draftService 降级判断）。 */
    isAvailable() {
        return !this._unavailable && Boolean(browserPlatform.storage.getIndexedDB());
    }

    _open() {
        if (this._unavailable) return Promise.reject(new Error('idb-unavailable'));
        if (this._dbPromise) return this._dbPromise;
        this._dbPromise = new Promise((resolve, reject) => {
            const indexedDB = browserPlatform.storage.getIndexedDB();
            if (!indexedDB) {
                this._unavailable = true;
                reject(new Error('idb-unavailable'));
                return;
            }
            const req = indexedDB.open(this.databaseName, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'key' });
                if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS, { keyPath: 'id' });
                if (!db.objectStoreNames.contains(PRESETS)) db.createObjectStore(PRESETS, { keyPath: 'id' });
                if (!db.objectStoreNames.contains(RECENT_PROJECTS)) db.createObjectStore(RECENT_PROJECTS, { keyPath: 'id' });
            };
            req.onsuccess = () => {
                const db = req.result;
                db.onversionchange = () => {
                    db.close();
                    this._dbPromise = null;
                };
                resolve(db);
            };
            req.onerror = () => reject(req.error || new Error('idb-open-failed'));
            req.onblocked = () => reject(new Error('idb-blocked'));
        }).catch((err) => {
            // 打开失败视为不可用，清空缓存以便降级；不在此处提示，由 service 决定
            this._unavailable = true;
            this._dbPromise = null;
            throw err;
        });
        return this._dbPromise;
    }

    _transaction(storeName, mode, operation) {
        return this._open().then((db) => new Promise((resolve, reject) => {
            let tx;
            let result;
            let settled = false;
            const fail = (error) => {
                if (settled) return;
                settled = true;
                reject(error || new Error('idb-transaction-failed'));
                try { tx?.abort(); } catch { /* transaction may already be inactive */ }
            };
            try {
                tx = db.transaction(storeName, mode);
                tx.oncomplete = () => {
                    if (settled) return;
                    settled = true;
                    resolve(result);
                };
                tx.onerror = () => fail(tx.error || new Error('idb-transaction-failed'));
                tx.onabort = () => fail(tx.error || new Error('idb-transaction-aborted'));
                Promise.resolve(operation(tx.objectStore(storeName)))
                    .then((value) => { result = value; })
                    .catch(fail);
            } catch (error) {
                fail(error);
            }
        }));
    }

    _request(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('idb-request-failed'));
        });
    }

    /** 写入（或覆盖）一个项目的 ProjectDocument。 */
    async saveProject(key, doc, metadata = {}) {
        await this._transaction(PROJECTS, 'readwrite', (store) =>
            this._request(store.put({
                key,
                doc,
                kind: metadata.kind || 'draft',
                name: metadata.name || null,
                updatedAt: Date.now(),
            }))
        );
    }

    /** 读取一个项目的 ProjectDocument；不存在返回 null。 */
    async loadProject(key) {
        const rec = await this.loadProjectRecord(key);
        return rec ? rec.doc : null;
    }

    async loadProjectRecord(key) {
        return this._transaction(PROJECTS, 'readonly', (store) => this._request(store.get(key)));
    }

    async listProjects({ kind } = {}) {
        const records = await this._transaction(PROJECTS, 'readonly', (store) => this._request(store.getAll()));
        return (records || [])
            .filter((record) => !kind || (record.kind || 'draft') === kind)
            .map((record) => ({
                key: record.key,
                kind: record.kind || 'draft',
                name: record.name || null,
                updatedAt: record.updatedAt || 0,
            }))
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }

    /** 删除一个项目。 */
    async deleteProject(key) {
        await this._transaction(PROJECTS, 'readwrite', (store) => this._request(store.delete(key)));
    }

    /** 写入（或覆盖）一个资源 Blob。payload = { blob, type, name, purpose }。 */
    async saveAsset(id, key, payload) {
        const bytes = await blobToBytes(payload.blob);
        if (!bytes) throw new Error('asset-blob-invalid');
        await this._transaction(ASSETS, 'readwrite', (store) => this._request(store.put({
            id, key,
            bytes,
            type: payload.type || (payload.blob && payload.blob.type) || 'application/octet-stream',
            name: payload.name || 'asset',
            purpose: payload.purpose || 'background',
            createdAt: Date.now()
        })));
    }

    /** 读取一个资源记录 { blob, type, name, purpose }；不存在返回 null。 */
    async loadAsset(id) {
        const record = await this._transaction(ASSETS, 'readonly', (store) => this._request(store.get(id)));
        if (!record) return null;
        // v1/v2 early records stored Blob directly; keep them readable.
        const blob = record.blob instanceof Blob ? record.blob : bytesToBlob(record.bytes, record.type);
        if (!blob) return null;
        const { bytes, ...metadata } = record;
        void bytes;
        return { ...metadata, blob };
    }

    /** 删除一个资源。 */
    async deleteAsset(id) {
        await this._transaction(ASSETS, 'readwrite', (store) => this._request(store.delete(id)));
    }

    /** 删除归属某 key 的全部资源（清空项目时清理孤立资源）。 */
    async deleteAssetsByKey(key) {
        await this._transaction(ASSETS, 'readwrite', (store) => new Promise((resolve, reject) => {
            const cursorReq = store.openCursor();
            cursorReq.onsuccess = () => {
                const cursor = cursorReq.result;
                if (!cursor) return resolve();
                if (cursor.value && cursor.value.key === key) cursor.delete();
                cursor.continue();
            };
            cursorReq.onerror = () => reject(cursorReq.error || new Error('idb-cursor-failed'));
        }));
    }

    async savePreset(record) {
        const { backgroundBlob, ...metadata } = record;
        const backgroundBytes = backgroundBlob ? await blobToBytes(backgroundBlob) : null;
        await this._transaction(PRESETS, 'readwrite', (store) => this._request(store.put({
            ...metadata,
            backgroundBytes,
            backgroundBlobType: backgroundBlob?.type || record.backgroundType || null,
            updatedAt: Date.now(),
            createdAt: record.createdAt || Date.now(),
        })));
    }

    async loadPreset(id) {
        const record = await this._transaction(PRESETS, 'readonly', (store) => this._request(store.get(id)));
        if (!record) return null;
        const backgroundBlob = record.backgroundBlob instanceof Blob
            ? record.backgroundBlob
            : bytesToBlob(record.backgroundBytes, record.backgroundBlobType || record.backgroundType);
        const { backgroundBytes, ...metadata } = record;
        void backgroundBytes;
        return { ...metadata, backgroundBlob };
    }

    async listPresets() {
        const records = await this._transaction(PRESETS, 'readonly', (store) => this._request(store.getAll()));
        return (records || [])
            .map(({ backgroundBlob, backgroundBytes, ...record }) => ({
                ...record,
                hasBackgroundAsset: Boolean(backgroundBlob || backgroundBytes),
            }))
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }

    async deletePreset(id) {
        await this._transaction(PRESETS, 'readwrite', (store) => this._request(store.delete(id)));
    }

    async saveRecentProject(record) {
        const { blob, ...metadata } = record;
        const bytes = await blobToBytes(blob);
        if (!bytes) throw new Error('recent-project-blob-invalid');
        await this._transaction(RECENT_PROJECTS, 'readwrite', (store) => this._request(store.put({
            ...metadata,
            bytes,
            blobType: blob.type || 'application/octet-stream',
            updatedAt: Date.now(),
        })));
        // Keep local recents bounded. A pruning failure must not turn an
        // already-saved project into an apparent save failure.
        await this._pruneRecentProjects(12).catch(() => {});
    }

    async _pruneRecentProjects(limit) {
        const records = await this._transaction(RECENT_PROJECTS, 'readonly', (store) => this._request(store.getAll()));
        const stale = (records || [])
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
            .slice(limit);
        for (const record of stale) await this.deleteRecentProject(record.id);
    }

    async loadRecentProject(id) {
        const record = await this._transaction(RECENT_PROJECTS, 'readonly', (store) => this._request(store.get(id)));
        if (!record) return null;
        const blob = record.blob instanceof Blob ? record.blob : bytesToBlob(record.bytes, record.blobType);
        if (!blob) return null;
        const { bytes, ...metadata } = record;
        void bytes;
        return { ...metadata, blob };
    }

    async listRecentProjects() {
        const records = await this._transaction(RECENT_PROJECTS, 'readonly', (store) => this._request(store.getAll()));
        return (records || [])
            .map(({ blob, bytes, ...record }) => ({
                ...record,
                size: blob?.size || bytes?.byteLength || record.size || 0,
            }))
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, 12);
    }

    async deleteRecentProject(id) {
        await this._transaction(RECENT_PROJECTS, 'readwrite', (store) => this._request(store.delete(id)));
    }

    /** 关闭当前实例持有的连接；不删除任何用户草稿。 */
    async close() {
        const dbPromise = this._dbPromise;
        this._dbPromise = null;
        if (!dbPromise) return;
        try {
            const db = await dbPromise;
            db.close();
        } catch {
            // 打开失败时连接不存在，无需额外处理。
        }
    }
}
