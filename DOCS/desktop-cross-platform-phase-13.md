# 跨平台桌面 Phase 13：受保护签名候选的 GitHub provenance

## 状态

> 后续状态：本页中关于后续阶段边界的表述只说明当时状态。当前契约为 [Phase 24](./desktop-cross-platform-phase-24.md) 的 schema v24：它保留既有 fail-closed 预检，并将 immutable candidate commit 的公开源码快照绑定到 direct-download/APT 交接，仍不改变本页历史结论或 `releaseReady=false`。

本阶段把 `config/desktop-release-matrix.json` 升至 schema v14，并为五条既有的受保护签名候选 workflow 增加 GitHub artifact provenance 的静态契约。状态仍是 `workflow-ready-not-run`：没有读取、设置或验证真实凭据，没有进入 GitHub Environment，没有运行远端 workflow，也没有创建 tag、GitHub Release、公开下载、更新端点或商店提交。`releaseReady` 仍为 `false`。

普通的 [Desktop Release Gate](../.github/workflows/desktop-release-gate.yml) 保持全局 `contents: read`、无 job 级写权限、无 OIDC、无 secrets、无签名和无 attestation action。Provenance 只在以下手动、私有仓库 `main`、显式确认、Environment 保护的 `sign` job 中发生：

| 目标 | Workflow | Attestation subject |
| --- | --- | --- |
| macOS ARM64 | [macOS Signed Candidate](../.github/workflows/macos-signed-candidate.yml) | 已验证的 DMG |
| macOS Intel | [macOS Intel Signed Candidate](../.github/workflows/macos-intel-signed-candidate.yml) | 已验证的 DMG |
| Windows x64 | [Windows Signed Candidate](../.github/workflows/windows-signed-candidate.yml) | 已验证的 NSIS installer |
| Windows ARM64 | [Windows ARM64 Signed Candidate](../.github/workflows/windows-arm64-signed-candidate.yml) | 已验证的 NSIS installer |
| Linux DEB repository | [Linux DEB Repository Signed Candidate](../.github/workflows/linux-deb-repository-signed-candidate.yml) | 两个 DEB、`Release`、`InRelease`、`Release.gpg` 与当前二进制/ASCII armor 客户端 keyring |

GitHub 的 [`actions/attest`](https://github.com/actions/attest) 在没有 SBOM 或自定义 predicate 输入时生成 SLSA build provenance。每个 workflow 固定到 `actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6`（v4.2.2），显式列出 subject，关闭 run summary，并且不设置 registry、storage-record、custom predicate 或自定义 token 输入。GitHub 要求 `id-token: write`、`attestations: write` 和 `artifact-metadata: write`；这些权限只存在于上表的 `sign` job，且仍保留 `contents: read`。[官方 action 文档](https://github.com/actions/attest#usage)与[GitHub artifact attestation 概念文档](https://docs.github.com/en/actions/concepts/security/artifact-attestations)是该权限和验证模型的依据。

## 凭据与证据边界

macOS 和 Windows workflow 先完成签名验证，再删除临时 keychain 或 CurrentUser 证书与运行时配置，之后才调用 attestation action。Linux workflow 的 OpenPGP signing step 在退出时销毁所有临时 GnuPG home 和私钥材料，后续 action 才运行。三条清理路径都会在删除失败或发现残留时使该 step 失败；后续 provenance step 使用 GitHub Actions 默认的 `success()` 状态检查，因此不会在清理失败后继续执行。[GitHub 的状态检查语义](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#status-check-functions)是这个阻断边界的依据。Attestation 和记录步骤没有映射任何 `secrets.*` 值。

`actions/attest` 的 `attestation-id`、`attestation-url` 和 runner-local Sigstore bundle 输出由 [`desktop-artifact-provenance.mjs`](../scripts/desktop-artifact-provenance.mjs) 写入候选 artifact：

- `provenance-attestation.bundle.json`：action 生成的 bundle 副本；
- `provenance-attestation.json`：候选 SHA、目标、固定 action、predicate、subject 字节数与 SHA-256、attestation ID/URL、bundle SHA-256 的公开记录；
- `SHA256SUMS.txt`：将以上两个文件与现有签名、包、SBOM 和验证证据一起覆盖；Phase 14 另把 verification plan 纳入其中。

记录脚本拒绝非 40 位候选 SHA、非本仓库 attestation URL、非固定 policy、重复或不完整 subject、符号链接、候选目录外 subject、超限文件，以及既不在 workspace 也不在显式 `$RUNNER_TEMP` 下的 bundle。它不会把真实 key、证书、密码、Environment 名称以外的凭据或 runner 绝对路径写入 artifact。

GitHub 说明公共仓库的 artifact attestation 对所有当前计划可用；私有或内部仓库需要 GitHub Enterprise Cloud，GitHub Enterprise Server 不支持。因此当前 policy 明确保留 `github-enterprise-cloud-plan-pending-verification` blocker。远端首次运行前必须由管理员确认该仓库的实际计划与 Environment 保护；静态代码无法替代该确认。

## 可执行审计

`pnpm audit:desktop:artifact-provenance` 校验五条 workflow 的固定 action SHA、精确 job 权限、受保护 Environment、subject 列表、凭据清理顺序、无 secrets 的记录步骤、Phase 14 verification plan、Phase 15 最终候选重检/收据关联 policy、Phase 16 候选绑定平台人工验收 policy、Phase 17 同 SHA 跨候选复核 policy、Phase 18 候选外审查档案 policy、最终 checksum 和无发布操作。它被以下链路调用：

1. 五条签名候选的 preflight 与 sign 前重检；
2. `pnpm audit:desktop:trust`；
3. 无凭据 Desktop Release Gate 的静态 workflow 审计；
4. 公开仓库完整验证。

`tests/unit/desktopArtifactProvenance.test.js` 用临时非敏感文件验证 bundle 位置、哈希、复制和 fail-closed 输入处理；`tests/unit/desktopArtifactProvenanceCandidateWorkflowAudit.test.js` 覆盖权限、pin、predicate、subject、verification plan、checksum、release 操作、CRLF 与 policy 回归；Phase 14/15 的 local precheck、receipt、最终候选重检和收据关联复核覆盖见 `tests/unit/desktopArtifactProvenanceVerification.test.js`。它们不模拟 GitHub OIDC，不产生真实 attestation。

## 尚未完成的边界

- 没有五条 workflow 的真实远端运行、GitHub attestation ID、Sigstore bundle、签名、公证、时间戳或安装证据。
- 没有确认私有仓库实际具备 GitHub Enterprise Cloud，也没有确认 Environment 审批、组织 secret 范围或 action 许可策略。
- 没有公开 GitHub Release、tag、下载页面、Linux repository HTTPS endpoint、客户端 key 分发、updater trust root 或商店渠道。
- 首次受保护运行后，必须按 [Phase 18](./desktop-cross-platform-phase-18.md) 的本地预检、GitHub 官方验证、候选外收据重验证、候选绑定平台人工验收、同 SHA 跨候选复核和候选外审查档案流程检查各个 candidate artifact 与对应仓库/attestation，再审阅本地 SHA-256 清单和平台安装/权限结果；任何结果只能覆盖本次不可变候选 SHA。
