import { getBackgroundDefinition, normalizeBackgroundKey } from '@utils/backgroundConfig';

const BACKGROUND_MODES = ['cover', 'fit', 'stretch'];
const BACKGROUND_ALIGNS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
const DEFAULT_GRADIENT_ANGLE = 90;

const getGradientPresetAngle = (definition) => {
    if (definition?.type !== 'gradient') return DEFAULT_GRADIENT_ANGLE;
    return definition.gradientAngle ?? (definition.fill?.from === 'top-left' ? 135 : DEFAULT_GRADIENT_ANGLE);
};

const normalizeGradientAngle = (value, fallback = DEFAULT_GRADIENT_ANGLE) => {
    const angle = Number(value);
    return Number.isFinite(angle)
        ? Math.max(0, Math.min(360, Math.round(angle)))
        : fallback;
};

/**
 * V2 项目文档（ProjectDocument）
 *
 * 作为 V1 后续功能（历史、本地草稿等）共同依赖的可序列化事实来源。
 * 一个文档必须满足：纯 JSON 可序列化，不包含 LeaferJS App、Blob、object URL、
 * message 回调或 DOM 节点。放大镜快照（editor.snap）不属于文档，由 M5 独立管理。
 *
 * 文档结构：
 * {
 *   version: 2,
 *   option: { ...画框/背景/尺寸等配置 },
 *   images: [ { id, assetId, name, type, width, height,
 *               transform: { x, y, scale, rotation }, zIndex, locked, groupId } ],
 *   shapes: [ { id, type, fill, strokeWidth, zIndex, x, y, width, height, rotation, scaleX, scaleY,
 *               points, text, textStyle, effect, editable } ]
 *   // text 携带 textStyle 子结构；blur/mosaic/spotlight 携带 effect 子结构；
 *   // 两者均经 normalizeShape 的 {...raw} 透传（非 NUMERIC_FIELDS，整体保留）。
 * }
 *
 * 视图缩放（editor.scale）、主题（editor.theme）、面板开合、导出格式与倍率等
 * 非内容状态不进入文档；这里只承载真正需要撤销/重做与持久化的内容。
 */

// 当前文档版本号；结构不兼容时递增并在 migrateDocument 中补充迁移逻辑。
export const PROJECT_VERSION = 2;

// 可读取的最低版本；低于此版本视为无法恢复。
export const MIN_VERSION = 1;
export const MAX_PROJECT_IMAGES = 12;
export const DEFAULT_PADDING_BACKGROUND = 'rgba(255,255,255,1)';

const LEGACY_PADDING_BACKGROUND = /^rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*100\s*\)$/i;

/**
 * 早期版本把不透明 alpha 错写成 100。浏览器渲染虽通常等同于不透明，
 * 颜色编辑器会把原始值解释成 100 倍；在统一恢复入口迁移，同时保留其他颜色原文。
 */
export function normalizePaddingBackground(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_PADDING_BACKGROUND;
    const value = raw.trim().slice(0, 48);
    return LEGACY_PADDING_BACKGROUND.test(value) ? DEFAULT_PADDING_BACKGROUND : value;
}

// 已知的标注类型；未知类型在规范化时不丢弃，保留原值，由渲染层忽略，
// 这样未来 M5 新增类型时旧文档读取不会被破坏。
export const SHAPE_TYPES = [
    'Square',
    'SquareFill',
    'Circle',
    'Slash',
    'MoveDownLeft',
    'Pencil',
    'Magnifier',
    'Step',
    'emoji',
    'text',
    'blur',
    'mosaic',
    'spotlight'
];

const NUMERIC_FIELDS = ['x', 'y', 'width', 'height', 'strokeWidth', 'zIndex', 'rotation', 'scaleX', 'scaleY'];
const NUMERIC_DEFAULTS = { scaleX: 1, scaleY: 1 };

/**
 * 阴影完整配置 { visible, x, y, blur, spread, color }。
 * 由旧的 0-6 强度档位换算（x=y=n*4、blur=n*3、#00000045），保持旧版本视觉不变。
 */
export function shadowFromIntensity(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) {
        return { visible: false, x: 0, y: 12, blur: 24, spread: 0, color: '#00000045' };
    }
    return { visible: true, x: Math.round(v * 4), y: Math.round(v * 4), blur: Math.round(v * 3), spread: 0, color: '#00000045' };
}

/** 规范化阴影配置：兼容旧版 number 档位、缺字段补默认（默认档 = 旧 shadow:3）。 */
export function normalizeShadow(raw) {
    if (typeof raw === 'number') return shadowFromIntensity(raw);
    const base = shadowFromIntensity(3);
    if (!raw || typeof raw !== 'object') return base;
    const num = (v, fallback) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    };
    return {
        visible: raw.visible !== false,
        x: num(raw.x, base.x),
        y: num(raw.y, base.y),
        blur: Math.max(0, num(raw.blur, base.blur)),
        spread: num(raw.spread, 0),
        color: typeof raw.color === 'string' && raw.color ? raw.color : base.color,
    };
}

/** 独立于外框的内描边，可与浏览器/设备外框同时使用。 */
export function normalizeInnerBorder(raw) {
    const base = { visible: false, width: 1, color: '#ffffff99' };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
    const width = Number(raw.width);
    return {
        visible: raw.visible === true,
        width: Number.isFinite(width) ? Math.max(1, Math.min(12, Math.round(width))) : base.width,
        color: typeof raw.color === 'string' && raw.color ? raw.color.slice(0, 48) : base.color,
    };
}

/**
 * 默认背景（gh_img_50 兼容 token）的代码渐变填充。
 * 与 stores/option.js 构造器的派生逻辑一致。
 */
const defaultBackgroundFill = () => {
    const definition = getBackgroundDefinition('gh_img_50');
    return definition?.fill ? { ...definition.fill } : null;
};

/**
 * 默认 option 快照。与 stores/option.js 的类字段保持一致；
 * 两者都是 V1 锁定的默认值，改动任一处时需同步。
 */
export function defaultOption() {
    return {
        scale: 1,
        scaleX: false,
        scaleY: false,
        rotation: 0,
        offsetX: 0,
        offsetY: 0,
        padding: 0,
        paddingBg: DEFAULT_PADDING_BACKGROUND,
        innerBorder: normalizeInnerBorder(),
        round: 10,
        shadow: shadowFromIntensity(3),
        frame: 'none',
        frameMode: 'cover',
        browserUrl: 'screenhello.com',
        browserHeaderSize: 100,
        background: 'gh_img_50',
        backgroundAssetId: null,
        backgroundMode: 'cover',
        backgroundAlign: 'center',
        backgroundGradientAngle: DEFAULT_GRADIENT_ANGLE,
        backgroundBlur: 0,
        backgroundMaskColor: '#000000',
        backgroundMaskOpacity: 0,
        backgroundNoise: 0,
        align: 'center',
        waterImg: null,
        waterIndex: 1,
        hdrEnabled: false,
        size: { type: 'auto', title: '自动' },
        frameConf: {
            width: 800,
            height: 600,
            // 与 option 构造器一致：默认背景 gh_img_50 的画布填充从代码定义派生。
            background: defaultBackgroundFill()
        }
    };
}

/** 全新默认文档。 */
export function defaultDocument() {
    return {
        version: PROJECT_VERSION,
        option: defaultOption(),
        images: [],
        shapes: []
    };
}

/**
 * 将单个 shape 规范化为当前统一结构。
 * 兼容读取当前旧 shape 字段：颜色回退 color/stroke，几何字段强转数字，
 * 缺失 id 的脏数据直接丢弃。这是新写入与历史恢复共用的单一入口。
 */
export function normalizeShape(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const shape = { ...raw };

    // 颜色：优先 fill，回退 color / stroke（旧实现部分类型用 stroke 承载颜色）
    if (shape.fill == null || shape.fill === '') {
        shape.fill = shape.color ?? shape.stroke ?? '#2563eb';
    }
    // 删除冗余的 color 别名，避免历史快照里出现重复来源
    delete shape.color;

    // 几何/数值字段统一转 number，过滤脏字符串
    for (const key of NUMERIC_FIELDS) {
        const fallback = NUMERIC_DEFAULTS[key] ?? 0;
        const n = shape[key] == null || shape[key] === '' ? fallback : Number(shape[key]);
        shape[key] = Number.isFinite(n) ? n : fallback;
    }

    // 变换默认值：rotation=0、scaleX/scaleY=1。
    // 编辑器移动/缩放/旋转后这些字段写回 shape，保证几何可被历史完整还原。
    if (shape.rotation == null) shape.rotation = 0;
    if (shape.scaleX == null) shape.scaleX = 1;
    if (shape.scaleY == null) shape.scaleY = 1;

    // points 仅对 Slash/MoveDownLeft/Pencil 有意义，统一保持为数组
    if (shape.points != null && !Array.isArray(shape.points)) {
        shape.points = [];
    }

    // 没有合法 id 无法被 Map 索引，直接丢弃
    if (!shape.id) return null;

    return shape;
}

/**
 * 用默认值补齐 option 缺失字段（浅层 + frameConf/size 两层）。
 * 用于从旧 store 数据或外部数据构建文档时保证结构完整。
 */
export function normalizeOption(raw) {
    const base = defaultOption();
    if (!raw || typeof raw !== 'object') return base;
    const out = { ...base, ...raw };
    out.paddingBg = normalizePaddingBackground(raw.paddingBg);
    const rawFrameMode = raw.frameMode === 'strench' ? 'stretch' : raw.frameMode;
    out.frameMode = BACKGROUND_MODES.includes(rawFrameMode) ? rawFrameMode : base.frameMode;
    const rawBackground = raw.background;
    const rawBackgroundKey = rawBackground && typeof rawBackground === 'object'
        ? (rawBackground.presetKey || rawBackground.key || rawBackground.id)
        : rawBackground;
    out.background = normalizeBackgroundKey(rawBackgroundKey);
    // 只有用户上传的图片背景拥有二进制资源。历史 gh_img_* 现在迁移为代码渐变，
    // 必须同时丢弃旧 assetId，避免草稿/归档继续要求已移除的第三方文件。
    out.backgroundAssetId = out.background === 'upload_image'
        ? (raw.backgroundAssetId ?? rawBackground?.assetId ?? null)
        : null;
    const rawBackgroundMode = raw.backgroundMode ?? rawBackground?.mode ?? raw.frameConf?.background?.mode;
    const rawBackgroundAlign = raw.backgroundAlign ?? rawBackground?.align ?? raw.frameConf?.background?.align;
    out.backgroundMode = BACKGROUND_MODES.includes(rawBackgroundMode) ? rawBackgroundMode : base.backgroundMode;
    out.backgroundAlign = BACKGROUND_ALIGNS.includes(rawBackgroundAlign) ? rawBackgroundAlign : base.backgroundAlign;
    const definition = getBackgroundDefinition(out.background);
    const rawGradientAngle = raw.backgroundGradientAngle ?? rawBackground?.gradientAngle;
    out.backgroundGradientAngle = normalizeGradientAngle(
        rawGradientAngle,
        getGradientPresetAngle(definition)
    );
    const rotation = Number(raw.rotation);
    out.rotation = Number.isFinite(rotation) ? Math.max(-180, Math.min(180, rotation)) : base.rotation;
    const offsetX = Number(raw.offsetX);
    out.offsetX = Number.isFinite(offsetX) ? offsetX : base.offsetX;
    const offsetY = Number(raw.offsetY);
    out.offsetY = Number.isFinite(offsetY) ? offsetY : base.offsetY;
    // 3D 旋转（rotationX/rotationY/perspective）功能已移除：剥离旧草稿中的残留字段
    delete out.rotationX;
    delete out.rotationY;
    delete out.perspective;
    const blur = Number(raw.backgroundBlur);
    out.backgroundBlur = Number.isFinite(blur) ? Math.max(0, Math.min(30, blur)) : base.backgroundBlur;
    const maskOpacity = Number(raw.backgroundMaskOpacity);
    out.backgroundMaskOpacity = Number.isFinite(maskOpacity) ? Math.max(0, Math.min(1, maskOpacity)) : base.backgroundMaskOpacity;
    const noise = Number(raw.backgroundNoise);
    out.backgroundNoise = Number.isFinite(noise) ? Math.max(0, Math.min(1, noise)) : base.backgroundNoise;
    out.backgroundMaskColor = (typeof raw.backgroundMaskColor === 'string' && raw.backgroundMaskColor) ? raw.backgroundMaskColor : base.backgroundMaskColor;
    out.browserUrl = typeof raw.browserUrl === 'string'
        ? raw.browserUrl.trim().slice(0, 160)
        : base.browserUrl;
    const browserHeaderSize = Number(raw.browserHeaderSize);
    out.browserHeaderSize = Number.isFinite(browserHeaderSize)
        ? Math.max(50, Math.min(200, Math.round(browserHeaderSize)))
        : base.browserHeaderSize;
    out.size = { ...base.size, ...(raw.size || {}) };
    // 阴影：旧文档/旧 store 存的是 0-6 number，统一迁移为完整配置对象
    out.shadow = normalizeShadow(raw.shadow);
    out.innerBorder = normalizeInnerBorder(raw.innerBorder);
    out.frameConf = { ...base.frameConf, ...(raw.frameConf || {}) };
    const rawFill = raw.frameConf?.background ?? (rawBackground && typeof rawBackground === 'object' ? rawBackground.fill : undefined);
    if (definition?.type === 'none') {
        out.frameConf.background = null;
    } else if (definition?.type === 'upload-image') {
        // 上传背景只能由已登记的本地 AssetStore Blob 恢复，不能信任项目 JSON 中的 URL。
        out.frameConf.background = {
            type: 'image',
            url: null,
            mode: out.backgroundMode,
            align: out.backgroundAlign,
        };
    } else if (out.background === 'custom_solid') {
        const color = !Array.isArray(rawFill)
            && rawFill?.type === 'solid'
            && typeof rawFill.color === 'string'
            && rawFill.color
            ? rawFill.color.slice(0, 48)
            : '#ffffff';
        out.frameConf.background = { type: 'solid', color };
    } else {
        // 预设的渐变和纯色也从受控定义恢复，避免伪装成图片填充后触发外部请求。
        out.frameConf.background = definition?.fill ?? base.frameConf.background;
    }
    return out;
}

/**
 * 规范化主图引用（M6）。{ assetId, width, height, type, name } 全为可序列化值；
 * 宽高强转数字。V1 迁移时由旧 image 字段带入 assetId 与图片元数据。
 */
export function normalizeImage(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const out = { ...raw };
    if (out.width != null) { const n = Number(out.width); out.width = Number.isFinite(n) ? n : 0; }
    if (out.height != null) { const n = Number(out.height); out.height = Number.isFinite(n) ? n : 0; }
    return out;
}

const finite = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

const textId = (value, fallback) => {
    const text = typeof value === 'string' ? value.trim().slice(0, 120) : '';
    return text || fallback;
};

/** V2 图片图层规范化。src / Blob / object URL 等运行时字段不会被透传。 */
export function normalizeProjectImage(raw, index = 0) {
    if (!raw || typeof raw !== 'object') return null;
    const transform = raw.transform && typeof raw.transform === 'object' ? raw.transform : raw;
    const width = Math.max(0, Math.round(finite(raw.width)));
    const height = Math.max(0, Math.round(finite(raw.height)));
    return {
        id: textId(raw.id, `image-${index + 1}`),
        assetId: typeof raw.assetId === 'string' && raw.assetId.trim()
            ? raw.assetId.trim().slice(0, 160)
            : null,
        name: typeof raw.name === 'string' && raw.name.trim()
            ? raw.name.trim().slice(0, 240)
            : `image-${index + 1}`,
        type: typeof raw.type === 'string' && raw.type.startsWith('image/')
            ? raw.type.slice(0, 80)
            : 'image/png',
        width,
        height,
        transform: {
            x: Math.max(-100000, Math.min(100000, finite(transform.x ?? transform.offsetX))),
            y: Math.max(-100000, Math.min(100000, finite(transform.y ?? transform.offsetY))),
            scale: Math.max(0.1, Math.min(3, finite(transform.scale, 1))),
            rotation: Math.max(-180, Math.min(180, finite(transform.rotation))),
        },
        zIndex: Math.max(0, Math.round(finite(raw.zIndex, index))),
        locked: raw.locked === true,
        groupId: typeof raw.groupId === 'string' && raw.groupId.trim()
            ? raw.groupId.trim().slice(0, 120)
            : null,
    };
}

const normalizeImages = (images) => {
    const seen = new Set();
    return (Array.isArray(images) ? images : [])
        .slice(0, MAX_PROJECT_IMAGES)
        .map((image, index) => normalizeProjectImage(image, index))
        .filter((image) => {
            if (!image || seen.has(image.id)) return false;
            seen.add(image.id);
            return true;
        })
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((image, zIndex) => ({ ...image, zIndex }));
};

const migrateV1Images = (input, option) => {
    const image = normalizeImage(input?.image);
    if (!image) return [];
    return normalizeImages([{
        ...image,
        id: image.id || 'image-1',
        transform: {
            x: option.offsetX,
            y: option.offsetY,
            scale: option.scale,
            rotation: option.rotation,
        },
        zIndex: 0,
    }]);
};

/**
 * 把当前 store 中的 option、images 与 shapes（已经是 toJS 后的纯数据）打包成 V2 文档。
 * 这是“旧 store 数据到当前文档”的兼容入口：旧 shape 经 normalizeShape 规范化，
 * 旧 option 经 normalizeOption 补齐。输入必须是纯值，调用方负责 toJS。
 */
export function createDocument({ option, shapes, images, image } = {}) {
    const normalizedOption = normalizeOption(option);
    const normalizedImages = Array.isArray(images)
        ? normalizeImages(images)
        : migrateV1Images({ image }, normalizedOption);
    return {
        version: PROJECT_VERSION,
        option: normalizedOption,
        images: normalizedImages,
        shapes: Array.isArray(shapes) ? shapes.map(normalizeShape).filter(Boolean) : []
    };
}

/**
 * 轻量校验：只校验顶层结构与版本范围，字段级健壮性交给 normalize*。
 * 返回 { ok, doc, errors }；ok 为 false 时 doc 仍尽量给出可用的默认文档。
 */
export function validateDocument(input) {
    const errors = [];
    if (!input || typeof input !== 'object') {
        return { ok: false, doc: defaultDocument(), errors: ['document is not an object'] };
    }
    const version = Number(input.version);
    if (!Number.isFinite(version)) {
        errors.push('missing or invalid version');
    } else if (version < MIN_VERSION || version > PROJECT_VERSION) {
        errors.push(`unsupported version ${input.version}`);
    }
    if (input.option != null && typeof input.option !== 'object') {
        errors.push('option is not an object');
    }
    if (input.shapes != null && !Array.isArray(input.shapes)) {
        errors.push('shapes is not an array');
    }
    if (version === PROJECT_VERSION && input.images != null && !Array.isArray(input.images)) {
        errors.push('images is not an array');
    }
    if (Array.isArray(input.images) && input.images.length > MAX_PROJECT_IMAGES) {
        errors.push(`images exceeds limit ${MAX_PROJECT_IMAGES}`);
    }
    if (Array.isArray(input.images)) {
        const normalizedIds = input.images.map((image, index) => normalizeProjectImage(image, index)?.id).filter(Boolean);
        if (new Set(normalizedIds).size !== normalizedIds.length) errors.push('images contain duplicate ids');
    }
    // 即使有小问题也尝试规范化出可用文档，避免一次格式瑕疵导致整份历史不可用
    const option = normalizeOption(input.option);
    const doc = {
        version: PROJECT_VERSION,
        option,
        images: version === 1 ? migrateV1Images(input, option) : normalizeImages(input.images),
        shapes: Array.isArray(input.shapes) ? input.shapes.map(normalizeShape).filter(Boolean) : []
    };
    return { ok: errors.length === 0, doc, errors };
}

/**
 * 把任意支持版本迁移到当前 PROJECT_VERSION。
 * V1 的单图 image 与 option 几何会迁移为 V2 images[0]。
 */
export function migrateDocument(input) {
    const { doc, errors } = validateDocument(input);
    // 版本未知但结构可解析时仍返回规范化结果，由调用方决定是否接受
    if (errors.length && !doc.option && !doc.shapes.length && !doc.images.length) {
        return defaultDocument();
    }
    doc.version = PROJECT_VERSION;
    return doc;
}
