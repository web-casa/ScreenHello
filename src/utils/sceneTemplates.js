import { perspectiveFromPreset } from './perspectiveSchema';

export const SCENE_TEMPLATE_CATEGORIES = Object.freeze([
    { id: 'all', title: '全部' },
    { id: 'single', title: '单图质感' },
    { id: '3d', title: '3D 电影感' },
    { id: 'social', title: '社媒发布' },
    { id: 'multi', title: '多图组合' },
]);

const softShadow = { visible: true, x: 0, y: 18, blur: 36, spread: 0, color: 'rgba(15, 23, 42, 0.28)' };
const deepShadow = { visible: true, x: 0, y: 26, blur: 48, spread: 0, color: 'rgba(0, 0, 0, 0.45)' };
const cleanShadow = { visible: true, x: 12, y: 12, blur: 9, spread: 0, color: '#00000045' };

export const SCENE_TEMPLATES = Object.freeze([
    // Single-image editorial & browser templates (6)
    {
        id: 'browser-light',
        category: 'single',
        title: '浅色浏览器展示',
        description: '简洁亮色浏览器窗格与柔和晴空渐变',
        keywords: 'browser light safari clean 浅色 浏览器',
        fields: {
            frame: 'macosBarLight',
            background: 'gradient_4',
            backgroundGradientAngle: 135,
            padding: 0,
            round: 14,
            innerBorder: { visible: false, width: 1, color: '#ffffff99' },
            shadow: softShadow,
            perspective3d: perspectiveFromPreset('flat'),
        },
    },
    {
        id: 'browser-dark',
        category: 'single',
        title: '深色浏览器展示',
        description: '暗夜浏览器边框搭配深靛石板渐变',
        keywords: 'browser dark safari night 深色 浏览器',
        fields: {
            frame: 'macosBarDark',
            background: 'gradient_9',
            backgroundGradientAngle: 145,
            padding: 0,
            round: 14,
            innerBorder: { visible: true, width: 1, color: 'rgba(255,255,255,0.16)' },
            shadow: deepShadow,
            perspective3d: perspectiveFromPreset('flat'),
        },
    },
    {
        id: 'arc-minimal',
        category: 'single',
        title: 'Arc 极简浮窗',
        description: '圆角轻量单栏与暖桃粉渐变底色',
        keywords: 'arc minimal browser 极简 浏览器',
        fields: {
            frame: 'arc',
            background: 'gradient_12',
            backgroundGradientAngle: 120,
            padding: 0,
            round: 18,
            innerBorder: { visible: true, width: 1, color: 'rgba(255,255,255,0.42)' },
            shadow: softShadow,
            perspective3d: perspectiveFromPreset('flat'),
        },
    },
    {
        id: 'floating-shadow',
        category: 'single',
        title: '悬浮长投影',
        description: '无外框纯净截图与立体长投影',
        keywords: 'floating shadow clean 无外框 悬浮 阴影',
        fields: {
            frame: 'none',
            background: 'gradient_35',
            backgroundGradientAngle: 135,
            padding: 0,
            round: 18,
            innerBorder: { visible: true, width: 1, color: 'rgba(15,23,42,0.08)' },
            shadow: deepShadow,
            perspective3d: perspectiveFromPreset('flat'),
        },
    },
    {
        id: 'glass-soft',
        category: 'single',
        title: '浅色玻璃衬底',
        description: '半透明磨砂外框配柔紫微光背景',
        keywords: 'glass light frosted 玻璃 磨砂',
        fields: {
            frame: 'glassLight',
            background: 'gradient_30',
            backgroundGradientAngle: 135,
            padding: 0,
            round: 16,
            innerBorder: { visible: true, width: 1, color: 'rgba(255,255,255,0.65)' },
            shadow: softShadow,
            perspective3d: perspectiveFromPreset('flat'),
        },
    },
    {
        id: 'transparent-clean',
        category: 'single',
        title: '透明底文档配图',
        description: '无背景透明画布，适合嵌入文档与 PPT',
        keywords: 'transparent none docs 透明 文档',
        fields: {
            frame: 'arc',
            background: 'none',
            padding: 0,
            round: 14,
            innerBorder: { visible: false, width: 1, color: '#ffffff99' },
            shadow: cleanShadow,
            perspective3d: perspectiveFromPreset('flat'),
        },
    },

    // 3D cinematic perspective templates (5)
    {
        id: 'tilt-left-hero',
        category: '3d',
        title: '左仰 3D 英雄视角',
        description: '左倾透视窗格与科技蓝紫渐变',
        keywords: '3d tilt left hero 左仰 透视',
        fields: {
            frame: 'arc',
            background: 'gradient_18',
            backgroundGradientAngle: 135,
            padding: 0,
            round: 16,
            innerBorder: { visible: true, width: 1, color: 'rgba(255,255,255,0.3)' },
            shadow: deepShadow,
            perspective3d: perspectiveFromPreset('tilt-left'),
        },
    },
    {
        id: 'tilt-right-hero',
        category: '3d',
        title: '右仰 3D 霞彩视角',
        description: '右倾透视窗格搭配暖色霞彩背景',
        keywords: '3d tilt right sunset 右仰 透视',
        fields: {
            frame: 'arc',
            background: 'gradient_34',
            backgroundGradientAngle: 135,
            padding: 0,
            round: 16,
            innerBorder: { visible: true, width: 1, color: 'rgba(255,255,255,0.32)' },
            shadow: deepShadow,
            perspective3d: perspectiveFromPreset('tilt-right'),
        },
    },
    {
        id: 'elevated-float',
        category: '3d',
        title: '暗夜轻仰悬浮',
        description: '深色玻璃外框与前仰悬浮立体阴影',
        keywords: '3d float dark glass 悬浮 暗色',
        fields: {
            frame: 'glassDark',
            background: 'gradient_45',
            backgroundGradientAngle: 145,
            padding: 0,
            round: 16,
            innerBorder: { visible: true, width: 1, color: 'rgba(255,255,255,0.22)' },
            shadow: deepShadow,
            perspective3d: perspectiveFromPreset('float-up'),
        },
    },
    {
        id: 'cinematic-closeup',
        category: '3d',
        title: '电影感斜切特写',
        description: '大角度英雄斜切配合深空暗色舞台',
        keywords: '3d cinematic closeup hero 电影 特写',
        fields: {
            frame: 'macosBarDark',
            background: 'gradient_44',
            backgroundGradientAngle: 135,
            padding: 0,
            round: 16,
            innerBorder: { visible: true, width: 1, color: 'rgba(255,255,255,0.2)' },
            shadow: deepShadow,
            perspective3d: perspectiveFromPreset('hero-closeup'),
        },
    },
    {
        id: 'isometric-stage',
        category: '3d',
        title: '等距立体展台',
        description: '等距左倾 3D 舞台与翡翠极光渐变',
        keywords: '3d isometric green 等距 立体',
        fields: {
            frame: 'glassLight',
            background: 'gradient_11',
            backgroundGradientAngle: 130,
            padding: 0,
            round: 16,
            innerBorder: { visible: true, width: 1, color: 'rgba(255,255,255,0.5)' },
            shadow: deepShadow,
            perspective3d: perspectiveFromPreset('isometric-left'),
        },
    },

    // Social & Launch templates (3)
    {
        id: 'x-tweet-16-9',
        category: 'social',
        title: 'X 推文宽屏配图',
        description: '1200×675 黄金推文比例与微倾 3D 卡片',
        keywords: 'x twitter tweet 16:9 推文 社交',
        fields: {
            size: { type: 'x', title: 'X 推文 16 : 9', width: 1200, height: 675 },
            frame: 'arc',
            background: 'gradient_16',
            backgroundGradientAngle: 135,
            padding: 0,
            round: 14,
            innerBorder: { visible: true, width: 1, color: 'rgba(255,255,255,0.4)' },
            shadow: softShadow,
            perspective3d: perspectiveFromPreset('subtle-tilt'),
        },
    },
    {
        id: 'og-share-card',
        category: 'social',
        title: 'OG 链接分享卡',
        description: '1200×630 标准 OpenGraph 预览图模板',
        keywords: 'og opengraph share blog 分享 博客',
        fields: {
            size: { type: 'og', title: 'OG / 社交分享 分享卡片 1.91 : 1', width: 1200, height: 630 },
            frame: 'macosBarDark',
            background: 'gradient_38',
            backgroundGradientAngle: 125,
            padding: 0,
            round: 14,
            innerBorder: { visible: true, width: 1, color: 'rgba(255,255,255,0.22)' },
            shadow: deepShadow,
            perspective3d: perspectiveFromPreset('tilt-left'),
        },
    },
    {
        id: 'product-hunt-gallery',
        category: 'social',
        title: 'Product Hunt 发布首图',
        description: '1270×760 暖橙活力渐变，突出产品演示',
        keywords: 'product hunt launch gallery 发布 首图',
        fields: {
            size: { type: 'producthunt', title: 'Product Hunt 发布首图 5 : 3', width: 1270, height: 760 },
            frame: 'macosBarLight',
            background: 'gradient_46',
            backgroundGradientAngle: 130,
            padding: 0,
            round: 16,
            innerBorder: { visible: true, width: 2, color: 'rgba(255,255,255,0.5)' },
            shadow: deepShadow,
            perspective3d: perspectiveFromPreset('subtle-tilt'),
        },
    },

    // Multi-layer showcase templates (4)
    {
        id: 'duo-side-by-side',
        category: 'multi',
        multiLayout: 'duo-side-by-side',
        minImages: 2,
        title: '双图并排对比',
        description: '两张画面左右对称展示，适合前后对比',
        keywords: 'multi two duo compare 双图 对比',
        fields: {
            size: { type: 'default', title: '比例 16 : 9', width: 1920, height: 1080 },
            frame: 'none',
            background: 'gradient_4',
            backgroundGradientAngle: 135,
            padding: 0,
            round: 16,
            innerBorder: { visible: true, width: 1, color: 'rgba(255,255,255,0.45)' },
            shadow: softShadow,
            perspective3d: perspectiveFromPreset('flat'),
        },
    },
    {
        id: 'duo-staggered',
        category: 'multi',
        multiLayout: 'duo-staggered',
        minImages: 2,
        title: '双图错落叠层',
        description: '一前一后对角错落排布，突出层次纵深',
        keywords: 'multi two staggered overlap 双图 叠层',
        fields: {
            size: { type: 'default', title: '比例 16 : 9', width: 1920, height: 1080 },
            frame: 'glassLight',
            background: 'gradient_27',
            backgroundGradientAngle: 135,
            padding: 0,
            round: 16,
            innerBorder: { visible: true, width: 1, color: 'rgba(255,255,255,0.35)' },
            shadow: deepShadow,
            perspective3d: perspectiveFromPreset('flat'),
        },
    },
    {
        id: 'trio-fan',
        category: 'multi',
        multiLayout: 'trio-fan',
        minImages: 3,
        title: '三图扇形展示',
        description: '三张画面呈扇形轻微展开，适合移动 App 展示',
        keywords: 'multi three fan app 三图 扇形',
        fields: {
            size: { type: 'default', title: '比例 16 : 9', width: 1920, height: 1080 },
            frame: 'none',
            background: 'gradient_47',
            backgroundGradientAngle: 135,
            padding: 0,
            round: 18,
            innerBorder: { visible: true, width: 2, color: 'rgba(255,255,255,0.5)' },
            shadow: deepShadow,
            perspective3d: perspectiveFromPreset('flat'),
        },
    },
    {
        id: 'responsive-desktop-mobile',
        category: 'multi',
        multiLayout: 'responsive-desktop-mobile',
        minImages: 2,
        title: '响应式双端组合',
        description: '主屏居中偏左 + 副屏右下角前置叠放',
        keywords: 'multi responsive desktop mobile 响应式 双端',
        fields: {
            size: { type: 'default', title: '比例 16 : 9', width: 1920, height: 1080 },
            frame: 'arc',
            background: 'gradient_9',
            backgroundGradientAngle: 140,
            padding: 0,
            round: 16,
            innerBorder: { visible: true, width: 1, color: 'rgba(255,255,255,0.28)' },
            shadow: deepShadow,
            perspective3d: perspectiveFromPreset('flat'),
        },
    },
]);

export const SCENE_TEMPLATE_MAP = Object.freeze(
    Object.fromEntries(SCENE_TEMPLATES.map((tpl) => [tpl.id, tpl])),
);

export function getSceneTemplate(id) {
    return SCENE_TEMPLATE_MAP[id] || null;
}

/**
 * 为多图场景模板计算各未锁定图层的相对偏移、缩放与角度（纯函数，无副作用）。
 */
export function computeMultiLayerLayout(layoutId, unlockedLayers, frameWidth, frameHeight) {
    if (!layoutId || !Array.isArray(unlockedLayers) || unlockedLayers.length < 2) return [];
    const w = Math.max(200, Number(frameWidth) || 1920);
    const h = Math.max(200, Number(frameHeight) || 1080);

    if (layoutId === 'duo-side-by-side') {
        const offsetX = Math.round(w * 0.21);
        return unlockedLayers.slice(0, 2).map((layer, idx) => ({
            id: layer.id,
            transform: {
                x: idx === 0 ? -offsetX : offsetX,
                y: 0,
                scale: 0.68,
                rotation: 0,
            },
        }));
    }

    if (layoutId === 'duo-staggered') {
        const dx = Math.round(w * 0.14);
        const dy = Math.round(h * 0.08);
        return unlockedLayers.slice(0, 2).map((layer, idx) => ({
            id: layer.id,
            transform: {
                x: idx === 0 ? -dx : dx,
                y: idx === 0 ? -dy : dy,
                scale: idx === 0 ? 0.72 : 0.76,
                rotation: idx === 0 ? -3 : 2,
            },
        }));
    }

    if (layoutId === 'trio-fan') {
        const count = Math.min(3, unlockedLayers.length);
        const dx = Math.round(w * 0.22);
        const dy = Math.round(h * 0.04);
        if (count === 2) {
            return unlockedLayers.slice(0, 2).map((layer, idx) => ({
                id: layer.id,
                transform: {
                    x: idx === 0 ? -Math.round(dx * 0.75) : Math.round(dx * 0.75),
                    y: 0,
                    scale: 0.7,
                    rotation: idx === 0 ? -6 : 6,
                },
            }));
        }
        return [
            { id: unlockedLayers[0].id, transform: { x: -dx, y: dy, scale: 0.64, rotation: -8 } },
            { id: unlockedLayers[1].id, transform: { x: 0, y: -dy, scale: 0.74, rotation: 0 } },
            { id: unlockedLayers[2].id, transform: { x: dx, y: dy, scale: 0.64, rotation: 8 } },
        ];
    }

    if (layoutId === 'responsive-desktop-mobile') {
        return [
            {
                id: unlockedLayers[0].id,
                transform: { x: -Math.round(w * 0.09), y: -Math.round(h * 0.03), scale: 0.8, rotation: 0 },
            },
            {
                id: unlockedLayers[1].id,
                transform: { x: Math.round(w * 0.23), y: Math.round(h * 0.1), scale: 0.58, rotation: 2 },
            },
        ];
    }

    return [];
}
