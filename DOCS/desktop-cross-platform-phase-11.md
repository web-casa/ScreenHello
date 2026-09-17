# 跨平台桌面 Phase 11：Linux DEB APT 仓库签名候选

## 状态

> 后续状态：本页中关于旧阶段或旧 schema 的表述只说明当时边界。当前契约为 [Phase 24](./desktop-cross-platform-phase-24.md) 的 schema v24：它保留既有 fail-closed 预检，并将 immutable candidate commit 的公开源码快照绑定到 direct-download/APT 交接，仍不改变本页历史结论或 `releaseReady=false`。

本页记录 Phase 11 将 `config/desktop-release-matrix.json` 升至 schema v12 时新增的 [Linux DEB Repository Signed Candidate workflow](../.github/workflows/linux-deb-repository-signed-candidate.yml)。后续矩阵曾由 [Phase 12](./desktop-cross-platform-phase-12.md)、[Phase 13](./desktop-cross-platform-phase-13.md)、[Phase 14](./desktop-cross-platform-phase-14.md)、[Phase 15](./desktop-cross-platform-phase-15.md)、[Phase 16](./desktop-cross-platform-phase-16.md)、[Phase 17](./desktop-cross-platform-phase-17.md) 和 [Phase 18](./desktop-cross-platform-phase-18.md) 升至 schema v19，并增加内部客户端信任包、密钥生命周期、受保护签名候选 provenance、最终候选重检、候选目录外验证收据、候选绑定平台人工验收、同 SHA 跨候选复核和完整验收后的候选外记录哈希档案。远端状态仍为 `workflow-ready-not-run`：代码、静态审计和本地临时仓库验证已完成，但没有读取、设置或验证 Linux 签名凭据，没有进入 GitHub Environment，也没有运行远端 workflow、创建公开仓库、tag、GitHub Release、updater 或公开分发。`releaseReady` 继续为 `false`。

该 workflow 只允许 `web-casa` 的私有仓库在 `main` 分支手动明确选择 `sign-linux-deb-repository-candidate` 后运行，并始终 checkout 本次运行的 `github.sha`。全局权限仍只有 `contents: read`。它不修改无签名 Desktop Release Gate：后者继续使用 `--no-sign` 且不读取任何签名凭据。

## 候选链路

1. preflight 从唯一配置来源选择 `linux-x64`（`ubuntu-22.04`、`amd64`）与 `linux-arm64`（`ubuntu-22.04-arm`、`arm64`），在没有凭据的情况下完成 JS、Rust、许可、合同和签名仓库静态检查。
2. 两个原生 runner 分别构建无签名 DEB 输入。每个输入都经现有包身份、版本、原生载荷架构检查、SBOM 和 SHA-256 清单约束，并以 14 天内部 artifact 保存。
3. `linux-repository-signing` Environment 中的 sign job 重新校验两个下载输入的 SHA-256、DEB control 字段和 inspection 记录，确认候选 SHA、目标、二进制架构、包架构、通道和 payload 状态一致后才读取凭据。
4. sign job 用 `apt-ftparchive` 分别生成 `amd64` 和 `arm64` 的 `Packages`/`Packages.gz`，产生带 14 天 `Valid-Until` 的 `Release`，并用同一个 OpenPGP 主密钥生成 `InRelease` 和分离的 `Release.gpg`。DEB 本身没有单独签名；APT 信任边界是覆盖仓库元数据及包摘要的 Release 签名。
5. 当前 workflow 按 [Phase 12](./desktop-cross-platform-phase-12.md) 从独立的只公开 trust home 导出最小化二进制与 ASCII armor keyring，以 `gpgv` 校验两种签名，并在隔离 APT 根目录中用 `signed-by=` 的 keyring 和本地 `file:` 源运行 `apt-get update`。最终候选只保存已验证仓库、公开 keyring、输入证据、`gpgv` 日志、工具版本、验证 JSON 和 SHA-256 清单，保留 14 天。

Debian 的 APT 信任模型要求签署 Release 元数据；`apt-ftparchive` 负责生成索引与 Release 文件，[`apt-secure(8)`](https://manpages.debian.org/bookworm/apt/apt-secure.8.en.html) 和 [`apt-ftparchive(1)`](https://manpages.debian.org/bookworm/apt-utils/apt-ftparchive.1.en.html) 是本链路采用 `InRelease`、分离签名和 `signed-by=` 的依据。工作流不使用已废弃的 `apt-key`。

## Environment 凭据契约

管理员在首次远端候选前需要为私有仓库配置 `linux-repository-signing` Environment 的分支限制与审批规则。Phase 11 的活动签名输入只在该 Environment 的 signing step 中读取以下名称；本文不记录任何值。可选下一把公开键与完整生命周期契约见[Phase 12](./desktop-cross-platform-phase-12.md)：

| 名称 | 类型 | 格式与用途 |
| --- | --- | --- |
| `LINUX_REPOSITORY_SIGNING_PRIVATE_KEY` | Environment secret | 单一 OpenPGP 主私钥导出的 base64；仅经 stdin 导入 runner 临时 `GNUPGHOME`。 |
| `LINUX_REPOSITORY_SIGNING_PASSPHRASE` | Environment secret | 非空单行口令；仅通过 GPG 的 loopback `--passphrase-fd` 交给签名命令。 |
| `LINUX_REPOSITORY_SIGNING_FINGERPRINT` | Environment variable | 40 或 64 位十六进制主密钥 fingerprint；必须与导入的唯一私钥完全一致。 |

GnuPG 的 batch loopback 模式要求显式 `--batch` 和 `--pinentry-mode loopback` 才能从文件描述符接收口令；实现遵循 [GnuPG 手册](https://www.gnupg.org/documentation/manuals/gnupg/GPG-Esoteric-Options.html)。Environment secret 只会在 Environment 保护规则通过后对 job 可用，具体规则由 GitHub 管理员配置；见 [GitHub deployment environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments)。

私钥、口令、临时 GPG home、临时 APT root 和临时仓库均在 job 结束时删除；候选 artifact 不包含私钥或口令。公开 keyring 仅随内部候选 artifact 保存，并不是已发布的密钥分发端点。

## 本地复核与命令

本阶段用临时测试 OpenPGP key 和临时 DEB 仓库实际复现了 `apt-ftparchive → OpenPGP → gpgv → signed-by APT update` 路径。该复核没有使用真实 Linux 凭据，不代表 Ubuntu 22.04 runner、真实 Environment 或公开 APT 端点已经验收。

```bash
pnpm audit:desktop:linux-deb-repository-signed-candidate
pnpm audit:desktop:contract
pnpm audit:desktop:trust
```

静态审计会拒绝自动触发、非私有或非 `main` 条件、未固定 action、在 protected step 外读取 Linux secret、交互式 GPG、`apt-key`、未过滤的架构索引、缺失 `Valid-Until`、不可读仓库、未验证的 `gpgv`/`signed-by` APT 路径、缺少输入或最终 SHA-256 清单，以及任何 tag、Release 或发布操作。Phase 13 额外仅允许签名材料清理后的固定 GitHub attestation action，并对其权限、subject 与证据记录单独 fail-closed 审计；Phase 14 再要求 provenance verification plan 进入 checksum，且拒绝在候选 workflow 内运行 `gh`；Phase 15 还固定最终候选重检和候选外收据的关联复核，Phase 16 再固定候选绑定的平台人工验收记录，Phase 17 再固定同 SHA 的五候选汇总复核，Phase 18 则在验收完整后固定候选外审查档案。

## 尚未完成的边界

- GitHub Environment 的实际保护规则、凭据范围、远端 x64/arm64 打包和签名运行仍没有证据。
- 没有 HTTPS 仓库端点、用户可用的 source list 或公开 keyring 分发。Phase 12 已定义内部候选的轮换和撤销响应契约，但尚未完成远端运行、公开 endpoint、客户端 rollout、轮换或撤销演练；候选 artifact 不能作为公开安装说明。
- 实机安装、升级、卸载、Wayland Portal、权限、多显示器、远程桌面和无显示器验证仍遵循六目标人工矩阵。
- Tauri updater 信任根、公开不可变发布与商店渠道仍分别处于未配置状态；GitHub provenance/attestation 仅为受保护签名候选定义了未运行链路，下载后的本地预检、收据重验证、候选绑定平台人工验收、同 SHA 跨候选复核和候选外审查档案边界详见 [Phase 18](./desktop-cross-platform-phase-18.md)。
