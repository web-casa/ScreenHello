# 开发指南

## 环境与安装

标准开发和 CI 环境为 Node.js 24，当前通过 `.node-version`、`.nvmrc` 和 `engines.node` 固定到 24.x；包管理器由 `packageManager` 固定为 pnpm 10.12.1。基线采集使用 Node 24.18.0。

正常情况下应执行：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

开发服务器由 Vite 启动。项目没有环境变量、后端服务或数据库迁移。


## 常用命令

| 命令 | 用途 | 预期产物 |
| --- | --- | --- |
| `pnpm dev` | 启动 Vite 开发服务器 | 无提交产物 |
| `pnpm build` | 构建独立站点 | `dist/` |
| `pnpm build:lib` | 构建 npm ES 模块 | `lib/` |
| `pnpm typecheck` | 检查公共 JSDoc/TypeScript 边界 | 无 |
| `pnpm lint` | 检查 `.js/.jsx` | 无 |
| `pnpm test:unit` | 一次性运行 Vitest 单元测试 | 无 |
| `pnpm test:unit:watch` | 本地监听单元测试 | 无 |
| `pnpm test:e2e` | 运行当前 Chromium/Firefox/WebKit smoke/E2E；重型导出 benchmark 默认跳过 | `artifacts/`（失败时） |
| `pnpm test:release:current` | 在 production preview 运行当前三引擎格式、本地优先、键盘、axe 与 reduced-motion 发布检查 | `artifacts/release/playwright/`（失败时） |
| `pnpm test:release:minimum-browser` | 连接显式配置的 Selenium/WebDriver，核对版本并生成含桌面/移动闭环的 schema v2 单目标证据 | `artifacts/release/browser-matrix/*.json` |
| `pnpm audit:release:browsers` | fail-closed 合并审计 Chrome/Edge 111、Firefox 128、Safari 16.4 的同一候选提交证据 | 无 |
| `pnpm test:consumer` | 打包 tarball，在独立 package 安装后分别验证 Vite 开发态、生产 build/preview、延迟资源、双实例和卸载重挂 | `artifacts/`（包、consumer production build 与失败证据） |
| `pnpm size:report` | 输出 Web/library 体积与内联图片统计 | 标准输出 |
| `pnpm preview` | 预览站点构建 | 需要先有 `dist/` |
| `pnpm release` | 发布 npm 包 | 外部副作用，只有明确发布时运行 |

首次运行浏览器测试前执行 `pnpm exec playwright install --with-deps chromium firefox webkit`。CI/本地完整门禁应依次覆盖 frozen strict-peer install、`pnpm ignored-builds`、low-severity 依赖审计、typecheck、零 warning lint、unit、当前浏览器 E2E/golden、Web/PWA build 与审计、当前 release suite、library build、清洁 tarball consumer 和体积预算。最新阶段证据见 [Phase 7 Web P2](./phase-7-web-p2.md) 与 [Web Release Gate](./web-release-gate.md)。

最低版本证据不能从 Playwright 当前 bundled engines 推断。仓库提供手工触发的原生 amd64 workflow，固定 Chrome 111、Edge 111 和 Firefox 128 Selenium 镜像并以返回的 capabilities 为准；ARM64 上模拟 Chrome/Edge amd64 只作诊断。Safari 16.4 必须来自 Apple 设备原生会话或记录了系统/设备的可信云会话，Playwright WebKit 不可代替。可信云通过 `SCREENHELLO_BROWSER_VERSION`、`SCREENHELLO_BROWSER_PLATFORM` 和只含 provider namespaced options 的 `SCREENHELLO_WEBDRIVER_CAPABILITIES_JSON` 配置；不得把凭据写进仓库或证据。四份证据必须对应同一 40 位候选 commit，最后运行 `pnpm audit:release:browsers`。

导出预算基准必须使用独立测试端口并显式开启：`SCREENHELLO_E2E_PORT=4183 SCREENHELLO_EXPORT_BENCHMARK=1 pnpm exec playwright test --grep "characterizes the reviewed single-export pixel budget" --workers=1`。普通 `pnpm test:e2e` 不会反复分配 16 MP Canvas。

AVIF 的 production Worker/WASM/CSP/取消复核使用 `tests/spikes/avif/`。先按该目录的 Vite 配置构建并在独立端口 preview，再运行 `verify-production.mjs`；4 MP 重复内存/时间基准由 `benchmark-production.mjs` 显式执行，不并入每次普通 E2E。AVIF 源码升级后必须同时复跑这两类验证和 `pnpm test:consumer`，不能只看开发服务器。

## 路径别名

`vite.config.js` 与 `jsconfig.json` 共同定义：

| 别名 | 目录/文件 |
| --- | --- |
| `@components` | `src/components` |
| `@assets` | `src/assets` |
| `@style` | `src/style`（仅 Vite 配置） |
| `@stores` | `src/stores` |
| `@utils` | `src/utils` |
| `@hooks` | `src/hooks` |

新增别名时要同步更新 Vite 和 `jsconfig.json`，否则编辑器跳转与实际构建会不一致。

## 修改常见功能

### 新增画面选项

1. 在 `src/stores/option.js` 添加默认值和 action。
2. 在 `src/components/sideBar/` 增加控制项。
3. 在 `Screenshot.jsx`、`FrameBox.jsx` 或相应图层中增加响应式 effect。
4. 检查设备框、自动尺寸、HDR、放大镜快照和导出的组合行为。

### 新增标注工具

1. 在 `Header.jsx` 的 `toolList` 加入工具。
2. 在 `View.jsx` 决定是单击还是拖拽创建，并定义初始业务数据。
3. 在 `ShapeLine.jsx` 创建对应 Leafer 节点，并同步几何、颜色、线宽和 editable 状态。
4. 验证选择、移动、缩放、旋转、删除、zIndex 和导出。

### 新增背景

内置背景必须优先使用 `src/utils/backgroundConfig.js` 的代码原生纯色或 Leafer 渐变，并使用唯一稳定键。不要提交来源不明的 stock 图片、预览缩略图或远程 URL；确有图片素材需求时，必须先在根目录 `ASSET_PROVENANCE.md` 记录来源、作者、精确再分发许可和署名义务，再运行 E2E 网络断言、许可审查与 `pnpm size:report`。用户自己上传的本地背景不进入仓库。

### 新增尺寸预设

在 `src/utils/sizeConfig.js` 添加类别或条目，提供实际 `width`/`height` 与展示比例 `w`/`h`。尺寸值直接成为最终导出逻辑像素。

### 修改项目或预设格式

1. 先确认 `ProjectDocument v2`、`StylePreset v1` 和 workspace container v1 是否已能表达需求，不为单一字段直接升级整个容器；V1 项目只经 `validateDocument()` 迁移。
2. 同步检查 `projectDocument.js`、`stylePreset.js`、`workspaceArchive.js`、DraftStore 迁移和旧记录兼容。
3. 新 ZIP 入口必须加入固定 allowlist 和大小预算；归档中的 MIME/尺寸字段不能替代浏览器真实图片解码。
4. 增加损坏、版本不支持、校验和不符、缺资源和打开失败不污染当前画布的测试。

## 手工回归清单

最低建议覆盖：

1. 文件、拖放、粘贴和示例图片能进入编辑器；若改动媒体能力，再测屏幕捕获。
2. Auto、自定义及至少一个预设尺寸能正确调整画布。
3. 背景、圆角、阴影、留白、翻转、位置和缩放能实时更新。
4. 普通边框、浏览器标题栏和至少一个设备框显示正确。
5. 每种受影响标注能创建、选中、变形和删除；放大镜能随底图样式更新。
6. 水印前景/仅背景与 HDR 开关正常。
7. PNG/JPG/WebP/AVIF 以及 1x/2x/3x 至少各抽查一组，导出尺寸正确；AVIF 超过 4,194,304 像素时应在分配 Canvas 前给出明确回退提示。
8. 复制和所有相关快捷键在 HTTPS 或 localhost 下工作。
9. 亮/暗主题和窄屏布局无明显回归。
10. 删除图片后回到初始页，LeaferJS 画布与标注已清理。
11. 保存/另存为项目、重新打开下载文件、刷新后打开最近项目，并确认导出设置和上传背景恢复。
12. 风格预设的保存、应用、复制、重命名、删除和导入/导出正常；损坏文件不会改变画布。
13. File System Access 可用时测 picker/handle 路径，不可用时测 input/download 回退；检查存储不可用与配额不足提示。
14. 本地建议只在添加图片后计算，三项建议均需用户点击才应用，且过程不发出远程请求。
15. 批量处理至少检查当前风格与一个本地预设、横竖图、同名/损坏项、取消/重试和 ZIP 解压；处理前后活动项目、历史、dirty、草稿、Canvas 与 object URL 保持不变。

## 已知技术债与风险


- 自动测试目前覆盖多图历史/ProjectDocument v1→v2、workspace 容器与安全校验、共享资源、项目/预设跨会话恢复、runtime 与资源生命周期、多图底图快照、屏幕流释放、三引擎编辑链路、Chromium golden 和双实例 library consumer；仍不是完整功能回归套件。
- 精确 Safari 16.4 仍未重放；当前发布门采用用户确认的 GitHub `macos-14` 原生 Safari hosted-current 证据。Playwright WebKit 不能替代 Safari。
- 主题和底部工具栏折叠状态是浏览器级偏好；当前挂载实例互不覆盖，但未显式传 `isDark` 的新实例会读取同一 localStorage 主题键。
- 当前 Web 主 chunk 和 Emoji chunk 仍超过 Vite 默认 500 kB 提示线，但已通过 Phase 3 明确预算；后续只在有测量收益时继续拆分。
- library 仍是浏览器专用 ESM，需要宿主 bundler 处理公开 CSS 和相对资源 import；不支持 SSR 直接执行。
- AVIF 依赖深度锁定 `@jsquash/avif@2.1.1` 的 scalar codec 入口，其内嵌 libavif 1.0.1 落后于当前上游；升级依赖时必须重新验证输出、Worker/WASM 资产、CSP、内存和第三方 notice。
- 颜色面板已通过 AntD 的公开 `panelRender` 替换为 ScreenHello 自有原生控件，并覆盖打开态 axe、键盘焦点、Escape 返回与 legacy alpha 迁移；Safari/VoiceOver 仍随最低浏览器证据人工复核。
- 批量失败项重试会生成仅含该次重试成功项的新 ZIP；如需保留首轮已成功文件，应先下载首轮 ZIP。

## 文档维护

功能、公共属性、命令、依赖策略或目录职责变化时，同步更新 `DOCS/`。文档应描述已合入的事实；规划项要明确标为未实现。
