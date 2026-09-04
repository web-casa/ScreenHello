import { makeAutoObservable, reaction, runInAction } from 'mobx';
import { validateDocument } from '@utils/projectDocument';
import { browserPlatform } from '../platform/browserPlatform';
import { prepareWorkspaceImage } from '@utils/imageValidation';

const AUTOSAVE_DEBOUNCE = 750;

const makeError = (code, message, extra = {}) => Object.assign(new Error(message || code), { code, ...extra });

/**
 * 草稿编排服务（M6）。
 *
 * 这个服务只在 App 明确传入 persistence 时启动。保存任务按顺序执行，且每个
 * 异步任务都带有 setup/clear 代际号，避免换 key、清空或卸载后旧任务回写项目。
 */
export class DraftService {
    status = 'unavailable';
    lastSavedAt = null;
    errorCode = null;

    constructor(root) {
        this.root = root;
        this.config = null;          // { key, autoRestore }
        this._disposer = null;
        this._saveTimer = null;
        this._saveChain = Promise.resolve();
        this._autosaveEnabled = true;
        this._blockedImageSrc = null;
        this._restoring = false;
        this._restorePromise = null;
        this._generation = 0;
        this._storageWarningShown = false;
        makeAutoObservable(this, {
            root: false,
            config: false,
            _disposer: false,
            _saveTimer: false,
            _saveChain: false,
            _restorePromise: false,
        });
    }

    isEnabled() { return !!this.config; }
    getKey() { return this.config?.key || null; }

    _isCurrent(key, generation) {
        return this.config?.key === key && this._generation === generation;
    }

    /** 登记配置并启动自动保存。config 为 false/undefined 时禁用。 */
    setup(config) {
        this.teardown();
        this._autosaveEnabled = true;
        this._blockedImageSrc = null;
        this._storageWarningShown = false;
        this.errorCode = null;
        this.lastSavedAt = null;
        const key = typeof config?.key === 'string' ? config.key.trim() : '';
        this.config = key
            ? { key, autoRestore: config.autoRestore !== false }
            : null;
        if (!this.config) {
            this.status = 'unavailable';
            return;
        }
        this.status = this.root.draftStore.isAvailable() ? 'idle' : 'unavailable';

        // 注册清空钩子：用户删除截图时删除草稿与归属资源（M6.10）。
        this.root.editor.setClearDraftHook(() => { this.clear(); });
        this._disposer = reaction(
            // 项目数据签名：视图缩放、主题和面板状态不进入保存触发条件。
            () => JSON.stringify({ p: this.root.editor.serializeProject(), resourceRevision: this.root.imageStore.resourceRevision }),
            () => this._scheduleSave(),
            { fireImmediately: false }
        );
    }

    /** 关闭自动保存并释放反应与定时器；不删除已存草稿（M6.11）。 */
    teardown() {
        this._generation += 1;
        if (this._disposer) { this._disposer(); this._disposer = null; }
        if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
        this.root.editor.setClearDraftHook(null);
        this.config = null;
        this.status = 'unavailable';
        this.errorCode = null;
        // 旧恢复任务会在下一次 await 后通过代际校验放弃，不再写入 store。
        this._restorePromise = null;
    }

    _scheduleSave() {
        if (!this.config || !this._autosaveEnabled || this._restoring) return;
        this.status = 'waiting';
        this.errorCode = null;
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            this._saveTimer = null;
            this._enqueueSave();
        }, AUTOSAVE_DEBOUNCE);
    }

    _enqueueSave() {
        const context = this.config
            ? { key: this.config.key, generation: this._generation }
            : null;
        if (context && this._isCurrent(context.key, context.generation)) {
            this.status = 'saving';
            this.errorCode = null;
        }
        const task = this._saveChain
            .catch(() => {})
            .then(() => context ? this._save(context) : undefined)
            .then((result) => {
                if (context && this._isCurrent(context.key, context.generation) && result) {
                    runInAction(() => {
                        this.status = result === 'cleared' ? 'idle' : 'saved';
                        this.lastSavedAt = Date.now();
                        this.errorCode = null;
                    });
                }
                return Boolean(result);
            })
            .catch((err) => {
                if (context && this._isCurrent(context.key, context.generation)) this._handleSaveError(err);
                return false;
            });
        this._saveChain = task.catch(() => {});
        return task;
    }

    /** 立即保存（跳过防抖）；供验证或宿主主动 flush 使用。 */
    async flush() {
        if (!this.config || !this._autosaveEnabled || this._restoring) return false;
        clearTimeout(this._saveTimer);
        this._saveTimer = null;
        return this._enqueueSave();
    }

    async _save({ key, generation }) {
        if (!this._isCurrent(key, generation) || !this._autosaveEnabled || this._restoring) return false;
        const layers = this.root.imageStore.list;
        if (!layers.length) {
            await this.root.draftStore.deleteProject(key);
            if (!this._isCurrent(key, generation)) return;
            await this.root.draftStore.deleteAssetsByKey(key);
            return 'cleared';
        }

        const doc = this.root.editor.serializeProject();
        // 1) 所有图片 Blob 先写入 assets。任一失败时不覆盖 ProjectDocument。
        const savedAssetIds = new Set();
        for (const layer of layers) {
            if (savedAssetIds.has(layer.assetId)) continue;
            const image = this.root.imageStore.resolve(layer);
            if (!image?.src || this._blockedImageSrc === image.src) {
                throw makeError('image-blob-unavailable', 'image blob unavailable', { src: image?.src || null });
            }
            const imageBlob = image.blob || await this._srcToBlob(image.src);
            if (!imageBlob) {
                throw makeError('image-blob-unavailable', 'image blob unavailable', { src: image.src });
            }
            if (!this._isCurrent(key, generation)) return false;
            await this.root.draftStore.saveAsset(layer.assetId, key, {
                blob: imageBlob,
                purpose: 'image',
                name: image.name,
                type: image.type || imageBlob.type,
            });
            savedAssetIds.add(layer.assetId);
            if (!this._isCurrent(key, generation)) return false;
        }

        // 2) 项目引用的背景 Blob 写入 assets。
        const backgroundAssetId = doc.option?.backgroundAssetId;
        if (backgroundAssetId) {
            const background = this.root.assetStore.get(backgroundAssetId);
            if (!background?.blob) {
                throw makeError('background-asset-missing', 'background asset missing');
            }
            await this.root.draftStore.saveAsset(backgroundAssetId, key, {
                blob: background.blob,
                purpose: 'background',
                name: background.name,
                type: background.type,
            });
            if (!this._isCurrent(key, generation)) return false;
        }

        // 3) 只有关联 assets 全部成功后才写 ProjectDocument。
        await this.root.draftStore.saveProject(key, doc, {
            kind: 'draft',
            name: this.root.editor.img?.name || '自动草稿',
        });
        return this._isCurrent(key, generation) ? 'saved' : false;
    }

    /** 把 img.src（blob:/data:/http:）统一转 Blob；失败由调用方降级。 */
    async _srcToBlob(src) {
        if (!src || typeof fetch === 'undefined') return null;
        try {
            const response = await fetch(src);
            if (!response.ok) return null;
            const blob = await response.blob();
            return blob && blob.size > 0 ? blob : null;
        } catch {
            return null;
        }
    }

    _handleSaveError(err) {
        const code = err?.code || '';
        const text = String(err?.name || err?.message || err || '');
        this.status = 'error';
        this.errorCode = code || err?.message || err?.name || 'draft-save-failed';
        if (code === 'image-blob-unavailable') {
            // 同一个无法 fetch 的远程地址不重复触发网络请求；换图后会自动重试。
            const repeated = Boolean(err.src && this._blockedImageSrc === err.src);
            this._blockedImageSrc = err.src || null;
            if (!repeated) this.root.editor.message?.warning?.('当前图片无法保存草稿，编辑和导出仍可继续');
        } else if (code === 'background-asset-missing') {
            this._autosaveEnabled = false;
            this.root.editor.message?.warning?.('背景资源缺失，已停止自动保存，编辑和导出仍可继续');
        } else if (/quota/i.test(text)) {
            this._autosaveEnabled = false;
            this.root.editor.message?.warning?.('存储空间不足，已停止自动保存，本次编辑仍可继续');
        } else if (/unavailable|blocked|open-failed|security|invalidstate/i.test(text)) {
            this._autosaveEnabled = false;
            this._warnStorageUnavailable();
        } else {
            this._autosaveEnabled = false;
            this.root.editor.message?.warning?.('本地草稿保存失败，已停止自动保存，本次编辑仍可继续');
        }
    }

    _warnStorageUnavailable() {
        this.status = 'unavailable';
        this.errorCode = this.errorCode || 'draft-storage-unavailable';
        if (this._storageWarningShown) return;
        this._storageWarningShown = true;
        this.root.editor.message?.warning?.('本地草稿存储不可用，本次编辑仍可继续，但关闭页面后不会自动恢复');
    }

    /**
     * 恢复草稿。同一挂载周期内只允许一个恢复任务，避免 React StrictMode
     * 的重复 effect 创建多份 object URL 或互相覆盖。
     */
    restore() {
        if (!this.config || !this.config.autoRestore) return Promise.resolve(false);
        if (!this.root.draftStore.isAvailable()) {
            this._warnStorageUnavailable();
            return Promise.resolve(false);
        }
        if (this.root.editor.img?.src) return Promise.resolve(false);
        if (this._restorePromise) return this._restorePromise;
        const key = this.config.key;
        const generation = this._generation;
        const task = this._runRestore(key, generation);
        const wrapped = task.finally(() => {
            if (this._restorePromise === wrapped) this._restorePromise = null;
        });
        this._restorePromise = wrapped;
        return wrapped;
    }

    async _runRestore(key, generation) {
        const preparedImages = [];
        const preparedByAssetId = new Map();
        let imagesInstalled = false;
        let backgroundRestored = null;
        let committed = false;
        try {
            const raw = await this.root.draftStore.loadProject(key);
            if (!this._isCurrent(key, generation) || this.root.editor.img?.src || !raw) return false;
            const { ok, doc: valid } = validateDocument(raw);
            if (!ok || !valid) {
                this.root.editor.message?.warning?.('草稿数据已损坏或版本不受支持，已忽略');
                return false;
            }
            if (!valid.images.length || valid.images.some((image) => !image.assetId)) return false;

            for (let index = 0; index < valid.images.length; index += 1) {
                const image = valid.images[index];
                const shared = preparedByAssetId.get(image.assetId);
                if (shared) {
                    preparedImages.push(shared);
                    continue;
                }
                const imageRecord = await this.root.draftStore.loadAsset(image.assetId);
                if (!imageRecord?.blob) {
                    this.root.editor.message?.info?.('草稿原图资源缺失，无法恢复');
                    return false;
                }
                if (!this._isCurrent(key, generation) || this.root.editor.img?.src) return false;
                const imageFile = new File([imageRecord.blob], image.name || imageRecord.name || `image-${index + 1}`, {
                    type: image.type || imageRecord.type || imageRecord.blob.type,
                });
                const prepared = await prepareWorkspaceImage(imageFile, {
                    retainObjectUrl: true,
                    role: `draft-image-${index + 1}`,
                });
                const runtimeImage = {
                    src: prepared.url,
                    width: prepared.width,
                    height: prepared.height,
                    type: image.type || imageRecord.type,
                    name: image.name || imageRecord.name,
                    assetId: image.assetId,
                    blob: imageFile,
                    _ownsObjectUrl: true,
                };
                preparedImages.push(runtimeImage);
                preparedByAssetId.set(image.assetId, runtimeImage);
                if (!this._isCurrent(key, generation) || this.root.editor.img?.src) return false;
            }
            valid.images = valid.images.map((image, index) => ({
                ...image,
                width: preparedImages[index].width,
                height: preparedImages[index].height,
                type: preparedImages[index].type,
                name: preparedImages[index].name,
            }));

            const backgroundAssetId = valid.option?.backgroundAssetId;
            if (backgroundAssetId) {
                const backgroundRecord = await this.root.draftStore.loadAsset(backgroundAssetId);
                if (!backgroundRecord?.blob) {
                    this.root.editor.message?.info?.('草稿背景资源缺失，无法恢复');
                    return false;
                }
                const backgroundFile = new File([backgroundRecord.blob], backgroundRecord.name || 'background', {
                    type: backgroundRecord.type || backgroundRecord.blob.type,
                });
                await prepareWorkspaceImage(backgroundFile, { role: 'draft-background-image' });
                if (!this._isCurrent(key, generation) || this.root.editor.img?.src) return false;
                backgroundRestored = this.root.assetStore.restore(backgroundAssetId, backgroundFile, {
                    name: backgroundRecord.name,
                    type: backgroundRecord.type,
                });
                if (!backgroundRestored) {
                    this.root.editor.message?.info?.('草稿背景资源无法加载，无法恢复');
                    return false;
                }
            }

            this._restoring = true;
            this.root.imageStore.replaceProject(valid.images, preparedImages);
            imagesInstalled = true;
            if (!this._isCurrent(key, generation)) return false;
            this.root.editor.restoreProject(valid);
            this.root.history.reset();
            committed = true;
            runInAction(() => {
                this.status = 'saved';
                this.lastSavedAt = Date.now();
                this.errorCode = null;
            });
            return true;
        } catch (error) {
            // IndexedDB 不可用或瞬时错误：保持初始页，继续允许编辑/导出并给出一次提示。
            const code = `${error?.code || ''} ${error?.message || ''}`;
            if (/image(?:-\d+)?-(invalid|type-unsupported|decode-failed|dimensions-invalid|pixels-too-large)/.test(code)) {
                this.root.editor.message?.warning?.('草稿图片资源已损坏或尺寸过大，已忽略');
            } else {
                this._warnStorageUnavailable();
            }
            return false;
        } finally {
            if (this._generation === generation) this._restoring = false;
            if (!committed) {
                if (imagesInstalled) this.root.imageStore.clearAll({ release: true });
                else new Set(preparedImages.map((image) => image.src))
                    .forEach((src) => browserPlatform.file.revokeObjectURL(src));
                if (backgroundRestored) this.root.assetStore.release(backgroundRestored.id);
            }
        }
    }

    /** 清空当前项目：删除该 key 的 project 与归属 assets（M6.10）。 */
    async clear() {
        if (!this.config) return false;
        const key = this.config.key;
        this._generation += 1;
        this._blockedImageSrc = null;
        if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
        try {
            // 先让已经排队的旧保存任务结束；代际号已变化，它们不会再写 project。
            await this._saveChain.catch(() => {});
            await this.root.draftStore.deleteProject(key);
            await this.root.draftStore.deleteAssetsByKey(key);
            runInAction(() => {
                this.status = 'idle';
                this.lastSavedAt = Date.now();
                this.errorCode = null;
            });
            return true;
        } catch (error) {
            runInAction(() => {
                this.status = 'error';
                this.errorCode = error?.code || error?.message || 'draft-clear-failed';
            });
            return false;
        }
    }
}
