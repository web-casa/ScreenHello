import { makeAutoObservable } from 'mobx';
import { MAX_PROJECT_IMAGES, normalizeProjectImage } from '@utils/projectDocument';
import { browserPlatform } from '../platform/browserPlatform';

export const MAX_PROJECT_IMAGE_PIXELS = 120_000_000;
const SNAP_THRESHOLD = 8;

const createId = (prefix) => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}:${crypto.randomUUID()}`;
    }
    return `${prefix}:${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const revoke = (resource) => {
    if (resource?._ownsObjectUrl && typeof resource.src === 'string' && resource.src.startsWith('blob:')) {
        browserPlatform.file.revokeObjectURL(resource.src);
    }
};

const clampOrder = (layers) => layers
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((layer, zIndex) => ({ ...layer, zIndex }));

export class ImageStore {
    layers = new Map();
    selectedIds = [];
    activeId = null;
    resourceRevision = 0;
    baselineRevision = 0;
    nodeRevision = 0;
    resources = new Map();
    geometry = new Map();
    nodes = new Map();
    _syncingOption = false;
    _processingTail = Promise.resolve();

    constructor(root) {
        this.root = root;
        makeAutoObservable(this, {
            root: false,
            resources: false,
            geometry: false,
            nodes: false,
            _syncingOption: false,
            _processingTail: false,
        });
    }

    get list() {
        return Array.from(this.layers.values()).sort((a, b) => a.zIndex - b.zIndex);
    }

    get selectedList() {
        return this.selectedIds.map((id) => this.layers.get(id)).filter(Boolean);
    }

    get activeLayer() {
        return this.activeId ? this.layers.get(this.activeId) || null : this.list[0] || null;
    }

    get activeImage() {
        // resourceRevision is intentionally observed so replacing a crop/source refreshes this computed view.
        void this.resourceRevision;
        const layer = this.activeLayer;
        if (!layer) return {};
        const resource = this.resources.get(layer.assetId);
        return resource ? { ...resource, ...layer, layerId: layer.id } : {};
    }

    resolve(layerOrId) {
        void this.resourceRevision;
        const layer = typeof layerOrId === 'string' ? this.layers.get(layerOrId) : layerOrId;
        if (!layer) return null;
        const resource = this.resources.get(layer.assetId);
        return resource ? { ...resource, ...layer, layerId: layer.id } : null;
    }

    _resourcePixels(resources = this.resources) {
        let total = 0;
        resources.forEach((resource) => {
            total += Math.max(0, Number(resource.width) || 0) * Math.max(0, Number(resource.height) || 0);
        });
        return total;
    }

    _assertBudget(layerCount, resources) {
        if (layerCount > MAX_PROJECT_IMAGES) {
            throw Object.assign(new Error('image-layer-limit'), { code: 'image-layer-limit' });
        }
        if (this._resourcePixels(resources) > MAX_PROJECT_IMAGE_PIXELS) {
            throw Object.assign(new Error('image-pixel-budget'), { code: 'image-pixel-budget' });
        }
    }

    _resourceFrom(value, assetId) {
        if (!value?.src) throw Object.assign(new Error('image-resource-missing'), { code: 'image-resource-missing' });
        return {
            assetId,
            src: value.src,
            width: Math.max(1, Math.round(Number(value.width) || 1)),
            height: Math.max(1, Math.round(Number(value.height) || 1)),
            type: value.type || 'image/png',
            name: value.name || 'image',
            blob: value.blob || null,
            _ownsObjectUrl: value._ownsObjectUrl === true,
        };
    }

    _defaultTransform(index = this.layers.size) {
        const option = this.root.option;
        const stagger = index ? index * 24 : 0;
        return {
            x: (Number(option?.offsetX) || 0) + stagger,
            y: (Number(option?.offsetY) || 0) + stagger,
            scale: Number(option?.scale) || 1,
            rotation: Number(option?.rotation) || 0,
        };
    }

    add(value, { select = true, transform, commit = false } = {}) {
        return this.addMany([value], { select, transforms: transform ? [transform] : [], commit })[0];
    }

    /** 原子追加一批图片：全部通过项目预算后才修改资源表和图层表。 */
    addMany(values, { select = true, transforms = [], commit = false } = {}) {
        if (this.root.isDisposed) throw Object.assign(new Error('runtime-disposed'), { code: 'runtime-disposed' });
        if (!Array.isArray(values) || !values.length) return [];
        const nextResources = new Map(this.resources);
        const startIndex = this.layers.size;
        const nextLayers = values.map((value, index) => {
            const assetId = value.assetId || createId('asset');
            const layerId = value.layerId || value.id || createId('image');
            if (!nextResources.has(assetId)) nextResources.set(assetId, this._resourceFrom(value, assetId));
            return normalizeProjectImage({
                id: layerId,
                assetId,
                name: value.name,
                type: value.type,
                width: value.width,
                height: value.height,
                transform: transforms[index] || this._defaultTransform(startIndex + index),
                zIndex: startIndex + index,
                locked: false,
                groupId: null,
            }, startIndex + index);
        });
        this._assertBudget(startIndex + nextLayers.length, nextResources);
        this.resources = nextResources;
        nextLayers.forEach((layer) => this.layers.set(layer.id, layer));
        this.resourceRevision += 1;
        if (select) this.select([nextLayers.at(-1).id]);
        if (commit) this.root.history?.commit?.('image:add');
        return nextLayers;
    }

    setActiveResource(value) {
        if (this.root.isDisposed) throw Object.assign(new Error('runtime-disposed'), { code: 'runtime-disposed' });
        const active = this.activeLayer;
        if (!active) {
            const layer = this.add(value);
            this.baselineRevision += 1;
            return layer;
        }
        const previous = this.resources.get(active.assetId);
        const shared = this.list.filter((layer) => layer.assetId === active.assetId).length > 1;
        const assetId = shared ? createId('asset') : active.assetId;
        const resource = this._resourceFrom(value, assetId);
        const nextResources = new Map(this.resources);
        nextResources.set(assetId, resource);
        this._assertBudget(this.layers.size, nextResources);
        this.resources = nextResources;
        this.layers.set(active.id, normalizeProjectImage({
            ...active,
            assetId,
            width: resource.width,
            height: resource.height,
            type: resource.type,
            name: resource.name,
        }));
        if (!shared && previous?.src !== resource.src) revoke(previous);
        this.resourceRevision += 1;
        this.baselineRevision += 1;
        return this.layers.get(active.id);
    }

    replaceAll(value) {
        if (this.root.isDisposed) throw Object.assign(new Error('runtime-disposed'), { code: 'runtime-disposed' });
        const assetId = value.assetId || createId('asset');
        const layer = normalizeProjectImage({
            id: value.layerId || value.id || createId('image'),
            assetId,
            name: value.name,
            type: value.type,
            width: value.width,
            height: value.height,
            transform: value.transform || this._defaultTransform(0),
            zIndex: 0,
            locked: false,
            groupId: null,
        }, 0);
        this.replaceProject([layer], [{ ...value, assetId }]);
        return this.layers.get(layer.id);
    }

    replaceProject(images, runtimeResources) {
        if (this.root.isDisposed) throw Object.assign(new Error('runtime-disposed'), { code: 'runtime-disposed' });
        const nextResources = new Map();
        const nextLayers = [];
        images.forEach((raw, index) => {
            const input = runtimeResources[index];
            const assetId = raw.assetId || input?.assetId || createId('asset');
            let resource = nextResources.get(assetId);
            if (!resource) {
                resource = this._resourceFrom({ ...raw, ...input, src: input?.src }, assetId);
                nextResources.set(assetId, resource);
            } else if (input?.src && input.src !== resource.src) {
                throw Object.assign(new Error('image-asset-conflict'), { code: 'image-asset-conflict' });
            }
            nextLayers.push(normalizeProjectImage({
                ...raw,
                assetId,
                width: resource.width,
                height: resource.height,
                type: resource.type,
                name: resource.name,
            }, index));
        });
        this._assertBudget(nextLayers.length, nextResources);
        const previousResources = this.resources;
        this.resources = nextResources;
        this.layers = new Map(clampOrder(nextLayers).map((layer) => [layer.id, layer]));
        this.geometry.clear();
        this.resourceRevision += 1;
        this.baselineRevision += 1;
        this.select(this.list[0] ? [this.list[0].id] : []);
        previousResources.forEach(revoke);
    }

    restoreLayers(images) {
        const current = this.list;
        const next = images.map((raw, index) => {
            const assetId = raw.assetId || current[index]?.assetId;
            if (!assetId || !this.resources.has(assetId)) {
                throw Object.assign(new Error('image-resource-missing'), { code: 'image-resource-missing' });
            }
            return normalizeProjectImage({ ...raw, assetId }, index);
        });
        this._assertBudget(next.length, this.resources);
        this.layers = new Map(clampOrder(next).map((layer) => [layer.id, layer]));
        const retainedSelection = this.selectedIds.filter((id) => this.layers.has(id));
        this.select(retainedSelection.length ? retainedSelection : (this.list[0] ? [this.list[0].id] : []));
    }

    toDocument() {
        return this.list.map((layer, index) => normalizeProjectImage(layer, index));
    }

    select(ids, { expandGroup = true } = {}) {
        const requested = (Array.isArray(ids) ? ids : [ids]).filter((id) => this.layers.has(id));
        const expanded = new Set(requested);
        if (expandGroup) {
            requested.forEach((id) => {
                const groupId = this.layers.get(id)?.groupId;
                if (groupId) this.list.forEach((layer) => { if (layer.groupId === groupId) expanded.add(layer.id); });
            });
        }
        this.selectedIds = Array.from(expanded);
        this.activeId = this.selectedIds[0]
            || (this.activeId && this.layers.has(this.activeId) ? this.activeId : this.list[0]?.id)
            || null;
        this._syncOptionFromActive();
    }

    _syncOptionFromActive() {
        const transform = this.activeLayer?.transform;
        if (!transform || !this.root.option) return;
        this._syncingOption = true;
        this.root.option.restoreImageTransform(transform);
        this._syncingOption = false;
    }

    updateActiveTransform(patch) {
        if (this._syncingOption || !this.activeId) return;
        this.updateTransform(this.activeId, patch, { syncOption: false });
    }

    updateTransform(id, patch, { syncOption = true } = {}) {
        const layer = this.layers.get(id);
        if (!layer || layer.locked) return false;
        const next = normalizeProjectImage({
            ...layer,
            transform: { ...layer.transform, ...patch },
        });
        this.layers.set(id, next);
        if (syncOption && id === this.activeId) this._syncOptionFromActive();
        return true;
    }

    setGeometry(id, geometry) {
        if (!this.layers.has(id)) return;
        this.geometry.set(id, { ...geometry });
    }

    clearGeometry(id) {
        this.geometry.delete(id);
    }

    registerNode(id, node) {
        if (id && node && this.nodes.get(id) !== node) {
            this.nodes.set(id, node);
            this.nodeRevision += 1;
        }
    }

    unregisterNode(id, node) {
        if (this.nodes.get(id) === node) {
            this.nodes.delete(id);
            this.nodeRevision += 1;
        }
    }

    _bounds(layer) {
        const runtime = this.geometry.get(layer.id);
        if (runtime) return runtime;
        return {
            x: layer.transform.x,
            y: layer.transform.y,
            width: layer.width * layer.transform.scale,
            height: layer.height * layer.transform.scale,
        };
    }

    snapPosition(id, candidate) {
        const layer = this.layers.get(id);
        if (!layer) return candidate;
        const width = Math.max(1, Number(candidate.width) || this._bounds(layer).width);
        const height = Math.max(1, Number(candidate.height) || this._bounds(layer).height);
        const frameWidth = Number(this.root.option?.frameConf?.width) || 0;
        const frameHeight = Number(this.root.option?.frameConf?.height) || 0;
        const xTargets = [0, frameWidth / 2, frameWidth];
        const yTargets = [0, frameHeight / 2, frameHeight];
        this.list.forEach((other) => {
            if (other.id === id) return;
            const bounds = this._bounds(other);
            xTargets.push(bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width);
            yTargets.push(bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height);
        });
        const snapAxis = (start, size, targets) => {
            const anchors = [start, start + size / 2, start + size];
            let best = { delta: 0, distance: SNAP_THRESHOLD + 1 };
            anchors.forEach((anchor) => targets.forEach((target) => {
                const distance = Math.abs(target - anchor);
                if (distance < best.distance) best = { delta: target - anchor, distance };
            }));
            return best.distance <= SNAP_THRESHOLD ? start + best.delta : start;
        };
        return {
            ...candidate,
            x: snapAxis(Number(candidate.x) || 0, width, xTargets),
            y: snapAxis(Number(candidate.y) || 0, height, yTargets),
        };
    }

    _editableSelection(minimum = 1) {
        const layers = this.selectedList.filter((layer) => !layer.locked);
        return layers.length >= minimum ? layers : [];
    }

    duplicateSelected() {
        const source = this._editableSelection();
        if (!source.length) return false;
        this._assertBudget(this.layers.size + source.length, this.resources);
        const nextIds = [];
        source.forEach((layer) => {
            const id = createId('image');
            const copy = normalizeProjectImage({
                ...layer,
                id,
                transform: { ...layer.transform, x: layer.transform.x + 24, y: layer.transform.y + 24 },
                zIndex: this.layers.size,
                groupId: null,
            });
            this.layers.set(id, copy);
            nextIds.push(id);
        });
        this._normalizeOrder();
        this.select(nextIds, { expandGroup: false });
        this.root.history?.commit?.('image:duplicate');
        return true;
    }

    removeSelected({ commit = true } = {}) {
        const ids = this.selectedIds.filter((id) => !this.layers.get(id)?.locked);
        if (!ids.length) return false;
        ids.forEach((id) => {
            this.layers.delete(id);
            this.geometry.delete(id);
        });
        this._normalizeOrder();
        this.select(this.list[0] ? [this.list[0].id] : []);
        if (commit) this.root.history?.commit?.('image:remove');
        if (!this.layers.size) this.root.editor?.notifyImagesEmpty?.();
        return true;
    }

    groupSelected() {
        const layers = this._editableSelection(2);
        if (!layers.length) return false;
        const groupId = createId('group');
        layers.forEach((layer) => this.layers.set(layer.id, { ...layer, groupId }));
        this.select(layers.map((layer) => layer.id));
        this.root.history?.commit?.('image:group');
        return true;
    }

    ungroupSelected() {
        const layers = this.selectedList.filter((layer) => layer.groupId);
        if (!layers.length) return false;
        const groups = new Set(layers.map((layer) => layer.groupId));
        this.list.forEach((layer) => {
            if (groups.has(layer.groupId)) this.layers.set(layer.id, { ...layer, groupId: null });
        });
        this.select(layers.map((layer) => layer.id), { expandGroup: false });
        this.root.history?.commit?.('image:ungroup');
        return true;
    }

    toggleLockSelected() {
        const layers = this.selectedList;
        if (!layers.length) return false;
        const locked = !layers.every((layer) => layer.locked);
        layers.forEach((layer) => this.layers.set(layer.id, { ...layer, locked }));
        this.root.history?.commit?.('image:lock');
        return true;
    }

    reorderSelected(direction) {
        const selected = new Set(this.selectedIds);
        if (!selected.size) return false;
        let list = this.list;
        if (direction === 'top') list = [...list.filter((layer) => !selected.has(layer.id)), ...list.filter((layer) => selected.has(layer.id))];
        else if (direction === 'bottom') list = [...list.filter((layer) => selected.has(layer.id)), ...list.filter((layer) => !selected.has(layer.id))];
        else {
            const step = direction === 'up' ? 1 : direction === 'down' ? -1 : 0;
            if (!step) return false;
            const indexes = list.map((layer, index) => selected.has(layer.id) ? index : -1).filter((index) => index >= 0);
            const ordered = step > 0 ? indexes.reverse() : indexes;
            ordered.forEach((index) => {
                const next = index + step;
                if (next < 0 || next >= list.length || selected.has(list[next].id)) return;
                [list[index], list[next]] = [list[next], list[index]];
            });
        }
        this.layers = new Map(list.map((layer, zIndex) => [layer.id, { ...layer, zIndex }]));
        this.root.history?.commit?.('image:order');
        return true;
    }

    alignSelected(axis) {
        const layers = this._editableSelection();
        if (!layers.length) return false;
        const frameWidth = Number(this.root.option?.frameConf?.width) || 0;
        const frameHeight = Number(this.root.option?.frameConf?.height) || 0;
        layers.forEach((layer) => {
            const bounds = this._bounds(layer);
            let x = bounds.x;
            let y = bounds.y;
            if (axis === 'left') x = 0;
            else if (axis === 'center') x = (frameWidth - bounds.width) / 2;
            else if (axis === 'right') x = frameWidth - bounds.width;
            else if (axis === 'top') y = 0;
            else if (axis === 'middle') y = (frameHeight - bounds.height) / 2;
            else if (axis === 'bottom') y = frameHeight - bounds.height;
            this.updateTransform(layer.id, {
                x: layer.transform.x + x - bounds.x,
                y: layer.transform.y + y - bounds.y,
            }, { syncOption: false });
        });
        this._syncOptionFromActive();
        this.root.history?.commit?.(`image:align:${axis}`);
        return true;
    }

    distributeSelected(axis = 'horizontal') {
        const layers = this._editableSelection(3);
        if (!layers.length) return false;
        const horizontal = axis === 'horizontal';
        const ordered = layers.map((layer) => ({ layer, bounds: this._bounds(layer) }))
            .sort((a, b) => (horizontal ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y));
        const start = horizontal ? ordered[0].bounds.x : ordered[0].bounds.y;
        const last = ordered.at(-1).bounds;
        const end = horizontal ? last.x + last.width : last.y + last.height;
        const totalSize = ordered.reduce((sum, item) => sum + (horizontal ? item.bounds.width : item.bounds.height), 0);
        const gap = (end - start - totalSize) / (ordered.length - 1);
        let cursor = start;
        ordered.forEach(({ layer, bounds }) => {
            const current = horizontal ? bounds.x : bounds.y;
            this.updateTransform(layer.id, horizontal
                ? { x: layer.transform.x + cursor - current }
                : { y: layer.transform.y + cursor - current }, { syncOption: false });
            cursor += (horizontal ? bounds.width : bounds.height) + gap;
        });
        this._syncOptionFromActive();
        this.root.history?.commit?.(`image:distribute:${axis}`);
        return true;
    }

    stackSelected() {
        const layers = this._editableSelection(2);
        if (!layers.length) return false;
        const anchor = layers[0].transform;
        layers.forEach((layer, index) => this.updateTransform(layer.id, {
            x: anchor.x + index * 24,
            y: anchor.y + index * 24,
            rotation: 0,
        }, { syncOption: false }));
        this._syncOptionFromActive();
        this.root.history?.commit?.('image:stack');
        return true;
    }

    fanSelected() {
        const layers = this._editableSelection(2);
        if (!layers.length) return false;
        const center = (layers.length - 1) / 2;
        const anchor = layers[0].transform;
        layers.forEach((layer, index) => {
            const delta = index - center;
            this.updateTransform(layer.id, {
                x: anchor.x + delta * 18,
                y: anchor.y + Math.abs(delta) * 6,
                rotation: delta * 8,
            }, { syncOption: false });
        });
        this._syncOptionFromActive();
        this.root.history?.commit?.('image:fan');
        return true;
    }

    _normalizeOrder() {
        this.layers = new Map(clampOrder(this.list).map((layer) => [layer.id, layer]));
    }

    pruneResources(retainedAssetIds = null) {
        const referenced = retainedAssetIds || new Set(this.list.map((layer) => layer.assetId));
        this.resources.forEach((resource, assetId) => {
            if (!referenced.has(assetId)) {
                revoke(resource);
                this.resources.delete(assetId);
            }
        });
    }

    /** 同一 runtime 内串行执行大图处理，避免多图 HDR 同时占用多份全尺寸 Canvas。 */
    enqueueProcessing(task) {
        const run = this._processingTail
            .catch(() => null)
            .then(() => this.root.isDisposed ? null : task());
        this._processingTail = run.catch(() => null);
        return run;
    }

    clearAll({ release = true, incrementBaseline = true } = {}) {
        if (release) this.resources.forEach(revoke);
        this.resources.clear();
        this.layers.clear();
        this.geometry.clear();
        this.nodes.clear();
        this.nodeRevision += 1;
        this.selectedIds = [];
        this.activeId = null;
        this.resourceRevision += 1;
        if (incrementBaseline) this.baselineRevision += 1;
    }

    dispose() {
        this.clearAll({ release: true });
    }
}
