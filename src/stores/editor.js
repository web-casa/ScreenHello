import { makeAutoObservable, toJS, action, runInAction } from 'mobx';
import { maxBy } from 'lodash';
import '@leafer-in/export';
import { createDocument, validateDocument, normalizeShape } from '@utils/projectDocument';

export class Editor {
    invalid = false;
    app = null;
    scale = 100;
    useTool = null;
    annotateColor = '#2563eb';
    strokeWidth = 4;
    shapes = new Map();
    message = null;
    theme = 'light';
    clearFun = null;
    snap = null;
    selectedId = null;
    _imageReleaseTimer = null;
    _destroyTimer = null;
    _invalidTimer = null;
    constructor (root) {
        this.root = root;
        makeAutoObservable(this, { root: false, _invalidTimer: false })
        // 底图快照服务生成完成后写回可观察 snap，驱动放大镜等消费者重绘
        this.root.baseSnapshot.onUpdate = (image) => runInAction(() => { this.snap = image; });
    }

    get img() {
        return this.root.imageStore.activeImage;
    }

    /** 当前是否存在依赖底图快照的标注（放大镜、模糊、马赛克；聚光不依赖快照）。 */
    _hasSnapshotConsumer() {
        return this.shapesList.some((s) => s.type === 'Magnifier' || s.type === 'blur' || s.type === 'mosaic');
    }

    get shapesList() {
        return Array.from(toJS(this.shapes).values());
    }

    /**
     * 当前单选且为文字标注的 shape（供右侧「文字」属性面板渲染）。
     * 多选或选中的非文字标注返回 null。
     */
    get selectedTextShape() {
        if (!this.selectedId) return null;
        const shape = this.shapes.get(this.selectedId);
        return shape && shape.type === 'text' ? shape : null;
    }

    /**
     * 当前单选且为区域效果（模糊/马赛克/聚光）的 shape（供右侧「区域效果」属性面板渲染）。
     */
    get selectedEffectShape() {
        if (!this.selectedId) return null;
        const shape = this.shapes.get(this.selectedId);
        return shape && (shape.type === 'blur' || shape.type === 'mosaic' || shape.type === 'spotlight') ? shape : null;
    }

    get cursor() {
        return this.useTool === 'Pencil' ? 'pencil' : this.useTool ? 'crosshair' : 'auto'
    }

    get isEditing() {
        return !!this.app?.tree;
    }

    ensureEditing() {
        if (this.isEditing) return true;
        this.message?.info?.('请先添加图片');
        this.setInvalid();
        return false;
    }

    get nextStep() {
        const steps = this.shapesList.filter(e => e.type === 'Step');
        const maxItem = maxBy(steps, (item) => Number(item.text));
        if (maxItem?.text) return Number(maxItem.text) + 1;
        return 1;
    }

    get isDark() {
        return this.theme === 'dark';
    }

    /**
     * 请求底图快照（放大镜与区域效果共享，见 baseSnapshot.js）。
     * - 'init'：放大镜工具被选中时预热，无论是否已有消费者。
     * - 其他（'update'）：仅在存在快照消费者或已有快照时更新，避免没有放大镜时每次截图调整都空跑整帧导出。
     * revision 未变时由服务复用缓存，不重复生成。
     */
    createSnap(type) {
        if (type === 'init') {
            this.root.baseSnapshot.schedule(this);
            return;
        }
        if (this.snap || this._hasSnapshotConsumer()) {
            this.root.baseSnapshot.schedule(this);
        }
    }

    /** 由 View 同步 LeaferJS 编辑器当前单选标注的 id（null 表示无单选）。 */
    setSelectedId(id) {
        this.selectedId = id || null;
    }

    setTheme(value) {
        if (value === this.theme) return;
        runInAction(() => {
            if (value) {
                this.theme = value;
            } else {
                this.theme = this.isDark ? 'light' : 'dark';
            }
        });
    }

    setInvalid() {
        clearTimeout(this._invalidTimer);
        this.invalid = true;
        this._invalidTimer = setTimeout(action(() => {
            this.invalid = false;
            this._invalidTimer = null;
        }), 200);
    }

    setImg(value) {
        this.cancelScheduledImageRelease();
        this.root.imageStore.setActiveResource(value);
    }

    replaceImg(value) {
        this.root.imageStore.replaceAll(value);
        this.shapes.clear();
        this.selectedId = null;
        this.snap = null;
        this.root.baseSnapshot.invalidate();
        this.setUseTool(null);
        this.clearSelection();
    }

    /** 组件卸载时释放主图 object URL；延迟一帧以避开 StrictMode 的模拟 cleanup。 */
    scheduleImageRelease() {
        clearTimeout(this._imageReleaseTimer);
        this._imageReleaseTimer = setTimeout(() => {
            this._imageReleaseTimer = null;
            this.root.imageStore.clearAll({ release: true });
        }, 0);
    }

    cancelScheduledImageRelease() {
        clearTimeout(this._imageReleaseTimer);
        this._imageReleaseTimer = null;
    }

    /** Leafer View 卸载时延迟销毁，允许 React StrictMode 的模拟 cleanup 被下一次 setup 取消。 */
    scheduleDestroy() {
        clearTimeout(this._destroyTimer);
        this._destroyTimer = setTimeout(() => {
            this._destroyTimer = null;
            this.destroy();
        }, 0);
    }

    cancelScheduledDestroy() {
        clearTimeout(this._destroyTimer);
        this._destroyTimer = null;
    }

    /**
     * 仅销毁当前 Leafer App（画布及其 DOM view），保留 shapes、图片、背景与快照等编辑状态。
     * View 重新挂载（React StrictMode 模拟 cleanup 后的 setup）时调用：
     * 旧 app 的 view 若不销毁会残留在容器里占据布局流，把新 app 挤出视口，
     * 指针事件全部落在已废弃的 view 上（表现为无法绘制/选中标注，仅 dev 模式出现）。
     */
    destroyApp() {
        this.app?.destroy(true);
        this.app = null;
        this.selectedId = null;
        this.setUseTool(null);
    }

    setMessage(value) {
        this.message = value;
    }

    getShape(id) {
        return this.shapes.get(id);
    }

    addShape(shape) {
        // 兼容旧入口；统一经 updateShape 完成规范化写入
        this.updateShape(shape);
    }

    /**
     * 统一更新/新增一个 shape：经 normalizeShape 规范化后写入 Map。
     * 所有 shape 写入（拖拽、颜色/线宽修改、历史恢复）都应走此方法，
     * 禁止外部直接 shapes.set 或直接修改 shape 对象字段。
     */
    updateShape(shape) {
        const next = normalizeShape(shape);
        if (!next) return;
        this.shapes.set(next.id, next);
    }

    /**
     * 序列化当前项目为可恢复的 ProjectDocument。
     * 包含项目级 option、images 图层与 shapes 标注；运行时 src/Blob、app、
     * 视图缩放、theme、snap 等非内容状态不进入文档。
     */
    serializeProject() {
        const images = this.root.imageStore.toDocument();
        const option = this.root.option.toDocument();
        const primaryTransform = images[0]?.transform;
        if (primaryTransform) {
            option.offsetX = primaryTransform.x;
            option.offsetY = primaryTransform.y;
            option.scale = primaryTransform.scale;
            option.rotation = primaryTransform.rotation;
        }
        return createDocument({
            option,
            images,
            shapes: this.shapesList.map((shape) => toJS(shape))
        });
    }

    /**
     * 从文档恢复项目：恢复 option、images 与 shapes，并清空 LeaferJS 编辑器选择。
     * image 资源必须已由 ImageStore/持久化层准备；不触碰 app、theme、视图缩放。
     */
    restoreProject(doc) {
        const { doc: valid } = validateDocument(doc);
        runInAction(() => {
            this.root.option.restoreFromDocument(valid.option);
            this.root.imageStore.restoreLayers(valid.images);
            this.shapes.clear();
            this.selectedId = null;
            valid.shapes.forEach((shape) => {
                const next = normalizeShape(shape);
                if (next) this.shapes.set(next.id, next);
            });
        });
        this.clearSelection();
    }

    /**
     * 取消 LeaferJS 编辑器当前选择。历史恢复后原选中节点可能已失效，需主动清空。
     */
    clearSelection() {
        const editor = this.app?.editor;
        if (!editor) return;
        try {
            editor.target = null;
            editor.update?.();
        } catch {
            // 编辑器可能尚未就绪，忽略
        }
    }

    removeShape(shape) {
        this.shapes.delete(shape.id);
        if (this.selectedId === shape.id) this.selectedId = null;
        // 没有快照消费者时释放可观察 snap 与服务缓存（含变体）
        if (this.snap && !this._hasSnapshotConsumer()) {
            this.snap = null;
            this.root.baseSnapshot.invalidate();
        }
    }

    setApp(app) {
        this.app = app;
    }

    setScale(value) {
        this.scale = parseInt(value * 100);
    }

    setUseTool(value) {
        this.useTool = value;
        if (value) {
            this.setMove(false);
            this.setSelect(false);
        } else {
            this.setSelect(true);
        }
    }

    setSelect(value) {
        if (!this.app) return;
        this.app.editor.hittable = value;
    }

    setMove(value) {
        if (!this.app) return;
        this.app.config.move.drag = value;
        if (this.app.interaction?.config?.move) {
            this.app.interaction.config.move.drag = value;
        }
        this.setSelect(!value);
    }
    

    setAnnotateColor(color) {
        this.annotateColor = color;
        if (!this.app?.editor) return;
        const { list } = this.app.editor;
        if (!list.length) return;
        let changed = false;
        for (let item of list) {
            const shape = this.shapes.get(item.id);
            if (shape) {
                this.updateShape({ ...shape, fill: color });
                changed = true;
            }
        }
        // 仅在确实改动了已有标注时入历史；只改默认色（无选中）不入历史
        if (changed) this.root.history.commit('style:color');
    }

    setStrokeWidth(value) {
        this.strokeWidth = value;
        if (!this.app?.editor) return;
        const { list } = this.app.editor;
        if (!list.length) return;
        let changed = false;
        for (let item of list) {
            const shape = this.shapes.get(item.id);
            if (shape) {
                this.updateShape({ ...shape, strokeWidth: value });
                changed = true;
            }
        }
        if (changed) this.root.history.commit('style:width');
    }

    /**
     * 修改当前选中文字标注的内容。仅更新 store，由调用方在交互结束时入历史，
     * 避免连续输入产生大量历史步。
     */
    setTextContent(text) {
        const shape = this.selectedTextShape;
        if (!shape) return;
        this.updateShape({ ...shape, text: text == null ? '' : String(text) });
    }

    /**
     * 合并更新当前选中文字标注的 textStyle（字号/粗细/颜色/对齐/背景/内边距/圆角）。
     * 同样不入历史，由调用方按需 commit。
     */
    setTextStyle(patch) {
        const shape = this.selectedTextShape;
        if (!shape) return;
        const textStyle = { ...(shape.textStyle || {}), ...patch };
        this.updateShape({ ...shape, textStyle });
    }

    /**
     * 合并更新当前选中区域效果的 effect 参数（模糊强度/马赛克块大小/聚光遮罩颜色与透明度/圆角）。
     * 不入历史，由调用方在交互结束（onChangeComplete）时统一 commit。
     */
    setEffectStyle(patch) {
        const shape = this.selectedEffectShape;
        if (!shape) return;
        const effect = { ...(shape.effect || {}), ...patch };
        this.updateShape({ ...shape, effect });
    }

    setClearFun(value) {
        this.clearFun = value;
    }

    clearImg() {
        this.root.option.releaseBackgroundAsset();
        this.cancelScheduledImageRelease();
        this.root.imageStore.clearAll({ release: true });
        // 草稿清理钩子（M6.10）：由 draftService 注册，清空时删除草稿与孤立资源。
        // 卸载走 destroy()，不触发本钩子，故不删除草稿（M6.11 只释放 object URL）。
        this.notifyImagesEmpty();
    }

    /** 用户操作使项目不再包含图片时，立即清理持久化草稿；保留内存历史供撤销。 */
    notifyImagesEmpty() {
        if (typeof this._onClearDraft === 'function') this._onClearDraft();
    }

    setClearDraftHook(fn) {
        this._onClearDraft = fn || null;
    }

    destroy() {
        this.cancelScheduledDestroy();
        this.root.option.releaseBackgroundAsset();
        this.root.baseSnapshot.invalidate();
        this.app?.destroy(true);
        this.app = null;
        this.snap = null;
        this.selectedId = null;
        this.shapes.clear();
        this.setUseTool(null);
    }

    /** 销毁整个编辑器实例拥有的运行时资源；不删除 IndexedDB 草稿。 */
    dispose() {
        this.cancelScheduledImageRelease();
        clearTimeout(this._invalidTimer);
        this._invalidTimer = null;
        this.destroy();
        this.root.imageStore.clearAll({ release: true });
        this.message = null;
        this.clearFun = null;
        this._onClearDraft = null;
    }
}
