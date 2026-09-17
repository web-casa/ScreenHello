# 跨平台桌面 Phase 17：同一候选 SHA 的跨候选人工验收复核

## 状态

> 后续状态：本页中关于旧阶段或旧 schema 的表述只说明当时边界。当前契约为 [Phase 24](./desktop-cross-platform-phase-24.md) 的 schema v24：它保留既有 fail-closed 预检，并将 immutable candidate commit 的公开源码快照绑定到 direct-download/APT 交接，仍不改变本页历史结论或 `releaseReady=false`。

本页记录 Phase 17 当时的 schema v18 契约。后续契约曾由 [Phase 18](./desktop-cross-platform-phase-18.md) 升至 schema v19，并在完整汇总后把当时五份平台记录哈希固定到候选外本地审查档案。Phase 17 本身没有运行受保护 workflow，没有读取、设置或验证真实凭据，也没有产生签名、公证、时间戳、安装、权限、远端 attestation 或公开发布证据。无论单目标或汇总记录的状态如何，工具都固定输出 `releaseReady=false`。

Phase 16 可以分别复核每个候选的人工平台记录，但独立记录本身不能证明五条签名候选来自同一个不可变源码提交。本阶段将五份 provenance receipt、五份平台记录和对应 evidence 重新关联到一个标准 bundle，并要求五个候选的 40 位 immutable SHA 完全相同。

## 标准复核 bundle

`desktop-cross-platform-acceptance.mjs` 只接受以下目录边界。候选目录和每个目标的 review 目录都必须是实际位于 bundle 内的普通目录；路径逃逸、目标目录作为符号链接和把 review 材料放在其他目标目录都会被拒绝。

```text
<bundle>/
  candidates/
    macos-arm64/
    macos-x64/
    windows-x64/
    windows-arm64/
    linux-deb-repository/
  reviews/
    <同一 target>/
      provenance-verification-receipt.json
      platform-acceptance-plan.json
      platform-acceptance-record.json
      evidence/
      trusted-root.jsonl             # 仅离线 receipt 需要
  cross-platform-acceptance-plan.json
```

计划文件只能在 bundle 根目录以独占方式创建，不能写入任意 candidate 或 review 目录。它绑定每个候选的 receipt、provenance verification plan 和 `SHA256SUMS.txt` 哈希，不绑定尚会随人工测试推进而变化的 record；汇总复核时会重新执行 Phase 16 的候选、receipt、plan、record 与 evidence 哈希校验。

五个 candidate target 必须完整出现：`macos-arm64`、`macos-x64`、`windows-x64`、`windows-arm64`、`linux-deb-repository`。它们展开为六个实际平台目标；Linux DEB 仓库候选必须同时覆盖 `linux-x64` 和 `linux-arm64`，不能用任意一个架构代替另一个。

## 首次候选后的操作顺序

先按 [Phase 15](./desktop-cross-platform-phase-15.md) 完成每个候选的本地 provenance receipt 复核，再按 [Phase 16](./desktop-cross-platform-phase-16.md) 填写和复核对应的平台人工记录。将这五套材料按标准目录放入同一个只读 review bundle 后，创建一次汇总计划：

```bash
pnpm desktop:verify-cross-platform-acceptance -- \
  --write-plan \
  --bundle-dir /secure/review/screenhello-<candidate-sha>
```

计划创建会重新验证五份 receipt 和候选清单，并拒绝不同 SHA、缺失 target、候选或 review 目录逃离 bundle，以及已有同名汇总计划。它不联网、不调用 `gh`，也不会写候选内容。

在交接或 release review 前复核完整汇总：

```bash
pnpm desktop:verify-cross-platform-acceptance -- \
  --verify-plan \
  --bundle-dir /secure/review/screenhello-<candidate-sha>
```

若任一 receipt 是离线 trusted-root 模式，工具仅会从该 target 的 `reviews/<target>/trusted-root.jsonl` 重新哈希 root；在线 receipt 不接受该额外 root。汇总结果中的 `crossPlatformAcceptanceComplete=true` 只表示五个当前候选记录都已完整通过、所有 evidence 仍匹配、六个平台目标被覆盖且 candidate SHA 相同。它仍不代表 GitHub Environment、Apple 公证、Windows 时间戳、Linux 公开 key 分发、更新信任根、正式 release 或商店审核已经完成。

## 审计与 review

`tests/unit/desktopCrossPlatformAcceptance.test.js` 覆盖五候选/六平台的同 SHA 汇总、任一未完成记录、离线 trusted root 自动重验证、候选 SHA 不一致、汇总计划篡改、候选变更和 CLI 参数冲突。当前 schema v19 还由 [Phase 18](./desktop-cross-platform-phase-18.md) 在完整通过后固定五份 record 哈希；`pnpm audit:desktop:contract` 与 `pnpm audit:desktop:trust` 将当前 policy 作为 fail-closed 契约检查。

本阶段没有替代真实平台安装、权限、生命周期或签名验证；这些项目仍由相应的受保护环境和人工测试设备执行。
