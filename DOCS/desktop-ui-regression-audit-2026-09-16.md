# 桌面 UI 回归：根因审计与修复记录（2026-09-16）

> 范围：用户提供的 `001.png`～`005.png`、当前工作树与本机 Linux Tauri 运行时。本文记录的是本轮代码审计和本地验证，不代表 macOS、Windows 的真实安装验收，也不代表已发布。

## 后续复测更正：CSP 才是本轮样式故障的直接根因

用户在已签名 `1.0.4` DMG 中再次提供 001～003 截图：尺寸弹层被下方缩略图覆盖、帮助菜单黑字透明、导出抽屉透明并重叠。按打包后的 CSP 复现后，确认上轮“StyleProvider layer 使所有组件进入 zeroRuntime”的解释错误；安装的 antd 中该 `!!layer` 分支用于图标 context，组件是否进入 zeroRuntime 由另一条主题路径决定。以下旧结论保留为调查记录，不应继续引用为最终根因。

真实链路是 `desktop/index.html` 的启动背景 `<style>` → Tauri 对该元素注入 nonce 并向 `style-src` 增加 nonce → 浏览器忽略同一 directive 中的 `unsafe-inline` → 没有 nonce 的 CSS-in-JS 样式和主题变量被拒绝 → 菜单/抽屉背景、字体、层级失效。上轮的静态 CSS 只能补部分布局，不能恢复被拦截的实例主题变量。

在 Chromium 生产预览中按 Tauri 2.11.5 的 `tauri-codegen::map_core_assets` 与 `manager::replace_csp_nonce` 路径模拟该策略，帮助菜单计算值为黑色 `rgb(0, 0, 0)`、透明背景 `rgba(0, 0, 0, 0)`、空 `--ant-color-bg-elevated`，收到 68 条样式 CSP 错误。此处是可重复的集成故障，不是仅凭截图推测 Safari 引擎不兼容。

修复将启动背景迁到 `src/desktop/desktop.css`，移除 HTML 内联 style，避免产生这个意外 nonce；保留 CSP 配置、脚本保护和资源协议限制。静态 CSS 仍作为首屏组件规则存在，但不能当作 runtime CSS 允许加载的证据。

新增 `pnpm desktop:test:ui`，先 `pnpm desktop:web:build`，再对生产入口施加按 HTML 实际生成的 Tauri style CSP；覆盖四个菜单、尺寸面板遮挡、裁剪和导出背景、主题变量、底部操作可见性和样式 CSP 违规。该测试模型不模拟原生 IPC，不替代真实 Mac GUI。原生 runtime 同步增加主题变量及不透明表面检查；macOS DMG workflow 新增生产前端 WebKit 验证步骤，失败不上传 DMG。

依据：[Tauri CSP 自动 nonce/hash](https://v2.tauri.app/security/csp/)、[MDN nonce 与 unsafe-inline 规则](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP)。

### 本次复测验证记录

- 负向回归：在生成产物中临时恢复原来的启动 `<style>`，两种主题在新生产 CSP 测试中均失败；随后恢复产物，不修改源码。
- 正向回归：外部启动 CSS 下，Chromium / Firefox / WebKit 的深浅主题测试通过；菜单、尺寸面板实际遮挡、裁剪、导出背景和操作按钮均检查，且 style CSP 违规为空。
- 原生 Linux ARM64 release 构建和 runtime 通过，菜单/尺寸/导出表面均读到主题变量；导出背景 `rgb(32, 32, 32)`、文字 `rgba(255, 255, 255, 0.85)`。
- lint、typecheck、相关 60 项 unit、Web/组件库构建、PWA 预算审计、文档内容检查通过。
- consumer 开发模式首轮 15 项通过、3 项浏览器进程崩溃；原生编译结束后单独重跑该 3 项通过。生产预览完整 18 项通过。没有把首轮崩溃记为成功。
- 当前 WebKit 不是用户机器上的 Safari/WKWebView；具体系统版本、真实 Mac 新包 GUI 仍待验证。

## 上轮结论（已由上述证据更正）

这些现象不是六个彼此无关的业务功能失效。主因是一次 Tailwind 4 迁移后，Ant Design 6 的 `StyleProvider layer` 被启用，却没有把 Ant Design 的静态基础样式放进生产 CSS。菜单、Popover、Input、Modal 和 Drawer 的 React 状态、事件处理和 Portal 节点仍在运行，但没有正确的定位、遮罩和布局规则，因此用户看到的是“点击没有反应”、裸文字输入框和导出面板流式溢出。

还有三项独立问题叠加在一起：

1. `prefers-reduced-motion` 曾用全局 `0.01ms !important` 覆盖所有动画和过渡。Ant Design 的 `rc-trigger` 需要一个正常的定位生命周期；在减少动态效果环境中，它会留下 `-1000vw/-1000vh` 的临时坐标，使尺寸浮层看似没有打开。
2. 隐私计数器不了解 Tauri 的 `ipc://localhost`、`ipc.localhost` 和 `asset.localhost` 本地桥接，把资源插件交还 Blob 的本机 IPC 错记为公网发送。
3. macOS 的原生标题栏与网页顶栏同时显示 ScreenHello 品牌。它是桌面壳的所有权设计问题，和响应式断点无关。

## 截图与证据映射

| 观察 | 直接原因 | 修复与验证 |
| --- | --- | --- |
| `001.png` 顶部出现两个 ScreenHello，网页栏与 macOS 标题栏不一致 | Tauri 配置保留系统 `decorations` 和窗口标题，网页 `TopBar` 又渲染品牌 | 桌面入口标记 `.shoteasy-desktop-app`，仅隐藏网页内重复品牌和紧邻分隔线，保留系统标题栏和原生窗口控制。 |
| `001.png` 显示“已上传 6.8 MB”，最近目标为 `ipc://localhost/plugin%3Aresources%7Cclose` | 该 URI 是 Tauri 本地 IPC；旧分类只识别回环 HTTP/WS 和少数非网络 scheme | 将 `ipc://localhost`、`http://ipc.localhost`、`http://asset.localhost`、`asset:` 与 `tauri:` 认定为本机；UI 改称“公网发送”。 |
| 文件、编辑、视图、帮助没有下级菜单 | Dropdown 的基础 CSS 缺失，Portal 存在但没有正确定位和外观 | 静态提取实际使用的 Ant Design 组件 CSS；E2E 同时验证菜单的视口几何而非仅验证 DOM。 |
| `002.png` 尺寸“自动”无反应 | 同上；若系统偏好减少动态效果，旧全局动画覆盖还会让 Popover 保留在视口外 | 删除影响 Portal 生命周期的全局动画时长覆盖；保留无平滑滚动。E2E 使用 reduced-motion profile 检查 Popover 的可见坐标。 |
| `003.png` 浏览器地址无法编辑 | Input 的基础 CSS 缺失，控件退化为没有边界与布局的文本流 | 静态 Input 样式恢复；E2E 和原生 runtime 都输入并读取实际 URL 值。 |
| 点击裁剪没有裁剪框 | Modal 的固定定位、遮罩和内容布局规则缺失 | 静态 Modal 样式恢复；E2E 和原生 runtime 检查固定定位的 modal wrapper。 |
| `004.png`、`005.png` 导出菜单溢出 | Drawer 的 fixed 定位与 wrapper 规则缺失，内容按普通文档流排版 | 静态 Drawer 样式恢复；E2E 和原生 runtime 检查 drawer 在视口内且为 fixed。 |

## 深层原因

### 1. CSS 构建契约在迁移时被拆开

仓库提交 `a6046fa`（`chore: migrate styles to Tailwind CSS 4`）把 `src/App.jsx` 的 `<StyleProvider>` 改为 `<StyleProvider layer>`，并同时替换了旧 Tailwind 层写法。上轮曾将图标 context 中的 `zeroRuntime: !!layer` 误读为所有组件均禁用 runtime CSS；复查安装源码与浏览器实际 style 元素后已否定这一推断，见本文顶部更正。

这类错误很容易被误诊为点击事件、MobX 状态或 Tauri IPC 故障，因为组件本身仍会 mount：

```text
点击 → React state 更新 → Ant Design Portal 进入 DOM
                               ↓
                   缺少 Drawer/Modal/Popover/Dropdown CSS
                               ↓
                 普通文档流、无 fixed/absolute 定位或视口外临时坐标
                               ↓
                       用户看见“没有反应”
```

Ant Design 的层兼容与静态样式路径见其[兼容样式文档](https://ant.design/docs/react/compatible-style/)和[主题文档](https://ant.design/docs/react/customize-theme/)。本轮以官方 `@ant-design/static-style-extract` 提取实际命名导入的组件样式，生成 [`src/style/antd-static.css`](../src/style/antd-static.css)，并在 [`src/style/main.css`](../src/style/main.css) 的 `antd` layer 先于本地覆盖规则导入。

生成脚本会从 `src/` 的 `antd` 命名导入中核对组件清单；新增可见组件而未加入提取清单会使 `pnpm check:antd-css` 失败。`build`、`build:preview`、`build:lib` 和 `desktop:web:build` 都先执行这个检查，校验静态组件清单同步；它不检测 CSP 是否阻止 runtime 主题注入。

### 2. 减少动态效果规则破坏了第三方浮层的时序

此前的媒体查询把 `.shoteasy-app *`、所有伪元素和多个 portal subtree 的动画、过渡强制压缩到 `0.01ms`。这看似符合减少动态效果偏好，却修改了 `rc-trigger` 用来完成定位和状态切换的时序。实测 Popover 元素已经存在，但坐标为 `left: -12800px; top: -7200px`。

尝试将 Ant Design 全局主题设为 `motion: false` 后，当前依赖组合又会使菜单切换失效，因此没有用另一种全局方式替换一个全局问题。审查中也短暂尝试停用传统菜单自身的 Dropdown 过渡，虽然避免了一次 WebKit 时序竞争，却使触控环境的 File → View 顶级菜单切换失效，已撤回。

最终修复只保留 `scroll-behavior: auto`，让组件自行完成可访问的生命周期；传统菜单则在打开后的下一帧确认焦点仍在当前菜单，解决 WebKit 会把焦点还给已点击 trigger 的竞争。若后续需要进一步降低动效，应针对自有动效逐项设计和验证，不能再次覆盖所有第三方 Portal。

### 3. “同源”与“本机”不是同一个安全边界

原实现把任意页面的同源地址当作本机，这在本地开发服务器和 Tauri WebView 中通常成立，却不适用于 `https://screenhello.com`：线上页面向同源 HTTPS API 发送 POST 依然会经过公网。修复后的分类规则是：

- 回环地址、`blob:`/`data:`/`file:`/`about:`/`filesystem:`、Tauri `asset:`/`tauri:` 与明确的 Tauri bridge host 属于本机；
- 只有当页面自身也运行在上述本地 origin 时，相对地址和同源地址才属于本机；
- 公网 HTTPS/WSS 地址（包括线上页面的同源 API）计入“公网发送”；
- GET 图片、脚本和样式只显示为“外部资源加载”，不增加发送字节。

`ipc://localhost/plugin%3Aresources%7Cclose` 正好属于第二类本机桥接，且 Tauri CSP 已明确许可 `ipc:`、`http://ipc.localhost` 和 `http://asset.localhost`。它可能承载大 Blob，但不是公网连接。因此截图中的 6.8 MB 不能作为“图片已上传公网”的证据；修复版启动新会话后会从零重新计数，旧会话的历史数字不会倒算。

该计数器观察的是 WebView 的 `fetch`、XHR、`sendBeacon`、WebSocket 与 Resource Timing，不能替代操作系统级抓包或证明所有原生进程网络行为。对本项目当前截图中的 IPC URI，结论是分类误报；对任何未来新增的原生网络能力，仍需单独审计。

### 4. 桌面窗口 chrome 缺少单一所有者

`src-tauri/tauri.conf.json` 使用默认装饰窗口，macOS 会在 WebView 外绘制系统标题栏和窗口控制。网页端传统菜单栏此前又带有品牌。两层并非同一响应式布局，浏览器版没有系统标题栏，所以它不会出现重复。

本轮采用低风险处理：保留成熟的系统标题栏和原生拖拽/窗口控制，只移除桌面 WebView 内重复品牌。完全自绘无边框标题栏会扩大为一个跨平台功能：需要 macOS/Windows/Linux 的可拖拽区、双击最大化、窗口控制、safe-area、系统缩放与真实 macOS 可视验收；在没有这些验收前不应把它作为顺手的 CSS 改动。

### 5. 之前的验收检查错过了“可用性几何”

旧 E2E 主要断言角色、文本、状态和 Portal 的存在。桌面 runtime smoke 也验证启动、IPC、截图、剪贴板和编码器，但未检查菜单、Popover、Modal、Drawer 的 computed position 与视口边界。一个没有 CSS 的 Portal 仍然可以通过“存在”和部分可见性断言。

本轮新增两层防线：

1. [`tests/e2e/phase852-menu.spec.js`](../tests/e2e/phase852-menu.spec.js) 检查 File 菜单、尺寸 Popover、浏览器地址输入、裁剪 Modal 和导出 Drawer 的宽高、定位和视口边界；三引擎共用 reduced-motion profile。
2. [`scripts/test-desktop-runtime.mjs`](../scripts/test-desktop-runtime.mjs) 在真实 release WebView 中执行同一组交互，并把结果写入 `overlays` evidence；不再只接受 DOM 中出现了 Portal。

## 为什么网页看起来完整而桌面端暴露得更集中

桌面端复用编辑器业务代码，但不是网页的简单壳：它有独立入口、`SCREENHELLO_TARGET=desktop` 构建、桌面覆盖 CSS、原生 WebView、不同默认动态效果/字体/窗口 chrome 与独立发布产物。这里的失效落在二者的交接层，不是画布、裁剪、菜单命令或 MobX store 的核心逻辑本身。

正式站点可取得的 HTML 只给出静态资源 hash，不能反推出与当前工作树相同的提交 SHA。因此不能把“网站当前看起来正常”解释为同一源码产物已在所有目标通过验收，也不能断言它一定采用了哪一版 CSS。应把网页和桌面分别构建、分别验收，并以实际 artifact 的 UI 路径作为发布门。

## 本轮修复清单

- 静态提取和提交所用 Ant Design CSS；构建前校验提取文件与当前命名导入同步。
- 移除会破坏 Portal 定位的全局 reduced-motion 时长覆盖。
- 更正公网/本机分类，覆盖 Tauri IPC、asset bridge、回环、线上同源 HTTPS 和 WSS。
- 将隐私按钮和帮助文本改为“公网发送 / 公网请求”，保持七语词典完整。
- 徽标告警只表示已知公网发送字节或无法定长的公网请求体；仅接收的外部资源和零正文请求仍在详情中可查，但不会把 `0 B` 标为上传。
- 桌面专用 wrapper 隐藏重复的网页品牌，保留原生标题栏。
- 菜单打开后在下一帧确认焦点仍在当前 Popup，修复 WebKit 的 trigger 焦点回抢；保留正常 Dropdown 过渡以确保触控顶级菜单切换。
- 添加 Web E2E 与原生 runtime 的浮层几何、地址输入和裁剪/导出回归。

## 验证记录

以下命令的结果只适用于本次未提交工作树；没有把 Linux WebKitGTK 结果延伸为 macOS 或 Windows 真实验收。

| 检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --strict-peer-dependencies` | 通过；锁文件无需更新。 |
| `pnpm check:antd-css` | 通过；生成样式 634,414 B。Ant Design extractor 仍输出其已知的 `Input.Group` 弃用 warning，不影响生成结果。 |
| `pnpm exec vitest run tests/unit/privacyMonitor.test.js --reporter=verbose` | 通过，21 项；包含 Tauri bridge、opaque `file:` origin、线上同源 HTTPS 发送分类，以及只接收流量不触发上传告警。 |
| `pnpm audit:i18n` | 通过；642 个代码键，无缺失或插值不匹配。 |
| `pnpm lint` / `pnpm typecheck` | 通过。 |
| `pnpm test:unit` | 通过，90 个文件、1,331 项。 |
| `pnpm exec playwright test tests/e2e/phase852-menu.spec.js` | 通过，Chromium / Firefox / WebKit 共 21 项；检查菜单、Popover、Input、Modal、Drawer 与 Drawer 内容容器的视口几何。 |
| `pnpm exec playwright test tests/e2e/privacy.spec.js` | 通过，Chromium / Firefox / WebKit 共 27 项；验证公网发送、未知长度正文、Tauri/本机边界和只接收外部资源不触发上传告警。Chromium 在清理遗留本地 Vite 进程后按 6 + 1 + 2 分组执行，Firefox/WebKit 各 9 项；全部断言通过。 |
| `pnpm build` + `pnpm audit:pwa` | 通过；主 CSS 911.10 kB、54 个 precache 条目、3,279,479 B。Vite 仍报告既存的大于 500 kB JavaScript chunk 提示。 |
| `pnpm build:lib` + `pnpm test:consumer` | 通过；consumer 开发和预览模式各 18 项通过。 |
| `pnpm desktop:build` + `pnpm desktop:test:runtime` | 通过；修复后的 Linux ARM64 release WebView 检查网页品牌隐藏、Tauri 本地 IPC 后仍为 `0 B`、menu / Popover / Input / Modal / Drawer 及 Drawer 内容几何，`overlays.status=passed`。桌面主 CSS 为 711.15 kB。 |
| `pnpm audit --audit-level=low` / `pnpm audit:licenses` | 通过；无已知漏洞，分发许可文本和开发工具 notice 元数据匹配。 |
| `pnpm check:docs-content` | 通过；7 个语言、6 个主题、49 个文件无内容偏差。 |

## 仍需人工确认的边界

- macOS 需要在真实设备上检查系统标题栏、缩放、刘海安全区、菜单行和深浅主题；本机 Linux 验证不能代表 macOS 视觉验收。
- Windows 和 macOS 仍需要各自运行修复后的原生 artifact。之前任何历史候选的通过记录不能覆盖新的源码。
- 新 build 需要重新启动桌面应用才会形成新的页面级隐私计数会话；旧窗口中已经累计的 6.8 MB 不会被原地重新分类。
- 如果产品决定追求完全一体化的自绘标题栏，应单独立项并定义三平台窗口交互验收，而不是取消系统装饰后依赖普通网页 CSS。
