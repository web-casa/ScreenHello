# 跨平台桌面 Phase 14：候选 provenance 的本地预检与验证收据

## 状态

> 后续状态：本页中关于旧阶段或旧 schema 的表述只说明当时边界。当前契约为 [Phase 24](./desktop-cross-platform-phase-24.md) 的 schema v24：它保留既有 fail-closed 预检，并将 immutable candidate commit 的公开源码快照绑定到 direct-download/APT 交接，仍不改变本页历史结论或 `releaseReady=false`。

本阶段将 `config/desktop-release-matrix.json` 升至 schema v15。五条受保护签名候选 workflow 在已有 GitHub SLSA provenance 记录之后，写入 `provenance-verification-plan.json`，再把它纳入 `SHA256SUMS.txt`。状态仍是 `workflow-ready-not-run`：没有读取、设置或验证真实凭据，没有进入 GitHub Environment、运行远端 workflow、生成真实 attestation、签名、公证、时间戳、安装证据、tag、Release、公开下载或更新端点；`releaseReady` 仍为 `false`。

该阶段只准备首次受保护运行后的验证链路。候选 workflow 不执行 `gh`，不把任何 GitHub CLI 凭据、trusted root 或验证收据写回候选 artifact。

> 后续阶段曾由 [Phase 18](./desktop-cross-platform-phase-18.md) 升至 schema v19：Phase 15 的收据会在写入前重新校验候选，之后可在不联网、不重跑 `gh` 的情况下重新关联候选与收据；Phase 16 再把该收据绑定到平台人工验收计划、未执行模板和 evidence 复核，Phase 17 要求五候选同一 immutable SHA 的汇总复核，Phase 18 在完成后固定当时 record 哈希。本页保留 Phase 14 当时 schema v15 的历史边界。

## 候选 artifact 内的计划

[`desktop-artifact-provenance-verification.mjs`](../scripts/desktop-artifact-provenance-verification.mjs) 从已经写入的 `provenance-attestation.json` 构造计划；下载后运行本地预检时，它会重新读取、流式哈希并 fail-closed 校验以下项目：

- 目标、候选提交 SHA、受保护 workflow、job、Environment 和固定 `actions/attest` policy；
- 每一个 attested subject 的路径、默认 basename、大小和 SHA-256；固定的 `actions/attest` 版本以 `subject-path` 创建 subject 时使用文件 basename，因此收据同时核对该名称与 SHA-256；Linux repository 的两个 DEB 与五份 Release/keyring subject 分别校验；
- runner 生成并已复制到候选目录的 Sigstore bundle、attestation ID/URL 和其 SHA-256；
- `SHA256SUMS.txt` 的所有条目，以及 record、bundle、verification plan 和每个 subject 必须都在清单中；除清单本身以外，候选目录不得有未校验的普通文件或符号链接。

计划将每个 subject 的 GitHub CLI 参数写成数组，不拼接 shell 命令。它固定以下验证策略：

- 从 attestation URL 导出的 `--repo` 与 `--signer-repo`，并在验证前以 GitHub repository ID 只读复核其身份；
- 对应的 `.github/workflows/*-signed-candidate.yml` 的 `--signer-workflow`；
- `--source-digest` 为 immutable main candidate SHA、`--source-ref refs/heads/main`；
- `--predicate-type https://slsa.dev/provenance/v1`、候选内 `--bundle`、`--deny-self-hosted-runners`、`--no-public-good` 与 `--format json`。

GitHub CLI 将这些 identity 和 predicate 作为 attestation 验证的一部分；官方 CLI 文档也说明，指定 signer workflow 能收紧 Actions 产生者身份检查。[`gh attestation verify`](https://cli.github.com/manual/gh_attestation_verify)

## 首次远端候选后的操作

从 GitHub 下载并解压单个候选 artifact 后，在本仓库 checkout 的根目录执行本地预检。它不会联网，也不会调用 `gh`：

```bash
pnpm desktop:verify-provenance -- \
  --verify-local \
  --candidate-dir /absolute/path/to/signed-candidate
```

预检通过后，才可由人工显式执行在线验证。收据路径必须位于候选目录外；工具只在每个 `gh attestation verify` 返回成功且 JSON 中包含对应 subject 的已验证 SHA-256 时写出收据。收据只保留严格参数、候选/bundle/plan 哈希和 CLI 输出哈希，不保存 CLI 原始输出、绝对候选路径、trusted root 内容或凭据。

```bash
pnpm desktop:verify-provenance -- \
  --execute-gh \
  --candidate-dir /absolute/path/to/signed-candidate \
  --receipt /secure/review/provenance-verification-receipt.json
```

离线计划中的 trusted-root 参数是占位符。离线验证前，按 GitHub 的流程临近验证时重新生成 trusted root，并将它保存在候选目录外；显式工具调用会使用该外部文件的实际路径。GitHub 明确提示 trusted root 不会过期，密钥可能轮换，因此不能把旧 root 当作长期有效证据。[离线验证文档](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline)

```bash
gh attestation trusted-root > /secure/review/trusted_root.jsonl

pnpm desktop:verify-provenance -- \
  --execute-gh \
  --candidate-dir /absolute/path/to/signed-candidate \
  --offline-trusted-root /secure/review/trusted_root.jsonl \
  --receipt /secure/review/provenance-verification-receipt.json
```

私有或内部仓库的 GitHub artifact attestation 需要 GitHub Enterprise Cloud，并使用 GitHub 的 Sigstore 实例；首次运行前仍必须由管理员确认仓库计划、Environment 保护和组织 action policy。[GitHub artifact attestation 概念文档](https://docs.github.com/en/actions/concepts/security/artifact-attestations)

## 审计与 review

`pnpm audit:desktop:artifact-provenance` 现在还拒绝缺少 verification-plan step、未将 plan 纳入 checksum、在候选 workflow 内执行 `gh attestation`、向 plan step 映射 secret 或传入 `--execute-gh`、`--offline-trusted-root`、`--receipt` 参数的改动。它也检查 plan 位于 provenance record 与 checksum 之间。

`tests/unit/desktopArtifactProvenanceVerification.test.js` 使用非敏感临时文件覆盖 macOS 单 subject、Linux 七 subject、bundle/record/plan/checksum 篡改、严格 GH 输出、在线/离线收据和 CLI mode 解析。`tests/unit/desktopArtifactProvenanceCandidateWorkflowAudit.test.js` 覆盖 workflow 顺序与越权回归。

本阶段 review 发现并修正了一处离线路径边界：trusted root 不能随候选 artifact 写入，也不能让候选目录中的同名文件替代它。计划使用明确占位符，显式执行时才以校验过的候选目录外文件的绝对路径替换该参数，并把该文件的哈希写入本地收据。

## 尚未完成的边界

- 本地预检和计划本身不验证 Sigstore 签名；只有显式 `gh attestation verify` 的成功结果才形成收据。
- 没有真实五目标远端运行、GitHub attestation ID、真实 bundle、GitHub Enterprise Cloud 确认、Environment 审批、签名、公证、时间戳或平台安装/权限结果。
- 没有公开 GitHub Release、tag、下载页、Linux repository HTTPS endpoint、客户端 key 分发、updater trust root 或商店渠道。
- 每份收据只适用于其中的 immutable candidate SHA，不能推导到另一个提交、重建产物或平台。
