import { makeAutoObservable, reaction, runInAction } from 'mobx';
import { createStylePreset, normalizeWorkspaceName, validateStylePreset } from '@utils/stylePreset';
import { normalizeEditorExportSettings as normalizeExportSettings } from '@utils/exportSettings';
import { prepareWorkspaceImage } from '@utils/imageValidation';
import { analyzeImageSuggestions } from '@utils/imageSuggestions';
import { validateDocument } from '@utils/projectDocument';
import { isImageBackgroundKey } from '@utils/backgroundConfig';
import { showUndoToast } from '@utils/undoToast';
import {
    PRESET_ARCHIVE_MIME,
    PRESET_EXTENSION,
    PROJECT_ARCHIVE_MIME,
    PROJECT_EXTENSION,
} from '@utils/workspaceFormat';

const loadArchiveTools = () => import('@utils/workspaceArchive');

const createId = (prefix) => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}:${crypto.randomUUID()}`;
    }
    return `${prefix}:${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const projectPickerTypes = [{
    description: 'ScreenHello 项目',
    accept: { [PROJECT_ARCHIVE_MIME]: [PROJECT_EXTENSION] },
}];

const presetPickerTypes = [{
    description: 'ScreenHello 风格预设',
    accept: { [PRESET_ARCHIVE_MIME]: [PRESET_EXTENSION] },
}];

const fileNameFor = (name, extension) => `${normalizeWorkspaceName(name)}${extension}`;

export class WorkspaceStore {
    enabled = false;
    ready = false;
    busy = null;
    projectName = '未命名项目';
    currentRecentId = null;
    fileHandle = null;
    isDirty = false;
    lastSavedAt = null;
    saveErrorCode = null;
    exportSettings = normalizeExportSettings();
    presets = [];
    recentProjects = [];
    drafts = [];
    libraryStatus = 'loading';
    storage = {
        supported: false,
        usage: null,
        quota: null,
        persistence: 'unknown',
    };
    suggestions = { status: 'idle', result: null };
    _baselineSignature = null;
    _dirtyDisposer = null;
    _suggestionDisposer = null;
    _suggestionGeneration = 0;
    _setupGeneration = 0;
    _libraryRequest = 0;
    _storageRequest = 0;
    _persistenceRequest = 0;
    _operationGeneration = 0;
    _presetRequest = 0;

    constructor(root) {
        this.root = root;
        this.projectName = root.i18n.t('未命名项目');
        makeAutoObservable(this, {
            root: false,
            fileHandle: false,
            _dirtyDisposer: false,
            _suggestionDisposer: false,
        });
    }

    setup(enabled) {
        this.teardown();
        this.enabled = Boolean(enabled);
        if (!this.enabled) return;
        this.libraryStatus = 'loading';
        const generation = this._setupGeneration;
        this._baselineSignature = this._signature();
        this._dirtyDisposer = reaction(
            () => this._signature(),
            (signature) => {
                this.isDirty = signature !== this._baselineSignature;
                if (this.isDirty) this.saveErrorCode = null;
            }
        );
        this._suggestionDisposer = reaction(
            () => this.root.editor.img?.src || null,
            (src) => { void this.analyzeSuggestions(src); },
            { fireImmediately: true }
        );
        void Promise.all([this.refreshLibrary(), this.refreshStorage()]).finally(() => {
            if (generation === this._setupGeneration) runInAction(() => { this.ready = true; });
        });
    }

    teardown() {
        this._presetRequest += 1;
        this._setupGeneration += 1;
        this._libraryRequest += 1;
        this._storageRequest += 1;
        this._persistenceRequest += 1;
        this._operationGeneration += 1;
        this._dirtyDisposer?.();
        this._dirtyDisposer = null;
        this._suggestionDisposer?.();
        this._suggestionDisposer = null;
        this._suggestionGeneration += 1;
        this.enabled = false;
        this.ready = false;
        this.busy = null;
        this._setFileHandle(null);
        this.suggestions = { status: 'idle', result: null };
    }

    _signature() {
        return JSON.stringify({
            projectName: this.projectName,
            document: this.root.editor.serializeProject(),
            imageRevision: this.root.imageStore.resourceRevision,
            exportSettings: this.exportSettings,
        });
    }

    get projectFileStatus() {
        if (this.busy === 'save' || this.busy === 'save-as') return 'saving';
        if (this.saveErrorCode) return 'error';
        if (this.isDirty) return 'dirty';
        if (this.lastSavedAt) return 'saved';
        return 'never-saved';
    }

    _markClean({ saved = true, signature = this._signature() } = {}) {
        this._baselineSignature = signature;
        this.isDirty = this._signature() !== signature;
        this.lastSavedAt = saved ? Date.now() : null;
        this.saveErrorCode = null;
    }

    _isOperationCurrent(operation) {
        return operation === this._operationGeneration && !this.root.isDisposed;
    }

    _assertOperation(operation) {
        if (!this._isOperationCurrent(operation)) {
            throw Object.assign(new Error('workspace-operation-cancelled'), { code: 'workspace-operation-cancelled' });
        }
    }

    _isOperationCancelled(error, operation) {
        return error?.code === 'workspace-operation-cancelled' || !this._isOperationCurrent(operation);
    }

    _setFileHandle(handle) {
        const previous = this.fileHandle;
        this.fileHandle = handle || null;
        if (previous && previous !== handle) {
            void this.root.platform.file.releaseHandle(previous).catch(() => {});
        }
    }

    setProjectName(value) {
        this.projectName = Array.from(String(value ?? ''))
            .filter((character) => character >= ' ' && character !== '\u007f')
            .join('')
            .slice(0, 80);
    }

    resetProject() {
        this._presetRequest += 1;
        this.root.renderTaskTracker?.changedProject();
        this.projectName = this.root.i18n.t("未命名项目");
        this.currentRecentId = null;
        this._setFileHandle(null);
        this.exportSettings = normalizeExportSettings();
        this._markClean({ saved: false });
    }

    setExportSettings(value, { replace = false } = {}) {
        const base = replace ? {} : (value?.format && value.format !== this.exportSettings.format
            ? { ratio: this.exportSettings.ratio } : this.exportSettings);
        this.exportSettings = normalizeExportSettings({ ...base, ...value });
    }

    async refreshLibrary() {
        const request = this._libraryRequest + 1;
        this._libraryRequest = request;
        if (!this.root.draftStore.isAvailable()) {
            runInAction(() => { this.libraryStatus = 'unavailable'; });
            return false;
        }
        try {
            const [presets, recentProjects, drafts] = await Promise.all([
                this.root.draftStore.listPresets(),
                this.root.draftStore.listRecentProjects(),
                this.root.draftStore.listProjects({ kind: 'draft' }),
            ]);
            if (request !== this._libraryRequest) return false;
            runInAction(() => {
                this.presets = presets;
                this.recentProjects = recentProjects;
                this.drafts = drafts;
                this.libraryStatus = 'ready';
            });
            return true;
        } catch {
            if (request !== this._libraryRequest) return false;
            runInAction(() => { this.libraryStatus = 'unavailable'; });
            return false;
        }
    }

    async refreshStorage() {
        const request = this._storageRequest + 1;
        this._storageRequest = request;
        const [estimate, persisted] = await Promise.all([
            this.root.platform.storage.estimate(),
            this.root.platform.storage.isPersisted(),
        ]);
        if (request !== this._storageRequest) return estimate;
        runInAction(() => {
            this.storage = {
                ...this.storage,
                supported: estimate.supported,
                usage: estimate.usage,
                quota: estimate.quota,
                persistence: persisted == null ? 'unsupported' : (persisted ? 'granted' : 'denied'),
            };
        });
        return estimate;
    }

    async requestPersistentStorage() {
        const request = this._persistenceRequest + 1;
        this._persistenceRequest = request;
        const result = await this.root.platform.storage.requestPersistence();
        if (request !== this._persistenceRequest) return result;
        runInAction(() => {
            this.storage = {
                ...this.storage,
                persistence: result == null ? 'unsupported' : (result ? 'granted' : 'denied'),
            };
        });
        if (result === true) this.root.editor.message?.success?.(this.root.i18n.t("浏览器已允许持久保存本地数据"));
        else if (result === false) this.root.editor.message?.info?.(this.root.i18n.t("浏览器未授予持久存储，请定期导出项目文件备份"));
        else this.root.editor.message?.info?.(this.root.i18n.t("当前浏览器不支持请求持久存储，请定期导出项目文件备份"));
        return result;
    }

    async analyzeSuggestions(src = this.root.editor.img?.src) {
        const generation = this._suggestionGeneration + 1;
        this._suggestionGeneration = generation;
        if (!src) {
            runInAction(() => { this.suggestions = { status: 'idle', result: null }; });
            return null;
        }
        runInAction(() => { this.suggestions = { status: 'analyzing', result: null }; });
        try {
            const result = await analyzeImageSuggestions(src);
            if (generation !== this._suggestionGeneration || src !== this.root.editor.img?.src) return null;
            runInAction(() => { this.suggestions = { status: 'ready', result }; });
            return result;
        } catch {
            if (generation === this._suggestionGeneration) {
                runInAction(() => { this.suggestions = { status: 'unavailable', result: null }; });
            }
            return null;
        }
    }

    applySuggestion(kind) {
        const suggestion = this.suggestions.result;
        if (!suggestion) return false;
        if (kind === 'background') this.root.option.setCustomSolidBackground(suggestion.edgeColor);
        else if (kind === 'inner-border') this.root.option.setInnerBorder(suggestion.innerBorder);
        else if (kind === 'frame') this.root.option.setFrame(suggestion.frame);
        else return false;
        this.root.editor.message?.success?.(this.root.i18n.t("已应用智能建议，可继续手动调整"));
        return true;
    }

    async _blobFromSource(src, errorCode) {
        if (!src || typeof fetch === 'undefined') throw Object.assign(new Error(errorCode), { code: errorCode });
        try {
            const response = await fetch(src);
            const blob = response.ok ? await response.blob() : null;
            if (!blob || blob.size <= 0 || (blob.type && !blob.type.startsWith('image/'))) throw new Error(errorCode);
            return blob;
        } catch {
            throw Object.assign(new Error(errorCode), { code: errorCode });
        }
    }

    _projectSnapshot() {
        const doc = this.root.editor.serializeProject();
        const asset = this.root.assetStore.get(doc.option.backgroundAssetId);
        return {
            doc,
            name: this.projectName,
            exportSettings: { ...this.exportSettings },
            signature: this._signature(),
            images: doc.images.map(metadata => {
                const resource = this.root.imageStore.resolve(metadata);
                return { metadata, blob: resource?.blob, src: resource?.src };
            }),
            background: doc.option.frameConf?.background?.type === 'image' ? {
                blob: asset?.blob, src: doc.option.frameConf.background.url,
                name: asset?.name || 'background', type: asset?.type,
            } : null,
        };
    }

    async _currentProjectParts(snapshot = this._projectSnapshot()) {
        if (!snapshot.images.length) throw Object.assign(new Error('project-image-missing'), { code: 'project-image-missing' });
        const images = [];
        for (const image of snapshot.images) {
            const blob = image.blob || await this._blobFromSource(image.src, 'project-image-unavailable');
            images.push({ blob, metadata: image.metadata });
        }
        let background = null;
        if (snapshot.background) {
            const captured = snapshot.background;
            const blob = captured.blob || await this._blobFromSource(captured.src, 'background-asset-missing');
            background = { blob, name: captured.name, type: captured.type || blob.type };
        }
        return { doc: snapshot.doc, images, background };
    }

    async _currentBackground(doc = this.root.editor.serializeProject()) {
        let background = null;
        if (doc.option?.frameConf?.background?.type === 'image') {
            const asset = this.root.assetStore.get(doc.option.backgroundAssetId);
            const blob = asset?.blob || await this._blobFromSource(
                doc.option.frameConf.background?.url,
                'background-asset-missing'
            );
            background = {
                blob,
                name: asset?.name || 'background',
                type: asset?.type || blob.type,
            };
        }
        return background;
    }

    async _cacheRecentProject(record, operation = null) {
        try {
            await this.root.draftStore.saveRecentProject(record);
            if (operation != null) this._assertOperation(operation);
            await this.refreshLibrary();
            if (operation != null) this._assertOperation(operation);
            return true;
        } catch (error) {
            if (operation != null && this._isOperationCancelled(error, operation)) throw error;
            const detail = `${error?.name || ''} ${error?.code || ''} ${error?.message || ''}`;
            this.root.editor.message?.warning?.(/quota/i.test(detail)
                ? this.root.i18n.t("项目文件已保存，但浏览器存储空间不足，未加入最近项目")
                : this.root.i18n.t("项目已处理，但最近项目记录未能写入本地存储"));
            return false;
        }
    }

    async createProjectBlob(snapshot = this._projectSnapshot()) {
        const { doc, images, background } = await this._currentProjectParts(snapshot);
        const { createProjectArchive } = await loadArchiveTools();
        return createProjectArchive({
            name: snapshot.name,
            document: doc,
            images,
            background,
            exportSettings: snapshot.exportSettings,
        });
    }

    async saveProject({ saveAs = false } = {}) {
        if (this.busy) return false;
        this._presetRequest += 1;
        this.saveErrorCode = null;
        this.busy = saveAs ? 'save-as' : 'save';
        const operation = this._operationGeneration;
        let selectedHandle = null;
        let adoptedHandle = false;
        try {
            this.projectName = normalizeWorkspaceName(this.projectName, this.root.i18n.t("未命名项目"));
            const suggestedName = fileNameFor(this.projectName, PROJECT_EXTENSION);
            let handle = saveAs ? null : this.fileHandle;
            let saveMethod = handle ? 'file-system' : 'download';
            if (!handle && this.root.platform.file.supportsFileSystemAccess()) {
                const selected = await this.root.platform.file.chooseSaveHandle({
                    suggestedName,
                    types: projectPickerTypes.map((type) => ({ ...type, description: this.root.i18n.t(type.description) })),
                    excludeAcceptAllOption: true,
                    id: 'screenhello-project-save',
                });
                if (selected.status === 'cancelled') return false;
                if (selected.status === 'selected') {
                    handle = selected.handle;
                    selectedHandle = handle;
                    saveMethod = 'file-system';
                }
            }
            this._assertOperation(operation);
            const snapshot = this._projectSnapshot();
            const blob = await this.createProjectBlob(snapshot);
            this._assertOperation(operation);
            if (handle) {
                await this.root.platform.file.writeToHandle(handle, blob);
            } else {
                await this.root.platform.export.download(blob, suggestedName);
            }
            this._assertOperation(operation);
            if (handle) {
                this._setFileHandle(handle);
                adoptedHandle = true;
            }
            const recentId = saveAs || !this.currentRecentId ? createId('recent') : this.currentRecentId;
            const cached = await this._cacheRecentProject({
                id: recentId,
                name: snapshot.name,
                fileName: suggestedName,
                blob,
                size: blob.size,
            }, operation);
            this._assertOperation(operation);
            runInAction(() => { this.currentRecentId = cached ? recentId : null; });
            this._markClean({ signature: snapshot.signature });
            await this.refreshStorage();
            this._assertOperation(operation);
            this.root.editor.message?.success?.(saveMethod === 'download'
                ? (cached ? this.root.i18n.t("项目已下载，并保存到最近项目") : this.root.i18n.t("项目已下载"))
                : this.root.i18n.t("项目已保存"));
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                runInAction(() => {
                    this.saveErrorCode = error?.code || error?.name || error?.message || 'project-save-failed';
                });
                this.root.editor.message?.error?.(this._messageForError(error, this.root.i18n.t("项目保存失败，请重试")));
            }
            return false;
        } finally {
            if (selectedHandle && !adoptedHandle) {
                await this.root.platform.file.releaseHandle(selectedHandle).catch(() => {});
            }
            if (this._isOperationCurrent(operation)) runInAction(() => { this.busy = null; });
        }
    }

    async openProjectPicker() {
        const operation = this._operationGeneration;
        let pendingHandle = null;
        try {
            const result = await this.root.platform.file.openWithPicker({
                types: projectPickerTypes.map((type) => ({ ...type, description: this.root.i18n.t(type.description) })),
                excludeAcceptAllOption: true,
                multiple: false,
                id: 'screenhello-project-open',
            });
            if (result.status === 'selected') pendingHandle = result.handle;
            this._assertOperation(operation);
            if (result.status !== 'selected') return result.status;
            const opening = this.openProjectFile(result.file, { handle: pendingHandle });
            pendingHandle = null;
            return opening;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, this.root.i18n.t("无法打开系统文件选择器")));
            }
            return false;
        } finally {
            if (pendingHandle) await this.root.platform.file.releaseHandle(pendingHandle).catch(() => {});
        }
    }

    async openProjectFile(file, { handle = null, recentId = null } = {}) {
        if (this.busy) {
            if (handle) await this.root.platform.file.releaseHandle(handle).catch(() => {});
            return false;
        }
        this.busy = 'open';
        this._presetRequest += 1;
        const operation = this._operationGeneration;
        let adoptedHandle = false;
        try {
            const { readWorkspaceArchive } = await loadArchiveTools();
            const decoded = await readWorkspaceArchive(file, { expectedKind: 'project' });
            this._assertOperation(operation);
            await this._applyProject(decoded, operation);
            this._assertOperation(operation);
            runInAction(() => {
                this.projectName = decoded.name;
                this.exportSettings = normalizeExportSettings(decoded.exportSettings);
                this._markClean();
            });
            const id = recentId || createId('recent');
            const cached = await this._cacheRecentProject({
                id,
                name: decoded.name,
                fileName: file.name || fileNameFor(decoded.name, PROJECT_EXTENSION),
                blob: file,
                size: file.size,
            }, operation);
            this._assertOperation(operation);
            runInAction(() => {
                this.currentRecentId = cached ? id : null;
            });
            this._setFileHandle(handle);
            adoptedHandle = true;
            await this.refreshStorage();
            this._assertOperation(operation);
            this.root.editor.message?.success?.(this.root.i18n.t("项目已打开"));
            if (decoded.exportSettingsWarnings?.length) this.root.editor.message?.warning?.(this.root.i18n.t('无法识别的压缩设置已恢复为标准导出；图片和图层未改变。'));
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, this.root.i18n.t("项目文件无法打开")));
            }
            return false;
        } finally {
            if (handle && !adoptedHandle) await this.root.platform.file.releaseHandle(handle).catch(() => {});
            if (this._isOperationCurrent(operation)) runInAction(() => { this.busy = null; });
        }
    }

    async _applyProject(decoded, operation = this._operationGeneration) {
        this.root.option.cancelBackgroundSelection();
        this.root.renderTaskTracker?.changedProject();
        this._assertOperation(operation);
        const validation = validateDocument(decoded.document);
        if (!validation.ok || !validation.doc.images.length) throw new Error('project-document-invalid');
        const doc = structuredClone(validation.doc);
        if (isImageBackgroundKey(doc.option.background) && !decoded.background) throw new Error('background-asset-missing');
        let backgroundAsset = null;
        const preparedImages = [];
        const preparedByAssetId = new Map();
        let imagesCommitted = false;
        try {
            const decodedImages = decoded.images?.length
                ? decoded.images
                : [{ file: decoded.image, assetId: doc.images[0]?.assetId }];
            if (decodedImages.length !== doc.images.length) throw new Error('project-image-count-invalid');
            for (let index = 0; index < decodedImages.length; index += 1) {
                const input = decodedImages[index];
                const file = input.file || input;
                const assetId = input.assetId || doc.images[index].assetId;
                const shared = assetId ? preparedByAssetId.get(assetId) : null;
                if (shared) {
                    preparedImages.push(shared);
                    continue;
                }
                const prepared = await prepareWorkspaceImage(file, {
                    retainObjectUrl: true,
                    role: `project-image-${index + 1}`,
                    platform: this.root.platform,
                });
                const runtimeImage = {
                    src: prepared.url,
                    width: prepared.width,
                    height: prepared.height,
                    type: file.type,
                    name: file.name,
                    assetId,
                    blob: file,
                    _ownsObjectUrl: true,
                };
                preparedImages.push(runtimeImage);
                if (assetId) preparedByAssetId.set(assetId, runtimeImage);
                this._assertOperation(operation);
            }
            doc.images = doc.images.map((layer, index) => ({
                ...layer,
                width: preparedImages[index].width,
                height: preparedImages[index].height,
                type: preparedImages[index].type,
                name: preparedImages[index].name,
            }));
            if (decoded.background) {
                await prepareWorkspaceImage(decoded.background, {
                    role: 'background-image',
                    platform: this.root.platform,
                });
                this._assertOperation(operation);
                backgroundAsset = this.root.assetStore.add(decoded.background);
                if (!backgroundAsset) throw new Error('background-asset-unavailable');
                doc.option.backgroundAssetId = backgroundAsset.id;
                doc.option.frameConf.background = {
                    ...(doc.option.frameConf.background || {}),
                    type: 'image',
                    url: backgroundAsset.url,
                    mode: doc.option.backgroundMode,
                    align: doc.option.backgroundAlign,
                };
            }
            this._assertOperation(operation);
            this.root.imageStore.replaceProject(doc.images, preparedImages);
            imagesCommitted = true;
            this.root.editor.snap = null;
            this.root.baseSnapshot.invalidate();
            this.root.editor.setUseTool(null);
            this.root.editor.restoreProject(doc);
            this.root.editor.clearSelection();
            this.root.history.reset();
        } catch (error) {
            if (!imagesCommitted) {
                new Set(preparedImages.map((image) => image.src))
                    .forEach((src) => this.root.platform.file.revokeObjectURL(src));
            }
            if (backgroundAsset) this.root.assetStore.release(backgroundAsset.id);
            throw error;
        }
    }

    async openRecentProject(id) {
        const operation = this._operationGeneration;
        try {
            const record = await this.root.draftStore.loadRecentProject(id);
            this._assertOperation(operation);
            if (!record?.blob) throw new Error('recent-project-missing');
            const file = new File([record.blob], record.fileName || fileNameFor(record.name, PROJECT_EXTENSION), {
                type: PROJECT_ARCHIVE_MIME,
            });
            return this.openProjectFile(file, { recentId: id });
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, this.root.i18n.t("最近项目已不可用")));
            }
            return false;
        }
    }

    async openDraft(key) {
        if (this.busy) return false;
        this._presetRequest += 1;
        this.busy = 'open-draft';
        const operation = this._operationGeneration;
        try {
            const record = await this.root.draftStore.loadProjectRecord(key);
            this._assertOperation(operation);
            const rawDoc = record?.doc;
            const validation = validateDocument(rawDoc);
            const doc = validation.doc;
            if (!validation.ok || !doc.images.length) throw new Error('draft-resource-missing');
            const imageRecords = await Promise.all(doc.images.map((image) => this.root.draftStore.loadAsset(image.assetId)));
            this._assertOperation(operation);
            if (imageRecords.some((image) => !image?.blob)) throw new Error('draft-resource-missing');
            const backgroundRecord = doc.option?.backgroundAssetId
                ? await this.root.draftStore.loadAsset(doc.option.backgroundAssetId)
                : null;
            this._assertOperation(operation);
            if (doc.option?.backgroundAssetId && !backgroundRecord?.blob) throw new Error('draft-resource-missing');
            await this._applyProject({
                document: doc,
                images: imageRecords.map((imageRecord, index) => ({
                    file: new File([imageRecord.blob], imageRecord.name || `image-${index + 1}`, { type: imageRecord.type }),
                    assetId: doc.images[index].assetId,
                })),
                background: backgroundRecord?.blob
                    ? new File([backgroundRecord.blob], backgroundRecord.name || 'background', { type: backgroundRecord.type })
                    : null,
            }, operation);
            this._assertOperation(operation);
            runInAction(() => {
                this.projectName = normalizeWorkspaceName(record.name, this.root.i18n.t("恢复的草稿"));
                this.currentRecentId = null;
            });
            this._setFileHandle(null);
            this._markClean({ saved: false });
            this.root.editor.message?.success?.(this.root.i18n.t("草稿已恢复"));
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, this.root.i18n.t("草稿资源缺失或已损坏")));
            }
            return false;
        } finally {
            if (this._isOperationCurrent(operation)) runInAction(() => { this.busy = null; });
        }
    }

    async deleteDraft(key) {
        const operation = this._operationGeneration;
        try {
            // 低频、代价高的删除：删除前留一份会话内快照，成功后用 toast 提供一次撤销
            const snapshot = await this._draftSnapshot(key);
            this._assertOperation(operation);
            await this.root.draftStore.deleteProject(key);
            this._assertOperation(operation);
            await this.root.draftStore.deleteAssetsByKey(key);
            this._assertOperation(operation);
            await Promise.all([this.refreshLibrary(), this.refreshStorage()]);
            this._assertOperation(operation);
            if (snapshot) {
                this._announceLibraryUndo(
                    this.root.i18n.t('已删除“{0}”', { 0: snapshot.record.name || this.root.i18n.t('未命名项目') }),
                    () => this._restoreDraftSnapshot(snapshot, operation)
                );
            }
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, this.root.i18n.t("草稿删除失败，请重试")));
            }
            return false;
        }
    }

    /**
     * 删除草稿前的快照：项目记录 + 归属资源。
     * 记录或资源任一读取失败都返回 null：删除照常执行，只是这次没有撤销可用
     * —— 半成品快照会写出「有记录、无资源」的坏草稿，比没有撤销更糟。
     */
    async _draftSnapshot(key) {
        const record = await this._snapshotForUndo(() => this.root.draftStore.loadProjectRecord(key));
        if (!record) return null;
        const assets = await this._snapshotForUndo(() => this.root.draftStore.listAssetsByKey(key));
        if (!assets) return null;
        return { record, assets };
    }

    /**
     * 写回删除前的草稿记录与资源；只由 toast 撤销调用，失败由调用方提示。
     * 先写资源、最后写记录：中途失败最多留下孤儿资源，不会出现「列表里可见但打不开」的草稿。
     */
    async _restoreDraftSnapshot(snapshot, operation = this._operationGeneration) {
        if (this.root.isDisposed || !this.root.isActive) return;
        this._assertOperation(operation);
        const { record, assets } = snapshot;
        // 撤销窗口内这份草稿又被写过（例如当前草稿的 750ms 自动保存）：新数据优先，不回滚
        const existing = await this.root.draftStore.loadProjectRecord(record.key);
        this._assertOperation(operation);
        if (existing && (existing.updatedAt || 0) > (record.updatedAt || 0)) {
            await Promise.all([this.refreshLibrary(), this.refreshStorage()]);
            return;
        }
        for (const asset of assets) {
            await this.root.draftStore.saveAsset(asset.id, record.key, asset);
            this._assertOperation(operation);
        }
        await this.root.draftStore.saveProject(record.key, record.doc, {
            kind: record.kind,
            name: record.name,
            updatedAt: record.updatedAt,
        });
        this._assertOperation(operation);
        await Promise.all([this.refreshLibrary(), this.refreshStorage()]);
    }

    /**
     * 本地资料库删除后的 toast 撤销。
     * 快照只由这个 toast 的闭包持有：提示关闭（默认 8 秒）或实例销毁后即可回收，
     * 因此不做跨会话保留，也不长期占用草稿/预设的字节。
     * `key` 让同类删除的提示互相替换：合并/连续删除时不会留下点不动的旧提示。
     */
    _announceLibraryUndo(label, restore, key = 'undo:library-delete') {
        showUndoToast(this.root, {
            label,
            key,
            onUndo: () => {
                const operation = this._operationGeneration;
                void restore().catch(error => {
                    if (this._isOperationCancelled(error, operation)) {
                        // 用户仍留在当前实例时说明一次撤销已失效；实例销毁后不能再向已卸载 UI 发消息。
                        if (!this.root.isDisposed) this.root.editor.message?.info?.(this.root.i18n.t('没有可撤销的操作'));
                        return;
                    }
                    this.root.editor.message?.error?.(this.root.i18n.t('撤销删除失败，请重试'));
                });
            },
        });
    }

    /** 读取删除前快照；失败按「没有撤销」处理，不阻断删除本身。 */
    async _snapshotForUndo(load) {
        try {
            return (await load()) || null;
        } catch {
            return null;
        }
    }

    async deleteRecentProject(id) {
        const operation = this._operationGeneration;
        const wasCurrent = this.currentRecentId === id;
        try {
            const record = await this._snapshotForUndo(() => this.root.draftStore.loadRecentProject(id));
            this._assertOperation(operation);
            await this.root.draftStore.deleteRecentProject(id);
            this._assertOperation(operation);
            if (this.currentRecentId === id) this.currentRecentId = null;
            await Promise.all([this.refreshLibrary(), this.refreshStorage()]);
            this._assertOperation(operation);
            if (record) {
                this._announceLibraryUndo(
                    this.root.i18n.t('已移除记录“{0}”', { 0: record.name || this.root.i18n.t('未命名项目') }),
                    async () => {
                        if (this.root.isDisposed || !this.root.isActive) return;
                        this._assertOperation(operation);
                        // 窗口内重新保存过同一个项目文件时，新的 ZIP 优先，不用旧快照覆盖
                        const existing = await this.root.draftStore.loadRecentProject(id);
                        this._assertOperation(operation);
                        if (existing && (existing.updatedAt || 0) > (record.updatedAt || 0)) {
                            await Promise.all([this.refreshLibrary(), this.refreshStorage()]);
                            return;
                        }
                        await this.root.draftStore.saveRecentProject(record);
                        this._assertOperation(operation);
                        // 只有仍没有“当前项目文件”时才把标记还回去，避免抢走用户刚打开的项目
                        if (wasCurrent && !this.currentRecentId) runInAction(() => { this.currentRecentId = id; });
                        await Promise.all([this.refreshLibrary(), this.refreshStorage()]);
                    }
                );
            }
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, this.root.i18n.t("最近项目记录删除失败，请重试")));
            }
            return false;
        }
    }

    async savePreset(name) {
        if (this.busy) return false;
        this.busy = 'save-preset';
        const operation = this._operationGeneration;
        try {
            const doc = this.root.editor.serializeProject();
            const exportSettings = { ...this.exportSettings };
            const background = await this._currentBackground(doc);
            this._assertOperation(operation);
            const id = createId('preset');
            const preset = createStylePreset({
                id,
                name,
                option: doc.option,
                exportSettings,
            });
            await this.root.draftStore.savePreset({
                id,
                name: preset.name,
                preset,
                backgroundBlob: background?.blob || null,
                backgroundName: background?.name || null,
                backgroundType: background?.type || null,
            });
            this._assertOperation(operation);
            await Promise.all([this.refreshLibrary(), this.refreshStorage()]);
            this._assertOperation(operation);
            this.root.editor.message?.success?.(this.root.i18n.t("风格预设已保存"));
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, this.root.i18n.t("风格预设保存失败")));
            }
            return false;
        } finally {
            if (this._isOperationCurrent(operation)) runInAction(() => { this.busy = null; });
        }
    }

    async applyPreset(id) {
        if (this.busy || this.root.isDisposed) return false;
        const request = ++this._presetRequest;
        const operation = this._operationGeneration;
        const project = this.root.renderTaskTracker?.projectVersion;
        const assertCurrent = () => {
            this._assertOperation(operation);
            if (request !== this._presetRequest || project !== this.root.renderTaskTracker?.projectVersion) {
                throw Object.assign(new Error('workspace-operation-cancelled'), { code: 'workspace-operation-cancelled' });
            }
        };
        try {
            const record = await this.root.draftStore.loadPreset(id);
            assertCurrent();
            if (!record?.preset) throw new Error('preset-missing');
            const validation = validateStylePreset(record.preset);
            if (!validation.ok) throw new Error('preset-invalid');
            const option = structuredClone(validation.preset.option);
            let asset = null;
            if (isImageBackgroundKey(option.background) && !record.backgroundBlob) {
                throw new Error('background-asset-missing');
            }
            if (record.backgroundBlob) {
                await prepareWorkspaceImage(record.backgroundBlob, {
                    role: 'background-image',
                    platform: this.root.platform,
                });
                assertCurrent();
                asset = this.root.assetStore.add(new File(
                    [record.backgroundBlob],
                    record.backgroundName || 'background',
                    { type: record.backgroundType || record.backgroundBlob.type }
                ));
                if (!asset) throw new Error('background-asset-unavailable');
                option.backgroundAssetId = asset.id;
                option.frameConf.background = {
                    ...(option.frameConf.background || {}),
                    type: 'image',
                    url: asset.url,
                    mode: option.backgroundMode,
                    align: option.backgroundAlign,
                };
            }
            try {
                this.root.option.restoreFromDocument(option);
                this.setExportSettings(validation.preset.exportSettings, { replace: true });
                this.root.history.commit('preset:apply');
            } catch (error) {
                if (asset) this.root.assetStore.release(asset.id);
                throw error;
            }
            this.root.editor.message?.success?.(this.root.i18n.t("已应用预设“{0}”", { 0: record.name }));
            if (validation.exportSettingsWarnings.length) this.root.editor.message?.warning?.(this.root.i18n.t('无法识别的压缩设置已恢复为标准导出；图片和图层未改变。'));
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, this.root.i18n.t("风格预设无法应用")));
            }
            return false;
        }
    }

    async duplicatePreset(id) {
        const operation = this._operationGeneration;
        try {
            const record = await this.root.draftStore.loadPreset(id);
            this._assertOperation(operation);
            if (!record?.preset) throw new Error('preset-missing');
            const nextId = createId('preset');
            const preset = createStylePreset({
                ...record.preset,
                id: nextId,
                name: this.root.i18n.t("{0} 副本", { 0: record.name }),
            });
            await this.root.draftStore.savePreset({
                ...record,
                id: nextId,
                name: preset.name,
                preset,
                createdAt: Date.now(),
                // 副本是新建记录，必须用当前时间：保留源记录的 updatedAt 会让它落到旧位置
                updatedAt: Date.now(),
            });
            this._assertOperation(operation);
            await this.refreshLibrary();
            this._assertOperation(operation);
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, this.root.i18n.t("风格预设复制失败")));
            }
            return false;
        }
    }

    async renamePreset(id, name) {
        const operation = this._operationGeneration;
        try {
            const record = await this.root.draftStore.loadPreset(id);
            this._assertOperation(operation);
            if (!record?.preset) throw new Error('preset-missing');
            const preset = createStylePreset({ ...record.preset, id, name });
            // 重命名是用户操作，沿用旧行为把它挪到列表最前；只有撤销删除才保留原时间戳
            await this.root.draftStore.savePreset({ ...record, name: preset.name, preset, updatedAt: Date.now() });
            this._assertOperation(operation);
            await this.refreshLibrary();
            this._assertOperation(operation);
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, this.root.i18n.t("风格预设重命名失败")));
            }
            return false;
        }
    }

    async deletePreset(id) {
        const operation = this._operationGeneration;
        try {
            // 与删草稿同一约定：先取快照，删除成功后用 toast 提供一次撤销
            const record = await this._snapshotForUndo(() => this.root.draftStore.loadPreset(id));
            this._assertOperation(operation);
            await this.root.draftStore.deletePreset(id);
            this._assertOperation(operation);
            await Promise.all([this.refreshLibrary(), this.refreshStorage()]);
            this._assertOperation(operation);
            if (record) {
                this._announceLibraryUndo(
                    this.root.i18n.t('已删除“{0}”', { 0: record.name || this.root.i18n.t('未命名预设') }),
                    async () => {
                        if (this.root.isDisposed || !this.root.isActive) return;
                        this._assertOperation(operation);
                        await this.root.draftStore.savePreset(record);
                        this._assertOperation(operation);
                        await Promise.all([this.refreshLibrary(), this.refreshStorage()]);
                    }
                );
            }
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, this.root.i18n.t("风格预设删除失败")));
            }
            return false;
        }
    }

    async exportPreset(id) {
        const operation = this._operationGeneration;
        let handle = null;
        try {
            const record = await this.root.draftStore.loadPreset(id);
            this._assertOperation(operation);
            if (!record?.preset) throw new Error('preset-missing');
            const name = fileNameFor(record.name, PRESET_EXTENSION);
            if (this.root.platform.file.supportsFileSystemAccess()) {
                const selected = await this.root.platform.file.chooseSaveHandle({
                    suggestedName: name,
                    types: presetPickerTypes.map((type) => ({ ...type, description: this.root.i18n.t(type.description) })),
                    excludeAcceptAllOption: true,
                    id: 'screenhello-preset-save',
                });
                this._assertOperation(operation);
                if (selected.status === 'cancelled') return false;
                if (selected.status === 'selected') handle = selected.handle;
            }
            const background = record.backgroundBlob ? {
                blob: record.backgroundBlob,
                name: record.backgroundName,
                type: record.backgroundType,
            } : null;
            const { createPresetArchive } = await loadArchiveTools();
            const blob = await createPresetArchive({ preset: record.preset, background });
            this._assertOperation(operation);
            if (handle) await this.root.platform.file.writeToHandle(handle, blob);
            else await this.root.platform.export.download(blob, name);
            this._assertOperation(operation);
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, this.root.i18n.t("预设导出失败")));
            }
            return false;
        } finally {
            if (handle) await this.root.platform.file.releaseHandle(handle).catch(() => {});
        }
    }

    async importPresetFile(file) {
        const operation = this._operationGeneration;
        try {
            const { readWorkspaceArchive } = await loadArchiveTools();
            const decoded = await readWorkspaceArchive(file, { expectedKind: 'preset' });
            this._assertOperation(operation);
            if (decoded.background) {
                await prepareWorkspaceImage(decoded.background, {
                    role: 'background-image',
                    platform: this.root.platform,
                });
                this._assertOperation(operation);
            }
            const id = createId('preset');
            const preset = createStylePreset({ ...decoded.preset, id });
            await this.root.draftStore.savePreset({
                id,
                name: preset.name,
                preset,
                backgroundBlob: decoded.background || null,
                backgroundName: decoded.background?.name || null,
                backgroundType: decoded.background?.type || null,
            });
            this._assertOperation(operation);
            await Promise.all([this.refreshLibrary(), this.refreshStorage()]);
            this._assertOperation(operation);
            this.root.editor.message?.success?.(this.root.i18n.t("风格预设已导入"));
            if (decoded.exportSettingsWarnings?.length) this.root.editor.message?.warning?.(this.root.i18n.t('无法识别的压缩设置已恢复为标准导出；图片和图层未改变。'));
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, this.root.i18n.t("预设文件无法导入")));
            }
            return false;
        }
    }

    _messageForError(error, fallback) {
        if (error?.code === 'desktop-file-exists') return this.root.i18n.t("补全扩展名后的文件已存在，未覆盖原文件；请重新选择文件名或在保存对话框中明确选择要覆盖的文件");
        const code = `${error?.name || ''} ${error?.code || ''} ${error?.message || ''}`;
        if (/quota/i.test(code)) return this.root.i18n.t("浏览器存储空间不足；请导出项目文件备份后清理旧项目");
        if (/archive-too-large|asset-too-large|image-pixel-budget|image-layer-limit/.test(code)) return this.root.i18n.t("图片数量、像素或文件大小超过当前项目的安全上限");
        if (/checksum|archive-(empty|invalid|entry-rejected)|manifest|container|document-invalid|asset-conflict|preset-invalid/.test(code)) {
            return this.root.i18n.t("文件已损坏、格式不正确或版本不受支持");
        }
        if (/resource-missing|asset-missing|asset-unavailable/.test(code)) return this.root.i18n.t("项目引用的图片资源缺失");
        if (/image(?:-\d+)?-(invalid|type-unsupported|decode-failed|dimensions-invalid|pixels-too-large)/.test(code)) {
            return this.root.i18n.t("图片资源无效、无法解码或尺寸过大");
        }
        if (/image-missing/.test(code)) return this.root.i18n.t("请先添加图片");
        return fallback;
    }

    dispose() {
        this.teardown();
    }
}
