# 跨平台桌面 Phase 10：Windows ARM64 签名候选

## 状态

> 后续状态：本页中关于旧阶段或旧 schema 的表述只说明当时边界。当前契约为 [Phase 24](./desktop-cross-platform-phase-24.md) 的 schema v24：它保留既有 fail-closed 预检，并将 immutable candidate commit 的公开源码快照绑定到 direct-download/APT 交接，仍不改变本页历史结论或 `releaseReady=false`。

本阶段为 Windows ARM64 增加独立的 Authenticode 签名候选 workflow：[.github/workflows/windows-arm64-signed-candidate.yml](../.github/workflows/windows-arm64-signed-candidate.yml)。它只允许 `web-casa` 私有仓库的 `main` 分支在手动明确选择 `sign-windows-arm64-candidate` 后运行，并固定 checkout 本次 workflow 的 `github.sha`。

当前状态是“workflow-ready-not-run”：本地静态审计已通过，但没有读取任何 secret 值、没有进入 GitHub Environment、没有在 Windows ARM64 runner 运行、没有签名或时间戳结果，也没有公开发布。`releaseReady` 保持 `false`。

本页记录 Phase 10 当时的 schema v11 合同；后续矩阵曾由 [Phase 18](./desktop-cross-platform-phase-18.md) 升至 schema v19，并保留以下 Windows ARM64 合同：

| 项目 | 当前值 |
| --- | --- |
| 目标 | `windows-arm64` |
| Runner | `windows-11-arm` |
| Rust target | `aarch64-pc-windows-msvc` |
| Environment | `windows-signing` |
| 签名 | Authenticode SHA-256 |
| 时间戳 | RFC 3161 SHA-256 |
| 安装器 | NSIS |
| 内部 artifact 保留 | 14 天 |

GitHub 当前将 `windows-11-arm` 列为 Windows ARM64 托管 runner；首次运行前仍须在目标私有仓库确认它对当前计划和 runner image 可用。[GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

## ARM64 构建与签名边界

无凭据的 `preflight` 先安装 `aarch64-pc-windows-msvc` Rust target，并用显式 `--target aarch64-pc-windows-msvc` 检查无 bundle 原生产物。只有 preflight 成功后，受 `windows-signing` Environment 保护的 `sign` job 才能读取凭据，并用同一显式 target 构建签名 NSIS 候选。两个 job 都只有 `contents: read`，不会创建 tag、GitHub Release、deployment、updater、attestation 或公开下载。

显式 target 使最终应用不依赖 runner 的默认目标推断，且让 artifact 检查从 `target/aarch64-pc-windows-msvc/release/` 读取主程序和安装器。Tauri 的 Windows 文档要求 ARM64 构建安装相应 MSVC ARM64 工具、添加该 Rust target 并传入 `--target aarch64-pc-windows-msvc`；其 NSIS installer 本身仍以 x86 形式在 ARM Windows 上通过仿真运行，而应用主程序应为原生 ARM64。[Tauri Windows installer](https://v2.tauri.app/distribute/windows-installer/)

签名 job 复用 Windows x64 候选的证书边界：只在证书导入 step 使用 `WINDOWS_CERTIFICATE` 和非空的 `WINDOWS_CERTIFICATE_PASSWORD`，将 base64 PFX 暂存到 runner 临时目录、导入 `Cert:\CurrentUser\My`，并要求恰好一个带私钥且包含 Code Signing EKU (`1.3.6.1.5.5.7.3.3`) 的证书。导入的 thumbprint 只写入临时 Tauri overlay；PFX 在导入 step 的 `finally` 删除，所有已导入证书和 overlay 会在 `if: always()` cleanup 中删除。

静态配置 [tauri.windows-arm64-signed-candidate.conf.json](../src-tauri/tauri.windows-arm64-signed-candidate.conf.json) 只固定 SHA-256、RFC 3161 和时间戳服务地址，不保存证书指纹、PFX、密码或自定义 `signCommand`。Tauri 原生 Windows 签名配置使用证书库 thumbprint；它会处理主程序、NSIS bundler 的相关载荷和最终安装器，实际输出仍须由运行结果验证。[Tauri Windows code signing](https://v2.tauri.app/distribute/sign/windows/)；[Tauri configuration reference](https://v2.tauri.app/reference/config/)

## 产物验证与审计

候选构建后会检查 ARM64 包身份、主程序架构和 NSIS payload，生成 npm/Cargo CycloneDX SBOM，并对主程序和安装器执行 `signtool verify /pa /all /tw /v`。workflow 优先使用 Windows SDK 的 ARM64 SignTool，只有缺失时才回退到 SDK x64 或 PATH 中的 SignTool；原始验证输出、结构化验证摘要和 SHA-256 清单连同安装器作为 14 天内部 artifact 上传。Windows SDK 同时提供 ARM64 与 x64 SignTool 路径；文件摘要和时间戳摘要必须明确指定。[Microsoft SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)；[Sign an app package using SignTool](https://learn.microsoft.com/en-us/windows/msix/package/sign-app-package-using-signtool)

本地可运行的静态检查为：

```bash
pnpm audit:desktop:windows-arm64-signed-candidate
pnpm audit:desktop:contract
pnpm audit:desktop:trust
```

审计同时覆盖 x64 与 ARM64 Windows 候选，拒绝自动触发、非私有或非 `main` 条件、错误 runner/目标/通道、未固定 action、preflight Environment、secret 越出导入 step、静态 thumbprint/custom command、未显式 ARM64 Rust target、错误的 SignTool 架构选择、`--no-sign`、缺少 RFC 3161 验证/cleanup/SBOM/摘要，或公开发布操作。桌面 Gate 也将新 workflow、审计 wrapper 和单元测试列为必经路径。

## 管理员前置项与后续边界

首次远端运行前，管理员仍须在目标私有仓库保护 `windows-signing` Environment，限制允许分支、配置必要的审批规则，并将两个 Windows 组织 secret 的访问范围限制到该仓库。还需确认 `windows-11-arm` runner 有可用的 MSVC ARM64 build tools 和 Windows SDK；缺少这些条件时 workflow 必须失败，不能回退为 x64 应用。Environment 保护和组织 secret 可见性需要在 GitHub 设置中实际核验。[GitHub deployment environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments)

首次候选只能在受保护 Environment 审批后运行。随后需要审阅同一 SHA 的 artifact，并在真实 Windows ARM64 设备上完成安装、升级、卸载、本地数据保留、Windows 信任 UI、时间戳和企业策略验收。Windows x64 的候选结论不能推导 ARM64 已签名，ARM64 的候选结论也不能推导 x64 已签名。Linux x64/arm64 DEB 仓库签名和内部客户端信任包候选已在[Phase 12](./desktop-cross-platform-phase-12.md)定义，五条签名候选 provenance 已在[Phase 13](./desktop-cross-platform-phase-13.md)定义，但公开密钥分发、客户端 rollout、轮换与撤销演练、updater 信任根、MSIX/Microsoft Store 和公开正式发布仍是后续独立阶段。
