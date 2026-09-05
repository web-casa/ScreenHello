# 项目概览

## 项目定位

ScreenHello 将本地图片、粘贴图片或屏幕截图放入可配置画布，叠加背景、留白、圆角、阴影、浏览器/设备外框、标注、水印与 HDR 风格处理，最后导出 PNG、JPG、WebP 或 AVIF。产品域名为 `screenhello.com`；`rico-screenshot` 只是 Web P0 前内部 library 的遗留包名。

项目提供两种交付形态：

1. 独立站点：`src/main.jsx` 将 `App` 挂载到 `index.html#root`，由 `pnpm dev` 或 `pnpm build` 使用。
2. React 组件库：`src/index.js` 导出 `ImageBeautifier`，由 `pnpm build:lib` 构建到 `lib/`。
3. 桌面 PoC：`desktop/index.html` 与 `src/desktop/` 复用同一编辑器，`src/platform/desktopPlatform.js` 和 `src-tauri/` 提供 Tauri 2 原生适配；Phase 9.3 已取得三平台自动技术 Gate 证据，当前产物仍为无签名测试包。

## 已实现能力

- 通过文件选择、拖放、剪贴板粘贴、屏幕捕获或内置示例导入图片。
- 自适应画布、自定义尺寸，以及 Instagram、X、YouTube、Pinterest 等尺寸预设。
- 缩放、裁剪、水平/垂直翻转和九宫格对齐。
- 图片留白、留白颜色、圆角、阴影和整体缩放。
- 独立内描边，可与基础、浏览器或设备外框组合使用。
- 纯色、代码原生渐变和上传本地图片背景；旧 `gh_img_*` 项目 token 自动解析为代码渐变。
- 基础/创意外框、可配置 URL 与顶部尺寸的代码原生浏览器框，以及无品牌矢量笔记本、显示器、平板和手机外框；旧品牌设备 ID 自动解析为对应无品牌矢量框。
- 可导出的平面旋转、缩放和位置偏移，并纳入项目级撤销/重做。
- 矩形、实心矩形、圆形、直线、箭头、自由画笔、局部放大镜、步骤编号和 Emoji 标注。
- 重复文字水印，可切换到截图下方；浏览器 Canvas 实现的 HDR 风格增强。
- PNG/JPG/WebP/AVIF 导出，1x/2x/3x 像素倍率，以及 PNG 剪贴板复制；AVIF 通过按需 module Worker/WASM 纯本地编码，WebP 在 Canvas 无原生编码能力时使用按需本地 Worker/WASM 回退，实例级导出服务统一处理串行、取消、尺寸/MIME 校验和 Canvas 释放。
- 独立站支持 1～12 张本地图片套用当前风格或本地预设，逐张隔离渲染并下载一个仅含成功项的安全 ZIP；支持单项失败隔离、取消与失败项重试。
- 亮色/暗色主题、画布缩放与快捷键。
- 独立站通过 IndexedDB 自动保存和恢复草稿；组件库默认关闭，可用 `persistence` 显式开启。
- 独立站桌面/平板提供“文件 / 编辑 / 视图 / 帮助”传统菜单和项目/草稿双状态；`.screenhello` 项目动作位于文件菜单，本地资料库以四个 Tabs 管理最多 12 个最近项目、草稿、预设和存储。
- 独立站移动端提供“菜单 / 项目状态 / 导出”三入口顶栏；同一组命令通过四个 Tabs 呈现，标注按主工具/更多工具/样式分组，缩放保留放大、缩小、100% 和适应画布。核心触控目标至少 44 px，并适配 safe-area、动态视口及 PWA 状态卡避让。
- 完整风格预设支持本地保存、应用、复制、重命名、删除和 `.screenhello-preset` 导入/导出。
- 图片边缘色、内描边和横竖图外框建议完全在本地生成，分别显示在背景、内描边和外框控制区，只在用户点击后应用并进入历史。
- 同一页面可挂载多个互相隔离的编辑器；图片、选项、历史、主题、草稿服务、Leafer App 和运行时资源按实例拥有。
- ProjectDocument v2 多图片画布；图层面板复用本地资源显示缩略图、选择摘要和锁定/编组状态，并支持拖放、Alt+方向键及置顶/上移/下移/置底按钮；选择/多选、移动/缩放/旋转、复制/删除、对齐/吸附/等间距及堆叠/扇形布局保持可撤销。
- 多图项目、最近项目和自动草稿可完整恢复；V1 单图项目按旧几何无损迁移。
- 每个 runtime 有独立命令编排层；项目文件/自动草稿双状态、三选一替换保护、可撤销的“替换当前图片”、四组菜单、视图显隐、帮助中心和确认式导出均已接入。
- 独立站首屏明确说明图片只在当前设备处理，并复用帮助中心提供可关闭、可再次打开的快速入门；示例原图仍只在用户点击后读取。
- 独立站提供 Web-only PWA：可安装 manifest、经激活确认的核心 app-shell 预缓存、同源哈希重资源按需缓存，以及 dirty/busy 更新保护；library 入口不导入或注册 PWA。
- Tauri 2 桌面入口独立输出到 `dist-desktop`，不注册 PWA；main-window capability 只允许 13 个有界 application command、PNG image resource 与图片剪贴板写入。原生项目打开/保存、图片导入/导出、显示器/窗口/区域截图、主屏快捷键、托盘和单实例均复用既有命令与编辑器；系统路径、PID、原生窗口 ID 和第二实例参数不进入 WebView。区域 PNG 截图/导入及图片剪贴板已在 Linux aarch64/WebKitGTK 真实窗口验证。

## 尚未完成或未接入

- 文本美化、代码美化和 GIF：当前不提供入口，仍不属于可用功能。
- 自动化测试：已接入 Vitest 单元测试、Playwright 当前三引擎 smoke/E2E、移动响应式/axe/PWA、Chromium visual/export golden 和 library consumer smoke；精确最低浏览器最终候选复验留在 Phase 8.5.5。
- 服务端能力：没有 API、数据库、账户系统或上传服务。
- 桌面 Phase 9.3 已验证 Windows x64、macOS 14 ARM64、Linux x64 的自动 runtime、DEB/APP/NSIS 构建、包内结构与 SBOM/摘要。真机权限、多显示器/DPI/负坐标、Wayland、远程桌面、无显示器、原生文件对话框视觉、安装升级/卸载、更新、签名与公证仍待后续验证；技术 Gate 通过不代表桌面 MVP 可正式发布。Linux 中文环境需系统 CJK 字库。
- Web Release Gate 已通过：同一候选提交在原生 amd64 Chrome 111、Edge 111、Firefox 128 与 GitHub `macos-14` Safari 26.5 上完成核心编辑和四格式导出。产品仍声明 Safari 16.4+，但当前测试策略不精确重放历史 16.4。Phase 8 正式公开仓晋级已完成；之后的 Phase 8.5 私有开发变更尚未晋级，新的公开写入、tag/release 与部署仍需单独授权。详见 [Web Release Gate](./web-release-gate.md)。

## 技术栈

| 类别 | 选型 | 用途 |
| --- | --- | --- |
| UI 框架 | React 19.2.8 | 组件与生命周期；Compiler 未启用 |
| 构建 | Vite 8.2.2、Rolldown、Oxc | 开发服务器、站点/库构建 |
| 状态 | MobX 7.0.3、mobx-react-lite 5.0.3 | 编辑器与美化选项的响应式状态 |
| 画布 | LeaferJS 2.2.9 及插件 | 图层、选择器、缩放、拖拽、导出 |
| 组件库 | Ant Design 6.6.2、cssinjs 2.1.2 | 按钮、抽屉、弹层、滑块、消息等 |
| 样式 | Tailwind CSS 4.3.3、CSS | Vite plugin、布局、主题、局部组件样式 |
| 图片裁剪 | CropperJS、react-cropper | 裁剪弹窗 |
| 图标/Emoji | mage-icons-react、自绘 SVG、Emoji Mart | 工具栏与 Emoji 选择器 |
| 工具 | lodash、nanoid、tinykeys | 防抖、ID、快捷键等 |
| 项目与批量容器 | fflate 0.8.3 | `.screenhello` / `.screenhello-preset` 编解码与批量导出 ZIP |
| AVIF 编码 | @jsquash/avif 2.1.1 | scalar Worker/WASM 按需本地编码；不启用线程入口 |
| WebP 回退编码 | @jsquash/webp 1.5.0 | Canvas 不返回 `image/webp` 时按需启用 scalar Worker/WASM；原生支持浏览器不加载 |
| PWA | vite-plugin-pwa 1.3.0、Workbox 7.4.1 | Web-only manifest、Service Worker、安装/更新生命周期与分层离线缓存 |
| 类型与质量 | TypeScript 5.9 checkJs、Vitest 4.1.11、Playwright 1.62.1 | 公共类型、单元、当前浏览器、golden 与 tarball consumer |
| 发布验证 | axe-core 4.13、Selenium WebDriver 4.48 | 当前引擎 WCAG/本地优先检查与精确最低版本证据采集；不进入运行时产物 |
| 桌面 PoC | Tauri API 2.11.1、CLI 2.11.4、Rust tauri 2.11.5、dialog 2.7.3、clipboard-manager 2.3.3、global-shortcut 2.3.2、single-instance 2.4.4、xcap 0.9.8 | 独立 WebView 壳、token 化原生文件/截图、图片剪贴板、固定系统入口、最小 capability/CSP 与原生 IPC smoke |

## 目录职责

```text
.
├─ DOCS/                         项目维护文档
├─ desktop/                      Tauri 专用 HTML 入口
├─ .github/workflows/ci.yml      Node 24 / pnpm 10 CI 验证
├─ config/                       Web PWA manifest、预缓存与 runtime cache 策略
├─ scripts/                      构建体积、PWA/library 边界与许可证审计
├─ tests/                        unit、E2E、PWA、fixture 与 library consumer
├─ src/
│  ├─ assets/                    品牌/示例图与可再分发 SVG 界面资源
│  ├─ components/
│  │  ├─ batch/                  批量面板与隔离 Leafer renderer
│  │  ├─ editor/                 LeaferJS 画布、缩放、快捷键与图层
│  │  ├─ header/                 应用菜单、项目状态、帮助与标注工具栏
│  │  ├─ init/                   未导入图片时的初始页
│  │  ├─ sideBar/                尺寸、外观、背景、水印与完整导出面板
│  │  └─ workspace/              最近项目、预设、草稿与存储资料库 UI
│  ├─ hooks/                     图片载入、粘贴、实例级快捷键
│  ├─ platform/                  浏览器/桌面文件、存储、剪贴板、捕获与导出能力边界
│  ├─ pwa/                       Web-only 安装、离线就绪与安全更新 UI
│  ├─ stores/                    MobX 实例级 root store、Provider 与持久化服务
│  ├─ style/                     Tailwind 入口和项目 CSS
│  ├─ desktop/                   Tauri React bootstrap、IPC schema 与状态 UI
│  ├─ utils/                     配置、项目文档、历史、图像/SVG 与截屏工具
│  ├─ workers/                   按需加载的 AVIF scalar module Worker
│  ├─ App.jsx                    可嵌入的顶层组件
│  ├─ index.js                   组件库导出入口
│  └─ main.jsx                   独立站点入口
├─ index.html                    ScreenHello 独立站点页面与 SEO
├─ src-tauri/                    Tauri 2 Rust 壳、capability、配置与 Cargo lock
├─ vite.config.js                路径别名及站点/库双构建配置
├─ vitest.config.js              单元测试配置
├─ playwright.config.js          当前浏览器与 E2E 配置
└─ package.json                  脚本、依赖和 npm 包元数据
```

## 外部依赖与运行条件

- 默认首屏和核心编辑链路只使用可再分发的仓库内资源、代码原生渐变/矢量图形和系统字体，不依赖外部素材服务。
- 屏幕捕获依赖 `navigator.mediaDevices.getDisplayMedia()`。
- Web 剪贴板复制依赖 `navigator.clipboard.write()` 和 `ClipboardItem`；Tauri 入口使用只获准写图片的 clipboard plugin，并显式释放 PNG image resource。
- 取色器仅在实现 `window.EyeDropper` 的浏览器显示。
- 上述屏幕、剪贴板类 API 通常要求 HTTPS 或 localhost，并受浏览器权限控制。
- Service Worker/PWA 同样要求 HTTPS 或 localhost；部署必须按构建 base path 原样托管 `manifest.webmanifest`、`sw.js`、Workbox runtime 和哈希资源，并为 manifest、JavaScript、WASM 返回正确 MIME。`sw.js` 应允许重新验证，哈希资源可长期 immutable 缓存。
- 子路径部署用 `SCREENHELLO_BASE_PATH=/目标路径/ pnpm build`，manifest 的 `start_url/scope`、HTML 引用、Service Worker scope 与静态资源路径会保持一致。CSP 至少需允许本站脚本、Worker、manifest/资源请求和现有 `blob:` 图片/Worker 路径；部署前应运行 production PWA 测试，不可只验证开发服务器。
- Web 项目文件增强保存依赖 File System Access；能力不存在或未授权时自动退回文件选择和下载。Tauri 原生文件只向 WebView 返回 owner-scoped 不透明 token、文件名、MIME 和大小，真实路径留在 Rust backend，并在同目录临时文件完整落盘后原子替换。
- 普通格式单次导出限制为单边 8192 px、总计 16,777,216 像素；AVIF 另限制为 4,194,304 像素。超过限制会在创建全尺寸 Canvas 前失败。完整基准见 [Phase 7 Web P2](./phase-7-web-p2.md)。
