# 跨平台桌面 Phase 19：候选载荷交接清单

## 状态

> 后续状态：本页中的 schema v20 只说明当时边界。当前契约为 [Phase 24](./desktop-cross-platform-phase-24.md) 的 schema v24：它保留既有 fail-closed 预检，并将 immutable candidate commit 的公开源码快照绑定到 direct-download/APT 交接，仍不改变本页历史结论或 `releaseReady=false`。

本阶段将 `config/desktop-release-matrix.json` 升至 schema v20。在 [Phase 18](./desktop-cross-platform-phase-18.md) 已完成的候选外本地发布审查档案之上，Phase 19 新增一个候选载荷交接清单。它把审查档案重新绑定到五条签名候选中全部 11 个已经 attested 的实际 subject，并再次计算每个 subject 的 SHA-256。

这不是受保护发布 workflow，也不会读取、设置或验证真实凭据。它不会运行签名、公证、时间戳、安装、权限、远端 attestation、上传、tag、Release、部署或商店提交。写入和复核成功时仍固定输出 `releaseReady=false`，也不授权公开发布或部署。

## 输入、载荷与输出边界

Phase 19 只接受一个已通过 Phase 18 复核的标准 bundle 和它的 `desktop-release-review.json`。它不会把无签名 Desktop Release Gate 的技术 evidence 当作签名候选的替代物，也不会用已有本地清单替代候选文件的重新验证。

清单覆盖固定的五个候选目标和 11 个 subject：

| 候选目标 | 载荷数量 | 重新绑定的 subject |
| --- | ---: | --- |
| `macos-arm64` | 1 | ARM64 DMG |
| `macos-x64` | 1 | Intel DMG |
| `windows-x64` | 1 | x64 NSIS installer |
| `windows-arm64` | 1 | ARM64 NSIS installer |
| `linux-deb-repository` | 7 | amd64/arm64 DEB、`Release`、`InRelease`、`Release.gpg` 和 `.gpg`/`.asc` keyring |

清单目录必须已存在、是普通目录，且同时位于 bundle 和 Phase 18 审查目录之外；符号链接、输入目录内输出和已有同名文件都会被拒绝。写入使用独占创建，不会覆盖已有清单。

```text
<bundle>/
  candidates/                         # 五个已重新验证的候选
  reviews/                            # receipt、人工验收记录和 evidence
  cross-platform-acceptance-plan.json

<external-review-dir>/
  desktop-release-review.json          # Phase 18 已复核档案

<external-payload-manifest-dir>/
  desktop-release-payload-manifest.json
```

`desktop-release-payload-manifest.json` 只保存候选相对路径、文件名、字节数和 SHA-256，以及 Phase 18 档案的文件名和 SHA-256；不包含绝对路径、凭据或下载 URL。写入前后都会重新运行 Phase 18 复核，并对每个 candidate receipt 重新关联 attested subject。候选、receipt、人工记录、审查档案或其中任一 subject 在过程中变化都会使操作失败。

## 候选完成后的操作顺序

先完成 Phase 18 的写入和复核，然后使用与 bundle、审查目录分离的既有目录写入清单：

```bash
pnpm desktop:verify-release-payload-manifest -- \
  --write-manifest \
  --bundle-dir /secure/review/screenhello-<candidate-sha>/bundle \
  --review-dir /secure/review/screenhello-<candidate-sha>/release-review \
  --manifest-dir /secure/review/screenhello-<candidate-sha>/payload-manifest
```

交接或人工 release decision 前再次复核：

```bash
pnpm desktop:verify-release-payload-manifest -- \
  --verify-manifest \
  --bundle-dir /secure/review/screenhello-<candidate-sha>/bundle \
  --review-dir /secure/review/screenhello-<candidate-sha>/release-review \
  --manifest-dir /secure/review/screenhello-<candidate-sha>/payload-manifest
```

`verified` 仅表示当前本地清单仍精确匹配当前 bundle 和 Phase 18 档案。它不表示存在真实远端候选，也不能替代受保护 Environment、签名、公证、时间戳、远端 provenance、安装/权限验收、Linux 密钥分发/轮换/撤销、updater 信任链、目标渠道或用户授权。

## 审计与 review

`tests/unit/desktopCrossPlatformAcceptance.test.js` 覆盖完整的五候选/六平台/11 subject 清单、篡改、候选变更、重复写入、bundle 或审查目录内输出、符号链接目录和 CLI 参数冲突。`pnpm audit:desktop:contract`、`pnpm audit:desktop:trust` 和 `pnpm audit:desktop:workflow` 将 schema v20、Phase 19 policy 与触发范围作为 fail-closed 契约检查。

截至本阶段，受保护公开发布 workflow 仍未配置，也没有真实签名候选、远端 attestation、平台人工验收、公开 key 分发或公开发布证据。Phase 19 只把将来经完整复核的候选载荷以可重新校验的形式交接给人工审查。
