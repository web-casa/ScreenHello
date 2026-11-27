# 跨平台桌面 Phase 22：Hermetic Corepack 运行边界

## 状态

Phase 22 收紧仓库内 [Corepack bootstrap](../.github/actions/setup-pnpm/action.yml) 的运行时隔离。它不改变 desktop release matrix 的 schema v22，也不改变 `releaseReady=false` 或 `publicRelease=false`；本阶段只消除 CI job 复用默认 Corepack cache 和加载项目控制 Corepack 环境文件的空间。

> 后续状态：Phase 23 区分 direct-download installer 与 Linux APT sidecar，Phase 24 再将它们绑定到 immutable candidate commit 的公开源码快照；当前实现边界见 [Phase 24](./desktop-cross-platform-phase-24.md)。这些后续强化不改变本页 Corepack 历史结论。

本阶段没有修改 GitHub 远端设置、读取 secret 值、进入 Environment、触发 workflow，或创建签名、公证、时间戳、attestation、Release、部署和公开下载。

## 每 job 的隔离 bootstrap

每个 Linux/macOS job 通过 `mktemp`、每个 Windows job 通过随机 GUID，在 `RUNNER_TEMP` 下建立独立根目录，并分别创建：

- `bin`：只放本 job 的 Corepack pnpm shim，随后写入 `GITHUB_PATH`；
- `home`：只放本 job 下载的 package-manager cache，作为 `COREPACK_HOME` 写入 `GITHUB_ENV`。

bootstrap 在下载前固定以下环境：

- `COREPACK_ENV_FILE=0`，不加载 checkout 中的 `.corepack.env`；
- `COREPACK_DEFAULT_TO_LATEST=0`，不查询或更新 last-known-good package-manager；
- `COREPACK_ENABLE_PROJECT_SPEC=1`，继续要求项目的 `packageManager` 字段；
- 清除继承的 `COREPACK_INTEGRITY_KEYS`，避免 job 环境关闭或替换 Corepack 默认完整性验证。

完成 `corepack install` 和本地 shim 的 `pnpm --version` 断言后，`COREPACK_HOME` 与上述三个安全设置会写进 `GITHUB_ENV`，因此同一 job 后续的 `pnpm` 调用仍使用同一隔离 home。`package.json` 继续以 `pnpm@10.12.1` 和 SHA-512 tarball hash 固定下载字节。Corepack 官方文档说明 `COREPACK_HOME` 可以指定安装目录，也说明 `COREPACK_ENV_FILE`、`COREPACK_DEFAULT_TO_LATEST` 与 `COREPACK_ENABLE_PROJECT_SPEC` 的语义。[Corepack environment variables](https://github.com/nodejs/corepack#environment-variables)

`pnpm audit:github-actions` 继续逐字核对本地 action，并额外拒绝八个 workflow 中任何 `COREPACK_*` 环境变量。这样 workflow 不会在 local action 之外重新放宽现有或未来的 Corepack 边界。

## Review 与验证

`tests/unit/githubActionsSupplyChain.test.js` 现覆盖：

- 共享或缺失的临时 Corepack home；
- 项目控制的 `.corepack.env`、default-to-latest 与 integrity-key override；
- 未把隔离配置传递给后续步骤；
- workflow 级 Corepack 环境覆盖，以及既有 action pin、bootstrap 顺序和 pnpm cache 回归。

在 Node 24 / Corepack 0.35 的隔离目录中，已实际运行 `corepack enable pnpm --install-directory`、`corepack install` 和 shim version check。另创建带有指向无效 registry 和禁用完整性设置的临时 `.corepack.env`；因 `COREPACK_ENV_FILE=0`，安装仍按 `packageManager` 的精确 hash 下载并得到 pnpm 10.12.1。这个实测只覆盖当前 Linux 环境；GitHub-hosted macOS 与 Windows runner 仍须由首次远端候选记录验证。

最终本地复核还通过 `actionlint`、`pnpm audit:github-actions`、lint、typecheck、90 个文件 / 1,311 项 unit 和当前三引擎完整 E2E（396 passed / 24 expected skipped）。这证明仓库配置、浏览器产品回归和本地 Corepack 边界在当前工作树内一致；它不替代 GitHub-hosted runner 对 macOS 或 Windows bootstrap 的实际执行记录。

## 仍未完成的外部条件

Phase 21 的远端阻断没有改变：固定私有候选仓库仍需恢复可读 API 访问、确认 numeric repository ID、取得 GitHub Enterprise Cloud、配置 selected Actions policy、受保护 `main`、三个 signing Environment 和组织 secret scope。之后仍需要五条真实签名候选、attestation、平台安装/权限验收、受保护公开发布 workflow、updater 信任链和用户明确的发布授权。
