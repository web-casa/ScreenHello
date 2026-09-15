# 跨平台桌面 Phase 20：私有候选身份与 GitHub 配置预检

## 状态

> 后续状态：本页中的 schema v21 只说明当时边界。当前契约为 [Phase 24](./desktop-cross-platform-phase-24.md) 的 schema v24：它保留既有 fail-closed 预检，并将 immutable candidate commit 的公开源码快照绑定到 direct-download/APT 交接，仍不改变本页历史结论或 `releaseReady=false`。

本阶段将 `config/desktop-release-matrix.json` 升至 schema v21。它为受保护签名候选增加私有 GitHub 仓库身份和远端配置的只读、fail-closed 预检；任何结果都固定为 `releaseReady=false` 和 `publicRelease=false`。

公开源码不保存私有候选仓库名称。候选 workflow 通过不可变的 `github.repository_id` 与私有仓库、`main` 分支和显式确认值共同约束签名 job；候选的完整仓库名只在下载候选中的 GitHub attestation URL 或操作员提供的命令参数中取得。本地 provenance 验证在调用 `gh attestation verify` 前，先用只读 `gh api repos/<候选仓库> --jq .id` 确认它与固定 numeric repository ID 相同。这样仓库改名不会放宽身份检查，公开导出也不会携带私有仓库名称。

GitHub 将 `github.repository_id` 作为字符串 context 提供给 workflow，因此 workflow 中的比较同样使用字符串值。[GitHub Actions contexts 文档](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts)

本阶段不读取 secret 值，不导入证书，不触发 workflow，不执行签名、公证、时间戳、上传、tag、Release、部署或商店提交。

## 预检项目

`desktop:verify-github-readiness` 仅以 `gh api --method GET` 获取下列元数据，不输出 API 响应体或 secret 值。Environment、organization secret 和 selected-repository scope 的列表会分页读取并合并，避免组织配置超过单页上限时误判为缺失：

| 项目 | 通过条件 |
| --- | --- |
| 候选仓库 | 操作员提供的 `<owner>/<repository>` 是私有仓库，默认分支为 `main`，numeric ID 与固定 policy 一致 |
| workflow 默认权限 | `read` |
| Actions policy | Actions 已启用、只允许 selected actions，并启用 SHA pinning |
| `main` | GitHub API 报告为受保护分支 |
| 三个 signing Environment | `macos-signing`、`windows-signing` 和 `linux-repository-signing` 都存在，至少一名 reviewer、禁止 self-review，并只允许受保护分支部署 |
| 组织 secret scope | 每个所需 secret 都是仅私有仓库可用，或 selected scope 中明确包含该仓库 ID |

Environment 保护与部署分支规则由 GitHub environment 配置控制；secret inventory 与 selected-repository scope 由 GitHub Actions secrets API 返回。[Environments API](https://docs.github.com/en/rest/deployments/environments) [Actions secrets API](https://docs.github.com/en/rest/actions/secrets)

macOS policy 只要求 `APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_ID`、`APPLE_TEAM_ID` 和 `MACOS_CERTIFICATE_P12_BASE64`。P12 当前明确无密码，workflow 将它映射为一次性的空 P12 import 密码，不新增或猜测 P12 password secret。Windows 和 Linux policy 仍分别要求其签名证书/密码及 OpenPGP 私钥/口令 secret。

## 操作命令

管理员或具备相应只读权限的操作员在私有候选仓库环境运行：

```bash
pnpm desktop:verify-github-readiness -- \
  --verify-github \
  --repository <private-candidate-repository>
```

该命令会输出各项 `passed`、`failed` 或 `unverified`，任何非 `passed` 项都会以非零状态退出。`unverified` 是安全阻断，不可解释为 secret 缺失或配置错误；例如 token 无权读取组织 secret inventory 时，预检只能报告其 scope 尚未验证。

首次签名候选前，仍需要管理员在 GitHub 中完成相应 Environment、组织 secret scope、Actions policy 与分支保护配置。这个预检只能验证已读取到的配置，不能代替真实签名、远端 provenance、平台人工验收、公开密钥分发、updater 信任链、目标渠道或用户授权。

## 2026-09-14 只读结果

对实际私有候选仓库执行的只读预检确认了候选仓库身份和 `read` workflow 默认权限。它同时 fail-closed 地发现 Actions policy 仍允许所有 actions、未启用 SHA pinning、`main` 未受保护，且三个 signing Environment 尚不存在。

当前授权 token 无权读取组织 secret inventory，因此三个 organization-secret-scope 检查均为 `unverified`。这不说明 secret 缺失，也没有读取其值。结果为 `blocked`，不会解锁签名 workflow 或公开发布。

## Review 与验证

`tests/unit/desktopReleaseGitHubReadiness.test.js` 覆盖私有仓库 ID、分支、Actions policy、Environment、selected secret scope、权限不足、分页合并和只读 argument vector。provenance 测试还覆盖 attestation URL 导出的仓库名与固定 repository ID 不符时，在执行 attestation 验证前失败。

`pnpm audit:desktop:contract`、`pnpm audit:desktop:trust`、`pnpm audit:desktop:workflow` 和五条签名 workflow 审计把 schema v21、numeric 身份条件、公开导出边界和 `releaseReady=false` 作为静态契约检查。
