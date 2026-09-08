import { makeAutoObservable, runInAction } from 'mobx';
import { isExportCancelled } from './exportService';
import { MAX_PROJECT_IMAGES } from '../utils/projectDocument';
import { getDefaultFrameSize, modKey, nanoid } from '../utils/utils';
import { prepareRuntimeImage, releaseRuntimeImage } from '../utils/runtimeImage';
import { captureScreen } from '../utils/captureScreen';
import { validateExportSettings, WEB_AVIF_LIMIT_MESSAGE } from '../utils/exportSettings';

const LABELS = Object.freeze({
    'file.newProject': '新建项目',
    'file.openProject': '打开项目…',
    'file.openRecentProject': '打开最近项目',
    'file.saveProject': '保存项目',
    'file.saveProjectAs': '另存为…',
    'file.addImages': '添加图片…',
    'file.replaceActiveImage': '替换当前图片…',
    'file.captureScreen': '截取屏幕…',
    'file.openExport': '导出图片…',
    'file.quickExport': '使用当前设置快速导出',
    'file.copyFinalImage': '复制最终图片',
    'file.openBatch': '批量处理…',
    'file.openLibrary': '本地资料库…',
    'edit.undo': '撤销',
    'edit.redo': '重做',
    'edit.duplicateSelection': '复制选中图层',
    'edit.deleteSelection': '删除选中内容',
    'edit.selectAllImages': '全选图片图层',
    'edit.groupSelection': '编组',
    'edit.ungroupSelection': '取消编组',
    'edit.toggleSelectionLock': '锁定',
    'edit.resetImageStyle': '重置图片样式',
    'view.zoomIn': '放大',
    'view.zoomOut': '缩小',
    'view.zoom100': '100%',
    'view.fitCanvas': '适应画布',
    'view.toggleFramePanel': '隐藏尺寸与外框',
    'view.toggleInspector': '隐藏检查器',
    'view.toggleAnnotationTools': '隐藏标注工具',
    'view.setTheme': '切换主题',
    'help.quickStart': '快速入门',
    'help.shortcuts': '快捷键列表',
    'help.localPrivacy': '本地数据与隐私',
    'help.recovery': '项目恢复与备份说明',
    'help.documentation': '使用文档（打开网页）',
    'help.reportIssue': '报告问题（打开网页）',
    'help.github': 'GitHub 仓库（打开网页）',
    'help.about': '关于 ScreenHello',
});

const SHORTCUTS = Object.freeze({
    'file.openProject': `${modKey}+O`,
    'file.saveProject': `${modKey}+S`,
    'file.saveProjectAs': `${modKey}+Shift+S`,
    'file.openExport': `${modKey}+Shift+E`,
    'file.copyFinalImage': `${modKey}+C`,
    'edit.undo': `${modKey}+Z`,
    'edit.redo': `${modKey}+Shift+Z`,
    'edit.deleteSelection': 'Delete',
    'view.zoomIn': `${modKey}++`,
    'view.zoomOut': `${modKey}+-`,
    'view.fitCanvas': `${modKey}+0`,
});

export const exportFailureMessage = (error, action, format, t) => {
    if (error?.code === 'device-render-failed') return t('设备素材缺失或渲染失败，请重新选择设备或改用无外框后导出。');
    if (error?.code === 'export-preview-unsupported' || error?.code === 'export-preview-invalid') return t('此浏览器无法显示该格式的真实预览。可切换格式，或按当前设置直接导出。');
    if (error?.code === 'export-preview-timeout') return t('预览解码超时，请重试或按当前设置直接导出。');
    if (error?.code === 'export-preview-size-too-large') return t('完整预览最多支持约 105 万像素。预览不可用时，仍可在下载尺寸限制内直接导出。');
    if (error?.code === 'export-web-avif-compression-size-too-large') return t(WEB_AVIF_LIMIT_MESSAGE);
    if (error?.code === 'export-compression-size-too-large') return t('压缩下载最多支持约 419 万像素，最长边为 8192 像素。请降低倍率或画布尺寸，或改用 PNG/JPG/WebP 标准导出。');
    if (error?.code === 'export-stale' || error?.code === 'export-render-interacting') return t('画面已变化或仍在编辑，请停止操作后重新导出。');
    if (error?.code === 'export-render-timeout' || error?.code === 'export-compression-timeout') return t('等待画面或压缩处理超时，请降低尺寸后重试。');
    if (error?.code === 'export-effect-failed') return t('区域效果未能生成，已阻止导出；请重试以避免遗漏遮挡。');
    if (error?.code === 'desktop-file-exists') return t('补全扩展名后的文件已存在，未覆盖原文件；请重新导出并选择其他文件名或明确选择要覆盖的文件');
    if (error?.code === 'export-avif-size-too-large') return t('AVIF 最多导出约 420 万像素，请降低倍率或画布尺寸');
    if (format === 'avif') return t('AVIF {0}失败，请改用 PNG 或 WebP', { 0: action });
    if (error?.code === 'export-size-too-large') return t('{0}尺寸过大，请降低像素倍率或画布尺寸', { 0: action });
    return t('{0}失败', { 0: action });
};

const commandResult = (id, {
    label = LABELS[id] || id,
    visible = true,
    enabled = true,
    disabledReason = null,
    busy = false,
    checked = null,
    shortcut = SHORTCUTS[id] || null,
    execute,
} = {}) => Object.freeze({
    id,
    label,
    visible,
    enabled: visible && enabled,
    disabledReason: visible && enabled ? null : disabledReason,
    busy,
    checked,
    shortcut,
    execute,
});

/** 每个 ScreenHelloRuntime 独占的命令与受控 workspace 替换编排层。 */
export class CommandService {
    imageBusy = false;
    captureBusy = false;
    pageUnloadApproved = false;
    guardOpen = false;
    guardBusy = false;
    guardLabel = '';
    guardError = null;
    exportActive = false;
    framePanelVisible = true;
    inspectorVisible = true;
    annotationToolsVisible = true;

    constructor(root) {
        this.root = root;
        this._uiActions = new Map();
        this._pendingGuardAction = null;
        this._pendingGuardResolve = null;
        this._exportController = null;
        this._pageUnloadApprovalTimer = null;
        makeAutoObservable(this, {
            root: false,
            get: false,
            _descriptor: false,
            _pickLocalImages: false,
            _installCapture: false,
            _replaceTargetId: false,
            _selectedUnlocked: false,
            _uiActions: false,
            _pendingGuardAction: false,
            _pendingGuardResolve: false,
            _exportController: false,
            _pageUnloadApprovalTimer: false,
        }, { autoBind: true });
    }

    get guard() {
        return {
            open: this.guardOpen,
            busy: this.guardBusy,
            label: this.guardLabel,
            error: this.guardError,
        };
    }

    get isBusy() {
        return Boolean(
            this.imageBusy
            || this.captureBusy
            || this.guardBusy
            || this.exportActive
            || this.root.workspace.busy
            || this.root.exportService.isBusy
            || this.root.batch?.isBusy
            || Number(this.root.renderTaskTracker?.size) > 0
        );
    }

    _replaceTargetId() {
        const { imageStore } = this.root;
        const selected = imageStore.selectedList;
        if (selected.length === 1 && !selected[0].locked) return selected[0].id;
        if (selected.length === 0 && imageStore.list.length === 1 && !imageStore.list[0].locked) return imageStore.list[0].id;
        return null;
    }

    _selectedUnlocked() {
        return this.root.imageStore.selectedList.filter((layer) => !layer.locked);
    }

    _descriptor(id, payload) {
        const { workspace, imageStore, history, option, editor } = this.root;
        const workspaceOnly = id.startsWith('file.') && id !== 'file.copyFinalImage';
        const visible = workspaceOnly ? workspace.enabled : true;
        const hasImage = imageStore.list.length > 0;
        const conflict = this.isBusy || this.guardOpen;
        const conflictReason = conflict ? this.root.i18n.t("正在处理其他本地任务") : null;
        const selected = imageStore.selectedList;
        const unlocked = this._selectedUnlocked();

        if (!visible) return { visible: false, enabled: false, disabledReason: this.root.i18n.t("仅独立工作区可用"), busy: conflict };
        switch (id) {
            case 'file.newProject':
            case 'file.openProject':
            case 'file.openBatch':
                return { enabled: !conflict, disabledReason: conflictReason, busy: conflict };
            case 'file.openRecentProject': {
                const exists = workspace.recentProjects.some((item) => item.id === payload?.id);
                const available = workspace.libraryStatus !== 'unavailable';
                return {
                    enabled: !conflict && available && exists,
                    disabledReason: conflictReason || (!available ? this.root.i18n.t("本地资料库不可用") : this.root.i18n.t("最近项目已不可用")),
                    busy: conflict,
                };
            }
            case 'file.saveProject':
            case 'file.saveProjectAs':
                return {
                    enabled: !conflict && hasImage,
                    disabledReason: conflictReason || (!hasImage ? this.root.i18n.t("请先添加图片") : null),
                    busy: conflict,
                };
            case 'file.addImages':
                return {
                    enabled: !conflict && imageStore.list.length < MAX_PROJECT_IMAGES,
                    disabledReason: conflictReason || (imageStore.list.length >= MAX_PROJECT_IMAGES ? this.root.i18n.t("最多添加 {0} 张图片", { 0: MAX_PROJECT_IMAGES }) : null),
                    busy: conflict,
                };
            case 'file.captureScreen': {
                const captureAvailable = this.root.platform.capture.isSupported();
                return {
                    enabled: !conflict && captureAvailable && imageStore.list.length < MAX_PROJECT_IMAGES,
                    disabledReason: conflictReason
                        || (!captureAvailable ? this.root.i18n.t("当前环境不支持屏幕截图") : null)
                        || (imageStore.list.length >= MAX_PROJECT_IMAGES ? this.root.i18n.t("最多添加 {0} 张图片", { 0: MAX_PROJECT_IMAGES }) : null),
                    busy: conflict,
                    shortcut: this.root.platform.capture.shortcut || null,
                };
            }
            case 'file.replaceActiveImage': {
                const targetId = this._replaceTargetId();
                return {
                    enabled: !conflict && Boolean(targetId),
                    disabledReason: conflictReason || (!hasImage
                        ? this.root.i18n.t("请先添加图片")
                        : this.root.i18n.t("请只选择一个未锁定图片图层")),
                    busy: conflict,
                };
            }
            case 'file.openExport':
            case 'file.quickExport':
                return { enabled: !conflict && hasImage, disabledReason: conflictReason || (!hasImage ? this.root.i18n.t("请先添加图片") : null), busy: conflict };
            case 'file.copyFinalImage': {
                const clipboardAvailable = this.root.platform.clipboard.supportsWriteImage();
                return {
                    enabled: !conflict && hasImage && clipboardAvailable,
                    disabledReason: conflictReason || (!hasImage ? this.root.i18n.t("请先添加图片") : (!clipboardAvailable ? this.root.i18n.t("当前浏览器不支持复制图片") : null)),
                    busy: conflict,
                };
            }
            case 'file.openLibrary':
                return { enabled: true, busy: false };
            case 'edit.undo':
                return { enabled: !conflict && history.canUndo, disabledReason: conflictReason || this.root.i18n.t("没有可撤销的操作"), busy: conflict };
            case 'edit.redo':
                return { enabled: !conflict && history.canRedo, disabledReason: conflictReason || this.root.i18n.t("没有可重做的操作"), busy: conflict };
            case 'edit.duplicateSelection':
                return {
                    enabled: !conflict && unlocked.length > 0 && imageStore.list.length + unlocked.length <= MAX_PROJECT_IMAGES,
                    disabledReason: conflictReason || (!unlocked.length ? this.root.i18n.t("请选择未锁定图片图层") : this.root.i18n.t("最多添加 {0} 张图片", { 0: MAX_PROJECT_IMAGES })),
                    busy: conflict,
                };
            case 'edit.deleteSelection': {
                const hasShape = Boolean(editor.app?.editor?.list?.some((item) => !item.__screenhelloImageId));
                return { enabled: !conflict && (unlocked.length > 0 || hasShape), disabledReason: conflictReason || this.root.i18n.t("没有可删除的选中内容"), busy: conflict };
            }
            case 'edit.selectAllImages':
                return { enabled: !conflict && hasImage && selected.length !== imageStore.list.length, disabledReason: conflictReason || (!hasImage ? this.root.i18n.t("请先添加图片") : this.root.i18n.t("已选择全部图片")), busy: conflict };
            case 'edit.groupSelection': {
                const groupable = unlocked.length >= 2 && !unlocked.every((layer) => layer.groupId && layer.groupId === unlocked[0].groupId);
                return { enabled: !conflict && groupable, disabledReason: conflictReason || this.root.i18n.t("请选择至少两个未锁定图片图层"), busy: conflict };
            }
            case 'edit.ungroupSelection':
                return { enabled: !conflict && selected.some((layer) => layer.groupId), disabledReason: conflictReason || this.root.i18n.t("选中图片未编组"), busy: conflict };
            case 'edit.toggleSelectionLock': {
                const allLocked = selected.length > 0 && selected.every((layer) => layer.locked);
                return {
                    label: allLocked ? this.root.i18n.t("解锁") : this.root.i18n.t("锁定"),
                    enabled: !conflict && selected.length > 0,
                    disabledReason: conflictReason || this.root.i18n.t("请先选择图片图层"),
                    checked: allLocked,
                    busy: conflict,
                };
            }
            case 'edit.resetImageStyle':
                return { enabled: !conflict && hasImage && !option.imageStyleIsDefault, disabledReason: conflictReason || (!hasImage ? this.root.i18n.t("请先添加图片") : this.root.i18n.t("图片样式已经是默认值")), busy: conflict };
            case 'view.zoomIn':
            case 'view.zoomOut':
            case 'view.zoom100':
            case 'view.fitCanvas':
                return { enabled: !conflict, disabledReason: conflictReason, busy: conflict };
            case 'view.toggleFramePanel':
                return {
                    label: this.framePanelVisible ? this.root.i18n.t("隐藏尺寸与外框") : this.root.i18n.t("显示尺寸与外框"),
                    enabled: true,
                    checked: this.framePanelVisible,
                };
            case 'view.toggleInspector':
                return {
                    label: this.inspectorVisible ? this.root.i18n.t("隐藏检查器") : this.root.i18n.t("显示检查器"),
                    enabled: true,
                    checked: this.inspectorVisible,
                };
            case 'view.toggleAnnotationTools':
                return {
                    label: this.annotationToolsVisible ? this.root.i18n.t("隐藏标注工具") : this.root.i18n.t("显示标注工具"),
                    enabled: true,
                    checked: this.annotationToolsVisible,
                };
            case 'view.setTheme': {
                const theme = payload?.theme;
                return {
                    label: theme === 'dark' ? this.root.i18n.t("暗色主题") : (theme === 'light' ? this.root.i18n.t("亮色主题") : this.root.i18n.t("切换主题")),
                    enabled: theme == null || theme === 'light' || theme === 'dark',
                    disabledReason: this.root.i18n.t("不支持的主题"),
                    checked: theme == null ? null : editor.theme === theme,
                };
            }
            case 'help.quickStart':
            case 'help.shortcuts':
            case 'help.localPrivacy':
            case 'help.recovery':
            case 'help.documentation':
            case 'help.reportIssue':
            case 'help.github':
            case 'help.about':
                return { enabled: true, busy: false };
            default:
                return { visible: false, enabled: false, disabledReason: this.root.i18n.t("命令尚未注册"), busy: false };
        }
    }

    get(id, payload) {
        const state = this._descriptor(id, payload);
        return commandResult(id, {
            ...state,
            label: this.root.i18n.t(state.label || LABELS[id] || id),
            shortcut: state.shortcut === undefined ? (SHORTCUTS[id] || null) : state.shortcut,
            execute: (nextPayload = payload) => this.execute(id, nextPayload),
        });
    }

    registerUiAction(id, handler) {
        if (typeof handler !== 'function') return () => {};
        this._uiActions.set(id, handler);
        return () => {
            if (this._uiActions.get(id) === handler) this._uiActions.delete(id);
        };
    }

    async _invokeUi(id, payload) {
        const handler = this._uiActions.get(id);
        return handler ? handler(payload) : false;
    }

    async _pickLocalImages(multiple) {
        try {
            return await this.root.platform.file.openImages({ multiple });
        } catch {
            this.root.editor.message?.error?.(this.root.i18n.t("无法打开系统图片选择器"));
            return { status: 'failed' };
        }
    }

    async _installCapture(file) {
        if (!(file instanceof File)) {
            this.root.editor.message?.error?.(this.root.i18n.t("未能获取屏幕内容，请检查屏幕录制权限"));
            return false;
        }
        return this.root.imageStore.list.length
            ? this.addImages([file])
            : this.replaceAllImage(file);
    }

    async execute(id, payload) {
        if (this.root.isDisposed || !this.root.isActive) return false;
        const descriptor = this.get(id, payload);
        if (!descriptor.visible || !descriptor.enabled) return false;

        switch (id) {
            case 'file.newProject':
                return this.requestWorkspaceReplacement(() => this._newProject(), { label: this.root.i18n.t("新建项目") });
            case 'file.openProject':
                if (payload?.file) {
                    return this.requestWorkspaceReplacement(
                        () => this.root.workspace.openProjectFile(payload.file),
                        { label: this.root.i18n.t("打开其他项目") }
                    );
                }
                if (!this.root.platform.file.supportsFileSystemAccess()) return Boolean(await this._invokeUi('file.selectProjectFile'));
                return this.requestWorkspaceReplacement(async () => {
                    const result = await this.root.workspace.openProjectPicker();
                    return result === true;
                }, { label: this.root.i18n.t("打开其他项目") });
            case 'file.openRecentProject':
                return this.requestWorkspaceReplacement(
                    () => this.root.workspace.openRecentProject(payload.id),
                    { label: this.root.i18n.t("打开最近项目") }
                );
            case 'file.saveProject':
                return this.root.workspace.saveProject();
            case 'file.saveProjectAs':
                return this.root.workspace.saveProject({ saveAs: true });
            case 'file.addImages': {
                if (payload?.files?.length) return this.addImages(payload.files);
                const selected = await this._pickLocalImages(true);
                if (selected.status === 'selected') return this.addImages(selected.files);
                return selected.status === 'unsupported'
                    ? Boolean(await this._invokeUi('file.selectImages'))
                    : false;
            }
            case 'file.replaceActiveImage': {
                if (payload?.file) return this.replaceActiveImage(payload.file);
                const selected = await this._pickLocalImages(false);
                if (selected.status === 'selected') return this.replaceActiveImage(selected.files[0]);
                return selected.status === 'unsupported'
                    ? Boolean(await this._invokeUi('file.selectReplacementImage'))
                    : false;
            }
            case 'file.captureScreen': {
                if (payload?.file instanceof File) return this._installCapture(payload.file);
                if (payload?.mode === 'primary' && typeof this.root.platform.capture.capturePrimary === 'function') {
                    this.captureBusy = true;
                    try {
                        const file = await this.root.platform.capture.capturePrimary();
                        runInAction(() => { this.captureBusy = false; });
                        return this._installCapture(file);
                    } catch {
                        runInAction(() => { this.captureBusy = false; });
                        this.root.editor.message?.error?.(this.root.i18n.t("未能截取主屏幕，请检查系统录屏权限"));
                        return false;
                    }
                }
                if (this.root.platform.capture.supportsSourcePicker()) {
                    return Boolean(await this._invokeUi('file.openCapture'));
                }
                this.captureBusy = true;
                try {
                    const file = await captureScreen(this.root.platform);
                    runInAction(() => { this.captureBusy = false; });
                    return this._installCapture(file);
                } catch {
                    runInAction(() => { this.captureBusy = false; });
                    this.root.editor.message?.error?.(this.root.i18n.t("未能获取屏幕内容，请检查屏幕录制权限"));
                    return false;
                }
            }
            case 'file.openExport':
                return Boolean(await this._invokeUi('file.openExport'));
            case 'file.quickExport':
                return this.downloadCurrentImage(payload?.confirmedSettings);
            case 'file.copyFinalImage':
                return this.copyFinalImage();
            case 'file.openBatch':
                return Boolean(await this._invokeUi('file.openBatch'));
            case 'file.openLibrary':
                return Boolean(await this._invokeUi('file.openLibrary'));
            case 'edit.undo':
                this.root.history.undo(); return true;
            case 'edit.redo':
                this.root.history.redo(); return true;
            case 'edit.duplicateSelection':
                return this.root.imageStore.duplicateSelected();
            case 'edit.deleteSelection':
                return this.deleteSelection(payload);
            case 'edit.selectAllImages':
                this.root.imageStore.select(this.root.imageStore.list.map((layer) => layer.id), { expandGroup: false }); return true;
            case 'edit.groupSelection':
                return this.root.imageStore.groupSelected();
            case 'edit.ungroupSelection':
                return this.root.imageStore.ungroupSelected();
            case 'edit.toggleSelectionLock':
                return this.root.imageStore.toggleLockSelected();
            case 'edit.resetImageStyle':
                return this.root.option.resetImageStyle();
            case 'view.zoomIn':
                return this.zoom('in');
            case 'view.zoomOut':
                return this.zoom('out');
            case 'view.zoom100':
                return this.zoom('100');
            case 'view.fitCanvas':
                return this.zoom('fit');
            case 'view.toggleFramePanel':
                return this.setPanelVisibility('frame', !this.framePanelVisible);
            case 'view.toggleInspector':
                return this.setPanelVisibility('inspector', !this.inspectorVisible);
            case 'view.toggleAnnotationTools':
                return this.setPanelVisibility('annotation', !this.annotationToolsVisible);
            case 'view.setTheme': {
                const nextTheme = payload?.theme || (this.root.editor.isDark ? 'light' : 'dark');
                if (!['light', 'dark'].includes(nextTheme)) return false;
                this.root.editor.setTheme(nextTheme);
                this.root.platform.storage.setPreference('SHOTEASY_BEAUTIFIER_THEME', nextTheme);
                return true;
            }
            case 'help.quickStart':
            case 'help.shortcuts':
            case 'help.localPrivacy':
            case 'help.recovery':
            case 'help.documentation':
            case 'help.reportIssue':
            case 'help.github':
            case 'help.about':
                return Boolean(await this._invokeUi(id, payload));
            default:
                return false;
        }
    }

    setPanelVisibility(panel, visible) {
        const next = Boolean(visible);
        if (panel === 'frame') this.framePanelVisible = next;
        else if (panel === 'inspector') this.inspectorVisible = next;
        else if (panel === 'annotation') this.annotationToolsVisible = next;
        else return false;
        return true;
    }

    requestWorkspaceReplacement(action, { label = this.root.i18n.t("替换当前项目") } = {}) {
        if (this.root.isDisposed || !this.root.isActive || typeof action !== 'function' || this.guardOpen || this.exportActive || this.root.exportService.isBusy) {
            return Promise.resolve(false);
        }
        if (!this.root.workspace.isDirty) return this._runReplacement(action);

        this.guardOpen = true;
        this.guardBusy = false;
        this.guardLabel = label;
        this.guardError = null;
        this._pendingGuardAction = action;
        return new Promise((resolve) => {
            this._pendingGuardResolve = resolve;
        });
    }

    async resolveWorkspaceGuard(choice) {
        if (!this.guardOpen || this.guardBusy) return false;
        if (this.root.isDisposed || !this.root.isActive) {
            this._finishGuard(false);
            return false;
        }
        if (choice === 'cancel') {
            this._finishGuard(false);
            return false;
        }
        if (!['save', 'discard'].includes(choice)) return false;

        this.guardBusy = true;
        this.guardError = null;
        if (choice === 'save') {
            const saved = await this.root.workspace.saveProject();
            if (!saved) {
                runInAction(() => {
                    this.guardBusy = false;
                    this.guardError = this.root.i18n.t("项目未能保存；当前内容保持不变。你可以重试、选择不保存或取消。");
                });
                return false;
            }
        }

        const action = this._pendingGuardAction;
        const result = await this._runReplacement(action);
        this._finishGuard(result);
        return result;
    }

    async _runReplacement(action) {
        if (this.root.draftService.isEnabled()) await this.root.draftService.flush();
        if (this.root.isDisposed || !this.root.isActive || typeof action !== 'function' || this.exportActive || this.root.exportService.isBusy) return false;
        try {
            const result = await action();
            return result !== false && result !== 'cancelled' && result !== 'unsupported';
        } catch {
            return false;
        }
    }

    /**
     * 仅允许紧随其后的一个受控页面离开事件通过。
     * PWA 的 updateServiceWorker() 会先返回，再于 controlling 事件中触发刷新，
     * 所以许可必须在实际调用 location.reload() 的同一调用栈中发放。
     */
    runApprovedPageUnload(action) {
        if (this.root.isDisposed || typeof action !== 'function') return false;
        this.consumePageUnloadApproval();
        this.pageUnloadApproved = true;
        this._pageUnloadApprovalTimer = setTimeout(this.consumePageUnloadApproval, 5_000);
        try {
            action();
            return true;
        } catch {
            this.consumePageUnloadApproval();
            return false;
        }
    }

    consumePageUnloadApproval() {
        const approved = this.pageUnloadApproved;
        clearTimeout(this._pageUnloadApprovalTimer);
        this._pageUnloadApprovalTimer = null;
        this.pageUnloadApproved = false;
        return approved;
    }

    _finishGuard(result) {
        const resolve = this._pendingGuardResolve;
        this.guardOpen = false;
        this.guardBusy = false;
        this.guardLabel = '';
        this.guardError = null;
        this._pendingGuardAction = null;
        this._pendingGuardResolve = null;
        resolve?.(Boolean(result));
    }

    async _newProject() {
        if (this.root.draftService.isEnabled()) await this.root.draftService.clear();
        this.root.editor.destroy();
        this.root.imageStore.clearAll({ release: true });
        this.root.option.restoreFromDocument({});
        this.root.workspace.resetProject();
        this.root.history.reset();
        this.root.editor.clearFun?.();
        return true;
    }

    openDraft(key) {
        if (this.root.isDisposed || !this.root.isActive || !key || this.isBusy) return Promise.resolve(false);
        return this.requestWorkspaceReplacement(
            () => this.root.workspace.openDraft(key),
            { label: this.root.i18n.t("恢复其他草稿") }
        );
    }

    async addImages(files) {
        if (this.root.isDisposed || !this.root.isActive || this.isBusy) return false;
        const list = Array.from(files || []);
        if (!list.length) return false;
        const prepared = [];
        let installed = false;
        let failingName = list[0]?.name || this.root.i18n.t("图片");
        this.imageBusy = true;
        try {
            if (this.root.imageStore.list.length + list.length > MAX_PROJECT_IMAGES) {
                throw Object.assign(new Error('image-layer-limit'), { code: 'image-layer-limit' });
            }
            for (let index = 0; index < list.length; index += 1) {
                failingName = list[index].name;
                prepared.push(await prepareRuntimeImage(list[index], {
                    role: `image-${index + 1}`,
                    platform: this.root.platform,
                }));
            }
            if (this.root.isDisposed || !this.root.isActive) return false;
            this.root.imageStore.addMany(prepared, { commit: false });
            installed = true;
            this.root.history.commit('image:add');
            return true;
        } catch (error) {
            const code = `${error?.code || ''} ${error?.message || ''}`;
            this.root.editor.message?.error?.(/limit|budget/.test(code)
                ? this.root.i18n.t("图片数量或总像素超过当前项目上限")
                : this.root.i18n.t("无法添加图片“{0}”", { 0: failingName }));
            return false;
        } finally {
            if (!installed) prepared.forEach((image) => releaseRuntimeImage(image, this.root.platform));
            runInAction(() => { this.imageBusy = false; });
        }
    }

    async replaceActiveImage(file) {
        if (this.root.isDisposed || !this.root.isActive || this.isBusy) return false;
        const targetId = this._replaceTargetId();
        if (!targetId) return false;
        let prepared = null;
        let installed = false;
        this.imageBusy = true;
        try {
            prepared = await prepareRuntimeImage(file, { role: 'replacement-image', platform: this.root.platform });
            if (this.root.isDisposed || !this.root.isActive || this._replaceTargetId() !== targetId) return false;
            this.root.imageStore.replaceActiveResource(prepared, { targetId, commit: true });
            installed = true;
            return true;
        } catch {
            this.root.editor.message?.error?.(this.root.i18n.t("图片加载失败，请选择有效图片"));
            return false;
        } finally {
            if (prepared && !installed) releaseRuntimeImage(prepared, this.root.platform);
            runInAction(() => { this.imageBusy = false; });
        }
    }

    async replaceAllImage(file) {
        if (this.root.isDisposed || !this.root.isActive || this.isBusy) return false;
        let prepared = null;
        let installed = false;
        this.imageBusy = true;
        try {
            prepared = await prepareRuntimeImage(file, { role: 'replacement-image', platform: this.root.platform });
            if (this.root.isDisposed || !this.root.isActive) return false;
            this.root.editor.replaceImg(prepared);
            installed = true;
            if (this.root.option.size.type === 'auto') {
                const frame = getDefaultFrameSize(prepared.width, prepared.height);
                this.root.option.setFrameSize(frame.width, frame.height);
            }
            this.root.history.reset();
            return true;
        } catch {
            this.root.editor.message?.error?.(this.root.i18n.t("图片加载失败，请选择有效图片"));
            return false;
        } finally {
            if (prepared && !installed) releaseRuntimeImage(prepared, this.root.platform);
            runInAction(() => { this.imageBusy = false; });
        }
    }

    deleteSelection({ imagesOnly = false } = {}) {
        const editorTarget = this.root.editor.app?.editor;
        const selectedNodes = imagesOnly ? [] : (editorTarget?.list || []);
        const nodeImageIds = selectedNodes.map((item) => item.__screenhelloImageId).filter(Boolean);
        if (nodeImageIds.length) this.root.imageStore.select(nodeImageIds);
        const removedImages = this.root.imageStore.removeSelected({ commit: false });
        let removedShape = false;
        selectedNodes.forEach((item) => {
            if (item.__screenhelloImageId) return;
            item.remove?.();
            this.root.editor.removeShape(item);
            removedShape = true;
        });
        editorTarget?.cancel?.();
        if (removedImages || removedShape) this.root.history.commit('selection:delete');
        if (removedImages && !this.root.imageStore.list.length) this.root.editor.clearFun?.();
        return removedImages || removedShape;
    }

    zoom(type) {
        const app = this.root.editor.app;
        if (!app?.tree) {
            if (type === 'fit' || type === '100') this.root.editor.setScale(1);
            else {
                const factor = type === 'in' ? 1.25 : 1 / 1.25;
                this.root.editor.setScale(Math.max(0.25, Math.min(4, this.root.editor.scale / 100 * factor)));
            }
            return true;
        }
        if (type === 'fit') app.tree.zoom('fit', 100);
        else if (type === '100') app.tree.zoom(1);
        else app.tree.zoom(type);
        this.root.editor.setScale(app.tree.scale);
        return true;
    }

    async _runExport(kind, confirmedSettings, preparedToken) {
        if (this.root.isDisposed || !this.root.isActive || this._exportController || this.root.exportService.isBusy || !this.root.editor.ensureEditing()) return false;
        let settings;
        try { settings = validateExportSettings(confirmedSettings ?? this.root.workspace.exportSettings); }
        catch { this.root.editor.message?.error?.(this.root.i18n.t('导出设置无效，请重新选择')); return false; }
        const controller = new AbortController();
        this._exportController = controller;
        this.exportActive = true;
        const key = nanoid();
        const format = kind === 'copy' ? 'png' : settings.format;
        const ratio = settings.ratio;
        const action = kind === 'copy' ? this.root.i18n.t("复制") : this.root.i18n.t("导出");
        this.root.editor.message?.open?.({ key, type: 'loading', content: kind === 'copy' ? this.root.i18n.t("正在复制…") : this.root.i18n.t("正在下载…") });
        try {
            const result = kind === 'copy'
                ? await this.root.exportService.copyImage({ ratio, signal: controller.signal, requireActive: true })
                : preparedToken
                    ? await this.root.exportService.downloadPreparedImage(preparedToken, { settings, signal: controller.signal, requireActive: true })
                    : await this.root.exportService.downloadImage({ ...settings, signal: controller.signal, requireActive: true });
            if (result?.current === false || controller.signal.aborted || this.root.isDisposed) return false;
            if (kind === 'download') this.root.workspace.setExportSettings(settings, { replace: true });
            if (result?.summary?.warnings?.length) this.root.editor.message?.warning?.(this.root.i18n.t('部分增强效果不可用，本次按画面中的回退效果导出。'));
            if (!this.root.isDisposed) {
                this.root.editor.message?.open?.({ key, type: 'success', content: kind === 'copy' ? this.root.i18n.t("复制成功") : this.root.i18n.t("下载成功") });
            }
            return true;
        } catch (error) {
            if (!controller.signal.aborted && !this.root.isDisposed && !isExportCancelled(error)) {
                this.root.editor.message?.open?.({ key, type: 'error', content: exportFailureMessage(error, action, format, this.root.i18n.t) });
            }
            return false;
        } finally {
            if (this._exportController === controller) {
                this._exportController = null;
                runInAction(() => { this.exportActive = false; });
            }
        }
    }

    downloadCurrentImage(settings) {
        return this._runExport('download', settings);
    }

    downloadPreparedImage(token, settings) {
        if (!token) return Promise.resolve(false);
        return this._runExport('download', settings, token);
    }

    copyFinalImage() {
        return this._runExport('copy');
    }

    cancelExport() {
        if (!this._exportController || this.root.exportService.isHandingOff) return false;
        this._exportController.abort();
        return true;
    }

    dispose() {
        this.consumePageUnloadApproval();
        this._exportController?.abort();
        this._exportController = null;
        this.exportActive = false;
        this.captureBusy = false;
        this._uiActions.clear();
        if (this.guardOpen) this._finishGuard(false);
    }
}
