# 跨平台桌面 Phase 23：公开直链与 APT 仓库发布边界

## 状态

本阶段将 `config/desktop-release-matrix.json` 升至 schema v23。它在 Phase 19 的 11 个 attested subject 交接清单之上，新增候选外、不可覆盖的公开发布计划。计划把可以作为 GitHub Release 直链下载的六个安装包，与必须保持 APT 路径布局的五个 Linux 仓库文件分开；所有路径继续固定 `releaseReady=false` 和 `publicRelease=false`。

2026-09-15 的只读 GitHub API 查询确认公开源码目标 `web-casa/ScreenHello` 的 numeric repository ID 为 `1353846676`，默认分支为 `main`，且仓库未归档。它不是 Phase 20 的私有候选 repository ID，也不授予跨仓库写入能力。

本阶段没有读取 secret 值、进入 Environment、触发 workflow、创建 tag、GitHub Release、部署、公开下载、签名、公证、时间戳、attestation 或 Linux endpoint。

## 载荷角色

Phase 19 的清单覆盖五个候选和 11 个 subject，但它们不属于同一种公开交付物。

| 交付方式 | 数量 | 载荷 |
| --- | ---: | --- |
| GitHub Release 直链下载 | 6 | macOS ARM64/Intel DMG、Windows x64/ARM64 NSIS installer、Linux amd64/arm64 DEB |
| 独立 HTTPS APT endpoint | 5 | `Release`、`InRelease`、`Release.gpg`、`.gpg` keyring、`.asc` keyring |

APT 客户端需要 `dists/` 与 `pool/` 的目录关系和对应签名元数据。GitHub Release asset 是一组扁平下载文件，不能替代这个仓库布局。因此 schema v23 明确禁止将五个 APT sidecar 作为 GitHub Release asset；两个 DEB 仍可作为 beta 的直接下载文件。

直链名称固定为：

- `ScreenHello-macos-arm64.dmg`
- `ScreenHello-macos-x64.dmg`
- `ScreenHello-windows-x64-setup.exe`
- `ScreenHello-windows-arm64-setup.exe`
- `ScreenHello-linux-amd64.deb`
- `ScreenHello-linux-arm64.deb`

tag 仍由将来的受保护 publisher 从同一 immutable candidate commit 的 `package.json` 读取，并加 `v` 前缀。Phase 23 不从当前 checkout 猜测候选版本，也不创建 tag。

## 本地交接计划

在完成 Phase 17、18 与 19 的完整本地复核后，使用第四个、与前三类输入目录分离的已有目录写计划：

```bash
pnpm desktop:verify-release-publication-plan -- \
  --write-publication-plan \
  --bundle-dir /secure/review/screenhello-<candidate-sha>/bundle \
  --review-dir /secure/review/screenhello-<candidate-sha>/release-review \
  --manifest-dir /secure/review/screenhello-<candidate-sha>/payload-manifest \
  --publication-plan-dir /secure/review/screenhello-<candidate-sha>/publication-plan
```

交接或后续 publisher preflight 前必须重新验证：

```bash
pnpm desktop:verify-release-publication-plan -- \
  --verify-publication-plan \
  --bundle-dir /secure/review/screenhello-<candidate-sha>/bundle \
  --review-dir /secure/review/screenhello-<candidate-sha>/release-review \
  --manifest-dir /secure/review/screenhello-<candidate-sha>/payload-manifest \
  --publication-plan-dir /secure/review/screenhello-<candidate-sha>/publication-plan
```

输出 `desktop-release-publication-plan.json` 只包含 candidate SHA、Phase 19 清单的 SHA-256、相对 source path、字节数、SHA-256 与固定发布名；不记录绝对路径、证书、token、下载 URL 或 tag 值。写入与读取均重新复核 Phase 19 清单，拒绝符号链接、输入目录内输出、重复写入、payload/清单变化、遗漏 subject 与重复映射。

## 仍未完成的发布链

Phase 23 只消除了“把 APT repository 当作普通 Release assets”的歧义。公开发布 workflow 仍未配置，原因是后续链还需要：

1. 五条真实受保护签名候选、attestation、平台人工验收、Phase 17～23 的本地复核结果；
2. 可在私有候选和公开目标之间传递已复核资料的受限身份，以及受保护 promotion Environment；
3. 由明确授权的 publisher 创建同 SHA 的不可变 tag，并只上传六个直链安装包；
4. 独立的静态 HTTPS APT endpoint、keyring 发布、客户端 rollout、轮换和撤销演练；
5. updater 信任根、endpoint 与密钥轮换，以及各商店渠道的独立方案。

这些条件和用户明确的发布授权缺一不可。后续 Phase 24 已补上 candidate commit 与公开源码导出快照的本地交接边界，但仍未配置 publisher 或运行远端操作；当前 `desktopReleasePublicationPlan`、release review、payload manifest、publication handoff 与所有候选 workflow 都不是发布许可。详见[跨平台桌面 Phase 24](./desktop-cross-platform-phase-24.md)。

## Review 与验证

`tests/unit/desktopCrossPlatformAcceptance.test.js` 覆盖 5 个候选、6 个目标、11 个 subject 的实际文件系统 fixture，验证 six-versus-five 划分、稳定 asset 名、清单篡改拒绝和 CLI 参数冲突。contract 与 trust 审计将 schema v23、公开目标 identity、APT sidecar 禁止规则及 `releaseReady=false` 固定为 fail-closed 约束。

本地静态和单元验证不替代 GitHub-hosted runner、Environment 审批、跨仓库 publisher、真实签名或任何公开发布动作。
