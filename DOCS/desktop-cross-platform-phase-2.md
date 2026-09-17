# 跨平台桌面 Phase 2：六目标候选构建

## 状态

> 后续状态：本页中关于旧阶段或旧 schema 的表述只说明当时边界。当前契约为 [Phase 24](./desktop-cross-platform-phase-24.md) 的 schema v24：它保留既有 fail-closed 预检，并将 immutable candidate commit 的公开源码快照绑定到 direct-download/APT 交接，仍不改变本页历史结论或 `releaseReady=false`。

本页记录跨平台计划的 Phase 2 实现。六个原生目标、工作流与安装包载荷检查已经配置完成，但本工作树尚未推送，也没有触发远端 GitHub Actions。因此 `config/desktop-release-matrix.json` 中六项的 `evidenceStatus` 均为 `not-run`；它们不表示已经构建、安装、运行或可供下载。

本阶段只产出无签名测试候选的技术门禁。不会创建 tag、GitHub Release、公开下载、自动更新、商店包、签名或公证。

本地 Linux aarch64 探路已成功生成 `ScreenHello_1.0.4_arm64.deb`：DEB metadata 为 `screen-hello` / `1.0.4` / `arm64`，解包后的 `usr/bin/screenhello-desktop` 是 AArch64 ELF。该构建来自未提交工作树，只用于验证本机打包链和载荷检查实现，不能作为当前 Git SHA 的候选证据。

## 候选矩阵与触发范围

| 目标 | 原生 runner | 候选包 | PR Gate | 手动 Gate |
| --- | --- | --- | --- | --- |
| Linux x64 | `ubuntu-22.04` | DEB | 是 | 是 |
| Linux arm64 | `ubuntu-22.04-arm` | DEB | 否 | 是 |
| macOS x64 | `macos-15-intel` | DMG | 否 | 是 |
| macOS arm64 | `macos-14` | DMG | 是 | 是 |
| Windows x64 | `windows-2025` | NSIS | 是 | 是 |
| Windows arm64 | `windows-11-arm` | NSIS | 否 | 是 |

Linux 选择 Ubuntu 22.04 的 x64/arm64 原生 runner，是为了与已声明的最低构建基线一致。macOS 候选改为实际 DMG，而不是把 `.app` 临时压缩为 ZIP。Windows ARM64 的 NSIS 文件名遵循 Tauri 的 `_arm64-setup.exe` 约定。

`.github/workflows/desktop-release-gate.yml` 的 `prepare` job 运行 `scripts/desktop-release-matrix.mjs`。PR 从目标分支的 SHA 读取矩阵，避免 PR 自己修改 JSON/JavaScript 后选择 runner；`workflow_dispatch` 从候选 SHA 读取。PR 输出 `pr` 范围的三项矩阵；手动触发输出 `full` 范围的六项矩阵。工作流本身不再维护另一份静态目标列表，`SCREENHELLO_DESKTOP_GATE_SCOPE` 会传到构建、检查、证据收集和汇总步骤。

## 安装包与候选完整性检查

`pnpm desktop:inspect` 只接受与 `SCREENHELLO_RELEASE_CANDIDATE` 完全相同且工作树干净的提交。这样本地改动或未跟踪文件不能被误记成某个 Git SHA 的候选包。

- Linux：读取 DEB control 元数据，解包到临时目录，验证 `usr/bin/screenhello-desktop` 和所有识别到的 ELF 载荷均为目标架构。
- macOS：只读挂载 DMG，检查唯一的 `ScreenHello.app`、Info.plist 与主可执行文件，并扫描包内 Mach-O 载荷；挂载会在 `finally` 中卸载。
- Windows：验证 NSIS 命名与目录，再用 7-Zip 解出载荷，检查 `screenhello-desktop.exe` 与所有识别到的 PE 载荷。

主可执行文件必须是目标架构的 thin binary。辅助 universal Mach-O 可以存在，但必须包含该目标架构；所有内部路径、符号链接、文件数量、深度和证据文件大小都有边界检查。产物检查报告升级到 schema 2，记录 gate 范围、主载荷路径和已识别 native binary 列表。证据汇总会再次验证这些字段、摘要和 scope，避免 PR 的三项结果被误当作六项完整 Gate。

## 本阶段完成条件

- `desktop-release-matrix.json` schema v19 是六目标、PR 范围、完整范围、codec、截图能力、状态迁移、发布信任准备和独立 macOS、Windows、Linux DEB 仓库签名、客户端信任包、受保护候选 provenance、最终候选重检、本地验证收据、候选绑定平台人工验收、同 SHA 跨候选复核及候选外本地审查档案要求的唯一配置来源；后续证据 schema 的升级不改变 Phase 2 的无签名目标范围。
- 工作流在 PR 与手动触发之间使用不同范围，仍保持只读权限、SHA 固定 action 与无发布操作。
- Linux x64/arm64、macOS x64/arm64、Windows x64/arm64 都使用各自原生 GitHub-hosted runner；没有把交叉编译当作原生验证。
- 产物与证据审计会验证 DMG、DEB 和 NSIS 内的真实 native 载荷架构，而不只检查外部可执行文件或文件名。
- 当前提交的远端候选证据仍待运行；在该证据出现前，不得提升任何 `evidenceStatus` 或支持声明。

当前 schema v19 另定义 ARM64、Intel 两条 macOS 签名候选、Windows x64/ARM64 Authenticode/RFC 3161 候选、Linux 双架构 DEB 仓库签名和内部客户端信任包，以及五条受保护签名候选的 provenance、本地预检、最终候选重检、候选目录外验证收据、候选绑定平台人工验收、同 SHA 跨候选复核和完整验收后的候选外本地审查档案静态约束；它们不改变本页的六目标无签名 Gate、目标范围或 not-run 证据状态。实际签名、公证、时间戳、attestation、仓库、客户端 rollout 和安装结论见后续[Phase 18](./desktop-cross-platform-phase-18.md)。

## 后续边界

下一步是在已提交的候选 SHA 上手动运行完整六目标 Gate，并审阅每个 job 的 codec/截图能力/状态迁移 runtime、包检查、SBOM 和 checksum 证据。之后仍需分别完成真实安装/升级/卸载、Wayland Portal、原生权限、多显示器与远程桌面验收，以及 Phase 6 所列的 macOS 签名/公证、Windows 代码签名和更新信任链。详见[跨平台桌面 Phase 1](./desktop-cross-platform-phase-1.md)、[Phase 3](./desktop-cross-platform-phase-3.md)、[Phase 5](./desktop-cross-platform-phase-5.md)、[Phase 6](./desktop-cross-platform-phase-6.md)和[桌面 PoC](./phase-9-desktop-poc.md)。
