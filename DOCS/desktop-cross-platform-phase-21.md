# 跨平台桌面 Phase 21：Enterprise Cloud 前提与第一方 Actions 供应链

## 状态

本阶段将 `config/desktop-release-matrix.json` 升至 schema v22。它把受保护私有签名候选所需的 GitHub Enterprise Cloud entitlement、精确的 selected Actions policy，以及仓库内固定版本的 pnpm bootstrap 写入 fail-closed 契约。所有路径继续固定 `releaseReady=false` 与 `publicRelease=false`。

本阶段没有修改 GitHub 远端设置、读取 secret 值、进入 Environment、触发签名 workflow，或创建签名、公证、时间戳、attestation、Release、部署和公开下载。

> 后续状态：Phase 22 已进一步将 Corepack home 限制在每个 job 的随机 `RUNNER_TEMP` 目录，并禁用项目控制的 Corepack env；Phase 23 固定 direct-download installer 与 Linux APT sidecar 的不同发布角色，Phase 24 再绑定 immutable candidate commit 的公开源码快照。当前实现边界见 [Phase 24](./desktop-cross-platform-phase-24.md)。这些后续强化不改变本页 schema v22 的历史结论或 `releaseReady=false`。

## 第一方 Actions 策略

所有八个 workflow 已移除 `pnpm/action-setup`。每个需要 pnpm 的 job 都先用 SHA 固定的 `actions/setup-node` 选择 Node 24，再调用仓库内的 [Corepack action](../.github/actions/setup-pnpm/action.yml)。该 action 在 Linux/macOS 使用 bash、在 Windows 使用 pwsh 创建 runner 临时 shim 目录；它以 `corepack install` 读取 `package.json` 的精确 `pnpm@10.12.1` 和 SHA-512 tarball hash，验证对应 shim 的版本后才把目录写入 `GITHUB_PATH`。

这使远端 Actions policy 可以保持为：只允许 selected Actions、要求完整 SHA、允许 GitHub 创建的 Action、拒绝 verified creator 与其他第三方 Action，且不使用 pattern allowlist。GitHub 的 selected-action `patterns_allowed` 只适用于公开仓库，私有候选因此明确要求空数组。[GitHub Actions permissions REST API](https://docs.github.com/en/rest/actions/permissions)

`actions/setup-node` 的内置 `cache: pnpm` 已从这些 job 移除：该缓存会在本地 Corepack shim 出现前查询 pnpm store。缓存优化可以在后续以已验证的第一方 cache 路径单独设计，不能重新引入不确定的 bootstrap 顺序。

新增 `pnpm audit:github-actions` 会检查：

- 八个 workflow 文件集合和每个本地 pnpm bootstrap 的数量；
- 所有外部 `uses:` 只能是 SHA 固定的 `actions/*`，本地引用只能是固定路径；
- Node setup 必须位于本地 Corepack bootstrap 之前，且没有 `cache: pnpm` 或 `pnpm/action-setup`；
- `.github/workflows/` 中的 `.yml` 和 `.yaml` 都必须属于固定八文件集合；
- 本地 action 必须与最小化的跨平台 Corepack 内容契约完全一致，且 `packageManager` 必须保留 pnpm 版本与 SHA-512 integrity hash；它不自行调用下载或依赖安装命令，也不使用外部 action 或 secret。首次缓存缺失时，Corepack 仍会取得该 hash 固定的 pnpm artifact。

Desktop Gate 与五条签名候选的无凭据复核都会执行该审计。各签名 workflow 的原有 allowlist 审计也将本地 action 视为唯一允许的非 SHA `uses:` 引用。

## 只读远端预检

`pnpm desktop:verify-github-readiness -- --verify-github --repository <候选仓库>` 仍只发送 `gh api --method GET`。除 Phase 20 的候选 repository ID、默认权限、基础 Actions policy、`main`、Environment 和组织 secret scope 外，它现在还检查：

1. organization metadata 中的 plan 是否为 `enterprise`；
2. selected Actions configuration 是否恰好为 `github_owned_allowed=true`、`verified_allowed=false` 和空 `patterns_allowed`；
3. 所有请求是否属于固定的只读 route allowlist，避免把任意 API path 传给 `gh`。

私有分支保护至少要求 GitHub Pro、Team 或 Enterprise；私有 Environment 的 required reviewers 与私有 artifact attestation 则要求 GitHub Enterprise Cloud。因为本契约同时要求三项，Enterprise Cloud 是受保护私有签名候选的共同前提。GitHub 的 branch protection、Environment 和 artifact attestation 文档分别说明了这些权限与私有仓库可用性的边界。[Branch protection](https://docs.github.com/en/rest/branches/branch-protection) · [Environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments) · [Artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)

2026-09-14 的最新实际只读预检中，organization metadata 返回 Free，因此 Enterprise Cloud entitlement 为 `failed`。当前 token 对固定候选仓库及其 workflow permissions、Actions policy、`main` 和 Environment endpoint 均得到 GitHub 404；工具因此将候选 identity、默认权限、基础/selected Actions policy、分支、三个 signing Environment 和 secret scope 全部标记为 `unverified`，而非把无法读取误报为失败或通过。404 既可能表示访问权限不足，也可能表示仓库已改名、转移或不存在；必须由管理员恢复可读访问并重新确认 numeric repository ID。结果为预期的 `blocked`，没有读取 secret 值。

## 管理员交接顺序

在第一次受保护候选前，管理员需要完成以下外部工作，然后重新运行只读预检：

1. 恢复管理员对固定候选仓库的只读 API 访问，确认它仍对应契约中的 numeric repository ID。
2. 将私有候选所在 organization 置于 GitHub Enterprise Cloud，并确认私有仓库可使用 branch protection、Environment required reviewers 与 artifact attestations。
3. 在仓库 Actions policy 中选择 selected Actions，要求完整 SHA，仅允许 GitHub-owned Actions，关闭 verified creator 和 pattern allowlist。
4. 为 `main` 配置受保护分支或等价 ruleset。
5. 创建 `macos-signing`、`windows-signing` 与 `linux-repository-signing` Environment；每个都需要至少一位 reviewer、禁止 self-review，并只允许受保护分支部署。
6. 由具备组织 secret inventory 权限的管理员确认已有 secret 的范围；预检只验证名称、visibility 和 selected-repository ID，绝不输出值。

这些步骤通过后仍只能进入手动签名候选。每个平台的真实签名、公证、时间戳、attestation、安装、权限、升级和发布证据仍需按后续候选流程分别取得。

## Review 与验证

新增 `tests/unit/githubActionsSupplyChain.test.js` 覆盖第三方/未固定 action、错误 bootstrap 顺序、提前 pnpm cache、非标准 YAML action key、缺失 shim 目录、Windows shim 版本检查、额外 bootstrap 命令、版本或 integrity 漂移，以及未声明 `.yaml` workflow。`tests/unit/desktopReleaseGitHubReadiness.test.js` 覆盖 Enterprise plan、selected policy、组织 metadata route 与 allowlist 拒绝，以及候选仓库 API 不可读时的 fail-closed 状态。

本地也以隔离 Corepack home 和 shim 目录复现了 `corepack install`、`corepack enable`、版本断言和后续 PATH 中的 `pnpm --version`。这只验证了当前 Linux Node 24 行为；macOS 与 Windows GitHub-hosted runner 的真实执行仍须由首次远端候选记录。
