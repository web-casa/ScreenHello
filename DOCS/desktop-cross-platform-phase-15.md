# 跨平台桌面 Phase 15：候选验证收据的重验证与原子交接

## 状态

> 后续状态：本页中关于旧阶段或旧 schema 的表述只说明当时边界。当前契约为 [Phase 24](./desktop-cross-platform-phase-24.md) 的 schema v24：它保留既有 fail-closed 预检，并将 immutable candidate commit 的公开源码快照绑定到 direct-download/APT 交接，仍不改变本页历史结论或 `releaseReady=false`。

本页记录 Phase 15 当时的 schema v16 收据契约。后续契约曾由 [Phase 18](./desktop-cross-platform-phase-18.md) 升至 schema v19：在收据重验证后增加候选绑定的平台人工验收计划、evidence 复核、同 SHA 跨候选汇总，以及完整验收后的候选外记录哈希档案；它没有运行任何受保护 workflow，也没有读取、设置或验证真实凭据。

Phase 14 已定义下载候选后的本地预检和人工显式 `gh attestation verify`。本阶段补上了该流程的交接闭环：一份候选外收据现在可在之后重新关联到当前候选，而不能只因它看起来像成功 JSON 就被接受。

## 收据 v2 与写入边界

[`desktop-artifact-provenance-verification.mjs`](../scripts/desktop-artifact-provenance-verification.mjs) 生成 schema v2 收据。工具只有在以下步骤全部成功后才以原子、不覆盖的方式创建它：

1. 校验 record、bundle、subject、verification plan 和完整 SHA-256 清单；
2. 对每个 subject 执行固定身份参数的 `gh attestation verify`，并校验 JSON 返回的 basename、SHA-256 与 SLSA predicate；
3. 再次完整校验候选，并比较第一次和第二次的 plan 与清单哈希；两次检查不一致会阻断；
4. 离线模式还会重新哈希候选外 trusted root；根文件发生变化同样阻断；
5. 仅在候选目录外、文件名严格为 `provenance-verification-receipt.json` 的新路径上以独占创建写出收据。

收据包含候选 SHA、目标、plan/attestation 哈希、固定验证身份、每个 subject 的 CLI 输出哈希及最终本地重检标记。它不保存 CLI 原始输出、绝对路径、trusted root 内容或凭据。输出路径已存在、解析到候选目录、符号链接、未列入 checksum 的候选文件和不匹配的收据字段都会 fail-closed。

`gh attestation trusted-root` 的 freshness 仍是人工流程约束：应在离线验证前立即生成。工具能在创建及复核时哈希同一个 root 文件，但不能仅凭文件时间戳证明它在历史运行时一定新鲜。

## 首次远端候选后的交接流程

每个下载并解压的候选先执行本地预检，再由人工显式执行 GitHub CLI。收据目录应按候选隔离，以便五条候选不会争用同一个固定文件名：

```bash
pnpm desktop:verify-provenance -- \
  --verify-local \
  --candidate-dir /secure/candidates/macos-arm64

pnpm desktop:verify-provenance -- \
  --execute-gh \
  --candidate-dir /secure/candidates/macos-arm64 \
  --receipt /secure/review/macos-arm64/provenance-verification-receipt.json
```

审阅、转交或平台人工验收前，重新验证候选与收据。该模式不联网，也不会重新调用 `gh`：

```bash
pnpm desktop:verify-provenance -- \
  --verify-receipt \
  --candidate-dir /secure/candidates/macos-arm64 \
  --receipt /secure/review/macos-arm64/provenance-verification-receipt.json
```

若收据来自离线 trusted-root 验证，复核必须传入同一候选外 root，以便重新计算其哈希：

```bash
pnpm desktop:verify-provenance -- \
  --verify-receipt \
  --candidate-dir /secure/candidates/macos-arm64 \
  --receipt /secure/review/macos-arm64/provenance-verification-receipt.json \
  --offline-trusted-root /secure/review/macos-arm64/trusted_root.jsonl
```

这份本地交接记录只能证明当前候选与一份格式、哈希和固定 policy 都匹配的本地收据。它不能替代 GitHub Enterprise Cloud 可用性、Environment 审批记录、GitHub 的原始 attestation 服务、签名/公证/时间戳、真实安装、权限测试或人工 release 决策。

## 审计与 review

`tests/unit/desktopArtifactProvenanceVerification.test.js` 覆盖在线和离线重验证、receipt/subject 篡改、候选在 CLI 期间变化、trusted root 变化、候选内收据和竞争写入。`pnpm audit:desktop:contract`、`pnpm audit:desktop:trust` 与 `pnpm audit:desktop:artifact-provenance` 将 Phase 15 policy 和当前 schema v19 作为 fail-closed 契约检查；后续人工项目、五候选汇总和候选外审查档案见 [Phase 18](./desktop-cross-platform-phase-18.md)。

首次远端运行前仍须由管理员确认私有仓库的 GitHub Enterprise Cloud 资格、Environment 保护、组织 secret scope 和 action policy。当前代码不读取或输出这些设置或其值。
