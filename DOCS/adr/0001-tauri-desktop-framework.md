# ADR 0001：桌面框架采用 Tauri 2

- 状态：候选已接受，仍受 Phase 9.3 三平台 Gate 约束
- 日期：2026-09-05
- 决策范围：桌面 MVP 的应用壳与原生能力边界，不代表安装包已可正式分发

## 背景

ScreenHello 先完成 Web 产品，再复用同一 React 编辑器建设 Windows、macOS 与 Linux 桌面版。桌面端需要本地项目文件、图片剪贴板、显示器/窗口/区域截图、全局快捷键、托盘和单实例，同时必须保持纯本地、无账号、无云同步，并避免把任意文件系统或系统命令暴露给 WebView。

Phase 9.0～9.2 已证明 Tauri 2 可以提供独立桌面入口、最小 capability/CSP、有界 Rust command、raw IPC 和系统能力适配，而 Web/PWA/library 不需要承担桌面运行时代码。Linux aarch64 的真实 WebKitGTK runtime 已覆盖编辑器启动、项目/图片 I/O、PNG 剪贴板、640×480 截图与编辑器导入、快捷键注册、托盘状态及单实例退出。

## 决策

桌面 MVP 继续采用 Tauri 2，不并行实现 Electron 对照壳。理由如下：

1. 现有 Web 编辑器可以复用，桌面入口和 `dist-desktop/` 又能与 PWA/library 明确隔离。
2. capability、CSP 与显式 Rust command 适合当前最小权限模型；文件路径、原生窗口 ID、PID、环境变量和底层错误不进入 WebView。
3. Node.js 只用于构建和测试，不进入最终桌面运行时。
4. 当前原生能力没有出现需要 Node/Electron 主进程才能解决的关键阻断。

该选择只授权继续桌面 MVP 开发。Phase 9.3 的同 SHA 三平台自动 Gate 必须通过；系统 picker、托盘视觉、多显示器/DPI/负坐标、平台权限、Wayland、远程桌面和无显示器仍需人工或受控环境验证。上述人工项未通过前，`releaseReady` 必须保持 `false`。

## 三平台验证契约

公开候选把“源码 × OS × 架构 × 渠道”作为交付单位。本轮渠道固定为 `github-actions-unsigned-test`，runner 为 Ubuntu 24.04 x64、Windows Server 2025 x64、用户确认的 `macos-14` Apple Silicon。每个平台固定 Node 24、pnpm 10.12.1、Rust/Cargo 1.96 和锁文件，执行 JS/Rust/许可/依赖审计、真实 WebView runtime、无签名原生产物构建、包内身份/版本/架构/payload 检查、CycloneDX SBOM 与 SHA-256 摘要。

macOS 没有 Tauri 官方 `tauri-driver` 支持，因此三平台统一使用 `tauri-plugin-wdio-webdriver` 的 runner-only Cargo feature 驱动 runtime。该插件提供无认证的 loopback 自动化接口，绝不能进入生产：CI 必须先构建并运行测试 feature，随后执行 `cargo clean`，再从无 feature 状态构建普通 bundle，并对 production dependency tree 和 binary marker 做排除审计。测试 feature binary 不得上传。

CI 只拥有 `contents: read`，只上传保留 14 天的无签名测试证据；它不创建 tag、GitHub Release、deployment、npm 发布、签名、公证或自动更新渠道。三平台证据必须绑定同一个 40 位公开 commit SHA，汇总器会拒绝跨 SHA、runner/arch 漂移、缺失/篡改产物、敏感字段以及把人工项伪造成通过。

## 后果与复审条件

- 好处：保留单一编辑器内核、较小原生壳、清晰 IPC/权限边界和平台原生 WebView。
- 成本：Rust 与三套系统 WebView/签名链带来平台差异；`xcap` 的 Linux GTK/PipeWire 传递链需要持续 RustSec 与维护状态复审。
- 若同一关键需求在受支持平台持续无法通过，或安全/维护成本超过可接受阈值，再以相同验收表建立 Electron 备选 PoC；不能先维护两套生产壳。
- 正式分发仍需独立决策：平台首发顺序、真实设备人工矩阵、代码签名、Apple notarization、更新签名、公开不可变 tag、SBOM/attestation 与回滚方案。
- Mac App Store 与 Microsoft Store 是独立渠道，不继承本轮 APP/NSIS 结果。MAS 需另验 sandbox/profile/entitlements/隐私/TCC 与商店包；Microsoft Store 需取得 Partner Center 身份并另建 MSIX/版本/WACK/侧载矩阵。任何一条商店路线都不能由“CI bundle 成功”直接推出“可上架”。
