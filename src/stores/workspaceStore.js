import { makeAutoObservable, reaction, runInAction } from 'mobx';
import { browserPlatform } from '../platform/browserPlatform';
import { createStylePreset, normalizeExportSettings, normalizeWorkspaceName } from '@utils/stylePreset';
import { prepareWorkspaceImage } from '@utils/imageValidation';
import { analyzeImageSuggestions } from '@utils/imageSuggestions';
import { validateDocument } from '@utils/projectDocument';
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

    constructor(root) {
        this.root = root;
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
        this.fileHandle = null;
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

    _markClean({ saved = true } = {}) {
        this._baselineSignature = this._signature();
        this.isDirty = false;
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

    setProjectName(value) {
        this.projectName = Array.from(String(value ?? ''))
            .filter((character) => character >= ' ' && character !== '\u007f')
            .join('')
            .slice(0, 80);
    }

    resetProject() {
        this.projectName = '未命名项目';
        this.currentRecentId = null;
        this.fileHandle = null;
        this.exportSettings = normalizeExportSettings();
        this._markClean({ saved: false });
    }

    setExportSettings(value) {
        this.exportSettings = normalizeExportSettings({ ...this.exportSettings, ...value });
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
            browserPlatform.storage.estimate(),
            browserPlatform.storage.isPersisted(),
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
        const result = await browserPlatform.storage.requestPersistence();
        if (request !== this._persistenceRequest) return result;
        runInAction(() => {
            this.storage = {
                ...this.storage,
                persistence: result == null ? 'unsupported' : (result ? 'granted' : 'denied'),
            };
        });
        if (result === true) this.root.editor.message?.success?.('浏览器已允许持久保存本地数据');
        else if (result === false) this.root.editor.message?.info?.('浏览器未授予持久存储，请定期导出项目文件备份');
        else this.root.editor.message?.info?.('当前浏览器不支持请求持久存储，请定期导出项目文件备份');
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
        this.root.editor.message?.success?.('已应用智能建议，可继续手动调整');
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

    async _currentProjectParts() {
        const layers = this.root.imageStore.list;
        if (!layers.length) throw Object.assign(new Error('project-image-missing'), { code: 'project-image-missing' });
        const images = [];
        for (const layer of layers) {
            const imageMeta = this.root.imageStore.resolve(layer);
            const blob = imageMeta?.blob || await this._blobFromSource(imageMeta?.src, 'project-image-unavailable');
            images.push({ blob, metadata: layer });
        }
        const doc = this.root.editor.serializeProject();
        const background = await this._currentBackground(doc);
        return { doc, images, background };
    }

    async _currentBackground(doc = this.root.editor.serializeProject()) {
        let background = null;
        if (doc.option?.frameConf?.background?.type === 'image') {
            const asset = this.root.assetStore.get(doc.option.backgroundAssetId);
            const blob = asset?.blob || await this._blobFromSource(
                this.root.option.frameConf.background?.url,
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
                ? '项目文件已保存，但浏览器存储空间不足，未加入最近项目'
                : '项目已处理，但最近项目记录未能写入本地存储');
            return false;
        }
    }

    async createProjectBlob() {
        const { doc, images, background } = await this._currentProjectParts();
        const { createProjectArchive } = await loadArchiveTools();
        return createProjectArchive({
            name: this.projectName,
            document: doc,
            images,
            background,
            exportSettings: this.exportSettings,
        });
    }

    async saveProject({ saveAs = false } = {}) {
        if (this.busy) return false;
        this.saveErrorCode = null;
        this.busy = saveAs ? 'save-as' : 'save';
        const operation = this._operationGeneration;
        try {
            this.projectName = normalizeWorkspaceName(this.projectName, '未命名项目');
            const suggestedName = fileNameFor(this.projectName, PROJECT_EXTENSION);
            let handle = saveAs ? null : this.fileHandle;
            let saveMethod = handle ? 'file-system' : 'download';
            if (!handle && browserPlatform.file.supportsFileSystemAccess()) {
                const selected = await browserPlatform.file.chooseSaveHandle({
                    suggestedName,
                    types: projectPickerTypes,
                    excludeAcceptAllOption: true,
                    id: 'screenhello-project-save',
                });
                if (selected.status === 'cancelled') return false;
                if (selected.status === 'selected') {
                    handle = selected.handle;
                    saveMethod = 'file-system';
                }
            }
            this._assertOperation(operation);
            const blob = await this.createProjectBlob();
            this._assertOperation(operation);
            if (handle) {
                await browserPlatform.file.writeToHandle(handle, blob);
            } else {
                await browserPlatform.export.download(blob, suggestedName);
            }
            this._assertOperation(operation);
            if (handle) this.fileHandle = handle;
            const recentId = saveAs || !this.currentRecentId ? createId('recent') : this.currentRecentId;
            const cached = await this._cacheRecentProject({
                id: recentId,
                name: this.projectName,
                fileName: suggestedName,
                blob,
                size: blob.size,
            }, operation);
            this._assertOperation(operation);
            runInAction(() => { this.currentRecentId = cached ? recentId : null; });
            this._markClean();
            await this.refreshStorage();
            this._assertOperation(operation);
            this.root.editor.message?.success?.(saveMethod === 'download'
                ? (cached ? '项目已下载，并保存到最近项目' : '项目已下载')
                : '项目已保存');
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                runInAction(() => {
                    this.saveErrorCode = error?.code || error?.name || error?.message || 'project-save-failed';
                });
                this.root.editor.message?.error?.(this._messageForError(error, '项目保存失败，请重试'));
            }
            return false;
        } finally {
            if (this._isOperationCurrent(operation)) runInAction(() => { this.busy = null; });
        }
    }

    async openProjectPicker() {
        const operation = this._operationGeneration;
        try {
            const result = await browserPlatform.file.openWithPicker({
                types: projectPickerTypes,
                excludeAcceptAllOption: true,
                multiple: false,
                id: 'screenhello-project-open',
            });
            this._assertOperation(operation);
            if (result.status !== 'selected') return result.status;
            return this.openProjectFile(result.file, { handle: result.handle });
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, '无法打开系统文件选择器'));
            }
            return false;
        }
    }

    async openProjectFile(file, { handle = null, recentId = null } = {}) {
        if (this.busy) return false;
        this.busy = 'open';
        const operation = this._operationGeneration;
        try {
            const { readWorkspaceArchive } = await loadArchiveTools();
            const decoded = await readWorkspaceArchive(file, { expectedKind: 'project' });
            this._assertOperation(operation);
            await this._applyProject(decoded, operation);
            this._assertOperation(operation);
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
                this.projectName = decoded.name;
                this.exportSettings = decoded.exportSettings;
                this.fileHandle = handle;
                this.currentRecentId = cached ? id : null;
            });
            this._markClean();
            await this.refreshStorage();
            this._assertOperation(operation);
            this.root.editor.message?.success?.('项目已打开');
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, '项目文件无法打开'));
            }
            return false;
        } finally {
            if (this._isOperationCurrent(operation)) runInAction(() => { this.busy = null; });
        }
    }

    async _applyProject(decoded, operation = this._operationGeneration) {
        this._assertOperation(operation);
        const validation = validateDocument(decoded.document);
        if (!validation.ok || !validation.doc.images.length) throw new Error('project-document-invalid');
        const doc = structuredClone(validation.doc);
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
                await prepareWorkspaceImage(decoded.background, { role: 'background-image' });
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
                    .forEach((src) => browserPlatform.file.revokeObjectURL(src));
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
                this.root.editor.message?.error?.(this._messageForError(error, '最近项目已不可用'));
            }
            return false;
        }
    }

    async openDraft(key) {
        if (this.busy) return false;
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
                this.projectName = normalizeWorkspaceName(record.name, '恢复的草稿');
                this.fileHandle = null;
                this.currentRecentId = null;
            });
            this._markClean({ saved: false });
            this.root.editor.message?.success?.('草稿已恢复');
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, '草稿资源缺失或已损坏'));
            }
            return false;
        } finally {
            if (this._isOperationCurrent(operation)) runInAction(() => { this.busy = null; });
        }
    }

    async deleteDraft(key) {
        const operation = this._operationGeneration;
        try {
            await this.root.draftStore.deleteProject(key);
            this._assertOperation(operation);
            await this.root.draftStore.deleteAssetsByKey(key);
            this._assertOperation(operation);
            await Promise.all([this.refreshLibrary(), this.refreshStorage()]);
            this._assertOperation(operation);
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, '草稿删除失败，请重试'));
            }
            return false;
        }
    }

    async deleteRecentProject(id) {
        const operation = this._operationGeneration;
        try {
            await this.root.draftStore.deleteRecentProject(id);
            this._assertOperation(operation);
            if (this.currentRecentId === id) this.currentRecentId = null;
            await Promise.all([this.refreshLibrary(), this.refreshStorage()]);
            this._assertOperation(operation);
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, '最近项目记录删除失败，请重试'));
            }
            return false;
        }
    }

    async savePreset(name) {
        if (this.busy) return false;
        this.busy = 'save-preset';
        const operation = this._operationGeneration;
        try {
            const background = await this._currentBackground();
            this._assertOperation(operation);
            const id = createId('preset');
            const preset = createStylePreset({
                id,
                name,
                option: this.root.option.toDocument(),
                exportSettings: this.exportSettings,
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
            this.root.editor.message?.success?.('风格预设已保存');
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, '风格预设保存失败'));
            }
            return false;
        } finally {
            if (this._isOperationCurrent(operation)) runInAction(() => { this.busy = null; });
        }
    }

    async applyPreset(id) {
        const operation = this._operationGeneration;
        try {
            const record = await this.root.draftStore.loadPreset(id);
            this._assertOperation(operation);
            if (!record?.preset) throw new Error('preset-missing');
            const option = structuredClone(record.preset.option);
            let asset = null;
            if (option.background === 'upload_image' && !record.backgroundBlob) {
                throw new Error('background-asset-missing');
            }
            if (record.backgroundBlob) {
                await prepareWorkspaceImage(record.backgroundBlob, { role: 'background-image' });
                this._assertOperation(operation);
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
                this.setExportSettings(record.preset.exportSettings);
                this.root.history.commit('preset:apply');
            } catch (error) {
                if (asset) this.root.assetStore.release(asset.id);
                throw error;
            }
            this.root.editor.message?.success?.(`已应用预设“${record.name}”`);
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, '风格预设无法应用'));
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
                name: `${record.name} 副本`,
            });
            await this.root.draftStore.savePreset({
                ...record,
                id: nextId,
                name: preset.name,
                preset,
                createdAt: Date.now(),
            });
            this._assertOperation(operation);
            await this.refreshLibrary();
            this._assertOperation(operation);
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, '风格预设复制失败'));
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
            await this.root.draftStore.savePreset({ ...record, name: preset.name, preset });
            this._assertOperation(operation);
            await this.refreshLibrary();
            this._assertOperation(operation);
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, '风格预设重命名失败'));
            }
            return false;
        }
    }

    async deletePreset(id) {
        const operation = this._operationGeneration;
        try {
            await this.root.draftStore.deletePreset(id);
            this._assertOperation(operation);
            await Promise.all([this.refreshLibrary(), this.refreshStorage()]);
            this._assertOperation(operation);
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, '风格预设删除失败'));
            }
            return false;
        }
    }

    async exportPreset(id) {
        const operation = this._operationGeneration;
        try {
            const record = await this.root.draftStore.loadPreset(id);
            this._assertOperation(operation);
            if (!record?.preset) throw new Error('preset-missing');
            const name = fileNameFor(record.name, PRESET_EXTENSION);
            let handle = null;
            if (browserPlatform.file.supportsFileSystemAccess()) {
                const selected = await browserPlatform.file.chooseSaveHandle({
                    suggestedName: name,
                    types: presetPickerTypes,
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
            if (handle) await browserPlatform.file.writeToHandle(handle, blob);
            else await browserPlatform.export.download(blob, name);
            this._assertOperation(operation);
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, '预设导出失败'));
            }
            return false;
        }
    }

    async importPresetFile(file) {
        const operation = this._operationGeneration;
        try {
            const { readWorkspaceArchive } = await loadArchiveTools();
            const decoded = await readWorkspaceArchive(file, { expectedKind: 'preset' });
            this._assertOperation(operation);
            if (decoded.background) {
                await prepareWorkspaceImage(decoded.background, { role: 'background-image' });
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
            this.root.editor.message?.success?.('风格预设已导入');
            return true;
        } catch (error) {
            if (!this._isOperationCancelled(error, operation)) {
                this.root.editor.message?.error?.(this._messageForError(error, '预设文件无法导入'));
            }
            return false;
        }
    }

    _messageForError(error, fallback) {
        const code = `${error?.name || ''} ${error?.code || ''} ${error?.message || ''}`;
        if (/quota/i.test(code)) return '浏览器存储空间不足；请导出项目文件备份后清理旧项目';
        if (/archive-too-large|asset-too-large|image-pixel-budget|image-layer-limit/.test(code)) return '图片数量、像素或文件大小超过当前项目的安全上限';
        if (/checksum|archive-(empty|invalid|entry-rejected)|manifest|container|document-invalid|asset-conflict|preset-invalid/.test(code)) {
            return '文件已损坏、格式不正确或版本不受支持';
        }
        if (/resource-missing|asset-missing|asset-unavailable/.test(code)) return '项目引用的图片资源缺失';
        if (/image(?:-\d+)?-(invalid|type-unsupported|decode-failed|dimensions-invalid|pixels-too-large)/.test(code)) {
            return '图片资源无效、无法解码或尺寸过大';
        }
        if (/image-missing/.test(code)) return '请先添加图片';
        return fallback;
    }

    dispose() {
        this.teardown();
    }
}
