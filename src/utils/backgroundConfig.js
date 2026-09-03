const ADDITIONAL_GRADIENT_STOPS = [
    ['#f5f7fa', '#c3cfe2', '#e0c3fc','#8ec5fc'],
    ['#ff9a9e', '#fecfef', '#c1dfc4', '#deecdd'],
    ['#2193b0', '#6dd5ed', '#cc2b5e', '#753a88'],
    ['#43e97b', '#38f9d7', '#fa7199'],
    ['#5ee7df', '#b490ca', '#43cea2', '#185a9d', '#6713d2'],
    ['#09203f', '#537895', '#243949'],
    ['#13547a', '#80d0c7', '#07a3b2', '#d9afd9', '#ff7a72'],
    ['#0ba360', '#3cba92', '#30dd8a'],
    ['#ff9a9e', '#fecfef', '#fad0c4'],
    ['#c1dfc4', '#deecdd', '#7de2fc', '#b9b6e5'],
    ['#f5f7fa', '#c3cfe2', '#e0c3fc', '#8ec5fc'],
    ['#48c6ef', '#6f86d6', '#c471ed', '#f64f59'],
    ['#89f7fe', '#66a6ff', '#48c6ef'],
    ['#00dbde', '#fc00ff', '#0093e9'],
    ['#4481eb', '#04befe', '#3f5efb', '#fc466b'],
    ['#30e8bf', '#ff8235', '#feac5e'],
    ['#f43b47', '#453a94', '#0250c5'],
    ['#ffecd2', '#fcb69f', '#fd1d1d', '#833ab4', '#405de6'],
    ['#0250c5', '#d43f8d', '#0fd850'],
    ['#834d9b', '#d04ed6', '#1cd8d2'],
    ['#d9afd9', '#97d9e1', '#a7a6cb'],
    ['#eecda3', '#ef629f', '#78ffd6'],
    ['#667db6', '#0082c8', '#0082c8', '#667db6'],
    ['#764ba2', '#667eea', '#63b3ed', '#434343'],
    ['#209cff', '#68e0cf', '#96fbc4', '#f9f586', '#f6d5f7'],
    ['#37ecba', '#72afd3', '#ff4b1f', '#1fddff'],
    ['#fff1eb', '#ace0f9', '#a18cd1', '#fbc2eb'],
    ['#373b44', '#4286f4', '#00c6ff'],
    ['#ff0844', '#ffb199', '#ff8177'],
    ['#a1c4fd', '#c2e9fb', '#93a5cf'],
    ['#ed6ea0', '#ec8c69', '#f7186a', '#fbb03b'],
    ['#fdfcfb', '#e2d1c3', '#f5f7fa', '#c3cfe2'],
    ['#b465da', '#cf6cc9', '#ee609c', '#ee609c', '#f59c65'],
    ['#ff8008', '#ffc837', '#ff0099'],
    ['#00c6fb', '#005bea', '#21d4fd', '#b721ff'],
    ['#b721ff', '#21d4fd', '#0052d4', '#4364f7', '#6fb1fc'],
    ['#74ebd5', '#acb6e5', '#0fd850'],
    ['#f093fb', '#f5576c', '#4facfe', '#00f2fe'],
    ['#000000', '#434343', '#ffffff'],
    ['#f5f5f5', '#bdbdbd', '#424242', '#000000'],
    ['#111111', '#537895', '#09203f'],
    ['#0f2027', '#203a43', '#2c5364'],
    ['#ff512f', '#f09819', '#ff6a00'],
    ['#00f5a0', '#00d9f5', '#7a00ff'],
    ['#134e5e', '#71b280', '#dce35b'],
    ['#ff6fd8', '#3813c2', '#00dbde'],
];

const additionalGradientConfig = Object.fromEntries(
    ADDITIONAL_GRADIENT_STOPS.map((stops, index) => {
        const key = `gradient_${index + 4}`;
        return [key, {
            class: 'bg-transparent',
            previewStyle: { background: `linear-gradient(135deg, ${stops.join(', ')})` },
            fill: {
                type: 'linear',
                from: 'top-left',
                to: 'bottom-right',
                stops,
            },
        }];
    })
);

const formatGradientPreviewStop = (stop) => {
    if (typeof stop === 'string') return stop;
    const percentage = Number((Number(stop.offset) * 100).toFixed(3));
    return `${stop.color} ${percentage}%`;
};

const createLinearGradientConfig = (stops, { angle, from, to }) => ({
    class: 'bg-transparent',
    gradientAngle: angle,
    previewStyle: {
        background: `linear-gradient(${angle}deg, ${stops.map(formatGradientPreviewStop).join(', ')})`,
    },
    fill: {
        type: 'linear',
        from,
        to,
        stops,
    },
});

const createAngularGradientConfig = (stops, angle) => ({
    class: 'bg-transparent',
    gradientAngle: angle,
    previewStyle: {
        background: `conic-gradient(from ${angle}deg, ${stops.map(formatGradientPreviewStop).join(', ')})`,
    },
    fill: {
        type: 'angular',
        from: 'center',
        rotation: angle,
        stops,
    },
});

// Phase 8 移除了不可再分发的第三方渐变位图。历史项目已经持久化这些 gh_img_*
// 键，因此保留 token、但用 ScreenHello 代码原生渐变重新定义视觉；不会读取图片、
// 网络或 object URL。键名只是兼容标识，不再表示图片或第三方来源。
const COMPAT_GRADIENT_SPECS = [
    [65, 'linear', ['#120b2e', '#7137d8', '#ff6aa2'], 135, 'top-left', 'bottom-right'],
    [62, 'angular', ['#09111f', '#155e75', '#67e8f9', '#1e293b', '#09111f'], 210],
    [50, 'linear', ['#0b1020', '#293b73', '#7c3aed', '#f472b6'], 120, 'top-left', 'bottom-right'],
    [48, 'linear', ['#172554', '#2563eb', '#22d3ee', '#ecfeff'], 150, 'top-left', 'bottom-right'],
    [47, 'angular', ['#20102e', '#be185d', '#fb7185', '#fbbf24', '#20102e'], 240],
    [45, 'linear', ['#052e2b', '#0f766e', '#5eead4', '#f0fdfa'], 135, 'top-left', 'bottom-right'],
    [44, 'linear', ['#1c1917', '#7c2d12', '#fb923c', '#ffedd5'], 110, 'top-left', 'bottom-right'],
    [43, 'angular', ['#111827', '#3730a3', '#a78bfa', '#312e81', '#111827'], 180],
    [40, 'linear', ['#18181b', '#3f3f46', '#a1a1aa', '#fafafa'], 145, 'top-left', 'bottom-right'],
    [39, 'linear', ['#3b0764', '#a21caf', '#f0abfc', '#fff1f2'], 125, 'top-left', 'bottom-right'],
    [38, 'angular', ['#082f49', '#0369a1', '#38bdf8', '#a5f3fc', '#082f49'], 225],
    [35, 'linear', ['#422006', '#ca8a04', '#fde047', '#fefce8'], 140, 'top-left', 'bottom-right'],
    [29, 'linear', ['#022c22', '#15803d', '#86efac', '#f0fdf4'], 160, 'top-left', 'bottom-right'],
    [26, 'angular', ['#450a0a', '#dc2626', '#fb7185', '#7f1d1d', '#450a0a'], 200],
    [25, 'linear', ['#0c0a09', '#44403c', '#d6d3d1', '#fff7ed'], 130, 'top-left', 'bottom-right'],
    [24, 'linear', ['#1e1b4b', '#4f46e5', '#818cf8', '#eef2ff'], 155, 'top-left', 'bottom-right'],
    [16, 'angular', ['#042f2e', '#0d9488', '#2dd4bf', '#ccfbf1', '#042f2e'], 195],
    [15, 'linear', ['#4c0519', '#e11d48', '#fda4af', '#fff1f2'], 115, 'top-left', 'bottom-right'],
    [13, 'linear', ['#082f49', '#0284c7', '#7dd3fc', '#f0f9ff'], 135, 'top-left', 'bottom-right'],
    [11, 'angular', ['#2e1065', '#7e22ce', '#d8b4fe', '#581c87', '#2e1065'], 215],
    [10, 'linear', ['#27272a', '#52525b', '#d4d4d8', '#ffffff'], 125, 'top-left', 'bottom-right'],
];

const compatibilityGradientConfig = Object.fromEntries(
    COMPAT_GRADIENT_SPECS.map(([number, kind, stops, angle, from, to]) => [
        `gh_img_${number}`,
        {
            ...(kind === 'angular'
                ? createAngularGradientConfig(stops, angle)
                : createLinearGradientConfig(stops, { angle, from, to })),
            label: `精选渐变 ${number}`,
        },
    ])
);

// default_3 使用近似 1px 的极窄过渡，保留 Grabient 原始的分段色带效果。
const createHardStops = (colors) => {
    // Grabient 的第一个颜色也占据一个完整区间，因此区间数等于颜色数。
    const segmentCount = Math.max(1, colors.length);
    const gap = Math.min(0.001, 1 / segmentCount / 4);
    const stops = [{ offset: 0, color: colors[0] }];
    for (let index = 0; index < colors.length - 1; index += 1) {
        const boundary = (index + 1) / segmentCount;
        stops.push({ offset: boundary, color: colors[index] });
        stops.push({ offset: Math.min(1, boundary + gap), color: colors[index + 1] });
    }
    stops.push({ offset: 1, color: colors[colors.length - 1] });
    return stops;
};

const DEFAULT_3_STOPS = createHardStops([
    '#c8d5c8', '#d0d3bd', '#d4ceaf', '#d5c59e', '#d2b88c', '#cbaa79',
    '#c19865', '#b48651', '#a5723f', '#935f2e', '#804b20', '#6c3914',
    '#59290b', '#461c06', '#341105', '#250908', '#18060e', '#0e0617',
    '#080924', '#051033', '#061b45', '#0b2958', '#13396b', '#1f4b7f',
    '#2d5e92', '#3e72a4', '#5085b3', '#6498c1', '#77a9cb', '#8bb8d2',
    '#9dc4d5', '#aecdd4', '#bcd3d0', '#c7d5c8',
]);

const legacyBackgroundConfig = {
    default_1: createLinearGradientConfig(
        ['#f5f7fa', '#c3cfe2', '#e0c3fc', '#8ec5fc'],
        { angle: 90, from: 'left', to: 'right' }
    ),
    default_2: createLinearGradientConfig(
        ['#002e5d', '#002e5d', '#2774ae'],
        { angle: 90, from: 'left', to: 'right' }
    ),
    default_3: createLinearGradientConfig(
        DEFAULT_3_STOPS,
        { angle: 90, from: 'left', to: 'right' }
    ),
    default_4: createLinearGradientConfig(
        ['#cedefd', '#b1d7f5', '#8fc6ed', '#6daae4', '#4b87dc', '#2e5ed4'],
        { angle: 180, from: 'top', to: 'bottom' }
    ),
    default_5: createLinearGradientConfig(
        ['#434343', '#000000'],
        { angle: 90, from: 'left', to: 'right' }
    ),
    default_6: createLinearGradientConfig(
        ['#c9bce0', '#bed3d4', '#d3e2bd', '#f5ddaf', '#ffc8b6', '#f0b5cb', '#ceb5de', '#bdc8de', '#ceddcb'],
        { angle: 225, from: 'top-right', to: 'bottom-left' }
    ),
    default_7: createLinearGradientConfig(
        ['#09203f', '#537895'],
        { angle: 0, from: 'bottom', to: 'top' }
    ),
    default_8: createLinearGradientConfig(
        ['#0a0000', '#250a26', '#49457a', '#767baa', '#aba9b5'],
        { angle: 0, from: 'bottom', to: 'top' }
    ),
    default_9: createLinearGradientConfig(
        ['#140e0c', '#1b121f', '#231733', '#2a1e48', '#33275d', '#3c3172', '#453c87', '#4e479a', '#5951ad', '#635cbf', '#6e65cf', '#796ede', '#8574ea', '#9179f4', '#9d7cfc', '#aa7dff', '#b67cff', '#c478ff', '#d173ff', '#df6cfe', '#ed63f7'],
        { angle: 0, from: 'bottom', to: 'top' }
    ),
    default_10: createAngularGradientConfig([
        '#000021', '#00000b', '#000000', '#000000', '#000000', '#000000', '#000000',
        '#180000', '#320000', '#4b0000', '#630000', '#7a0100', '#8d1700', '#9d2e02',
        '#a94518', '#af5b2e', '#b07045', '#ac825c', '#a39270', '#969e83', '#84a692',
        '#6faa9e', '#57aaa5', '#3ea5a9', '#259ba7', '#0c8ea2', '#007e98', '#006b8a',
        '#005579', '#003f65', '#002850', '#001139', '#000022', '#00000c',
    ], 180),
    default_11: createLinearGradientConfig(
        ['#ffc488', '#ffa375', '#ff907a', '#ff9394', '#ffacb0', '#ffcdb9', '#ffe6aa'],
        { angle: 315, from: 'bottom-right', to: 'top-left' }
    ),
    default_12: createLinearGradientConfig(
        ['#193132', '#0f5a65', '#32918b', '#74bda5', '#becab1', '#f2b2b0'],
        { angle: 90, from: 'left', to: 'right' }
    ),
    default_13: createLinearGradientConfig(
        ['#fda373', '#ffdbb0', '#fcffe4', '#ccffff', '#8bf1ff', '#4ec0e4', '#2585b0'],
        { angle: 90, from: 'left', to: 'right' }
    ),
    solid_1: {
        class: 'bg-transparent',
        fill: {
            type: 'solid',
            color: '#ffffff00',
        },
    },
    solid_2: {
        class: 'bg-slate-400',
        fill: {
            type: 'solid',
            color: '#94a3b8',
        },
    },
    solid_3: {
        class: 'bg-gray-400',
        fill: {
            type: 'solid',
            color: '#9ca3af',
        },
    },
    solid_4: {
        class: 'bg-stone-400',
        fill: {
            type: 'solid',
            color: '#a8a29e',
        },
    },
    solid_5: {
        class: 'bg-red-400',
        fill: {
            type: 'solid',
            color: '#f87171',
        },
    },
    solid_6: {
        class: 'bg-orange-400',
        fill: {
            type: 'solid',
            color: '#fb923c',
        },
    },
    solid_7: {
        class: 'bg-amber-400',
        fill: {
            type: 'solid',
            color: '#facc15',
        },
    },
    solid_8: {
        class: 'bg-yellow-400',
        fill: {
            type: 'solid',
            color: '#fbbf24',
        },
    },
    solid_9: {
        class: 'bg-lime-400',
        fill: {
            type: 'solid',
            color: '#a3e635',
        },
    },
    solid_10: {
        class: 'bg-green-400',
        fill: {
            type: 'solid',
            color: '#4ade80',
        },
    },
    solid_11: {
        class: 'bg-emerald-400',
        fill: {
            type: 'solid',
            color: '#34d399',
        },
    },
    solid_12: {
        class: 'bg-teal-400',
        fill: {
            type: 'solid',
            color: '#2dd4bf',
        },
    },
    solid_13: {
        class: 'bg-cyan-400',
        fill: {
            type: 'solid',
            color: '#22d3ee',
        },
    },
    solid_14: {
        class: 'bg-sky-400',
        fill: {
            type: 'solid',
            color: '#38bdf8',
        },
    },
    solid_15: {
        class: 'bg-blue-400',
        fill: {
            type: 'solid',
            color: '#60a5fa',
        },
    },
    solid_16: {
        class: 'bg-indigo-400',
        fill: {
            type: 'solid',
            color: '#818cf8',
        },
    },
    solid_17: {
        class: 'bg-violet-400',
        fill: {
            type: 'solid',
            color: '#a78bfa',
        },
    },
    solid_18: {
        class: 'bg-purple-400',
        fill: {
            type: 'solid',
            color: '#c084fc',
        },
    },
    solid_19: {
        class: 'bg-fuchsia-400',
        fill: {
            type: 'solid',
            color: '#e879f9',
        },
    },
    solid_20: {
        class: 'bg-pink-400',
        fill: {
            type: 'solid',
            color: '#f472b6',
        },
    },
    solid_21: {
        class: 'bg-rose-400',
        fill: {
            type: 'solid',
            color: '#fb7185',
        },
    },
    gradient_1: {
        class: 'bg-gradient-to-br from-[#ff6432] from-12.8% via-[#ff0065] via-43.52% to-[#7b2eff] to-84.34%',
        fill: {
            type: 'linear',
            from: 'top-left',
            to: 'bottom-right',
            stops: [
                { offset: 0.12, color: '#ff6432' },
                { offset: 0.44, color: '#ff0065' },
                { offset: 0.84, color: '#7b2eff' },
            ],
        },
    },
    gradient_2: {
        class: 'bg-gradient-to-br from-[#69eacb] from-0% via-[#eaccf8] via-48% to-[#6654f1] to-100%',
        fill: {
            type: 'linear',
            from: 'top-left',
            to: 'bottom-right',
            stops: [
                { offset: 0, color: '#69eacb' },
                { offset: 0.48, color: '#eaccf8' },
                { offset: 1, color: '#6654f1' },
            ],
        },
    },
    gradient_3: {
        class: 'bg-gradient-to-br from-[#f9f047] to-[#0fd850]',
        fill: {
            type: 'linear',
            from: 'top-left',
            to: 'bottom-right',
            stops: ['#f9f047', '#0fd850'],
        },
    },
    ...additionalGradientConfig,
    ...compatibilityGradientConfig,
};

const getBackgroundType = (key) => {
    if (key === 'none') return 'none';
    if (key.startsWith('solid_') || key === 'custom_solid') return 'solid';
    if (key.startsWith('default_') || key.startsWith('gradient_') || key.startsWith('gh_img_')) return 'gradient';
    return 'solid';
};

const getBackgroundCategory = (key) => {
    if (key === 'none') return 'none';
    if (key.startsWith('default_')) return 'default';
    if (key.startsWith('solid_') || key === 'custom_solid') return 'solid';
    if (key.startsWith('gradient_') || key.startsWith('gh_img_')) return 'gradient';
    return 'custom';
};

const normalizedBackgroundConfig = {
    none: {
        key: 'none',
        type: 'none',
        category: 'none',
        label: '无背景',
        class: 'bg-transparent border border-dashed border-slate-300',
        fill: null,
    },
    custom_solid: {
        key: 'custom_solid',
        type: 'solid',
        category: 'custom',
        label: '自定义颜色',
        class: 'bg-transparent border border-dashed border-slate-300',
        fill: null,
        hidden: true,
    },
    upload_image: {
        key: 'upload_image',
        type: 'upload-image',
        category: 'upload',
        label: '本地图片',
        class: 'bg-transparent border border-dashed border-slate-300',
        fill: null,
        hidden: true,
    },
    ...Object.fromEntries(
        Object.entries(legacyBackgroundConfig).map(([key, value]) => [
            key,
            {
                ...value,
                key,
                type: getBackgroundType(key),
                category: getBackgroundCategory(key),
                label: key,
            },
        ])
    ),
};

export const normalizeBackgroundKey = (value) => {
    if (value && typeof value === 'object') {
        return normalizeBackgroundKey(value.presetKey || value.key || value.id);
    }
    // Phase 3 移除了历史 Unsplash 预设；旧草稿会安全回退到本地渐变。
    if (/^(cosmic|cloud|desktop)_img_\d+$/.test(value)) return 'default_1';
    return normalizedBackgroundConfig[value] ? value : 'default_1';
};

export const getBackgroundDefinition = (value) => normalizedBackgroundConfig[normalizeBackgroundKey(value)];

/**
 * 检查器「预设」区直出的代码原生精选渐变（恰好两行五列）。
 * gh_img_* 只作为旧项目兼容 token 保留，不再表示图片资源。
 */
export const QUICK_ACCENT_GRADIENT_KEYS = [
    'gh_img_65', 'gh_img_50', 'gh_img_48', 'gh_img_47', 'gh_img_45',
    'gh_img_44', 'gh_img_43', 'gh_img_40', 'gh_img_39', 'gh_img_38',
].filter((key) => Boolean(normalizedBackgroundConfig[key]));

/** @deprecated 兼容旧内部导入；新代码使用 QUICK_ACCENT_GRADIENT_KEYS。 */
export const QUICK_IMAGE_KEYS = QUICK_ACCENT_GRADIENT_KEYS;

export const getBackgroundEntries = (category) => Object.values(normalizedBackgroundConfig)
    .filter((item) => !item.hidden && (!category || item.category === category));

export default normalizedBackgroundConfig;
