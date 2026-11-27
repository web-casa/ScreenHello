# iPhone Duo 可选本地素材包

2026-09-17：按用户要求撤下两款手持样式，当前仅提供非手持横屏、竖屏两款。Web 与桌面使用相同配置；本次不包含新的公开部署或 DMG。名称沿用 mockup 作者，不代表 Apple 官方机型或规格。

## 输入与提取

当前提取器仅使用 Good Mockups 横屏／竖屏 PSD；最初评估的两份手持 PSD 不再提取或打包，原文件保留。源文件 SHA-256 固定在 [提取脚本](../scripts/extract-iphone-duo.py) 中，脚本只读取 PSD，不保存或重写源文件。

```bash
uv run --no-project --with 'psd-tools[composite]==1.19.0' python scripts/extract-iphone-duo.py ~/jietu/duo
```

输出到 gitignored 的 `local-device-assets/`，仅包含两款机身 PNG、屏幕 alpha 掩膜和 320 px 缩略图。旧手持派生文件即使仍在本地目录，也不会被资源 glob 引入构建。`iphone-duo-provenance.json` 记录源文件摘要、裁切范围、原屏幕尺寸与输出摘要。暂存全部输出并核对版本化几何后才安装，不修改其他设备文件。

| 稳定 ID | 样式 | 合成尺寸 |
| --- | --- | --- |
| `iphone-duo-hand-folded-v1` | 手持折叠（已撤下，仅保留旧 ID） | 1440 × 856 |
| `iphone-duo-hand-unfolded-v1` | 手持展开（已撤下，仅保留旧 ID） | 1440 × 713 |
| `iphone-duo-portrait-v1` | 无手持竖屏 | 879 × 1220 |
| `iphone-duo-landscape-v1` | 无手持横屏 | 1220 × 879 |

设备选择器仅显示两张非手持卡片，不把姿态当作机身配色；名称提供七语翻译。旧 `iphone-bitmap` 和 Devices.css 的 iPhone ID 与外观不变。

旧手持项目不会自动变成另一种外观：继续识别原 ID，但素材标记不可用，导出需用户重新选择非手持外框。撤销列表、PSD 原件与本地项目不会被删除。

## 渲染与保存边界

- 机身 → 用户屏幕投影 → 屏幕掩膜 → 前景遮挡，确保拇指与独立摄像头位于用户截图上方。原 PSD 的隐藏层仍隐藏，背景、场景纹理、演示 UI 与标题不参与设备像素。
- 屏幕四角与比例来自 PSD 智能对象；[几何文件](../src/utils/iphoneDuoGeometry.json) 为版本化契约，重新提取时必须一致。没有增加运行时 PSD 解码或扩大像素预算。
- 手持素材保留原图底边截断的手臂，不生成源文件中不存在的肢体。横竖屏设备保留透明背景，场景专用地面阴影不提取。
- 机身、掩膜、必需前景缺失时隐藏该样式；旧项目仍识别其 ID，导出明确失败，不静默替换。前景尺寸不一致也拒绝合成。
- 前景图片与其他输入共用取消、超时和资源释放机制。预览、自动尺寸、放大镜和导出继续走已有管线。
- 项目／预设仅保存样式 ID 与用户图片，不携带第三方机身、掩膜或手部素材。换到未安装素材的环境需要安装同版本本地包或换外框。
- library 构建保留 ID／几何并替换素材表为空；Web／桌面构建仅在本地包存在时包含素材。PWA 按需缓存设备图片，不放入核心预缓存。

## 来源与分发状态

来源：[手持款](https://goodmockups.com/free-hand-holding-iphone-duo-mockup-psd-set-folded-unfolded/)、[横竖屏款](https://goodmockups.com/free-iphone-duo-mockup-psd-landscape-portrait/)、[法律说明](https://goodmockups.com/legal-notice/)。素材页允许个人／商业设计使用，但当前未取得将提取图片放入公开源码或安装包再分发的明确说明。

因此保持 `licenseStatus: unverified`，不标记 MIT，不继承其他素材的历史确认。复用现有下载许可提示；该提示不是再分发授权。公开源码导出不包含 `local-device-assets`，缺包时这四项自动隐藏。

## 首轮四款实现的历史 Review 与验证

本轮重点检查并修正：前景被截图覆盖、缺少前景却仍被判定可用、前景尺寸错位、library 误携带本地图片、源文件或几何改变时部分覆盖已有包，以及新增 E2E 文件分组数量断言。

可复验命令：

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm audit:i18n
pnpm exec playwright test tests/e2e/iphone-duo.spec.js
pnpm build
pnpm audit:pwa
pnpm build:lib
pnpm audit:pwa:library
pnpm desktop:web:build
```

已执行结果：

- `lint`、`typecheck`、七语审计通过；全量单测 **93 files / 1362 tests** 通过。最后收紧前景文件选择后，相关四组 **19 tests** 复验通过。
- 三引擎 Duo 像素／缺层／尺寸／取消、适配／PNG/JPG/WebP／倍率／撤销／归档测试 **6/6** 通过。108 次导出覆盖四样式 × 三适配 × 三格式 × 三引擎。换图后屏幕像素变化，屏幕上的不透明前景像素与原始前景逐像素一致。
- 追加快速切换、放大镜、真正重新打开项目、批量 ZIP 及下载许可快照测试 **3/3** 通过，Duo 专项合计 **9 项**。取消下载不会误交付切换后的另一款设备。
- 既有 Devices.css／Surface 设备、双实例资源回收与项目／预设回归 **15/15** 通过。
- 桌面生产 CSP 预览和深浅主题菜单／弹层检查 **9/9** 通过。此处是浏览器承载生产桌面前端并应用 CSP，不是真正的 Tauri 宿主。
- 最后一次桌面前端重建后，Duo 生产 CSP 预览专项再次 **3/3** 通过。
- Web、library、桌面前端构建通过；PWA 核心预缓存 54 项／3,288,409 bytes，Duo 资源按需加载；library 审计 `libraryDeviceAssets=0`。consumer 开发／生产预览分别 **18/18** 通过。
- 重复提取后，14 个 PNG 的摘要与 Web、桌面构建内相应素材一致，合计 1,448,397 bytes（约 1.38 MiB）。源摘要再次核对通过。
- 公开源码本地预览导出审计通过（815 files，不包含本地素材），复用现有依赖的无素材 Web 构建、相关 **17 tests** 通过；不是全新依赖安装或公开发布。

首轮验证发现新增 E2E 文件导致分组数量旧断言失败，已更新并通过全量复验；首个界面测试错误地直接点击禁止指针事件的隐藏 radio，改为用户实际操作的可见卡片后通过。公开预览审计把桌面测试中的固定本地图片 URL 当作必备公开文件，现统一按可选素材列表检测并跳过缺包环境。构建仍有既有的大 chunk 提示。

当前浏览器测试不等于真实 macOS WKWebView 或最低 Safari 验收；本次没有生成或安装新的 DMG，也没有执行新增样式的真实 macOS／Windows 人工验收。

## 撤下手持款（2026-09-17）

两款手持 ID 标记为 retired，始终不可用；资源导入限制为 portrait／landscape，提取器也只生成两款非手持素材。Web 与桌面选择器测试同步检查没有手持入口。本轮 `pnpm lint`、相关 17 项单测、三引擎 9 项 Duo 回归、Web 与桌面前端构建通过。重新提取只处理 portrait／landscape；两种构建均只有 6 个非手持 Duo PNG，没有手持图片。本地 4173 预览实测仅显示横屏、竖屏两个入口。
