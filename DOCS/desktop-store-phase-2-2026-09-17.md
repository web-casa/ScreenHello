# 商店适配第二阶段：受限的原生帮助链接

日期：2026-09-17。延续 [第一阶段](./desktop-store-phase-1-2026-09-17.md)，本轮完成帮助外链的代码接入，不表示整个商店适配已经完成。

## 实现

- 帮助中心的文档、反馈、源码链接在桌面环境通过 `desktop_open_help` 请求系统默认浏览器，保留 Web 环境的 anchor 行为。
- 桌面隐私说明增加 WebView2 官方隐私说明按钮。完整 ScreenHello 政策尚无正式 URL，未把草案或微软政策冒充本产品政策。
- IPC 只接受四个固定条目标识；Rust 枚举独立校验并映射到固定 HTTPS 地址，且只允许 main 窗口。调用者无法传入任意 URL、文件、协议、命令或浏览器可执行文件。
- 使用锁定版本 `open 5.3.3`，Windows 启用 `shellexecute-on-windows`，避免默认命令解释器路径；启动器在 blocking worker 中执行。实现参考 [open-rs 上游](https://github.com/Byron/open-rs)，本地核对所用版本源码。该依赖的 macOS/Linux 系统打开方式仍需实际渠道环境验证。
- 更新 command 注册、AppManifest 和 main capability，并同步桌面审计白名单；没有向前端暴露通用 shell/opener 权限。
- 桌面打开失败不回退到 WebView 内导航，返回固定错误码；界面提供七语言错误提示，不把含本地路径的系统错误展示给用户。组件卸载后不弹错误消息。
- Web anchor 无论点击成功或异常均移除；原生和浏览器目的地通过一致性单测约束。

## 验证与 review

- 前端相关单测：28 项通过，覆盖非法输入、原生调用、失败处理、浏览器元素清理及目标地址一致性。
- Rust 默认 feature：42 项通过；Linux 主机上的 `mac-app-store` feature：42 项通过。后者不等于 macOS 沙箱或 MAS 包验收。
- `pnpm lint`、`pnpm typecheck`、`pnpm audit:i18n`、`cargo fmt --check`：通过；国际化 651 个键，无缺失或占位符问题。
- `pnpm build`、`pnpm desktop:web:build`、`pnpm audit:desktop`：通过。大 chunk 提示仍存在。
- 初次新增目的地一致性测试未兼容 rustfmt 添加的 match 分支大括号而失败；修正提取表达式后重跑通过。未通过削减目标集合或放宽 HTTPS 白名单规避失败。
- 未在 macOS/Windows 安装包中执行真实浏览器启动，也没有执行商店上传。系统启动器报告成功不证明目标网页已加载、网络可达或用户已阅读。

## 原生验收与后续

需要在 MAS 沙箱、Windows ARM64/x64 MSIX、Linux 桌面实际点击四个入口，检查默认浏览器、无默认浏览器、离线、连续点击、关闭应用及辅助窗口拒绝。MAS 的系统启动方式若受沙箱限制，应改用适用的原生 Launch Services 路径，不能加广泛 shell 或沙箱例外掩盖问题。

运营主体、私密支持联系方式和正式隐私政策 URL 仍待维护者提供。随后完善政策发布与商店资料。接下来的核心工程工作仍是 MAS 文件授权/原子保存与 ScreenCaptureKit 验证，以及 MSIX 固定 Runtime 和原生安装升级验收，见 [总体调研](./desktop-store-readiness-research-2026-09-17.md)。
