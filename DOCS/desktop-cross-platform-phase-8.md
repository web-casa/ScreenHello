# 跨平台桌面 Phase 8：macOS Intel 签名候选

## 状态

> 后续状态：本页中关于旧阶段或旧 schema 的表述只说明当时边界。当前契约为 [Phase 24](./desktop-cross-platform-phase-24.md) 的 schema v24：它保留既有 fail-closed 预检，并将 immutable candidate commit 的公开源码快照绑定到 direct-download/APT 交接，仍不改变本页历史结论或 `releaseReady=false`。

本阶段为 Intel macOS 建立了独立的手动签名候选 workflow：[.github/workflows/macos-intel-signed-candidate.yml](../.github/workflows/macos-intel-signed-candidate.yml)。它只允许组织私有仓库的 main 分支在显式选择 sign-macos-x64-candidate 后运行，并固定 checkout 本次 workflow 的 github.sha。

它与 ARM64 workflow 分开确认、分开 runner、分开包通道和 artifact 目录。Intel 成功不能证明 ARM64 已签名，ARM64 成功也不能证明 Intel 已签名。两个 workflow 都尚未远端运行；本阶段没有读取组织 secret 值，没有创建 tag、GitHub Release、公开下载、updater、attestation 或公开发布。releaseReady 继续为 false。

config/desktop-release-matrix.json 已升为 schema v9：

- macosSigningCandidate 保留 ARM64 的 macos-14 / macos-arm64 合同；
- macosIntelSigningCandidate 定义 Intel 的 macos-15-intel / macos-x64 合同；
- 两者都只表示 workflow 和静态审计已就绪，不表示 Environment 保护、证书、Apple notarization 或真实安装已完成。

## 独立候选链路

| 架构 | Workflow | 显式确认 | Runner | 产物通道 |
| --- | --- | --- | --- | --- |
| Apple Silicon | macos-signed-candidate.yml | sign-macos-arm64-candidate | macos-14 | github-actions-macos-signed-candidate |
| Intel | macos-intel-signed-candidate.yml | sign-macos-x64-candidate | macos-15-intel | github-actions-macos-intel-signed-candidate |

每条链路都有不含 secret 的 preflight job，以及仅在 preflight 成功后才能进入的 sign job。sign job 使用 macos-signing Environment；无签名 Desktop Release Gate 仍固定 --no-sign、无 secret、全局仅 contents: read，不能得到 Apple 凭据。

Intel workflow 在原生 Intel runner 上构建 DMG。pnpm desktop:inspect 会读取 macos-x64 目标合同、挂载 DMG、检查 ScreenHello.app、Info.plist 和包内 Mach-O 载荷，从而拒绝非 x86_64 的主可执行文件或不匹配的签名候选通道。

## 凭据和临时钥匙串

两个 macOS 签名 job 采用同一组组织 secret，且只在导入证书或 Tauri 签名/公证 step 中引用：

| 组织 secret | 使用位置 | 变量 |
| --- | --- | --- |
| MACOS_CERTIFICATE_P12_BASE64 | 证书导入 | APPLE_CERTIFICATE |
| APPLE_ID | 构建与公证 | APPLE_ID |
| APPLE_APP_SPECIFIC_PASSWORD | 构建与公证 | APPLE_PASSWORD |
| APPLE_TEAM_ID | 构建与公证 | APPLE_TEAM_ID |

当前 P12 没有导出密码，因此 APPLE_CERTIFICATE_PASSWORD 明确为空字符串。每次运行生成随机临时钥匙串密码，恢复 runner 原有 default/search-list keychain，并删除 P12 文件和临时 keychain。两个 workflow 还会从 codesign 输出中提取并检查 Developer ID Application authority；这一步使用正确的 POSIX sed 捕获转义，避免把失配 authority 当作已签名，并拒绝 CR/LF 身份字符串写入 GITHUB_ENV。

Tauri 根据导入后的 Developer ID Application identity 签名，并用 Apple ID、应用专用密码和 Team ID 在构建 DMG 时完成 notarization。流程不允许 --no-sign 或 --skip-stapling。[Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/)

## 产物、审计与管理员前置项

每个签名 job 仅上传保留 14 天的内部 artifact，包含 DMG、payload inspection、npm/Cargo CycloneDX SBOM、签名验证 JSON 与 SHA-256 清单。验证包括 codesign --verify --deep --strict、App 和 DMG 的 stapler validate、以及 spctl Gatekeeper assessment。它们仍不代替下载、拖放安装、首次启动、屏幕录制权限、升级、卸载和本地数据保留的真实设备验收。

pnpm audit:desktop:macos-signed-candidate 现在会同时审计 ARM64 和 Intel workflow，并拒绝自动触发、非私有/非 main 条件、错误 runner/目标/通道、未固定 action、secret 越界、P12 密码映射、错误的 Developer ID authority 提取、跳过签名或 stapling、缺少 keychain cleanup、发布操作，以及缺少 payload、SBOM、摘要和验证步骤。pnpm audit:desktop:trust 也要求两条 workflow 都通过，因此单独修改任何一个都不能静默降低信任边界。

在首次手动运行前，管理员仍须在目标私有仓库创建并保护 macos-signing Environment，将四个组织 secret 的访问范围限制到该仓库，并确认 Developer ID Application P12、Apple ID、应用专用密码和 Team ID 有效。GitHub Environment 的保护规则会在 job 到 runner 前生效；GitHub-hosted Intel macOS runner 的可用性和仓库资格也应在目标仓库设置中确认。[GitHub deployment environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments)；[GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

## 后续边界

下一步是在受保护 Environment 审批后，分别运行 ARM64 和 Intel 的新候选 SHA，审阅各自 artifact，并在真实 Mac 上完成安装和权限检查。Windows x64 和 ARM64 Authenticode/RFC 3161 候选已在[跨平台桌面 Phase 10](./desktop-cross-platform-phase-10.md)作为独立静态链路定义，Linux x64/arm64 DEB 仓库签名与内部客户端信任包候选已在[Phase 12](./desktop-cross-platform-phase-12.md)定义，五条签名候选的 provenance 则已在[Phase 13](./desktop-cross-platform-phase-13.md)定义，但都尚未远端运行。Linux 的公开密钥分发、客户端 rollout、轮换、撤销演练以及 updater 信任根仍待后续阶段；任一后续阶段都不能把本阶段的静态约束当作远端签名或发布证据。
