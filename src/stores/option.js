import { makeAutoObservable, toJS, runInAction } from 'mobx';
import { getBackgroundDefinition, normalizeBackgroundKey } from '@utils/backgroundConfig';
import {
    DEFAULT_PADDING_BACKGROUND,
    normalizeInnerBorder,
    normalizeOption,
    normalizePaddingBackground,
    normalizeShadow,
    shadowFromIntensity,
} from '@utils/projectDocument';

const DEVICE_FRAMES = [
    'genericLaptop',
    'genericDesktop',
    'genericTablet',
    'genericPhone',
    'macbookpro16',
    'macbookair',
    'imacpro',
    'ipadpro',
    'iphonepro',
];
const BACKGROUND_MODES = ['cover', 'fit', 'stretch'];
const BACKGROUND_ALIGNS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
const isImageBackground = (definition) => definition?.type === 'upload-image';
const DEFAULT_GRADIENT_ANGLE = 90;

const clampGradientAngle = (value, fallback = DEFAULT_GRADIENT_ANGLE) => {
    const angle = Number(value);
    return Number.isFinite(angle)
        ? Math.max(0, Math.min(360, Math.round(angle)))
        : fallback;
};

const getGradientPresetAngle = (definition, fallback = DEFAULT_GRADIENT_ANGLE) => {
    if (definition?.type !== 'gradient') return fallback;
    return clampGradientAngle(
        definition.gradientAngle ?? (definition.fill?.from === 'top-left' ? 135 : DEFAULT_GRADIENT_ANGLE),
        fallback
    );
};

const getGradientPoints = (angle, width, height) => {
    const safeWidth = Math.max(1, Number(width) || 1);
    const safeHeight = Math.max(1, Number(height) || 1);
    // 0° 指向上方、90° 指向右方，与 CSS linear-gradient 的角度约定一致。
    const radians = clampGradientAngle(angle) * Math.PI / 180;
    const directionX = Math.sin(radians);
    const directionY = -Math.cos(radians);
    const extent = Math.sqrt(safeWidth ** 2 + safeHeight ** 2) / 2;
    const centerX = safeWidth / 2;
    const centerY = safeHeight / 2;
    const fromX = (centerX - directionX * extent) / safeWidth;
    const fromY = (centerY - directionY * extent) / safeHeight;
    const toX = (centerX + directionX * extent) / safeWidth;
    const toY = (centerY + directionY * extent) / safeHeight;
    return {
        from: { x: fromX, y: fromY, type: 'percent' },
        to: { x: toX, y: toY, type: 'percent' },
    };
};

const applyGradientAngle = (fill, angle, width, height) => {
    if (fill?.type === 'angular') {
        return { ...fill, rotation: clampGradientAngle(angle) };
    }
    if (fill?.type !== 'linear') return fill;
    return {
        ...fill,
        ...getGradientPoints(angle, width, height),
    };
};

export class Option {
    scale = 1;
    scaleX = false;
    scaleY = false;
    rotation = 0;
    offsetX = 0;
    offsetY = 0;
    padding = 0;
    paddingBg = DEFAULT_PADDING_BACKGROUND;
    innerBorder = normalizeInnerBorder();
    round = 10;
    // 完整阴影配置（V1 由 0-6 强度档位迁移）；默认档 = 旧 shadow:3 的视觉
    shadow = shadowFromIntensity(3);
    frame = 'none';
    frameMode = 'cover';
    browserUrl = 'screenhello.com';
    browserHeaderSize = 100;
    background = 'gh_img_50';
    backgroundAssetId = null;
    backgroundMode = 'cover';
    backgroundAlign = 'center';
    // 旧预设 default_* 为从左到右，90° 可保持旧草稿的视觉方向。
    backgroundGradientAngle = DEFAULT_GRADIENT_ANGLE;
    // 背景轻量效果（M4.11/M4.12/M4.13），默认关闭
    backgroundBlur = 0;
    backgroundMaskColor = '#000000';
    backgroundMaskOpacity = 0;
    backgroundNoise = 0;
    align = 'center';
    waterImg = null;
    waterIndex = 1;
    hdrEnabled = false;
    size = {
        type: 'auto',
        title: '自动'
    };
    frameConf = {
        width: 800,
        height: 600,
        background: {
            type: 'linear',
            from: 'left',
            to: 'right',
            stops: ['#f5f7fa', '#c3cfe2', '#e0c3fc', '#8ec5fc']
        }
    }
    constructor(root) {
        this.root = root;
        // 默认背景与初始页一致（gh_img_50 兼容 token）：填充始终从代码渐变定义派生。
        this.frameConf.background = this.getBackgroundFill(getBackgroundDefinition(this.background))
            ?? this.frameConf.background;
        makeAutoObservable(this, { root: false });
    }

    get waterSvg() {
        return toJS(this.waterImg);
    }

    get mode() {
        return DEVICE_FRAMES.includes(this.frame) ? this.frameMode : 'cover';
    }

    setScale(value, { commit = true } = {}) {
        const scale = Number(value);
        if (!Number.isFinite(scale)) return;
        this.scale = Math.max(0.1, Math.min(3, scale));
        this.root.imageStore?.updateActiveTransform({ scale: this.scale });
        if (commit) this.root.history.commit('slider:scale');
    }

    setPadding(value) {
        this.padding = value;
        this.root.history.commit('slider:padding');
    }

    setPaddingBg(value) {
        this.paddingBg = normalizePaddingBackground(value);
        this.root.history.commit('slider:paddingBg');
    }

    setInnerBorder(partial) {
        this.innerBorder = normalizeInnerBorder({ ...this.innerBorder, ...partial });
        this.root.history.commit('inner-border');
    }

    setRound(value) {
        this.round = value;
        this.root.history.commit('slider:round');
    }

    setShadow(value) {
        // 兼容旧调用：number 档位整体替换；对象走 setShadowConf
        this.shadow = typeof value === 'number' ? shadowFromIntensity(value) : normalizeShadow(value);
        this.root.history.commit('slider:shadow');
    }

    /** 合并更新阴影配置的任意字段（x/y/blur/spread/color/visible），一次交互只提交一步历史。 */
    setShadowConf(partial) {
        this.shadow = { ...this.shadow, ...partial };
        this.root.history.commit('shadow:conf');
    }

    setFrame(value) {
        this.frame = value;
        this.root.history.commit();
    }

    setFrameMode(value) {
        const mode = value === 'strench' ? 'stretch' : value;
        if (!BACKGROUND_MODES.includes(mode)) return;
        this.frameMode = mode;
        this.root.history.commit();
    }

    setBrowserUrl(value, { commit = true } = {}) {
        this.browserUrl = String(value ?? '').slice(0, 160);
        if (commit) this.root.history.commit('browser:url');
    }

    setBrowserHeaderSize(value, { commit = true } = {}) {
        const size = Number(value);
        if (!Number.isFinite(size)) return;
        this.browserHeaderSize = Math.max(50, Math.min(200, Math.round(size)));
        if (commit) this.root.history.commit('browser:header-size');
    }

    setFrameSize(width, height) {
        const nextWidth = Number(width);
        const nextHeight = Number(height);
        if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight) || nextWidth <= 0 || nextHeight <= 0) return;
        this.frameConf.width = Math.round(nextWidth);
        this.frameConf.height = Math.round(nextHeight);
        this._syncGradientBackgroundFill();
    }

    setAlign(value) {
        this.align = value;
        this.offsetX = 0;
        this.offsetY = 0;
        this.root.imageStore?.updateActiveTransform({ x: 0, y: 0 });
        this.root.history.commit();
    }

    setSize(value) {
        this.size.type = value.type;
        this.size.title = value.title;
        this.setFrameSize(value.width, value.height);
        this.root.history.commit();
    }

    setRotation(value, { commit = true } = {}) {
        const rotation = Number(value);
        if (!Number.isFinite(rotation)) return;
        this.rotation = Math.max(-180, Math.min(180, rotation));
        this.root.imageStore?.updateActiveTransform({ rotation: this.rotation });
        if (commit) this.root.history.commit('rotation');
    }

    setPositionOffset(offsetX, offsetY, { commit = true } = {}) {
        const nextX = Number(offsetX);
        const nextY = Number(offsetY);
        if (Number.isFinite(nextX)) this.offsetX = nextX;
        if (Number.isFinite(nextY)) this.offsetY = nextY;
        this.root.imageStore?.updateActiveTransform({ x: this.offsetX, y: this.offsetY });
        if (commit) this.root.history.commit('image:transform');
    }

    setScreenshotTransform({ offsetX, offsetY, rotation, scale } = {}, { commit = true } = {}) {
        if (offsetX != null || offsetY != null) {
            this.setPositionOffset(offsetX ?? this.offsetX, offsetY ?? this.offsetY, { commit: false });
        }
        if (rotation != null) this.setRotation(rotation, { commit: false });
        if (scale != null) this.setScale(scale, { commit: false });
        if (commit) this.root.history.commit('image:transform');
    }

    /** 从活动图片图层恢复兼容字段，不提交历史，也不反向写回 ImageStore。 */
    restoreImageTransform({ x = 0, y = 0, scale = 1, rotation = 0 } = {}) {
        this.offsetX = x;
        this.offsetY = y;
        this.scale = scale;
        this.rotation = rotation;
    }

    setBackground(value) {
        const key = normalizeBackgroundKey(value);
        const definition = getBackgroundDefinition(key);
        if (!definition) return false;
        this.releaseBackgroundAsset();
        this.background = key;
        this.backgroundAssetId = null;
        if (definition.type === 'gradient') {
            this.backgroundGradientAngle = getGradientPresetAngle(definition, this.backgroundGradientAngle);
        }
        this.frameConf.background = this.getBackgroundFill(definition);
        this.root.history.commit();
        return true;
    }
    /**
     * 统一背景选择入口。保留 Promise 返回形态，避免破坏已有 UI/宿主调用；
     * 内置预设均为代码渐变，不读取网络或打包图片。
     */
    async applyBackground(value) {
        return this.setBackground(value);
    }
    setBackgroundMode(value) {
        if (!BACKGROUND_MODES.includes(value)) return false;
        this.backgroundMode = value;
        this._syncImageBackgroundFill();
        this.root.history.commit('background:mode');
        return true;
    }
    setBackgroundAlign(value) {
        if (!BACKGROUND_ALIGNS.includes(value)) return false;
        this.backgroundAlign = value;
        this._syncImageBackgroundFill();
        this.root.history.commit('background:align');
        return true;
    }
    /**
     * 图片背景的 mode/align 变更后重建 frameConf.background。
     * 必须保留当前运行时 URL：上传背景的 blob: 不在静态定义里（definition.fill 为 null），
     * 若用静态定义（getBackgroundFill）重建会丢掉 blob:，导致背景消失或导出 canvas 被 tainted。
     */
    _syncImageBackgroundFill() {
        const definition = getBackgroundDefinition(this.background);
        if (!isImageBackground(definition)) return;
        const currentUrl = this.frameConf.background?.url;
        this.frameConf.background = {
            type: 'image',
            url: currentUrl || definition?.fill?.url || null,
            mode: this.backgroundMode,
            align: this.backgroundAlign,
        };
    }
    setBackgroundBlur(value) {
        const blur = Math.max(0, Math.min(30, Number(value) || 0));
        this.backgroundBlur = blur;
        this.root.history.commit('slider:bgblur');
        return true;
    }
    setBackgroundMaskColor(value) {
        this.backgroundMaskColor = typeof value === 'string' && value ? value : this.backgroundMaskColor;
        this.root.history.commit('bgmask');
        return true;
    }
    setBackgroundMaskOpacity(value) {
        const opacity = Math.max(0, Math.min(1, Number(value) || 0));
        this.backgroundMaskOpacity = opacity;
        this.root.history.commit('slider:bgmask');
        return true;
    }
    setBackgroundNoise(value) {
        const noise = Math.max(0, Math.min(1, Number(value) || 0));
        this.backgroundNoise = noise;
        this.root.history.commit('slider:bgnoise');
        return true;
    }

    setBackgroundGradientAngle(value, { commit = true } = {}) {
        if (getBackgroundDefinition(this.background)?.type !== 'gradient') return false;
        this.backgroundGradientAngle = clampGradientAngle(value, this.backgroundGradientAngle);
        this._syncGradientBackgroundFill();
        if (commit) this.root.history.commit('slider:bg-gradient-angle');
        return true;
    }
    setUploadedBackground(asset) {
        if (!asset?.id || !asset.url) return false;
        this.releaseBackgroundAsset();
        this.background = 'upload_image';
        this.backgroundAssetId = asset.id;
        this.frameConf.background = {
            type: 'image',
            url: asset.url,
            mode: this.backgroundMode,
            align: this.backgroundAlign,
        };
        this.root.history.commit();
        return true;
    }
    setCustomSolidBackground(color) {
        if (typeof color !== 'string' || !color) return false;
        this.releaseBackgroundAsset();
        this.background = 'custom_solid';
        this.backgroundAssetId = null;
        this.frameConf.background = { type: 'solid', color };
        this.root.history.commit();
        return true;
    }
    getBackgroundFill(definition) {
        if (!definition?.fill) return null;
        if (isImageBackground(definition)) {
            return {
                ...definition.fill,
                mode: this.backgroundMode,
                align: this.backgroundAlign,
            };
        }
        if (definition.type === 'gradient') {
            return applyGradientAngle(
                definition.fill,
                this.backgroundGradientAngle,
                this.frameConf.width,
                this.frameConf.height
            );
        }
        return definition.fill;
    }

    _syncGradientBackgroundFill() {
        if (!['linear', 'angular'].includes(this.frameConf.background?.type)) return;
        this.frameConf.background = applyGradientAngle(
            this.frameConf.background,
            this.backgroundGradientAngle,
            this.frameConf.width,
            this.frameConf.height
        );
    }

    get imageStyleIsDefault() {
        const defaultShadow = shadowFromIntensity(3);
        const shadow = normalizeShadow(this.shadow);
        return this.scale === 1
            && this.scaleX === false
            && this.scaleY === false
            && this.padding === 0
            && this.paddingBg === DEFAULT_PADDING_BACKGROUND
            && this.innerBorder.visible === false
            && this.round === 10
            && shadow.visible === defaultShadow.visible
            && shadow.x === defaultShadow.x
            && shadow.y === defaultShadow.y
            && shadow.blur === defaultShadow.blur
            && shadow.spread === defaultShadow.spread
            && shadow.color === defaultShadow.color;
    }

    resetImageStyle() {
        if (this.imageStyleIsDefault) return false;
        this.scale = 1;
        this.root.imageStore?.updateActiveTransform({ scale: 1 });
        this.scaleX = false;
        this.scaleY = false;
        this.padding = 0;
        this.paddingBg = DEFAULT_PADDING_BACKGROUND;
        this.innerBorder = normalizeInnerBorder();
        this.round = 10;
        this.shadow = shadowFromIntensity(3);
        this.root.history.commit('image:style-reset');
        return true;
    }
    toggleFlip(type) {
        if (type === 'x') {
            this.scaleX = !this.scaleX;
        }
        if (type === 'y') {
            this.scaleY = !this.scaleY;
        }
        this.root.history.commit();
    }
    setWaterImg(value) {
        this.waterImg = value;
        this.root.history.commit('water');
    }
    setWaterIndex(value) {
        this.waterIndex = value;
        this.root.history.commit('water');
    }
    setHdrEnabled(value) {
        this.hdrEnabled = value;
        this.root.history.commit();
    }

    /**
     * 导出当前 option 的可序列化快照。
     * 返回纯值副本，供 ProjectDocument 与历史快照使用；不包含任何方法或 MobX 包装。
     */
    toDocument() {
        const frameConf = toJS(this.frameConf);
        if (frameConf.background) {
            if (this.background === 'upload_image') {
                frameConf.background = { ...frameConf.background, url: null };
            }
        }
        return {
            scale: this.scale,
            scaleX: this.scaleX,
            scaleY: this.scaleY,
            rotation: this.rotation,
            offsetX: this.offsetX,
            offsetY: this.offsetY,
            padding: this.padding,
            paddingBg: this.paddingBg,
            innerBorder: toJS(this.innerBorder),
            round: this.round,
            shadow: toJS(this.shadow),
            frame: this.frame,
            frameMode: this.frameMode,
            browserUrl: this.browserUrl,
            browserHeaderSize: this.browserHeaderSize,
            background: this.background,
            backgroundAssetId: this.backgroundAssetId,
            backgroundMode: this.backgroundMode,
            backgroundAlign: this.backgroundAlign,
            backgroundGradientAngle: this.backgroundGradientAngle,
            backgroundBlur: this.backgroundBlur,
            backgroundMaskColor: this.backgroundMaskColor,
            backgroundMaskOpacity: this.backgroundMaskOpacity,
            backgroundNoise: this.backgroundNoise,
            align: this.align,
            waterImg: toJS(this.waterImg),
            waterIndex: this.waterIndex,
            hdrEnabled: this.hdrEnabled,
            size: toJS(this.size),
            frameConf
        };
    }

    /**
     * 从文档恢复 option。直接按文档快照赋值（文档已是权威值），不调用带副作用的
     * setter（如 setBackground 会重新派生 frameConf.background），以保证恢复结果
     * 与快照完全一致。缺失字段由 normalizeOption 用默认值补齐。
     */
    restoreFromDocument(doc) {
        const next = normalizeOption(doc?.option ?? doc);
        if (this.backgroundAssetId && this.backgroundAssetId !== next.backgroundAssetId) {
            this.root.assetStore.release(this.backgroundAssetId);
        }
        runInAction(() => {
            this.scale = next.scale;
            this.scaleX = next.scaleX;
            this.scaleY = next.scaleY;
            this.rotation = next.rotation;
            this.offsetX = next.offsetX;
            this.offsetY = next.offsetY;
            this.padding = next.padding;
            this.paddingBg = next.paddingBg;
            this.innerBorder = next.innerBorder;
            this.round = next.round;
            this.shadow = next.shadow;
            this.frame = next.frame;
            this.frameMode = next.frameMode;
            this.browserUrl = next.browserUrl;
            this.browserHeaderSize = next.browserHeaderSize;
            this.background = next.background;
            this.backgroundAssetId = next.backgroundAssetId;
            this.backgroundMode = next.backgroundMode;
            this.backgroundAlign = next.backgroundAlign;
            this.backgroundGradientAngle = next.backgroundGradientAngle;
            this.backgroundBlur = next.backgroundBlur;
            this.backgroundMaskColor = next.backgroundMaskColor;
            this.backgroundMaskOpacity = next.backgroundMaskOpacity;
            this.backgroundNoise = next.backgroundNoise;
            this.align = next.align;
            this.waterImg = next.waterImg;
            this.waterIndex = next.waterIndex;
            this.hdrEnabled = next.hdrEnabled;
            this.size = next.size;
            this.frameConf = next.frameConf;
            this._syncGradientBackgroundFill();
            const asset = this.root.assetStore.get(this.backgroundAssetId);
            if (asset && isImageBackground(getBackgroundDefinition(this.background)) && this.frameConf.background?.type === 'image') {
                this.frameConf.background = { ...this.frameConf.background, url: asset.url };
            }
        });
    }

    releaseBackgroundAsset() {
        if (!this.backgroundAssetId) return;
        this.root.assetStore.release(this.backgroundAssetId);
        this.backgroundAssetId = null;
    }

    destroy() {
        this.releaseBackgroundAsset();
    }
}
