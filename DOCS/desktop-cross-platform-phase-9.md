# 跨平台桌面 Phase 9：Windows x64 签名候选

## 状态

> 后续状态：本页中关于旧阶段或旧 schema 的表述只说明当时边界。当前契约为 [Phase 24](./desktop-cross-platform-phase-24.md) 的 schema v24：它保留既有 fail-closed 预检，并将 immutable candidate commit 的公开源码快照绑定到 direct-download/APT 交接，仍不改变本页历史结论或 `releaseReady=false`。

本阶段为 Windows x64 新增了独立的 Authenticode 签名候选 workflow：[.github/workflows/windows-signed-candidate.yml](../.github/workflows/windows-signed-candidate.yml)。它只允许 `web-casa` 私有仓库的 `main` 分支在手动明确选择 `sign-windows-x64-candidate` 后运行，并固定 checkout 本次 workflow 的 `github.sha`。

当前状态是“workflow-ready-not-run”：本地静态审计已通过，但没有读取任何 secret 值、没有进入 GitHub Environment、没有在 Windows runner 运行、没有签名或时间戳结果，也没有公开发布。`releaseReady` 仍为 `false`。

本页记录 Phase 9 当时的 schema v10 合同；后续矩阵曾由 [Phase 18](./desktop-cross-platform-phase-18.md) 升至 schema v19，并保留以下 Windows x64 合同：

| 项目 | 当前值 |
| --- | --- |
| 目标 | `windows-x64` |
| Runner | `windows-2025` |
| Environment | `windows-signing` |
| 签名 | Authenticode SHA-256 |
| 时间戳 | RFC 3161 SHA-256 |
| 安装器 | NSIS |
| 内部 artifact 保留 | 14 天 |

## 签名链路与凭据边界

workflow 分为两个 job。无凭据的 `preflight` 先在 Windows 2025 完成锁文件安装、JS/Rust 检查、桌面契约和无 bundle 原生产物检查；只有它成功后，受 `windows-signing` Environment 保护的 `sign` job 才能读取凭据。两个 job 都只有 `contents: read`，不会创建 tag、GitHub Release、deployment、updater、attestation 或公开下载。

签名 job 只在证书导入步骤使用以下组织 secret 名称，本文不记录其值：

| 组织 secret | 用途 |
| --- | --- |
| `WINDOWS_CERTIFICATE` | base64 编码的 PFX |
| `WINDOWS_CERTIFICATE_PASSWORD` | 非空的 PFX 导出密码 |

Windows PFX 的密码不能从 macOS P12 的空密码设置推断。该 workflow 明确拒绝空的 `WINDOWS_CERTIFICATE_PASSWORD`，并要求导入内容只有一个带私钥、含 Code Signing EKU (`1.3.6.1.5.5.7.3.3`) 的签名证书。

导入时，workflow 在 runner 临时目录写入 PFX，导入 `Cert:\CurrentUser\My`，从实际导入证书取得 SHA-1 thumbprint，并将 thumbprint 写入临时 Tauri overlay。静态配置 [tauri.windows-signed-candidate.conf.json](../src-tauri/tauri.windows-signed-candidate.conf.json) 只固定 SHA-256、RFC 3161 和时间戳服务地址，不保存证书指纹、PFX、密码或自定义签名命令。PFX 会在导入步骤的 `finally` 中删除；不论成功、失败或取消，末尾 cleanup 都尝试删除导入的 CurrentUser 证书和临时 overlay。

此设计使用 Tauri 原生 Windows 签名配置和 Windows 证书库查找，而没有把 PFX 密码传入自定义 `signCommand`。Tauri 对 Windows 配置支持证书 thumbprint、摘要算法和 RFC 3161 时间戳；其 NSIS bundler 会按该配置处理主程序、卸载器、插件副本和最终安装器。实际运行仍必须检查输出，而不能把源码行为当作签名证据。[Tauri Windows code signing](https://v2.tauri.app/distribute/sign/windows/)；[Tauri configuration reference](https://v2.tauri.app/reference/config/)

## 产物验证与审计

签名候选会以 `pnpm exec tauri build --ci --bundles nsis` 构建，然后检查 Windows x64 包身份、架构和 NSIS payload，生成 npm/Cargo CycloneDX SBOM。它使用 Windows SDK 的 `signtool verify /pa /all /tw /v` 分别验证主程序与 NSIS 安装器，保存原始验证输出、结构化验证摘要和 SHA-256 清单，并将这些文件与安装器作为 14 天内部 artifact 上传。

Microsoft 的 SignTool 文档要求指定文件摘要算法，RFC 3161 时间戳使用 `/tr` 与 `/td SHA256`；`/pa /all /tw` 分别要求 Authenticode 策略、检查所有签名并将缺失时间戳视为警告。候选静态配置采用 Tauri 支持的 `digestAlgorithm: sha256`、`tsp: true` 和 DigiCert 公布的 RFC 3161 endpoint `http://timestamp.digicert.com`。实际运行必须以 `signtool` 输出为准。[Microsoft SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)；[DigiCert RFC 3161 TSA](https://knowledge.digicert.com/general-information/rfc3161-compliant-time-stamp-authority-server)

本地可运行的静态检查为：

```bash
pnpm audit:desktop:windows-signed-candidate
pnpm audit:desktop:contract
pnpm audit:desktop:trust
```

审计拒绝自动触发、非私有或非 `main` 条件、浮动或未固定 action、preflight 的 Environment、越出导入步骤的 secret、静态 thumbprint/custom command、`--no-sign` 签名构建、缺少签名验证/临时证书 cleanup/SBOM/摘要，或公开发布操作。全局桌面 Gate 也将该 workflow、审计脚本和单元测试列为必经路径。

## 管理员前置项与后续边界

首次远端运行前，管理员仍须在目标私有仓库创建并保护 `windows-signing` Environment，限制允许分支、配置必要的审批规则，并将两个组织 secret 的访问范围限制到该仓库。Environment 保护在 job 获得凭据前生效；实际组织策略和 secret 可见性必须在 GitHub 设置中核验。[GitHub deployment environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments)

首次候选只能从受保护 Environment 审批后运行。随后需要审阅同一 SHA 的 artifact、在真实 Windows x64 系统完成安装、升级、卸载和本地数据保留检查，并确认 Windows 信任 UI、时间戳和企业策略表现。Windows ARM64 已在[跨平台桌面 Phase 10](./desktop-cross-platform-phase-10.md)取得独立静态候选；Linux x64/arm64 DEB 仓库签名和内部客户端信任包候选见[Phase 12](./desktop-cross-platform-phase-12.md)，五条签名候选 provenance 见[Phase 13](./desktop-cross-platform-phase-13.md)，但公开密钥分发、客户端 rollout、轮换与撤销演练、updater 信任根、MSIX/Microsoft Store 和公开正式发布仍是后续独立阶段；任何一项不能由本阶段的静态 workflow 或 x64 候选结果推导。
