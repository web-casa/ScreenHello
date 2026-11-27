# MAS / Microsoft Store 上架要求与 Skills 调研

调研日期：2026-09-17。代码基线：`0c342e2`；已验证的直装候选：`e66d2c0`。本次为官方资料核对与静态检查，没有生成或安装新的商店包，也没有上传商店、安装 Skill 或更改生产代码。

## 结论与当前证据

需要继续做商店适配，但目前没有证据要求更换 React / Tauri。六目标直装构建通过，只能证明相应构建与已执行检查成功，不能代替 MAS 沙箱、MSIX 安装、商店元数据和审核验收。现有独立打包入口、最小权限、身份校验与禁止自动发布的边界应保留。

已有实现与命令见 [商店打包指南](./desktop-store-packaging.md)，直装证据见 [构建记录](./desktop-build-rollout-2026-09-17.md)。MAS / MSIX 脚本尚未在对应原生系统完成执行和功能验收。

## 应调整的项目（按实施顺序）

### 1. 桌面隐私政策、帮助入口与真实网络边界

**上架前必须完成。** Apple 要求所有应用在 App Store Connect 和应用内提供可访问的隐私政策；Microsoft 明确要求 Win32 / Desktop Bridge 应用提供隐私政策，即使应用主要在本地处理数据。[Apple 审核指南 5.1.1](https://developer.apple.com/app-store/review/guidelines/)、[Microsoft Store 政策 10.5](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies)。

代码证据：`src/components/header/HelpCenter.jsx` 的隐私说明仍以浏览器数据为主，关于窗口显示 `ScreenHello Web`，外链通过 anchor 打开。网站已有隐私内容，不能称为完全没有政策；缺口是桌面适用范围、完整政策入口和原生环境可达性。

建议补充稳定的公开桌面隐私/支持 URL，说明运营者及联系方式、本地图片与项目、权限用途、保留与删除方法、外部链接及第三方运行时；按平台显示正确产品名称，并测试默认浏览器打开帮助与政策。如需原生 opener，限制为明确允许的 HTTPS 目标，不扩大为任意命令执行。

特别注意：`src/utils/privacyMonitor.js` 监控页面通道，不能覆盖 Rust、系统及 WebView2 进程。微软说明 WebView2 有必要和可选诊断数据；默认启用的 SmartScreen 也有告知要求。应核对实际配置、抓取整个应用进程的联网证据，再写准确披露；不要为了声称零流量而盲目关闭安全功能。[WebView2 数据与隐私](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/data-privacy)。

Apple 的 App Privacy 要按实际应用及第三方行为填写，不能单凭页面显示 0 B 选择“不收集数据”。本地处理不自动等于开发者收集；Windows 的 WebView2 行为也不能直接套到 macOS 的 WKWebView。[Apple 隐私标签说明](https://developer.apple.com/app-store/app-privacy-details/)。

验收：两平台政策链接可达；政策与实际网络、删除行为一致；支持联系有效；商店隐私问卷由实际证据支撑。

### 2. MAS 文件授权与原子保存

**高优先级功能风险，需要真实沙箱验证。** `src-tauri/src/native_files.rs` 将对话框结果转换为 PathBuf，并在目标父目录创建临时文件后原子替换。用户选择一个文件，不等于授予整个父目录的任意写入能力，因此临时文件、自动追加扩展名、覆盖保存等路径需要重点测试。

不能把“没有 bookmark”直接判为漏洞：系统打开/保存面板会自动授予所选 URL 的访问；跨重启复用外部 URL 才需要评估持久化 security-scoped bookmark。当前内部最近项目并不必然需要外部文件 bookmark。[Apple 沙箱文件访问](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)。

建议按失败路径保留原生 URL 授权生命周期，必要时使用文件协调或让用户选择输出目录；不要通过全盘权限或取消原子保存来掩盖问题。验收覆盖导入、首次导出、覆盖、无扩展名、取消、只读目录、外部卷、重启及授权失效。

### 3. macOS 截图后端现代化与系统最低版本

**高优先级兼容性改造，不应描述为已确定被拒审。** Cargo.lock 当前为 xcap 0.9.8；已检查该依赖的 macOS 实现，实际调用 `CGWindowListCreateImage`。Apple 已弃用此 API，并推荐 ScreenCaptureKit 路径。[Apple macOS 15 发布说明](https://developer.apple.com/documentation/macos-release-notes/macos-15-release-notes)、[CGWindowListCreateImage](https://developer.apple.com/documentation/coregraphics/cgwindowlistcreateimage)。

建议做 ScreenCaptureKit 技术验证，明确系统版本可用性和回退策略，再决定 MAS 最低 macOS 版本。迁移须保留当前 owner 隔离、一次性授权、超时、取消及权限撤销逻辑；验收多显示器、Retina、窗口截图、允许/拒绝/撤销权限及窗口恢复。

现配置最低 macOS 11.0，当前 macOS 14/15 runner 不能证明 11.0 兼容；Windows MSIX 最低 19041 也需对应系统验证。上架前应明确实际支持范围，并在最低系统与当前系统分别测试，不能用构建目标架构替代系统兼容性证据。

### 4. 加强商店打包与原生验收

| 渠道 | 已有基础 | 需要补齐 |
| --- | --- | --- |
| MAS | 独立 feature、sandbox entitlements、profile/签名检查、universal PKG 入口 | 实际 MAS 身份和证书；最终包所有原生代码的架构检查；隔离属性检查；加密出口合规配置；沙箱 GUI、升级和上传 processing 验收 |
| MS Store | 双架构 MSIX、身份/版本校验、固定 WebView2、打包解包检查 | 固定 Runtime 版本/来源/哈希及安全更新计划；原生安装、离线启动、升级、卸载、WACK；受限能力用途说明 |

MAS 已公证的 Developer ID DMG 不等于 MAS 可提交包；需匹配应用的 distribution profile、应用签名和 installer 签名材料。项目已有 secret 的名称不足以证明证书类型符合 MAS。[Tauri App Store 分发](https://v2.tauri.app/distribute/app-store/)。

Apple 自 2025-02-18 起拒收带 `com.apple.quarantine` 属性的相关 macOS 提交文件。建议在最终包检查中显式检测并记录结果。加密声明须根据实际依赖和用途确定，不能无依据写 `ITSAppUsesNonExemptEncryption=false`。[Apple 即将生效的要求](https://developer.apple.com/news/upcoming-requirements/)。

MSIX 的 `runFullTrust` 是 Win32 桌面应用能力，不等于请求管理员提权；应说明本地文件、截图和原生桌面功能用途，而不是删除所需能力或新增广泛文件权限。[Microsoft 能力声明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/app-capability-declarations)、[提交选项](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/create-app-submission)。

固定 WebView2 是本项目离线交付选择，不是商店统一强制要求；固定版本不自动更新，必须随应用维护安全版本。微软的部分 Windows 10 ACL 修复要求针对未打包应用，不应直接套到 MSIX。[WebView2 分发指南](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)。

ARM64/x64 可使用同一产品身份提交架构包，亦可后续生成 MSIX bundle。商店会对 MSIX 签名，不需要为了 Store 上传先购买第三方 CA 证书；本地侧载测试仍需有效的测试签名与信任配置。EXE/MSI 分发的签名规则不同。[MSIX 包要求](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)。

已只读检查直装候选的两架构 PE 直接导入表，未发现 VCRUNTIME140/MSVCP140 直接依赖；这不证明未来 MSIX 完整依赖闭包合格，也不支持盲目添加 VCLibs/.NET/Windows App SDK。以最终包及干净系统测试确定依赖。

验收必须包含两架构、无预装 Evergreen 的离线启动、项目保存/恢复、商店版与直装版并存、升级数据保留和权限拒绝。当前 `releaseReady: false` 应继续保持，直到相应证据补齐。

### 5. 商店资料、本地化、资产权利与账户事项

- MSIX 声明七种语言，但 Description 为固定英文，原生界面主要为中文/英文。核对实际覆盖范围，补资源本地化和每种商店语言的资料，或明确语言限制；不要以网页翻译存在推定原生流程完整翻译。[Microsoft Store 政策 10.7](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies)。
- 准备与最终包一致的截图、支持联系方式、截图权限使用步骤和审核备注；未实现的 GIF/代码卡片不能写成可用功能。Duo PSD 的可获得性不等于再分发授权，继续排除未确认授权的资源；包内素材与商店截图都要核对权利。
- App Store Connect 补新年龄分级问卷；若分发到欧盟，按实际经营情况完成 DSA trader 身份和联系信息要求，不替用户假定商家类别。[Apple 要求时间表](https://developer.apple.com/news/upcoming-requirements/)。
- 补真实 VoiceOver/Narrator、键盘导航、缩放/DPI、首次启动与离线流程检查；浏览器自动化通过不能代替商店包的桌面可访问性体验。

## 不应误加的要求

1. 当前没有账户体系、付费数字服务或用户社区，不能仅因上架就要求新增登录、账户删除、IAP、ATT 或内容审核系统；以后增加相应功能时再核对适用政策。
2. `PrivacyInfo.xcprivacy` 要按实际平台、SDK、数据收集和 API 要求审计。Apple 的隐私清单数据描述与 required-reason API 平台范围并不完全相同，不能照抄 iOS 模板或编造 reason code。[隐私清单](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files)、[Required-reason API](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api)。
3. Apple 2026-04-28 的 Xcode 26/SDK 公告所列为 iOS/iPadOS/tvOS/visionOS/watchOS，不能据此宣称所有 MAS 包同样被该条强制要求。应固定适用的现代 Xcode，并用实际 macOS 上传校验确认；不要沿用网页中陈旧版本示例。
4. Tauri 的网络客户端 entitlement 与真实数据上传不是同一回事；不能为让权限清单看起来更短而删除 WKWebView 所需能力。

## Skills 调研结果

已读取本地 `desktop-release-playbook` 和 `find-skills`，并查询技能索引及上游源码。下列外部技能仅作为调研资料，没有安装或执行其上传、签名、证书导入命令。安装量和仓库 stars 为查询日约数，不是质量或合规保证。

| Skill / 来源 | 查询快照 | 对本项目的用途与限制 |
| --- | --- | --- |
| 本地 `desktop-release-playbook` | 已安装 | 最适合继续作为跨平台发布主流程；增加项目专属商店证据清单即可，不必替换现有打包架构 |
| [github/awesome-copilot · apple-appstore-reviewer](https://github.com/github/awesome-copilot/blob/main/skills/apple-appstore-reviewer/SKILL.md) | 约 10.9K 安装；仓库 39,097 stars | 辅助审核材料、风险排序；GitHub 社区集合，并非 Apple 官方认证，内容偏 iOS，必须筛选 MAS 适用条目 |
| [Microsoft winapp-package](https://github.com/microsoft/winappCli/blob/main/plugins/winapp/skills/winapp-package/SKILL.md) / [winapp-manifest](https://github.com/microsoft/winappCli/blob/main/plugins/winapp/skills/winapp-manifest/SKILL.md) | Microsoft 上游仓库 1,257 stars；这些具体技能安装量未确认 | 适合检查 MSIX、资源与 manifest；winapp CLI 仍为 Public Preview，应固定版本并选用能力，不覆盖现有身份配置 |
| [github/awesome-copilot · msstore-cli](https://github.com/github/awesome-copilot/blob/main/skills/msstore-cli/SKILL.md) | 约 7.1K 安装 | 可辅助 Partner Center 状态、flight 与提交；CLI 自动项目识别列表未包含 Tauri，应使用已验证包，不假定 init/package 自动适配 |
| [rorkai · asc-submission-health](https://github.com/rorkai/app-store-connect-cli-skills/blob/main/skills/asc-submission-health/SKILL.md) | 约 7.3K 安装；仓库 1,030 stars | 社区 App Store Connect 检查；显式使用 MAC_OS，适合资料就绪度检查，不替代实际 GUI 验收及网页隐私问卷 |

发现一处索引过期：搜索结果仍列 `github/awesome-copilot@winapp-cli`（约 8.5K 安装），但查询日该仓库 main 中对应 SKILL.md 返回 404，目录树也未找到。应优先上表已核验存在的 Microsoft 上游技能，而非直接复制旧安装命令。Expo/EAS 和 WinUI 专用技能不适合作为本项目主流程。

如后续决定启用，可先审阅固定 revision，再选装；以下仅是候选命令，本次未执行：

```bash
npx skills add microsoft/winappCli --skill winapp-package
npx skills add microsoft/winappCli --skill winapp-manifest
npx skills add github/awesome-copilot --skill msstore-cli
npx skills add github/awesome-copilot --skill apple-appstore-reviewer
npx skills add rorkai/app-store-connect-cli-skills --skill asc-submission-health
```

外部 Skill 示例中的自动 publish、覆盖 manifest、导入信任证书和未固定 action 不应原样带入项目；复用现有受控签名、SHA 固定工作流及发布授权边界。

## 建议下一轮开发顺序

1. **政策与桌面帮助**：完成桌面隐私/支持内容和外链、产品标识、本地化清单；明确最低系统及商店语言。
2. **原生适配**：先做 MAS 沙箱文件与 ScreenCaptureKit 验证；同时补 MSIX Runtime 固定与更新策略、最终包检查和原生验收入口。
3. **真实商店候选**：提供已注册身份、MAS 签名材料与 Partner Center identity 后，构建两架构候选；做沙箱/侧载、升级、WACK、TestFlight 或受控测试分发。
4. **提交资料与审核**：核对素材权利、年龄分级、隐私、地区、商家信息及 reviewer 步骤，最后单独执行授权的提交。打包成功、上传成功和审核通过应分别记录。

需要后续确认的信息包括：实际 MAS Bundle ID 与签名材料、Partner Center 产品身份、支持联系人、目标最低系统/语言/地区、素材授权。凭据应继续放受控 secret/keychain，不放仓库或聊天。研究本身不需要这些敏感材料。
