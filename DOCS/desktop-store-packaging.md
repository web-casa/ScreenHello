# MAS / Microsoft Store 开发与打包

更新：2026-09-17。用户新增两个商店的 ARM64、AMD64（工具链名称 x64 / x86_64）交付要求。

## 当前交付边界

| 渠道 | 架构 / 文件 | 当前实现 | 尚缺的证据 |
| --- | --- | --- | --- |
| GitHub 测试直装 | macOS ARM64/x64 DMG、Windows ARM64/x64 NSIS、Linux ARM64/x64 DEB | 候选 `e66d2c0` 六目标原生 Gate 和浏览器 CI 通过；macOS ARM64 另有签名、公证 DMG | 真实安装/GUI/升级验收 |
| Mac App Store | 优先 universal PKG，同时包含 ARM64 与 x86_64；支持单架构诊断构建 | `mac-app-store` feature、独立沙箱权限、profile/架构/签名检查与 `productbuild` 打包入口 | 真实应用身份、MAS 证书/profile、macOS 原生打包、沙箱功能验收、上传和审核 |
| Microsoft Store | ARM64 与 x64 两个 MSIX，同一应用身份 | 独立身份/版本校验、随包固定 WebView2、MakeAppx 打包/解包与内容核对入口 | Partner Center 身份/版本、两架构固定 Runtime、原生打包、侧载/升级/WACK、上传和审核 |

**本轮商店打包脚本尚未成功生成 macOS / Windows 商店包；不能把源码检查或 Linux 上 Rust feature 测试称为商店包已生成。** 已新增仅手动触发的 MAS universal 候选工作流 `.github/workflows/macos-mas-universal-candidate.yml`，它生成并上传 GitHub Actions 测试产物，但不会上传 App Store Connect。直装矩阵中的 `storeChannels: deferred` 只描述该矩阵不向商店发布；本文件定义独立商店开发渠道。

## 共用前提

使用项目固定 Node 24.18.0、pnpm 10.12.1、Rust 1.96.0，先执行 `pnpm install --frozen-lockfile --strict-peer-dependencies`。命令必须通过 pnpm 运行，以复用当前安装的 Tauri CLI。

新入口是 `scripts/package-desktop-store.mjs`，配置/边界校验在 `scripts/desktop-store-config.mjs`。它要求原生系统和实际身份，不提供其他产品的默认身份，也不调用商店上传 API。每次使用新的输出目录；已存在目录会拒绝覆盖。

成功后输出安装文件及 `package-evidence.json`，记录源码提交、工作树是否有改动、配置与 Cargo.lock 哈希、最终包哈希。`releaseReady` 始终为 false，安装、GUI、升级、上传、审核均标为 `not-run`。正式候选必须来自干净源码，补齐原生验收并重新核对原包哈希。

## MAS

配置以下环境变量，证书先通过受控签名环境导入 macOS keychain；不要在仓库、日志或聊天中粘贴私钥：

| 变量 | 来源 |
| --- | --- |
| `SCREENHELLO_MAS_BUNDLE_ID` | App Store Connect 应用对应的显式 Bundle ID |
| `APPLE_TEAM_ID` | 已有组织 secret；必须与证书/profile 一致 |
| `SCREENHELLO_MAS_BUILD_NUMBER` | 查询已有构建后选择的新的 CFBundleVersion，不能重复上传旧编号 |
| `SCREENHELLO_MAS_APP_IDENTITY` | Apple Distribution 或 3rd Party Mac Developer Application 证书完整名称 |
| `SCREENHELLO_MAS_INSTALLER_IDENTITY` | 3rd Party Mac Developer Installer 证书完整名称 |
| `SCREENHELLO_MAS_PROFILE` | 有效的 Mac App Store distribution provisioning profile 的本地路径 |

已有 `MACOS_CERTIFICATE_P12_BASE64` 用于 Developer ID 直装签名，不能凭存在这个 secret 推定已有 MAS 签名材料。`APPLE_ID` / app-specific password 也不能替代证书和 profile。

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
pnpm desktop:store:package --channel mas --arch universal --output artifacts/stores/mas-001
```

`--arch arm64` / `--arch x64` 只生成相应架构，可用于诊断；提交首选 universal，仍需分别在 Apple Silicon 与 Intel 上测试。

GitHub Actions 手动运行 `macOS MAS Universal Candidate` 时，确认项选择 `package-mas-universal-candidate`，首次上传的 build number 可用 `1`。工作流从仓库 Variables 读取 bundle/certificate identity，从 Secrets 读取两张空密码 P12、Team ID 和 profile；它使用临时钥匙串，结束时清理证书、profile 和钥匙串。PKG 产物只代表签名与结构检查通过，安装、双架构 GUI、App Store processing 和审核仍分别记录为未执行。

当前权限声明 App Sandbox、用户选择文件读写、匹配的 application/team identifier，以及 WebKit 初始化需要的 `network.client`；没有网络服务端、全盘访问或临时沙箱例外。[Tauri 上游白屏问题及维护者说明](https://github.com/tauri-apps/tauri-docs/issues/3171) 记录了仅加载打包内容也可能需要该客户端权限。这是沙箱能力声明，不是实际传输统计；应用网络行为仍需结合 CSP 与运行记录验收。Store 编译开关关闭使用共享 `/tmp` socket 的单实例插件，系统状态如实返回 `singleInstance: unavailable`。直装版继续启用原有插件。MAS feature 禁止与 runner-only test driver 同时启用。

打包入口检查 profile 过期/Team/app identity/开发权限/设备绑定，验证 app 的架构、代码签名、实际 entitlements、Bundle ID/build number 与嵌入 profile，再用 Installer identity 生成 PKG 并检查签名。它清除直装公证环境变量；MAS 不走 Developer ID notarization。

Tauri 会按源文件权限把 provisioning profile 原样嵌入 app，`productbuild` 也保留该权限放进 PKG。导入步骤在 `umask 077` 下解码 profile（这是保护私钥文件所必需的），因此打包入口改为把 profile 复制成权限 `0644` 的暂存副本再嵌入，并断言包内 `embedded.provisionprofile` 为 `0644`。否则 App Store Connect 校验会以 HTTP 409 `STATE_ERROR.VALIDATION_ERROR` 拒绝整包，理由是“installer package includes files that are only readable by the root user”。

必须继续处理并在真实沙箱中验证：

1. 文件选择后的授权、取消、输出目录、原子写入使用同目录临时文件，以及自动追加扩展名。当前 PathBuf/token 不能证明具备安全范围权限；需要按测试结果引入 security-scoped URL / NSFileCoordinator，或明确要求重新选择输出目录。
2. 截图后端当前依赖 xcap 的 macOS CGWindow 路径；需评估弃用 API 与当前审核要求，迁移 ScreenCaptureKit 并验证允许/拒绝/撤销授权。不能只凭已签名推定截图可上架。
3. WKWebView 的本地资源、WASM 编码器、菜单/弹层、剪贴板、快捷键、托盘、退出确认和离线导出；需要实际用户可见 GUI 证据。
4. universal 最终包的全部原生代码架构、App Privacy、审核说明、真实截图、地区/年龄分级与 App Store Connect processing。

## Microsoft Store

| 变量 | 来源 |
| --- | --- |
| `SCREENHELLO_MSIX_IDENTITY_NAME` | Partner Center → Product identity → Package/Identity/Name |
| `SCREENHELLO_MSIX_PUBLISHER` | 同页面 Package/Identity/Publisher，完整 `CN=...` |
| `SCREENHELLO_MSIX_PUBLISHER_DISPLAY_NAME` | 同页面发布者显示名 |
| `SCREENHELLO_MSIX_VERSION` | 明确选择的四段版本，首段非零、末段为零、每段不超过 65535；先核对已有包 |
| `SCREENHELLO_WEBVIEW2_RUNTIME_DIR` | 微软 Fixed Version Runtime 解包目录，根下含当前架构 `msedgewebview2.exe` |
| `SCREENHELLO_MAKEAPPX` | Windows SDK 的 MakeAppx.exe 绝对路径 |

在对应原生 Windows runner 上执行，分别选择匹配架构的 Runtime：

```powershell
rustup target add x86_64-pc-windows-msvc
pnpm desktop:store:package --channel msix --arch x64 --output artifacts/stores/msix-x64-001
```

```powershell
rustup target add aarch64-pc-windows-msvc
pnpm desktop:store:package --channel msix --arch arm64 --output artifacts/stores/msix-arm64-001
```

不继承 NSIS 下载 bootstrapper 的逻辑。脚本检查 Runtime PE 架构和微软 Authenticode 签名，将固定 Runtime 临时放入忽略目录 `src-tauri/store-webview2/<arch>`，编译相同相对路径并复制到包内；完成或失败后清理本次临时目录。Runtime 的下载来源、版本、原始压缩包 SHA-256 与更新周期仍需在正式 CI 固定。

Manifest 声明 `runFullTrust`，用于本地桌面程序的文件、剪贴板、截图与窗口交互；没有自动提权。最低候选目标是 Windows 10 2004（19041），这是配置值，尚不是最低系统实机验收结论。

MakeAppx `pack` 保留默认校验，不使用 `/nv`；随后 `unpack` 核对 manifest、主程序与 WebView2 字节。输出为未签名商店候选 MSIX；微软在认证后重新签名。侧载测试需对**临时副本**签名和建立测试信任，不能把自签名包标为已获商店签名。

仍需两架构分别验证：无预装 WebView2/离线启动、文件与截图权限、全部导出格式、同身份升级、卸载、WACK、受限 capability 说明、Store 实际下载安装。ARM 上 x64 模拟启动不能替代原生 ARM64 验收。

## 后续实施顺序

1. 已取得候选 `e66d2c0` 六目标可下载测试件、42 项文件哈希和完整自动审计通过，见 [本轮开发记录](./desktop-build-rollout-2026-09-17.md#最终六目标结果与下载)；继续人工安装、GUI 和升级验收。
2. 补齐两个商店应用身份、版本和签名材料；在原生 runner 跑本文件的打包命令，修复真实打包失败。
3. MAS 沙箱文件/截图后端适配及双架构 GUI 回归；MSIX 双架构清洁侧载、升级和 WACK。
4. 把已验证的命令接入独立、手动触发的 Store CI，固定 Runtime 来源、工具链、证书清理和产物证据。
5. 补齐商店资料，上传候选并分别记录 processing、审核、获批与公开分发状态。

## 官方核对来源（2026-09-17）

- [Tauri Mac App Store 分发](https://v2.tauri.app/distribute/app-store/)
- [Apple 审核规则 §2.4.5 / §2.5.1](https://developer.apple.com/app-store/review/guidelines/)
- [Apple 沙箱文件访问](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)
- [Microsoft Store MSIX 要求](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)
- [MakeAppx 支持的命令](https://learn.microsoft.com/en-us/windows/win32/appxpkg/make-appx-package--makeappx-exe-)
- [WebView2 分发](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)

第七阶段接入公开仓库的 MAS universal 签名候选工作流、空密码 P12 临时钥匙串、失败清理、全 Mach-O 双架构检查及 GitHub artifact 证据；详见[开发记录](./desktop-store-phase-7-2026-09-18.md)。商店上传与实机验收仍独立待办。
