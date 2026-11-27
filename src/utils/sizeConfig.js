// 尺寸配置是纯本地数据源。group.category 用于面板分类，entry.search 用于本地搜索，
// 不把展示文案或筛选状态写入 option，避免面板操作污染项目历史。
const sizeConfig = [
    {
        key: 'default',
        category: 'ratio',
        title: '比例 ',
        search: '比例 默认 ratio golden',
        lists: [
            { id: 'default-1-1', width: 1920, height: 1920, w: 1, h: 1, search: '方图 正方形 square 1 1' },
            { id: 'default-4-3', width: 1920, height: 1440, w: 4, h: 3, search: '横屏 标准 standard 4 3' },
            { id: 'default-3-2', width: 1920, height: 1280, w: 3, h: 2, search: '横屏 经典 classic 3 2' },
            { id: 'default-golden', title: '黄金比例', width: 1920, height: 1187, w: 1.618, h: 1, search: '黄金比例 golden 1.618 1' },
            { id: 'default-5-4', width: 1920, height: 1536, w: 5, h: 4, search: '横屏 照片 photo 5 4' },
            { id: 'default-16-9', width: 1920, height: 1080, w: 16, h: 9, wide: true, search: '横屏 宽屏 widescreen 16 9' },
            { id: 'default-4-5', width: 1080, height: 1350, w: 4, h: 5, search: '竖图 4 5' },
            { id: 'default-3-4', width: 1080, height: 1440, w: 3, h: 4, search: '竖图 3 4' },
            { id: 'default-2-3', width: 1080, height: 1620, w: 2, h: 3, search: '竖图 2 3' },
            { id: 'default-9-16', width: 1080, height: 1920, w: 9, h: 16, search: '竖屏 手机 9 16' },
        ],
    },
    {
        key: 'x',
        category: 'platform',
        title: 'X',
        badge: 'X',
        search: 'X 推特 twitter 社交',
        lists: [
            { id: 'x-post', title: '推文', width: 1200, height: 675, w: 16, h: 9, wide: true, search: '推文 tweet 横屏 16 9' },
            { id: 'x-cover', title: '封面', width: 1500, height: 500, w: 3, h: 1, wide: true, search: '封面 header 横幅 3 1' },
        ],
    },
    {
        key: 'instagram',
        category: 'platform',
        title: 'Instagram',
        badge: 'IG',
        search: 'Instagram 社交',
        lists: [
            { id: 'instagram-square', title: '方帖', width: 1080, height: 1080, w: 1, h: 1, search: '方帖 方图 1 1' },
            { id: 'instagram-portrait', title: '竖图', width: 1080, height: 1350, w: 4, h: 5, search: '竖图 4 5' },
            { id: 'instagram-story', title: '快拍', width: 1080, height: 1920, w: 9, h: 16, search: '快拍 故事 9 16' },
        ],
    },
    {
        key: 'og',
        category: 'platform',
        title: 'OG / 社交分享',
        badge: 'OG',
        search: 'OG OpenGraph 分享 博客 网站 1200 630',
        lists: [
            { id: 'og-card', title: '分享卡片', width: 1200, height: 630, w: 1.91, h: 1, wide: true, search: 'OG 分享 卡片 1200 630' },
        ],
    },
    {
        key: 'producthunt',
        category: 'platform',
        title: 'Product Hunt',
        badge: 'PH',
        search: 'Product Hunt 发布 独立开发 1270 760',
        lists: [
            { id: 'ph-gallery', title: '发布首图', width: 1270, height: 760, w: 5, h: 3, wide: true, search: 'Product Hunt 画廊 1270 760' },
        ],
    },
    {
        key: 'xiaohongshu',
        category: 'platform',
        title: '小红书',
        badge: 'RED',
        search: '小红书 rednote 图文 3 4 1080 1440',
        lists: [
            { id: 'xhs-note', title: '图文竖版', width: 1080, height: 1440, w: 3, h: 4, search: '小红书 竖版 3 4' },
        ],
    },
    {
        key: 'linkedin',
        category: 'platform',
        title: 'LinkedIn',
        badge: 'in',
        search: 'LinkedIn 领英 1200 627',
        lists: [
            { id: 'linkedin-post', title: '动态配图', width: 1200, height: 627, w: 1.91, h: 1, wide: true, search: 'LinkedIn 配图 1200 627' },
        ],
    },
    {
        key: 'youtube',
        category: 'platform',
        title: 'YouTube',
        badge: 'YT',
        search: 'YouTube 视频',
        lists: [
            { id: 'youtube-banner', title: '横幅', width: 2560, height: 1440, w: 16, h: 9, wide: true, search: '横幅 频道 16 9' },
            { id: 'youtube-thumbnail', title: '缩略图', width: 1280, height: 720, w: 16, h: 9, wide: true, search: '缩略图 16 9' },
            { id: 'youtube-video', title: '视频', width: 1920, height: 1080, w: 16, h: 9, wide: true, search: '视频 16 9' },
        ],
    },
    {
        key: 'pinterest',
        category: 'platform',
        title: 'Pinterest',
        badge: 'Pin',
        search: 'Pinterest 灵感',
        lists: [
            { id: 'pinterest-long', title: '长图', width: 1000, height: 2100, w: 10, h: 21, search: '长图 10 21' },
            { id: 'pinterest-best', title: '最佳', width: 1000, height: 1500, w: 2, h: 3, search: '竖图 2 3' },
            { id: 'pinterest-square', title: '方图', width: 1000, height: 1000, w: 1, h: 1, search: '方图 1 1' },
        ],
    },
];

export default sizeConfig;
