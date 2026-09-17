# ADR 0001：桌面框架采用 Tauri 2

- 状态：Accepted；三平台自动技术 Gate 已通过，正式分发仍受人工/渠道 Gate 约束
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

该选择只授权继续桌面 MVP 开发。Phase 9.3 的同 SHA 三平台自动 Gate 必须通过；Phase 4 已把未授权截图拒绝和有限能力响应加入候选 Gate，但系统 picker、托盘视觉、多显示器/DPI/负坐标、平台权限、Wayland Portal、远程桌面和无显示器仍需人工或受控环境验证。上述人工项未通过前，`releaseReady` 必须保持 `false`。

依据：公开候选 `486ba005f374ca2430bad64258452eec117ec49f` 的 [三平台自动 Gate](https://github.com/web-casa/ScreenHello/actions/runs/33949585116) 与下载后摘要/包内复核均通过，未出现需要切换框架的关键阻断。后续候选继续以各自同 SHA 证据验收；CI 图像中的 Linux 缺字已在 runner 前置依赖补 CJK 字体，并要求重新验证截图。

Phase 8 已把 macOS ARM64 与 Intel 的签名候选分别固定到仅私有 main、手动确认和受保护 Environment 可进入的 workflow；Phase 9 加入 Windows x64 Authenticode/RFC 3161 候选，Phase 10 又以同样隔离方式加入 Windows ARM64 候选与显式 Rust target，Phase 11 定义 Linux x64/arm64 DEB 的受保护 APT 仓库签名候选，Phase 12 追加内部客户端信任包、双键重叠和带外撤销响应契约，Phase 13 再在签名临时材料清理后为五条链路定义最小 OIDC/GitHub provenance 契约，Phase 14 增加下载候选的本地预检、严格 GitHub CLI 验证参数和候选目录外收据，Phase 15 再增加最终候选重检和收据关联复核，Phase 16 追加候选绑定的平台人工验收计划、未执行模板和 evidence 复核，Phase 17 再追加同一 immutable SHA 的跨候选汇总复核，Phase 18 则在汇总完整通过后于 bundle 外固定当前计划与记录哈希。它们都保留无签名 Gate 的权限边界，且均尚无实际 Apple 签名、公证、Authenticode 时间戳、Linux 远端仓库、GitHub attestation、客户端 rollout 或安装证据。详见[跨平台桌面 Phase 18](../desktop-cross-platform-phase-18.md)。

Phase 19 只消费已复核的 Phase 18 档案，重新校验五候选、11 个 attested payload 的 SHA-256 并写入另一候选外目录；它不改变无签名 Gate 的权限边界，也不把本地交接清单视为实际签名、平台验收或发布证据。Phase 20 再以固定 numeric repository ID 保护私有候选身份，并新增只读 GitHub 配置预检；Phase 21 进一步要求 Enterprise Cloud entitlement、精确 selected Actions policy 和 GitHub-owned SHA-pinned Action / 本地 Corepack bootstrap 供应链。它们同样不运行签名或发布。当前边界见[跨平台桌面 Phase 21](../desktop-cross-platform-phase-21.md)。

## 候选验证契约

公开候选把“源码 × OS × 架构 × 渠道”作为交付单位。Phase 9.3 的历史三平台证据使用 Ubuntu 24.04 x64、Windows Server 2025 x64 与 `macos-14` Apple Silicon。Phase 2 的当前配置将无签名 `github-actions-unsigned-test` 扩展为 Linux x64/arm64（Ubuntu 22.04）、macOS x64/arm64（`macos-15-intel` / `macos-14`）和 Windows x64/arm64（`windows-2025` / `windows-11-arm`）；PR 保持三项基础 Gate，手动 Gate 才执行六项。Phase 3 将 AVIF/WebP/PNG scalar Worker/WASM、严格同前端协议/host 资源校验和真实 WebView codec smoke 加入每个候选；Phase 4 再加入有限截图能力与未授权调用拒绝，Phase 5 再加入脱敏本地状态标记和安装/升级/卸载本地数据人工项，Phase 6 以当时 schema v7 固定无签名候选隔离与正式发布信任前提，Phase 7 至 Phase 10 依次加入 macOS ARM64、macOS Intel、Windows x64 和 Windows ARM64 签名候选，Phase 11 定义 Linux x64/arm64 DEB APT 仓库签名候选，Phase 12 将当时契约升至 schema v13 并加入内部客户端信任包、双键重叠和撤销响应，Phase 13 定义 provenance，Phase 14 定义下载候选后的本地预检和严格 GitHub CLI 验证收据，Phase 15 定义最终候选重检和收据关联复核，Phase 16 定义候选绑定的平台人工验收计划、未执行模板和 evidence 复核，Phase 17 定义同一 immutable SHA 的五候选、六平台汇总复核，Phase 18 再将当前契约升至 schema v19 并将完整汇总和五份 record 哈希绑定为候选外本地审查档案。当前配置仍未生成新的远端候选、签名、attestation、收据、平台验收或公开发布证据，详见[跨平台桌面 Phase 18](../desktop-cross-platform-phase-18.md)。每个平台固定 Node 24、pnpm 10.12.1、Rust/Cargo 1.96 和锁文件，执行 JS/Rust/许可/依赖审计、真实 WebView runtime、无签名原生产物构建、包内身份/版本/架构/payload 检查、CycloneDX SBOM 与 SHA-256 摘要。

当前 schema v24 的 Phase 24 在保留 Phase 19 交接清单、Phase 20 numeric repository ID、Phase 21 GitHub 预检、Phase 22 Corepack 隔离和 Phase 23 six-versus-five 载荷划分的同时，把每个交接绑定到 immutable candidate commit 的公开源码导出快照。它按提交 blob 读取版本和 allowlist，审计生成的公开树，并固定 `treeSha256`；公开目标仍必须在将来的受保护 workflow 中重建并匹配快照。它不产生新的远端候选、跨仓库凭据、签名、attestation、收据、平台验收或公开发布证据，详见[跨平台桌面 Phase 24](../desktop-cross-platform-phase-24.md)。

macOS 没有 Tauri 官方 `tauri-driver` 支持，因此三平台统一使用 `tauri-plugin-wdio-webdriver` 的 runner-only Cargo feature 驱动 runtime。该插件提供无认证的 loopback 自动化接口，绝不能进入生产：CI 必须先构建并运行测试 feature，随后执行 `cargo clean`，再从无 feature 状态构建普通 bundle，并对 production dependency tree 和 binary marker 做排除审计。测试 feature binary 不得上传。

CI 只拥有 `contents: read`，只上传保留 14 天的无签名测试证据；它不创建 tag、GitHub Release、deployment、npm 发布、签名、公证或自动更新渠道。每个 scope 的证据必须绑定同一个 40 位公开 commit SHA，汇总器会拒绝跨 SHA、scope、runner/arch 漂移、缺失/篡改产物、敏感字段以及把人工项伪造成通过。

## 后果与复审条件

- 好处：保留单一编辑器内核、较小原生壳、清晰 IPC/权限边界和平台原生 WebView。
- 成本：Rust 与三套系统 WebView/签名链带来平台差异；`xcap` 的 Linux GTK/PipeWire 传递链需要持续 RustSec 与维护状态复审。
- 若同一关键需求在受支持平台持续无法通过，或安全/维护成本超过可接受阈值，再以相同验收表建立 Electron 备选 PoC；不能先维护两套生产壳。
- 正式分发仍需独立决策：平台首发顺序、真实设备人工矩阵、代码签名、Apple notarization、更新签名、公开不可变 tag、SBOM/attestation 与回滚方案。
- Mac App Store 与 Microsoft Store 是独立渠道，不继承本轮 APP/NSIS 结果。MAS 需另验 sandbox/profile/entitlements/隐私/TCC 与商店包；Microsoft Store 需取得 Partner Center 身份并另建 MSIX/版本/WACK/侧载矩阵。任何一条商店路线都不能由“CI bundle 成功”直接推出“可上架”。
