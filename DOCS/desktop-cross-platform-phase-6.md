# 跨平台桌面 Phase 6：发布签名与信任准备

## 状态

> 后续状态：本页中关于旧阶段的当前边界只说明当时状态。当前契约为 [Phase 24](./desktop-cross-platform-phase-24.md) 的 schema v24：它保留既有 fail-closed 预检，并将 immutable candidate commit 的公开源码快照绑定到 direct-download/APT 交接，仍不改变本页历史结论或 `releaseReady=false`。

本阶段把“当前候选只能用于测试”的发布信任边界固化为 schema v7 的单一契约和可执行审计。它没有创建私钥、证书、Apple 凭据、签名命令、更新 endpoint、GitHub Release、tag、attestation 或公开下载；六个原生目标仍是 `not-run`，`releaseReady=false`。

完成的是对意外越权配置的 fail-closed 防护，不是 macOS、Windows、Linux 的签名、公证、自动更新或正式分发实现。

## 当前信任契约

`config/desktop-release-matrix.json` 的 `releaseTrustPolicy` 是当前状态的唯一声明来源：

| 范围 | 当前状态 | 进入正式分发前的条件 |
| --- | --- | --- |
| 候选 Gate | 无签名、无 secrets、只读 `contents: read` | 继续使用 `--no-sign`，只上传 14 天保留的测试 evidence |
| macOS DMG | `not-configured` | 使用 `Developer ID Application` 进行签名、完成 notarization 与 stapling，并在真实 macOS 安装路径复验 |
| Windows NSIS | `not-configured` | 选定受保护的代码签名服务或证书机制，签名并加入时间戳，再按当前用户安装/升级路径复验 |
| Linux DEB | `workflow-ready-not-run` | Phase 12 已定义受保护 Environment 中的双架构 Release/InRelease 仓库签名和内部 `.gpg`/`.asc` 客户端信任包候选；公开密钥分发、HTTPS endpoint、远端运行、rollout、轮换和撤销演练仍未验收 |
| Tauri updater | `disabled` | 配置公钥信任根、受保护私钥、TLS endpoint、签名 artifact 与密钥轮换/撤销策略 |
| GitHub provenance | `workflow-ready-not-run` | Phase 13 在五条独立、受保护签名候选的 sign job 中申请最小 attestation / OIDC 权限；私有仓库 GitHub Enterprise Cloud 可用性和真实运行仍待确认 |

Tauri 的 updater 要求签名和公钥配置；在没有完整信任根、私钥管理和 HTTPS 更新源之前，普通无签名安装包不能作为更新包。[Tauri Updater](https://v2.tauri.app/plugin/updater/)

macOS 直发所需的是 `Developer ID Application` 签名和 Apple notarization，而不是把候选 DMG 的成功构建当作用户可安装的证明。[Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/)

Windows 的签名证书或云签名服务、签名命令和时间戳服务尚未选定；本阶段不写入空的 `signCommand`，避免无效配置掩盖缺失的证书流程。[Tauri Windows signing](https://v2.tauri.app/distribute/sign/windows/)

当前渠道为 DEB，不是 AppImage。Tauri 关于 AppImage 嵌入签名的说明不能替代 Debian/APT 仓库签名方案，因此没有把它误写为 Linux DEB 已受信任。[Tauri Linux signing](https://v2.tauri.app/distribute/sign/linux/)

GitHub artifact attestation 需要 `attestations: write` 与 `id-token: write` 等权限。现有 PR/手动无签名 Gate 继续故意不拥有这些权限；[Phase 13](./desktop-cross-platform-phase-13.md) 只在独立、受保护的签名 job 完成临时凭据清理后申请它们，不能扩张不受信任候选构建的权限。[GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)

## 可执行保护

新增 `pnpm audit:desktop:trust`，它同时检查：

- schema v7 的完整 `releaseTrustPolicy`、候选包配置和 `unsigned-test-only` 状态；
- 基础 Tauri 配置没有 updater plugin、`createUpdaterArtifacts`、macOS `signingIdentity` 或 Windows `signCommand`；
- `package.json` 与 Cargo 没有 updater 依赖；
- 候选 workflow 保持只读、无 secrets、无签名凭据引用、无 attestation/OIDC 写权限、无发布 action，并明确带有 `--no-sign`；
- candidate evidence 的 `requiredBuildChecks` 包含 `trustPolicy`，使证据审计不会遗漏这道门。

`pnpm audit:desktop:contract` 同样锁定 schema、策略和目标矩阵；`pnpm audit:desktop:workflow` 继续拒绝无签名 Gate 的 `attestations: write`、`id-token: write` 或发布操作，`pnpm audit:desktop:artifact-provenance` 则锁定独立签名候选的最小权限与凭据清理顺序。它们通过时表示边界仍被正确保护，不表示正式发布已就绪。

公开仓库的完整验证链也会运行 trust 审计；web-only 验证则排除全部桌面命令，避免把原生工具链当作 Web 交付的隐含依赖。

## 后续实施顺序

1. 创建与 PR Gate 分离的、只接受受保护不可变 release 输入的签名 workflow，并记录审批、回滚和撤销责任人。
2. 在外部凭据管理系统配置平台签名身份；只向该 workflow 注入最小权限的短生命周期凭据，绝不写入仓库、候选 artifact 或 evidence。
3. 分平台签名、macOS notarization/stapling、Windows 时间戳、Linux 渠道信任链与安装升级验证；每一步以新候选 SHA 的产物和实机记录为准。
4. 只有在更新公钥、TLS feed、密钥轮换与回滚被设计并验证后，才添加 Tauri updater；随后再评估 provenance attestation、公开下载和商店渠道。

## 后续状态

Phase 8 已在不改变无签名 Gate 的前提下新增独立 macOS Intel 签名候选，并保留 ARM64 链路；Phase 9 新增 Windows x64 Authenticode/RFC 3161 候选，Phase 10 又以独立 workflow 新增 Windows ARM64 候选，Phase 11 定义 Linux x64/arm64 DEB 仓库签名候选，Phase 12 追加内部客户端信任包、双键重叠和撤销响应契约，Phase 13 为五条签名链路定义清理后的 GitHub provenance，Phase 14 为下载候选定义本地预检和严格 GitHub CLI 验证收据，Phase 15 再增加最终候选重检和收据关联复核，Phase 16 追加候选绑定的平台人工验收计划、未执行模板和 evidence 复核，Phase 17 再要求五候选属于同一 immutable SHA 的汇总复核，Phase 18 在完整验收后将当前汇总计划和 record 哈希固定在候选外本地审查档案。五条签名链路都仍未远端运行；Environment 保护、私有仓库 GitHub Enterprise Cloud 可用性、密钥/证书范围、Apple notarization、Windows 时间戳、Linux 公开密钥分发和生命周期演练都尚未获得实际证据；当前边界见[跨平台桌面 Phase 18](./desktop-cross-platform-phase-18.md)。 

## 本阶段完成条件

- 当前无签名候选与未来正式发布的权限、凭据和产物路径被明确隔离。
- 对 updater、签名配置、签名依赖、发布操作与 OIDC/attestation 权限的意外引入均有单元测试和静态审计。
- 文档明确每个平台尚缺的信任前提，不把候选 bundle、SBOM 或 checksum 写成签名/公证/发布证据。
- `releaseReady` 继续为 `false`，直到后续受保护发布流程和每个平台的人工验收真正完成。
