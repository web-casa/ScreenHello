# 跨平台桌面 Phase 1：基线与支持契约

## 状态

> 后续状态：本页中关于旧阶段或旧 schema 的表述只说明当时边界。当前契约为 [Phase 24](./desktop-cross-platform-phase-24.md) 的 schema v24：它保留既有 fail-closed 预检，并将 immutable candidate commit 的公开源码快照绑定到 direct-download/APT 交接，仍不改变本页历史结论或 `releaseReady=false`。

本页记录跨平台桌面计划的 Phase 1。它建立版本、目标和验收边界；不代表新增架构已经构建、签名、安装或公开发布。

Phase 1 完成时，当前自动候选 Gate 只覆盖 Linux x64、macOS ARM64 和 Windows x64。历史 Gate 只能说明其对应提交曾通过，后续提交需要自己的候选证据。Phase 2 已把六个原生目标写入候选工作流，Phase 4 已把截图权限边界、Phase 5 已把状态迁移和安装生命周期人工项、Phase 6 已把无签名候选隔离和正式发布信任前提接入候选契约，Phase 11 定义 Linux x64/arm64 DEB 仓库签名候选，Phase 12 补充内部客户端信任包与密钥生命周期候选，Phase 13 定义五条受保护签名候选的 provenance，Phase 14 增加本地预检与严格 GitHub CLI 验证计划，Phase 15 再增加候选外收据的最终候选重检与本地关联复核，Phase 16 将已验证收据绑定到平台人工验收计划、未执行模板和 evidence 复核，Phase 17 再要求五个候选属于同一 immutable SHA 并覆盖六个实际平台目标，Phase 18 再在完整验收后固定候选外记录哈希档案；当前工作树尚无新的远端运行记录，因此所有目标的证据状态仍是 `not-run`；详见[跨平台桌面 Phase 2](./desktop-cross-platform-phase-2.md)、[Phase 6](./desktop-cross-platform-phase-6.md)和[Phase 18](./desktop-cross-platform-phase-18.md)。 

## 版本与配置

桌面发行版本以根目录 `package.json` 的 `version` 为唯一声明来源。`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock` 必须保持相同值；`pnpm audit:desktop:contract` 会拒绝任一处漂移。当前版本为 `1.0.4`。

基础 Tauri 配置继续保持 `bundle.active=false`，避免日常开发意外生成安装包。`src-tauri/tauri.phase9.conf.json` 仅用于当前无签名候选 Gate 打开 bundling。直发签名配置、商店配置和自动更新配置尚未创建，以免把未验收渠道伪装成可用能力。

## 六目标支持契约

| 系统 | 架构 | 当前状态 | 原生 runner | Beta 包格式 |
| --- | --- | --- | --- | --- |
| Linux | x64 | `candidate-gated` / `not-run` | `ubuntu-22.04` | DEB |
| Linux | arm64 | `candidate-gated` / `not-run` | `ubuntu-22.04-arm` | DEB |
| macOS | x64 | `candidate-gated` / `not-run` | `macos-15-intel` | DMG |
| macOS | arm64 | `candidate-gated` / `not-run` | `macos-14` | DMG |
| Windows | x64 | `candidate-gated` / `not-run` | `windows-2025` | NSIS |
| Windows | arm64 | `candidate-gated` / `not-run` | `windows-11-arm` | NSIS |

目标 ID 只描述系统和架构。它不再把 macOS runner 版本编码进 ID，因此 runner 升级不会改变产物、证据或支持身份。

`candidate-gated` 表示无签名候选工作流已定义该目标；`not-run` 表示当前提交尚无该目标的远端证据。二者都不等于当前提交、公开 Beta 或稳定版已通过。每个目标的原生文件选择器、托盘、多显示器/DPI、远程桌面和无显示器检查仍保留为人工或受控环境项。

## Linux 支持边界

公开 Beta 的最低 Linux 构建基线计划为 Ubuntu 22.04 或 Debian 12，运行验证计划覆盖 Ubuntu 22.04、Ubuntu 24.04 和 Debian 12。现有 Ubuntu 24.04 候选 Gate 不能替代该最低基线的构建或运行证据。

X11 与 Wayland 均处于原生验证计划中。Phase 4 已在 Wayland 会话返回 `portal-required` 并拒绝窗口枚举，避免把 xcap 的后备路径写成支持；真正的 ScreenCast Portal/权限流程和 GNOME/KDE 会话验证仍待完成。X11 的 `ready` 能力结果同样不替代真实显示器、DPI 或远程桌面验收。

## 已知前置项

- 桌面 WASM 编码的源码兼容与候选 Gate 已在 Phase 3 接通；远端六目标 runtime 仍未执行，不能由本地或旧候选外推。见[跨平台桌面 Phase 3](./desktop-cross-platform-phase-3.md)。
- macOS 直发需要签名、公证和 stapling；Windows 直发需要代码签名。签名凭据只能在受保护的发布环境使用。
- 当前候选安装包是短期保留的无签名测试产物。它们不能作为公开下载、自动更新、Mac App Store 或 Microsoft Store 的证据。

## Phase 1 完成条件

- `config/desktop-release-matrix.json` schema v19 定义六个系统×架构目标、PR 范围、完整范围、codec/截图能力/状态迁移 runtime 证据、发布信任准备，以及独立 macOS、Windows、Linux DEB 仓库签名、客户端信任包、provenance、最终候选重检、验证收据、候选绑定平台人工验收、同 SHA 跨候选复核和候选外本地审查档案的当前证据状态。
- `pnpm audit:desktop:contract` 验证版本、应用标识、配置边界、六目标和 Linux 支持政策。
- 候选工作流、产物检查和证据审计按 `candidateGate.prTargetIds` 或 `candidateGate.targetIds` 选择范围，不会把未运行目标误报为已验证。
- 目标架构检查覆盖 ELF、Mach-O 和 PE 的 x64/ARM64 头部识别。

当前配置已由 [Phase 18](./desktop-cross-platform-phase-18.md) 升至 schema v19：无签名六目标范围不变，另有仅供私有 main 手动触发的 macOS ARM64/Intel、Windows x64/ARM64 和 Linux 双架构 DEB 仓库签名、内部客户端信任包、GitHub provenance、最终候选重检、候选目录外验证收据、其绑定的平台人工验收契约、同 SHA 的跨候选复核及完整验收后的候选外记录哈希档案。五条 workflow 尚未远端运行，不能改变本页的候选或人工验收结论。

## 下一阶段

Phase 2 已配置六目标原生候选构建与包内检查，Phase 3 已接通桌面 codec，Phase 4 已接通截图权限边界，Phase 5 已接通状态迁移，Phase 6 已接通当时 schema v7 的发布信任准备，Phase 7 至 Phase 10 依次增加 macOS ARM64、macOS Intel、Windows x64 和 Windows ARM64 签名候选，Phase 11 定义 Linux x64/arm64 DEB 仓库签名候选，Phase 12 将当时合同升至 schema v13 并定义内部客户端信任包与密钥生命周期候选，Phase 13 定义五条受保护签名候选的 provenance，Phase 14 定义本地预检、严格 GitHub CLI 验证计划和候选目录外收据，Phase 15 要求最终候选重检与收据关联复核，Phase 16 要求候选绑定的平台人工验收计划、未执行模板和 evidence 复核，Phase 17 要求同一 immutable SHA 的跨候选复核，Phase 18 再将当前合同升至 schema v19 并固定完整验收后的候选外记录哈希档案；当前仍待远端候选证据。真实 Portal/系统权限、安装升级/卸载和正式签名门禁仍分别独立。
