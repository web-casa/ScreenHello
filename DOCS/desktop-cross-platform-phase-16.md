# 跨平台桌面 Phase 16：候选绑定的平台人工验收记录

## 状态

> 后续状态：本页中关于旧阶段或旧 schema 的表述只说明当时边界。当前契约为 [Phase 24](./desktop-cross-platform-phase-24.md) 的 schema v24：它保留既有 fail-closed 预检，并将 immutable candidate commit 的公开源码快照绑定到 direct-download/APT 交接，仍不改变本页历史结论或 `releaseReady=false`。

本页记录 Phase 16 当时的 schema v17 契约。后续契约曾由 [Phase 18](./desktop-cross-platform-phase-18.md) 升至 schema v19：Phase 17 新增五候选同一 immutable SHA 的跨候选人工验收复核，Phase 18 在完整通过后固定五份 record 哈希。Phase 16 本身没有运行受保护 workflow，没有读取、设置或验证真实凭据，也没有产生签名、公证、时间戳、安装、权限、远端 attestation 或公开发布证据；`releaseReady` 继续为 `false`。

Phase 15 已能把下载候选与 GitHub CLI 验证收据重新关联，但“实际在什么系统和架构上完成安装、权限与生命周期项目”仍只能由人工记录。本阶段新增候选绑定的计划、未执行模板和本地证据复核，避免把一份未关联候选或可被修改的截图/日志当作平台验收结果。

## 本地验收契约

[`desktop-platform-acceptance.mjs`](../scripts/desktop-platform-acceptance.mjs) 在每次写计划、写模板或复核记录前，都调用 Phase 15 的本地收据重验证。计划和记录均须在候选目录外使用固定文件名、独占创建：

- `platform-acceptance-plan.json`：把已验证候选、收据哈希和需人工验收的项目固定下来；
- `platform-acceptance-record.json`：人工填写的结果；模板初始全部为 `not-run`；
- evidence 目录：候选目录外的普通文件。通过项至少附一份带相对文件名、媒体类型、字节数和 SHA-256 的证据；失败或未运行项须有简短原因。

工具只接受 `.png`、`.jpg`/`.jpeg`、`.webp`、`.txt`、`.log`、`.json`、`.pdf`、`.mp4` 和 `.mov` 证据。它会拒绝符号链接、路径逃逸、哈希或媒体类型不匹配、计划/收据/记录/trusted root 被错误复用为人工证据，以及候选、计划、记录或证据在复核过程中发生变化。

macOS 与 Windows 候选各生成其单一架构的七项人工检查。Linux DEB 仓库候选同时展开为 `linux-x64` 和 `linux-arm64` 两组检查，不能只用一个架构的安装结果覆盖另一架构。

## 首次候选后的操作顺序

先完成 Phase 15 的候选和收据复核。以下命令会再次执行同一份本地复核，不联网且不会调用 `gh`：

```bash
pnpm desktop:verify-platform-acceptance -- \
  --write-plan \
  --candidate-dir /secure/candidates/macos-arm64 \
  --receipt /secure/review/macos-arm64/provenance-verification-receipt.json \
  --plan /secure/review/macos-arm64/platform-acceptance-plan.json

pnpm desktop:verify-platform-acceptance -- \
  --write-record-template \
  --candidate-dir /secure/candidates/macos-arm64 \
  --receipt /secure/review/macos-arm64/provenance-verification-receipt.json \
  --plan /secure/review/macos-arm64/platform-acceptance-plan.json \
  --record /secure/review/macos-arm64/platform-acceptance-record.json
```

验收人员随后只填写实际发生的系统/硬件摘要、时间、每项结果和证据元数据；不要写入用户名、设备序列号、路径、凭据或未脱敏内容。`passed` 仅用于已经在该目标系统和架构上完成且有证据的项目；`failed`、`not-run` 必须保留真实原因。模板本身是可验证的未完成记录，不是通过结果。

交接、人工 release review 或再次测试前复核候选、收据、计划、记录和 evidence：

```bash
pnpm desktop:verify-platform-acceptance -- \
  --verify-record \
  --candidate-dir /secure/candidates/macos-arm64 \
  --receipt /secure/review/macos-arm64/provenance-verification-receipt.json \
  --plan /secure/review/macos-arm64/platform-acceptance-plan.json \
  --record /secure/review/macos-arm64/platform-acceptance-record.json \
  --evidence-dir /secure/review/macos-arm64/evidence
```

离线 trusted-root 收据需在三条命令中附加同一候选外的 `--offline-trusted-root <路径>`，以重新计算 root 哈希。

`--verify-record` 的 `acceptanceComplete=true` 仅表示这份候选绑定记录的所有必填人工项均声明为通过且证据当前匹配。它不代表 GitHub Environment、Apple 公证、Windows 时间戳、Linux 公开 key 分发、更新信任根、正式 release 或任何商店审核已经完成；工具始终输出 `releaseReady=false`。

## 审计与 review

`tests/unit/desktopPlatformAcceptance.test.js` 覆盖 macOS 单架构和 Linux 双架构计划、未完成模板、候选变化、候选内输出、路径逃逸、证据篡改、控制文件复用、CLI 选项冲突及 `releaseReady=false`。`pnpm audit:desktop:contract` 和 `pnpm audit:desktop:trust` 将 Phase 16 的历史 policy 及当前 schema v19 契约作为 fail-closed 检查；五候选汇总和候选外记录哈希档案见 [Phase 18](./desktop-cross-platform-phase-18.md)。

实际受保护运行、真实安装和权限/生命周期验收仍由管理员和对应平台测试环境执行；本阶段只提供可复核的本地交接格式，不替代这些外部步骤。
