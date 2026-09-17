# 跨平台桌面 Phase 7：macOS 签名候选

## 状态

> 后续状态：本页中关于旧阶段或旧 schema 的表述只说明当时边界。当前契约为 [Phase 24](./desktop-cross-platform-phase-24.md) 的 schema v24：它保留既有 fail-closed 预检，并将 immutable candidate commit 的公开源码快照绑定到 direct-download/APT 交接，仍不改变本页历史结论或 `releaseReady=false`。

本页记录 Phase 7：它新增了一个与无签名候选 Gate 完全分离的手动 macOS ARM64 签名候选 workflow：.github/workflows/macos-signed-candidate.yml。它只允许组织私有仓库的 main 分支、显示选择 sign-macos-arm64-candidate 后运行，并固定 checkout 该次 workflow 的 github.sha。

该 workflow 尚未在本工作树对应的提交上运行。没有读取或修改任何凭据值，也没有创建 tag、GitHub Release、公开下载、updater、attestation 或公开发布。releaseReady 继续为 false。

Phase 7 完成时，config/desktop-release-matrix.json 升为 schema v8。当前合同已在 [Phase 18](./desktop-cross-platform-phase-18.md) 升为 schema v19，并另有 Intel、Windows x64、Windows ARM64、Linux DEB 仓库/客户端信任包和五条签名候选 provenance/local verification workflow、最终候选重检、收据关联复核、候选绑定的平台人工验收、同 SHA 跨候选复核及完整验收后的候选外记录哈希档案；macosSigningCandidate.status 的 workflow-ready-not-run 仍只表示代码和静态审计已就绪，不表示 GitHub Environment 已受保护、组织 secret 已限定仓库访问、GitHub Enterprise Cloud 私有 attestation 可用、证书有效、Apple notarization 已成功或用户已安装验证。

## 工作流隔离

无签名的 Desktop Release Gate 继续保留 --no-sign、无 secrets 和全局 contents: read。它仍可由 PR 和手动触发，不能获得 Apple 凭据。

签名流程分为两个 job：

1. preflight 在 macos-14 上完成锁文件安装、JS/Rust 检查和静态信任审计，不引用任何 secret。
2. sign 只有在 preflight 成功后才引用 macos-signing Environment。它再次检查签名契约，再导入证书、构建、notarize、staple 和验证。

签名 job 固定为 macos-14 Apple Silicon，因此本阶段只覆盖 macos-arm64。macos-x64 仍只属于无签名候选矩阵，不能由 ARM64 结果推导为已签名或已公证。

## 凭据映射与临时钥匙串

workflow 只在两个需要它们的 step 中引用以下组织 secret：

| 组织 secret | 使用位置 | Tauri / Apple 变量 |
| --- | --- | --- |
| MACOS_CERTIFICATE_P12_BASE64 | 证书导入 step | APPLE_CERTIFICATE |
| APPLE_ID | 构建与公证 step | APPLE_ID |
| APPLE_APP_SPECIFIC_PASSWORD | 构建与公证 step | APPLE_PASSWORD |
| APPLE_TEAM_ID | 构建与公证 step | APPLE_TEAM_ID |

当前 P12 没有导出密码，因此证书导入使用显式空的 APPLE_CERTIFICATE_PASSWORD。workflow 每次运行会生成随机临时钥匙串密码，不把它保存为组织、仓库或 artifact secret。P12 文件在导入后删除，keychain search list/default keychain 在结束时恢复，临时 keychain 随后删除。

Tauri 使用导入后查到的 Developer ID Application identity 签名。Apple ID、应用专用密码和 Team ID 会让 Tauri 在构建 DMG 时执行 notarization；本流程没有使用 --no-sign 或 --skip-stapling。[Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/)

## 远端运行前的管理员配置

在第一次手动运行前，仓库管理员必须在目标私有仓库预先创建 macos-signing Environment，并完成以下配置：

1. 将可部署分支限制为受保护的 main，配置至少一名 required reviewer，并在可用时禁止发起人自审和管理员绕过。
2. 将四个组织 secret 的访问策略限制为这个私有仓库；不要授予所有仓库访问。
3. 确认证书是带私钥的 Developer ID Application P12，Apple ID 能使用该 Team，并且应用专用密码仍有效。

GitHub Environment 的保护规则必须在 job 被发送到 runner 前通过，Environment secret 也只会在此后可用；这正是签名 job 使用该 Environment 的原因。[GitHub deployment environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments)

## 产物和验证

成功的签名 job 只上传保留 14 天的内部 artifact，包含：

- 经过 DMG payload/身份/ARM64 架构检查的 DMG；
- codesign verify deep strict 通过的 App；
- App 与 DMG 的 stapler validate 结果；
- spctl assess 的 Gatekeeper 接受结果；
- npm/Cargo CycloneDX SBOM、artifact-inspection.json、signing-validation.json 和 SHA-256 清单。

这些文件只证明该次候选的技术签名、公证和封装检查。它们不代替真实 macOS 的下载、挂载、拖放安装、首次启动、屏幕录制权限、升级、卸载和本地数据保留验收。

## 可执行审计

    pnpm audit:desktop:contract
    pnpm audit:desktop:trust
    pnpm audit:desktop:macos-signed-candidate

当前 audit:desktop:macos-signed-candidate 会同时拒绝 ARM64 或 Intel workflow 的自动触发、非私有/非 main 条件、未固定 action、secret 出现在签名 step 外、P12 密码映射变化、错误的 Developer ID authority 提取、--no-sign / --skip-stapling、缺少 keychain cleanup、发布操作或缺少签名、公证、Gatekeeper、SBOM、payload 和 checksum 检查。它是对 workflow 文本和配置的 fail-closed 检查，不能替代一次真实 Apple 服务运行。

## 后续边界

Phase 8 已为 Intel 架构建立独立签名候选，Phase 9 已为 Windows x64 建立独立 Authenticode/RFC 3161 候选，Phase 10 已为 Windows ARM64 建立独立候选，Phase 11 已为 Linux x64/arm64 DEB 仓库建立独立候选，Phase 12 追加内部客户端信任包及轮换/撤销响应契约，Phase 13 定义五条链路的 provenance，Phase 14 定义下载候选后的本地预检和严格 GitHub CLI 验证收据，Phase 15 再要求收据写入前的最终候选重检和交接时的本地关联复核，Phase 16 追加候选绑定的平台人工验收计划、未执行模板和 evidence 复核，Phase 17 再要求同 SHA 跨候选复核，Phase 18 再将完整验收后的计划和 record 哈希固定到候选外本地审查档案；五条链路都尚未远端运行。下一步应由受保护 Environment 审批后分别运行新候选 SHA，审阅 artifact、验证收据与真实平台安装结果；Linux 的公开密钥分发、客户端 rollout、轮换/撤销演练和 updater 信任根仍需单独处理。任何一步都必须使用新的候选 SHA，不能继承本阶段的静态检查结论。当前边界见[跨平台桌面 Phase 18](./desktop-cross-platform-phase-18.md)。
