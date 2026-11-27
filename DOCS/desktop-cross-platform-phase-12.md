# 跨平台桌面 Phase 12：Linux DEB 客户端信任包与密钥生命周期候选

## 状态

> 后续状态：本页中关于旧阶段或旧 schema 的表述只说明当时边界。当前契约为 [Phase 24](./desktop-cross-platform-phase-24.md) 的 schema v24：它保留既有 fail-closed 预检，并将 immutable candidate commit 的公开源码快照绑定到 direct-download/APT 交接，仍不改变本页历史结论或 `releaseReady=false`。

本阶段将 `config/desktop-release-matrix.json` 升至当时的 schema v13，并扩展既有的 [Linux DEB Repository Signed Candidate workflow](../.github/workflows/linux-deb-repository-signed-candidate.yml)。新增的是内部候选的客户端公开 keyring、可选双键重叠、最短剩余有效期检查和撤销响应契约。Phase 13 定义 GitHub provenance，Phase 14 定义候选 provenance 的本地预检/严格验证收据，Phase 15 增加最终候选重检/收据关联复核，Phase 16 增加候选绑定的平台人工验收记录，Phase 17 增加同 SHA 的跨候选汇总复核，Phase 18 曾将后续契约升至 schema v19 并在完整验收后增加候选外记录哈希档案；远端状态仍是 `workflow-ready-not-run`。没有读取、设置或验证真实 Linux 凭据，没有进入 GitHub Environment、运行远端 workflow、签署真实候选、建立 HTTPS endpoint、发布 source list、tag、GitHub Release、updater 或公开分发。`releaseReady` 仍为 `false`。

这不是公开安装说明。候选 artifact 没有公开仓库 URL，也没有用户应执行的 `apt` 命令；在实际 endpoint、传输层、独立发布和客户端安装证据完成前，不能把内部 artifact 当作分发渠道。

## 候选信任包

受保护的 signing step 先把活动签名密钥的**公开部分**以 `--export-options export-minimal` 导入独立临时 trust home。可选的下一把公开密钥只从 Environment variable 导入同一 trust home；任何 secret key、重复主 fingerprint、未声明的主键、活动/下一把键不一致，或已撤销、过期、禁用、无效的受信任主键都会使 job 失败。

候选会导出并校验以下两种等价的公开格式：

| 文件 | 未来客户端安装位置 | 用途 |
| --- | --- | --- |
| `screenhello-archive-keyring.gpg` | `/etc/apt/keyrings/screenhello-archive-keyring.gpg` | 二进制 OpenPGP keyring，供 `signed-by=` 使用。 |
| `screenhello-archive-keyring.asc` | `/etc/apt/keyrings/screenhello-archive-keyring.asc` | ASCII armor 版本，便于受控的人工检查。 |

workflow 对 armor 执行 `gpg --dearmor` 并逐字节比对二进制版本，随后继续以二进制 keyring 完成 `gpgv` 和隔离 `signed-by` APT update。候选 artifact 的 `client-trust/` 还包含 `client-trust-manifest.json`、`ROTATION.md`、`REVOCATION_RESPONSE.md`，并纳入最终 `SHA256SUMS.txt`。

APT 推荐把本地维护的第三方 keyring 放在 `/etc/apt/keyrings`，并通过 `Signed-By` 精确引用；二进制 keyring 使用 `.gpg`，ASCII armor 使用 `.asc`。该格式和最小导出规则依据 [Debian `apt-secure(8)`](https://manpages.debian.org/testing/apt/apt-secure.8.en.html)；已废弃的 `apt-key` 不在本项目中使用，见 [Debian `apt-key(8)`](https://manpages.debian.org/unstable/apt/apt-key.8.en.html)。

## Environment 凭据与变量契约

管理员在首次远端候选前仍需配置私有仓库的 `linux-repository-signing` Environment 分支限制和审批。所有名称如下，本文不包含任何值：

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `LINUX_REPOSITORY_SIGNING_PRIVATE_KEY` | Environment secret | base64 OpenPGP 私钥；只通过 stdin 导入临时 signing home。 |
| `LINUX_REPOSITORY_SIGNING_PASSPHRASE` | Environment secret | 非空单行口令；只从 loopback file descriptor 交给签名命令。 |
| `LINUX_REPOSITORY_SIGNING_FINGERPRINT` | Environment variable | 活动主密钥的 40 或 64 位完整 fingerprint。 |
| `LINUX_REPOSITORY_SIGNING_NEXT_PUBLIC_KEY` | 可选 Environment variable | base64 OpenPGP **公开**键；只可与下一把 fingerprint 同时存在。 |
| `LINUX_REPOSITORY_SIGNING_NEXT_FINGERPRINT` | 可选 Environment variable | 下一把主密钥的 40 或 64 位完整 fingerprint；必须与活动键不同。 |

可选下一把键不是 secret，也不应包含私钥材料。GitHub Environment 的保护规则通过后，Environment secret 和 variable 才会在 job 中可用；管理策略需由仓库管理员实际核验，见 [GitHub deployment environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments) 和 [GitHub secrets](https://docs.github.com/en/actions/reference/security/secrets)。

## 轮换和撤销

轮换候选有两种状态：只有活动键的 `single-key-candidate`，或活动键加下一把键的 `overlap-candidate`。workflow 会拒绝已撤销、过期、禁用或无效的受信任主键；若键带有有效期，还要求每把受信任键至少还有 30 天，无有效期键会明确记录为未提供到期时间。先分发并验证当前信任包，再在受保护 signing Environment 切换活动键。下一把键与旧键必须至少重叠 30 天，且只能在已支持客户端的 rollout 证据审阅后手工退役旧键。

撤销证书保存在离线受控位置，不放进候选 artifact。若怀疑活动签名键泄露，应先停止仓库发布和 endpoint，再从独立、可验证的带外渠道引导替换信任包；不能依赖由疑似泄露密钥签名的更新来建立替换密钥的信任。GnuPG 在创建密钥时会生成撤销证书，并将到期作为额外制动，参见 [GnuPG 手册](https://www.gnupg.org/documentation/manuals/gnupg.pdf)。本阶段尚未执行真实撤销或轮换 drill。

## 本地复核

```bash
pnpm audit:desktop:linux-deb-key-lifecycle
pnpm audit:desktop:linux-deb-repository-signed-candidate
pnpm audit:desktop:contract
pnpm audit:desktop:trust
```

静态审计拒绝将下一把公开键设为 secret、下一把键单独存在、私钥进入 trust home、已撤销/过期/禁用/无效的 trust key、非最小导出、缺少 `.gpg`/`.asc` 或 armor 还原比对、少于 30 天的 expiring key、缺失 manifest/checksum、`apt-key`、公开 endpoint 和任何发布操作。

## 尚未完成的边界

- GitHub Environment 的真实保护规则、变量/secret 作用域、远端 x64/ARM64 打包、签名和 client-trust artifact 仍没有运行证据。
- 没有公开 HTTPS 仓库、source list、公开 key 分发端点、受支持客户端 rollout、双键轮换或撤销演练。
- 实机安装、升级、卸载、Wayland Portal、权限、多显示器、远程桌面和无显示器验证仍按六目标人工矩阵分别验收。
- updater 信任根、不可变公开发布和商店渠道仍未配置；GitHub provenance/attestation 已在 [Phase 13](./desktop-cross-platform-phase-13.md) 定义为受保护签名候选的 workflow-ready-not-run 链路，Phase 14 追加本地预检/收据，Phase 15 追加候选重检/收据关联复核，Phase 16 追加候选绑定的平台人工验收记录，Phase 17 追加同 SHA 的跨候选复核，Phase 18 追加候选外审查档案，但仍尚无真实运行或验证证据。
