# 跨平台桌面 Phase 18：候选绑定的本地发布审查档案

## 状态

> 后续状态：本页中的 schema v19 只说明当时边界。当前契约为 [Phase 24](./desktop-cross-platform-phase-24.md) 的 schema v24：它保留既有 fail-closed 预检，并将 immutable candidate commit 的公开源码快照绑定到 direct-download/APT 交接，仍不改变本页历史结论或 `releaseReady=false`。

本阶段将 `config/desktop-release-matrix.json` 升至 schema v19。它在 Phase 17 的五候选、六平台汇总复核之后，新增一个仅本地使用的发布审查档案：档案固定当次汇总计划和每份平台人工记录的 SHA-256，且只能在所有人工验收项已通过时创建。

这不是发布 workflow，也不读取、设置或验证真实凭据。它没有运行受保护 workflow、签名、公证、时间戳、安装、权限、远端 attestation、上传、tag、Release、部署或商店提交。无论档案写入或复核是否成功，工具始终输出 `releaseReady=false`。

## 输入与边界

Phase 18 只消费已通过 [Phase 17](./desktop-cross-platform-phase-17.md) 复核的标准 bundle。它不会把无签名 Desktop Release Gate 的技术 evidence 当作签名候选的替代物：即使两条链路引用同一提交，它们仍是不同的构建和信任链。

审查档案必须位于 bundle 外一个已存在的普通目录中；目标目录、符号链接、bundle 内输出和已有同名文件都会被拒绝。

```text
<bundle>/
  candidates/                         # Phase 17 已复核的五个候选
  reviews/                            # receipt、平台计划、记录和 evidence
  cross-platform-acceptance-plan.json

<external-review-dir>/
  desktop-release-review.json
```

档案不写入候选、不含绝对路径、不含凭据。内容绑定以下稳定事实：

- 同一个 40 位 immutable candidate SHA；
- `cross-platform-acceptance-plan.json` 的 SHA-256；
- 五份 `platform-acceptance-plan.json` 和五份 `platform-acceptance-record.json` 的 SHA-256；
- 五个候选、六个平台和全部已通过的人工检查计数；
- 当前仍未配置的公开发布 workflow、updater 信任根/endpoint/轮换和商店渠道状态。

Phase 17 的汇总计划刻意不绑定仍可能随人工测试推进而变化的 record；Phase 18 正是在所有检查完成后将这些 record 哈希冻结到一次可交接的本地审查档案中。

## 候选完成后的操作顺序

先完成每个候选的 provenance receipt、平台人工记录及 Phase 17 汇总复核。只有 `crossPlatformAcceptanceComplete=true` 且 `completedChecks` 等于 `totalChecks` 时，才创建外部档案：

```bash
pnpm desktop:verify-release-review -- \
  --write-review \
  --bundle-dir /secure/review/screenhello-<candidate-sha>/bundle \
  --review-dir /secure/review/screenhello-<candidate-sha>/release-review
```

写入前工具会完整重跑 Phase 17 的本地候选、receipt、plan、record 和 evidence 哈希复核；写入前后再次比较结果，以避免候选或记录在审查过程中变化。输出使用独占创建，因此同一目录的既有档案不会被覆盖。

交接或人工 release decision 前再次复核：

```bash
pnpm desktop:verify-release-review -- \
  --verify-review \
  --bundle-dir /secure/review/screenhello-<candidate-sha>/bundle \
  --review-dir /secure/review/screenhello-<candidate-sha>/release-review
```

复核会重新验证整个 Phase 17 bundle，比较档案中的汇总计划和五份 record 哈希，并在候选、evidence、record 或档案本身变化时失败。`verified` 只表示当前本地档案仍匹配当前 bundle；它不授予公开发布或部署权限。

## 审计与 review

`tests/unit/desktopCrossPlatformAcceptance.test.js` 覆盖完整档案、未完成人工项、bundle 内输出、符号链接目录、记录或档案变更、重复写入和 CLI 参数冲突。`pnpm audit:desktop:contract` 与 `pnpm audit:desktop:trust` 将 schema v19、Phase 18 policy 和 `releaseReady=false` 作为 fail-closed 契约检查。

公开发布前仍需要单独确认受保护 Environment、签名/公证/时间戳、远端 provenance、真实安装和权限、Linux key 分发/轮换/撤销、updater 信任链、目标渠道及用户授权。后续 [Phase 19](./desktop-cross-platform-phase-19.md) 在不改变这些前置条件的前提下，把本档案重新绑定到 11 个 attested payload 的本地交接清单。
