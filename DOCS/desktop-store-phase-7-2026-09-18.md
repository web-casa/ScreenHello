# MAS Universal 候选工作流接入（Phase 7）

日期：2026-09-18。目标：在公开仓库通过受控 GitHub Actions 使用用户配置的 MAS 身份材料，生成同时包含 ARM64 与 x86_64 的签名 PKG 候选。本阶段不上传 App Store Connect，也不声明已通过安装、GUI 或审核。

## 已配置的非敏感身份

- Bundle ID：`com.webcasa.screenhello.mas`
- 应用签名：`Apple Distribution: Alan Miao (H8MSV8BL2G)`
- 安装包签名：`3rd Party Mac Developer Installer: Alan Miao (H8MSV8BL2G)`
- Team ID：`H8MSV8BL2G`（Secret，仅记录已知非敏感标识）
- 首次候选 build number：`1`

GitHub 仓库变量和仓库级 profile Secret 已通过 API 核对名称；当前 CLI 缺少组织 Secret 管理权限，无法读取组织 Secret 列表或授权范围。工作流会在导入前分别检查 `APPLE_TEAM_ID`、两张 P12 和 profile 是否非空。不会输出 Secret 内容。

## 工作流边界

`.github/workflows/macos-mas-universal-candidate.yml` 只允许公开仓库 ID `1353846676` 的 `main` 或专用候选分支运行。专用分支 push 用 build number 1 自动产生首个候选；默认分支后续可手动输入新的、未使用的 CFBundleVersion。

工作流分为不接触凭据的 preflight 和 packaging：

1. 固定 Node 24、pnpm 10.12.1、Rust 1.96.0，安装 ARM64/x86_64 Rust targets。
2. 运行 lint、typecheck、相关单测、Rust `mac-app-store` feature 测试和 GitHub Actions 供应链审计。
3. 将两张空密码 P12 与 profile 解码到 `RUNNER_TEMP`，导入随机密码临时钥匙串；按完整证书名核对应用/installer identity。
4. 使用 `--locked` 构建 universal app，脚本核对 profile、Team、App ID、期限、entitlements、Info.plist 和主程序架构。
5. 对 app 内每个 Mach-O 文件检查同时包含 arm64/x86_64，核对 app 与 PKG 的签名 authority，生成 SHA-256 和证据文件。
6. 无论成功失败，恢复原钥匙串列表并删除证书、profile 和临时钥匙串。
7. 上传保留 14 天的 GitHub Actions artifact；不调用 Transporter、App Store Connect API 或公证服务。

## 本地 review 与验证

- `actionlint .github/workflows/macos-mas-universal-candidate.yml`：通过。
- `pnpm audit:github-actions`：通过；新增工作流的 checkout/setup-node/upload-artifact 均固定完整 commit SHA，本地 pnpm bootstrap 复用仓库 action。
- 相关 Vitest：35 项通过，覆盖 Store 输入、工作流秘密边界、空密码导入、失败清理、locked build、双架构与诚实证据状态。
- `pnpm lint`、`pnpm typecheck`：通过。
- 首次隔离工作树依赖安装因 `/tmp` tmpfs 空间不足中断；删除该工作树中新生成的残缺 node_modules 后，复用主工作区同锁文件依赖完成检查。这不属于产品或工作流失败。

## 待远端证据

- 组织 Secrets 是否已授权给 `web-casa/ScreenHello`，以首次 workflow 的非空检查为准。
- Apple profile 与两张 P12 是否实际匹配 Team、Bundle ID 和完整 identity。
- Tauri universal MAS 原生打包、所有 Mach-O 架构、最终 app/PKG 签名是否通过。
- Apple Silicon 与 Intel 的安装/启动、App Sandbox 文件流程、ScreenCaptureKit 允许/拒绝/撤销、导出与重启行为仍需实机验收。
- App Store Connect 上传、processing、选择 build、审核和发布均未执行。
