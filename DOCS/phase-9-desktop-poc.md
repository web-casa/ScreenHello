# Phase 9 桌面 PoC

## 当前状态

Phase 9.0 已建立 Tauri 2 桌面壳与最小安全契约；Phase 9.1 接入实例级原生文件与图片剪贴板；Phase 9.2 已接入显示器/窗口/区域截图、固定主屏快捷键、托盘和单实例恢复。桌面端复用现有 React 编辑器、菜单、项目容器、图片校验和导出服务，但使用独立的桌面 HTML/React 入口、`desktopPlatform` 和 `dist-desktop/` 产物；Web 入口继续生成 PWA，library 入口继续保持 `workspace=false` 默认行为。

Phase 9.3 最终公开候选 `4bbe72a1b7ed779375c9ac950219e98769a2bd77` 已取得三平台自动 Gate 通过证据（[Actions run](https://github.com/web-casa/ScreenHello/actions/runs/33950833037)）：Ubuntu 24.04 x64、Windows Server 2025 x64 与 `macos-14` arm64 均完成真实 WebView、640×480 区域 PNG 捕获与编辑器导入、PNG 剪贴板、快捷键注册、托盘创建和第二实例退出，以及无签名 DEB/APP/NSIS、包内检查、CycloneDX SBOM 和 SHA-256 汇总。下载后复算亦通过，Ubuntu 中文字库修复也已由同一最终候选截图验证。此证据不覆盖后续保存覆盖/多实例修复；修改后的候选需自身 run 复验。系统文件对话框、真实托盘、多显示器/DPI/负坐标、Wayland/远程桌面/无显示器和权限仍为人工项，`releaseReady=false`。

## 技术基线

- Node.js 24.x、pnpm 10.12.1：前端和构建工具，不进入桌面生产运行时。
- `@tauri-apps/api` 2.11.1、`@tauri-apps/cli` 2.11.4。
- `tauri` 2.11.5、`tauri-build` 2.6.3、`tauri-plugin-dialog` 2.7.3、`tauri-plugin-clipboard-manager` 2.3.3、`tauri-plugin-global-shortcut` 2.3.2、`tauri-plugin-single-instance` 2.4.4、`xcap` 0.9.8、`getrandom` 0.3.4、`tempfile` 3.27.0、Rust 1.77.2+。
- `Cargo.lock` 与 pnpm lockfile 一起提交，直接版本使用精确 pin。
- release profile 启用 LTO、单 codegen unit、`opt-level=s`、abort panic 和 strip；Tauri 按 capability 删除未授权 command。

Linux 构建需要 `libclang-dev`、`libpipewire-0.3-dev` 和 `libgbm-dev`。无安装包 release ELF 体积只用于同平台回归，不代表 Windows/macOS 安装包大小。

界面使用系统字体；Linux 的中文运行/视觉验证环境需提供 CJK 字库，Ubuntu runner 安装 `fonts-noto-cjk`。裸系统缺中文字库会显示方框，不能据此宣称中文视觉验收通过；应用不下载远程字体。

## 安全边界

桌面端暴露 16 个 application command：六个环境/文件命令、一个语言命令、五个截图命令、一个有界本地状态命令和三个有界系统状态/Channel 命令。新增 `desktop_capture_capability` 只返回有限截图 backend/status；`desktop_state_status` 只返回 schema/status/data schema，不返回路径、标记内容、上次版本或错误；`desktop_set_locale` 仅接受 `zh-CN/en-US`，只作用于 main 的应用自有原生对话框/托盘文案，不接受路径或任意菜单内容。环境命令仍返回固定 schema v1 的六项数据：

- `schemaVersion`
- `runtime`
- `platform`
- `arch`
- `appVersion`
- `debug`

它不返回文件路径、主机名、命令行参数或环境变量。前端严格校验类型、平台和值长度；command reject 或畸形响应只显示统一的“桌面能力不可用”，不渲染原始 IPC 错误。

文件命令不接受前端提供的路径。系统 dialog 只在 Rust 端运行；WebView 获得固定 48 位小写十六进制 token、规范化文件名、MIME 和大小，token 在 backend 中按 window owner 隔离且总数最多 64。项目/预设、输入图片、单图导出和批量 ZIP 的字节上限分别为 64/48/128/256 MiB，主工作区一次最多选择 12 张图；现有 ZIP/图片解码和像素预算仍作为第二层业务校验。二进制通过 raw IPC 传输，写入使用目标目录内临时文件、`sync_all` 后持久化替换。

保存扩展名只追加、不替换用户输入（`report.v2` → `report.v2.png`），已匹配的扩展名保留原样。若应用在原生对话框返回后改了路径，首次写入固定使用 `persist_noclobber`，不依赖 `exists()` 预检查；同名目标（含对话框关闭后新出现的文件）导致 `native-file-exists`，前端仅映射为无路径的 `desktop-file-exists` 并提示重新选择，不覆盖原文件。每个句柄的共享锁在 blocking task 内保护写入策略，成功创建后允许该句柄后续项目保存；失败不授予覆盖权限。未改名且由原生对话框确认的目标、已打开项目的正常保存仍保持覆盖语义。原生确认 UI、所有 OS 文件系统和外部改动冲突仍需独立验收，不能把此局部修复称为完整文件冲突检测。

截图枚举最多返回 16 个显示器和 128 个窗口。Rust 只向 WebView 提供固定 schema、规范化名称、几何、缩放与 48 位随机 token；PID、原生 ID、系统路径和底层错误正文都留在后端。token 按 window owner 隔离、刷新替换、捕获时消费，并在取消/关闭时释放；捕获在分配前限制到 33,177,600 像素，PNG 编码后限制到 48 MiB，以 raw IPC 返回并再次经过前端 PNG 头/尺寸和既有图片校验。截图枚举/捕获由单操作锁串行，防止连续快捷键并发隐藏窗口。

`build.rs` 通过 `AppManifest::commands` 生成 application permission，`main-desktop` capability 只把 15 个 application allow permission 授予 `main` window。新增的截图能力 command 仅返回有限的 backend/status，不提供显示器、会话、路径或原生 ID；图片复制额外只允许 `core:image:allow-from-bytes`、`core:resources:allow-close` 和 `clipboard-manager:allow-write-image`。没有 dialog/fs/global-shortcut/event/menu/window 前端权限，也没有 clipboard read/text/html/clear 权限。快捷键与固定托盘菜单完全在 Rust 注册，只通过自定义 Channel 发送 `capture-primary`；single-instance callback 丢弃第二实例参数/工作目录，只执行 unminimize/show/focus。项目不启用全局 Tauri API、远程 URL capability 或插件默认权限。

生产 CSP 只允许自身、Tauri IPC、内部 asset protocol、已有 `blob:` 图片/Worker 和必要 inline style；`script-src` 额外仅允许 WebAssembly 所需的 `wasm-unsafe-eval`，不允许 `unsafe-eval`。远程 script/connect、frame 和 object 均不允许。原生 drag/drop interception 关闭，保留现有 HTML5 本地图片拖放。

## 构建和验证

```bash
pnpm desktop:web:build
pnpm desktop:check
pnpm desktop:test:rust
pnpm desktop:build
pnpm desktop:test:runtime
pnpm audit:desktop
pnpm audit:desktop:workflow
pnpm desktop:sbom
pnpm audit:desktop:release
```

`desktop:build` 显式使用 `--no-bundle --ci`，只生成原始可执行文件，不生成安装包。Linux runtime smoke 需要 PATH 中存在 `tauri-driver`、`WebKitWebDriver`、`xvfb-run` 和 `dbus-run-session`；测试在隔离 XDG 目录中启动真实 release binary，断言编辑器挂载、Rust IPC 为 ready、桌面页面没有 PWA manifest，验证一层 AVIF/WebP/PNG module Worker/WASM 编码、无授权截图拒绝、图片剪贴板、快捷键/托盘状态和第二实例退出。成功原生 640×480 PNG 与 UI 导入由下述 interactive 模式验证，默认结果为 manual。

桌面审计还会扫描普通 Web 与桌面两份 production 产物：Web 不得包含 Tauri runtime marker，桌面不得包含 manifest 或 Service Worker 注册。

SBOM 必须经 `pnpm desktop:sbom` 运行；脚本使用当前 Node 和 pnpm 提供的 `npm_execpath` 启动 CLI，以兼容 Windows 命令包装文件和带空格的安装路径。依赖查询失败时不生成成功证据。

Phase 9.3 的 embedded WebDriver 只允许存在于 `desktop-test-driver` Cargo feature。runner 完成真实 runtime 后必须 `cargo clean`，再用 `tauri.phase9.conf.json` 从无 feature 状态构建平台 bundle；普通 dependency tree 与 production binary 均不得包含测试 driver。最终包还会检查 ELF/Mach-O/PE 架构、DEB control/payload、macOS Info.plist/app ZIP 或 NSIS payload，检查报告与产物一起进入摘要。CI 只有 `contents: read`，不使用发布 action，也不接触签名凭据。汇总器会重新计算下载产物摘要，并强制所有平台引用同一公开 commit/run attempt；自动 Gate 通过也只产生 `conditional` 结果，人工项未完成时 `releaseReady=false`。

跨平台桌面 Phase 8 已定义独立的 macOS ARM64 与 Intel 签名候选，Phase 9 定义 Windows x64 Authenticode/RFC 3161 候选，Phase 10 又定义 Windows ARM64 候选，Phase 11 定义 Linux x64/arm64 DEB 仓库签名候选，Phase 12 追加内部客户端信任包与密钥生命周期候选，Phase 13 定义五条受保护签名候选的 provenance，Phase 14 定义本地预检与严格 GitHub CLI 验证收据，Phase 15 再定义最终候选重检与收据关联复核，Phase 16 追加候选绑定的平台人工验收记录，Phase 17 追加同 SHA 的跨候选汇总复核，Phase 18 再在完整验收后固定候选外本地审查档案；五条链路都尚未远端运行，也不能扩展本页 Phase 9.3 历史三平台技术 Gate 的适用范围。详见[跨平台桌面 Phase 18](./desktop-cross-platform-phase-18.md)。

Phase 19 在不改变上述适用范围的前提下，将已复核的本地审查档案重新关联到五候选、11 个 attested payload 的 SHA-256 交接清单；它同样没有远端运行、签名或公开发布证据。Phase 20 再固定私有候选 repository ID，并以只读 GitHub API 预检阻断未保护的分支、Actions policy、Environment 或 secret scope。Phase 21 追加 Enterprise Cloud plan 和 selected Actions policy 预检，并将 pnpm bootstrap 收束到仓库内 Corepack action。当前边界见[跨平台桌面 Phase 21](./desktop-cross-platform-phase-21.md)。

## 已知风险和后续阶段

- 后续安全修复候选不能继承旧三平台 Gate：无授权 list/primary 调用会被拒绝；普通选源需先同意原生确认，60 秒内最多截取一个来源；Rust 快捷键/托盘产生 5 秒一次性主屏意图，不提供前端 mint 接口。取消与生成凭据同锁串行，防止旧枚举重新安装授权。
- runtime 默认验证无授权拒绝并将成功截图记录为 `manual`。设置 `SCREENHELLO_DESKTOP_CAPTURE_INTERACTIVE=1` 后，须人工或真实原生 UI 自动化批准两次系统对话框，才运行原生 PNG 与编辑器导入链路；该变量本身不授予截图权限。证据收集仍拒绝缺少成功截图的候选，当前 CI 未接入此原生确认自动化，不能直接宣称新三平台 Gate 通过。
- 专用 `pnpm desktop:build:test-driver` 固定 `SCREENHELLO_TEST_DRIVER_BUILD=runner-only` 及 `src-tauri/target-test-driver`；裸启用 feature 会在 build.rs 失败，测试 binary 还需 `SCREENHELLO_TEST_DRIVER_RUN=runner-only` 才能启动。生产构建使用普通 target，最终 binary/依赖/SBOM 继续拒收 driver。以上是测试防误发门，不是签名或可信用户认证。

- RustSec 对当前 Cargo graph 报告 0 个已知 vulnerability；Tauri Linux GTK3 链仍有 unmaintained INFO，并带入 `glib 0.18.5` 的 `VariantStrIter` unsound INFO。仓库与依赖未调用受影响 API，但正式发布前必须随 Tauri/Wry 更新重新审计。
- 9.1 已接入原生项目打开/保存、图片导入/导出和 PNG 图片剪贴板；操作系统 picker 的可视交互和平台差异仍需 9.3 真机验证。
- 9.2 已在 Linux aarch64 X11/Xvfb 验证基础区域截图、系统集成接线和单实例；Phase 4 已把未授权 IPC 拒绝和有限能力响应接入自动 Gate。真实窗口截图、多显示器/DPI/负坐标、快捷键实际按键、托盘视觉、macOS/Windows 权限、Wayland Portal、远程桌面/无显示器仍待真机矩阵。
- 9.3 在 Windows、macOS、Linux GitHub-hosted 环境运行同一自动 Gate；[ADR 0001](./adr/0001-tauri-desktop-framework.md) 记录 Tauri 选择和退出条件。系统视觉/权限人工项、首发平台、签名、公证、attestation 和正式分发继续留在后续授权。

当前阶段不创建 tag、GitHub Release、deployment、npm publish 或可分发桌面安装包；workflow 产物仅是短期保留的 unsigned test artifact。

后续跨平台工作见[跨平台桌面 Phase 18](./desktop-cross-platform-phase-18.md)：目标矩阵已配置 Linux、macOS、Windows 的 x64/arm64 六个原生候选目标，并要求每个目标留存 codec、截图能力/权限、状态迁移、安装生命周期和无签名候选信任 evidence，但本页的 Phase 9.3 历史证据仍只适用于 Linux x64、macOS ARM64 和 Windows x64。当前六目标配置尚未在远端执行；任何目标都必须先完成自身候选 Gate，不能从本页的三目标结果推导。Phase 8 定义 ARM64 与 Intel macOS 签名候选，Phase 9 追加 Windows x64 Authenticode/RFC 3161 候选，Phase 10 追加 Windows ARM64 Authenticode/RFC 3161 候选，Phase 11 追加 Linux x64/arm64 DEB 仓库签名候选，Phase 12 追加内部客户端信任包与密钥生命周期候选，Phase 13 追加 provenance，Phase 14 追加本地预检和验证收据，Phase 15 追加最终候选重检和收据关联复核，Phase 16 追加候选绑定的平台人工验收记录，Phase 17 追加同 SHA 的跨候选复核，Phase 18 追加完整验收后的候选外审查档案；五条链路均尚未产生签名、公证、时间戳、attestation、公开密钥分发、客户端 rollout、updater 或公开分发证据。

当前交接与远端预检边界由[跨平台桌面 Phase 21](./desktop-cross-platform-phase-21.md)补充：已复核的 Phase 18 档案必须再次关联五个候选和 11 个 attested subject，且清单只能写在 bundle 与审查目录之外；私有候选身份、Enterprise Cloud plan、分支、基础/selected Actions policy、Environment 与 secret scope 还必须通过只读检查。该本地清单和预检仍不能推导签名、公证、时间戳、attestation、公开密钥分发、客户端 rollout、updater 或公开分发证据。

Mac App Store 与 Microsoft Store 是后续独立渠道：当前 macOS APP 不具备 MAS sandbox/profile/签名/隐私/TCC 证据，当前 Windows NSIS 也不是 MSIX。商店 identity、版本、架构、权限、安装、审核和更新链必须分别定义，不能从本轮技术 bundle 外推。
