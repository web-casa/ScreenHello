# 跨平台桌面 Phase 3：本地 WASM 编码兼容

## 状态

> 后续状态：本页中关于旧阶段或旧 schema 的表述只说明当时边界。当前契约为 [Phase 24](./desktop-cross-platform-phase-24.md) 的 schema v24：它保留既有 fail-closed 预检，并将 immutable candidate commit 的公开源码快照绑定到 direct-download/APT 交接，仍不改变本页历史结论或 `releaseReady=false`。

本阶段已把桌面编码的源码、构建资产审计和候选 runtime 证据接入六目标 Gate。它不表示任何目标已完成远端候选、安装、签名或公开分发；`config/desktop-release-matrix.json` 仍将全部目标标为 `not-run`。

## 兼容契约

AVIF、WebP 和 PNG 无损编码都使用一层 module Worker 和各自随桌面前端打包的 scalar WASM。Worker 只接受与自身前端 URL 同协议、同 host 的 WASM URL：

- Web 继续支持同一 HTTP(S) host；
- macOS/Linux 的 `tauri://localhost` 可加载同 host 打包资源；
- Windows 的 `http://tauri.localhost` 可加载同 host 打包资源；
- `asset:`、`file:`、`data:`、跨 host、跨端口和含凭据 URL 都会被拒绝。`asset:` 仍只用于受 Tauri 控制的用户文件访问，不能成为 codec 的逃逸通道。

不能用 URL 的 `origin` 比较代替该规则：`tauri:` 的 origin 是 opaque。`src/utils/trustedCodecResourceUrl.js` 因而比较已规范化的协议和 host，并由三个 Worker 共用。

Tauri 的 CSP 为两个 `script-src` 都加入了 `'wasm-unsafe-eval'`，这是 Tauri 对 WebAssembly 的明确要求；没有加入 `'unsafe-eval'`、远程 script source 或更宽的 asset script 权限。参见 [Tauri CSP 文档](https://v2.tauri.app/security/csp/) 和 [平台资源 URL 差异说明](https://github.com/orgs/tauri-apps/discussions/11091)。

## 自动证据

`pnpm audit:desktop:codecs` 检查 `dist-desktop/assets/` 中恰好各有一份 AVIF、WebP、Oxipng WASM 与对应 Worker，检查文件大小边界，并验证每个 Worker 引用了自己的哈希 WASM 名称。它在无 feature 的生产 candidate build 后执行。

`scripts/test-desktop-runtime.mjs` 在真实 Tauri test-driver WebView 中直接启动三个打包 module Worker，分别编码 1×1 RGBA/PNG 输入并校验 AVIF、WebP、PNG 输出容器。runtime 结果只记录格式、成功状态和前端资源协议，不记录本地路径或资源 URL。当前 schema v19 保留 `codecs` 的 runtime/build asset check，并由 Phase 4 追加截图能力和权限边界、Phase 5 追加本地状态迁移检查、Phase 6 追加候选发布信任准备、Phase 7 至 Phase 10 追加 macOS 与 Windows 签名候选、Phase 11 追加 Linux DEB 仓库签名候选、Phase 12 追加内部客户端信任包候选、Phase 13 追加受保护签名候选的 provenance、Phase 14 追加本地预检与验证收据契约、Phase 15 追加最终候选重检与收据关联复核、Phase 16 追加候选绑定的平台人工验收记录、Phase 17 追加同 SHA 跨候选复核、Phase 18 追加候选外本地审查档案；任一格式失败会阻断证据收集。

该 smoke 证明的是本机运行该 candidate 的一层 Worker/WASM 路径。它不替代每个 OS/架构自己的远端 runtime、真实安装、Wayland Portal、权限、DPI、远程桌面或无显示器验收。当前 Tauri 对 Windows packaged nested Worker 仍有公开问题；本项目固定 scalar codec 并只创建一层 codec Worker，但仍须以每个目标的候选结果为准。[相关上游问题](https://github.com/tauri-apps/tauri/issues/15755)

## 本轮本地验证

在当前 Linux aarch64 工作机上，`pnpm desktop:build:test-driver` 后以 `xvfb-run`、隔离 DBus 会话和嵌入式 test-driver 执行 `pnpm desktop:test:runtime` 已通过。真实 Tauri WebView 使用 `tauri:` 前端资源协议，AVIF、WebP 和 PNG 三个 Worker 均完成编码并通过输出容器校验。

这是当前未提交工作树的本地 smoke，不生成可比对的远端候选 SHA，也不会改变六个目标的 `not-run` 状态。

## 本阶段完成条件

- 三个 codec Worker 采用同一严格本地资源 URL 策略，且 CSP 仅增加 WebAssembly 所需 source。
- 桌面生产前端构建、静态 codec asset 审计和真实 WebView codec smoke 都进入 candidate Gate。
- 当前 schema v19 拒绝缺失、伪造或不完整的 codec runtime 结果，并要求候选记录 `trustPolicy` build check；独立 macOS、Windows 和 Linux DEB 仓库签名/客户端信任包/provenance/验证收据/平台人工验收/跨候选复核/候选外审查档案不改变 codec evidence 的范围。
- Phase 2 的六目标、无签名和 `not-run` 支持声明保持不变。

当前 schema v19 保留本页的 codec 检查，并增加独立 macOS、Windows 与 Linux DEB 仓库签名/客户端信任包/provenance/最终候选重检、验证收据、平台人工验收、同 SHA 跨候选复核和候选外审查档案的静态契约。五条签名 workflow 尚未远端运行，不能作为 Worker/WASM、系统权限或安装成功证据。

## 后续阶段

Phase 4 已实现有限截图能力、Wayland 拒绝、macOS Screen Recording 请求边界、Windows GDI 声明；Phase 5 已把非破坏性状态标记和安装生命周期人工项加入 evidence，Phase 6 已固定签名、公证、更新和 provenance 的准备边界。真实 Portal、系统策略、多显示器/负坐标、受控远程桌面、安装、升级、卸载和签名仍待各自验收，详见[跨平台桌面 Phase 6](./desktop-cross-platform-phase-6.md)。
