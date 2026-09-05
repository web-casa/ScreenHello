# Phase 9 桌面 PoC

## 当前状态

Phase 9.0 已建立 Tauri 2 桌面壳与最小安全契约；Phase 9.1 接入实例级原生文件与图片剪贴板；Phase 9.2 已接入显示器/窗口/区域截图、固定主屏快捷键、托盘和单实例恢复。桌面端复用现有 React 编辑器、菜单、项目容器、图片校验和导出服务，但使用独立的桌面 HTML/React 入口、`desktopPlatform` 和 `dist-desktop/` 产物；Web 入口继续生成 PWA，library 入口继续保持 `workspace=false` 默认行为。

Phase 9.3 已取得公开候选 `486ba005f374ca2430bad64258452eec117ec49f` 的三平台自动 Gate 通过证据（[Actions run](https://github.com/web-casa/ScreenHello/actions/runs/33949585116)）：Ubuntu 24.04 x64、Windows Server 2025 x64 与 `macos-14` arm64 均完成真实 WebView、640×480 区域 PNG 捕获与编辑器导入、PNG 剪贴板、快捷键注册、托盘创建和第二实例退出，以及无签名 DEB/APP/NSIS、包内检查、CycloneDX SBOM 和 SHA-256 汇总。下载后复算亦通过。截图复审发现 Ubuntu runner 缺中文字库，当前 workflow 已补 `fonts-noto-cjk`，后续候选须使用自身 run 复验。系统文件对话框、真实托盘、多显示器/DPI/负坐标、Wayland/远程桌面/无显示器和权限仍为人工项，`releaseReady=false`。

## 技术基线

- Node.js 24.x、pnpm 10.12.1：前端和构建工具，不进入桌面生产运行时。
- `@tauri-apps/api` 2.11.1、`@tauri-apps/cli` 2.11.4。
- `tauri` 2.11.5、`tauri-build` 2.6.3、`tauri-plugin-dialog` 2.7.3、`tauri-plugin-clipboard-manager` 2.3.3、`tauri-plugin-global-shortcut` 2.3.2、`tauri-plugin-single-instance` 2.4.4、`xcap` 0.9.8、`getrandom` 0.3.4、`tempfile` 3.27.0、Rust 1.77.2+。
- `Cargo.lock` 与 pnpm lockfile 一起提交，直接版本使用精确 pin。
- release profile 启用 LTO、单 codegen unit、`opt-level=s`、abort panic 和 strip；Tauri 按 capability 删除未授权 command。

Linux 构建需要 `libclang-dev`、`libpipewire-0.3-dev` 和 `libgbm-dev`。无安装包 release ELF 体积只用于同平台回归，不代表 Windows/macOS 安装包大小。

界面使用系统字体；Linux 的中文运行/视觉验证环境需提供 CJK 字库，Ubuntu runner 安装 `fonts-noto-cjk`。裸系统缺中文字库会显示方框，不能据此宣称中文视觉验收通过；应用不下载远程字体。

## 安全边界

桌面端暴露 13 个 application command：六个环境/文件命令、四个截图命令和三个有界系统状态/Channel 命令。环境命令仍返回固定 schema v1 的六项数据：

- `schemaVersion`
- `runtime`
- `platform`
- `arch`
- `appVersion`
- `debug`

它不返回文件路径、主机名、命令行参数或环境变量。前端严格校验类型、平台和值长度；command reject 或畸形响应只显示统一的“桌面能力不可用”，不渲染原始 IPC 错误。

文件命令不接受前端提供的路径。系统 dialog 只在 Rust 端运行；WebView 获得固定 48 位小写十六进制 token、规范化文件名、MIME 和大小，token 在 backend 中按 window owner 隔离且总数最多 64。项目/预设、输入图片、单图导出和批量 ZIP 的字节上限分别为 64/48/128/256 MiB，主工作区一次最多选择 12 张图；现有 ZIP/图片解码和像素预算仍作为第二层业务校验。二进制通过 raw IPC 传输，写入使用目标目录内临时文件、`sync_all` 后持久化替换。

截图枚举最多返回 16 个显示器和 128 个窗口。Rust 只向 WebView 提供固定 schema、规范化名称、几何、缩放与 48 位随机 token；PID、原生 ID、系统路径和底层错误正文都留在后端。token 按 window owner 隔离、刷新替换、捕获时消费，并在取消/关闭时释放；捕获在分配前限制到 33,177,600 像素，PNG 编码后限制到 48 MiB，以 raw IPC 返回并再次经过前端 PNG 头/尺寸和既有图片校验。截图枚举/捕获由单操作锁串行，防止连续快捷键并发隐藏窗口。

`build.rs` 通过 `AppManifest::commands` 生成 application permission，`main-desktop` capability 只把 13 个 application allow permission 授予 `main` window。图片复制额外只允许 `core:image:allow-from-bytes`、`core:resources:allow-close` 和 `clipboard-manager:allow-write-image`；没有 dialog/fs/global-shortcut/event/menu/window 前端权限，也没有 clipboard read/text/html/clear 权限。快捷键与固定托盘菜单完全在 Rust 注册，只通过自定义 Channel 发送 `capture-primary`；single-instance callback 丢弃第二实例参数/工作目录，只执行 unminimize/show/focus。项目不启用全局 Tauri API、远程 URL capability 或插件默认权限。

生产 CSP 只允许自身、Tauri IPC、内部 asset protocol、已有 `blob:` 图片/Worker 和必要 inline style；远程 script/connect、frame 和 object 均不允许。原生 drag/drop interception 关闭，保留现有 HTML5 本地图片拖放。

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

`desktop:build` 显式使用 `--no-bundle --ci`，只生成原始可执行文件，不生成安装包。Linux runtime smoke 需要 PATH 中存在 `tauri-driver`、`WebKitWebDriver`、`xvfb-run` 和 `dbus-run-session`；测试在隔离 XDG 目录中启动真实 release binary，断言编辑器挂载、Rust IPC 为 ready、桌面页面没有 PWA manifest，直接校验原生 640×480 PNG，再通过文件菜单/来源对话框导入同一区域，并验证图片剪贴板、快捷键/托盘状态和第二实例退出。

桌面审计还会扫描普通 Web 与桌面两份 production 产物：Web 不得包含 Tauri runtime marker，桌面不得包含 manifest 或 Service Worker 注册。

SBOM 必须经 `pnpm desktop:sbom` 运行；脚本使用当前 Node 和 pnpm 提供的 `npm_execpath` 启动 CLI，以兼容 Windows 命令包装文件和带空格的安装路径。依赖查询失败时不生成成功证据。

Phase 9.3 的 embedded WebDriver 只允许存在于 `desktop-test-driver` Cargo feature。runner 完成真实 runtime 后必须 `cargo clean`，再用 `tauri.phase9.conf.json` 从无 feature 状态构建平台 bundle；普通 dependency tree 与 production binary 均不得包含测试 driver。最终包还会检查 ELF/Mach-O/PE 架构、DEB control/payload、macOS Info.plist/app ZIP 或 NSIS payload，检查报告与产物一起进入摘要。CI 只有 `contents: read`，不使用发布 action，也不接触签名凭据。汇总器会重新计算下载产物摘要，并强制所有平台引用同一公开 commit/run attempt；自动 Gate 通过也只产生 `conditional` 结果，人工项未完成时 `releaseReady=false`。

## 已知风险和后续阶段

- RustSec 对当前 Cargo graph 报告 0 个已知 vulnerability；Tauri Linux GTK3 链仍有 unmaintained INFO，并带入 `glib 0.18.5` 的 `VariantStrIter` unsound INFO。仓库与依赖未调用受影响 API，但正式发布前必须随 Tauri/Wry 更新重新审计。
- 9.1 已接入原生项目打开/保存、图片导入/导出和 PNG 图片剪贴板；操作系统 picker 的可视交互和平台差异仍需 9.3 真机验证。
- 9.2 已在 Linux aarch64 X11/Xvfb 验证基础区域截图、系统集成接线和单实例；真实窗口截图、多显示器/DPI/负坐标、快捷键实际按键、托盘视觉、权限拒绝、Wayland/远程桌面/无显示器仍待真机矩阵。
- 9.3 在 Windows、macOS、Linux GitHub-hosted 环境运行同一自动 Gate；[ADR 0001](./adr/0001-tauri-desktop-framework.md) 记录 Tauri 选择和退出条件。系统视觉/权限人工项、首发平台、签名、公证、attestation 和正式分发继续留在后续授权。

当前阶段不创建 tag、GitHub Release、deployment、npm publish 或可分发桌面安装包；workflow 产物仅是短期保留的 unsigned test artifact。

Mac App Store 与 Microsoft Store 是后续独立渠道：当前 macOS APP 不具备 MAS sandbox/profile/签名/隐私/TCC 证据，当前 Windows NSIS 也不是 MSIX。商店 identity、版本、架构、权限、安装、审核和更新链必须分别定义，不能从本轮技术 bundle 外推。
