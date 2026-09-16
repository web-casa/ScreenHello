# 跨平台桌面 Phase 4：截图权限与系统能力边界

## 状态

> 后续状态：本页中关于旧阶段或旧 schema 的表述只说明当时边界。当前契约为 [Phase 24](./desktop-cross-platform-phase-24.md) 的 schema v24：它保留既有 fail-closed 预检，并将 immutable candidate commit 的公开源码快照绑定到 direct-download/APT 交接，仍不改变本页历史结论或 `releaseReady=false`。

本阶段把桌面截图的系统差异收敛为有限的原生能力契约，并把权限拒绝与真实截图成功分开记录。它不代表 Linux Wayland Portal、macOS 屏幕录制、Windows 组织策略或远程桌面已经完成真机验收。六个原生候选仍全部是 `not-run`，没有新的远端候选、安装、签名或公开分发证据。

## 有界能力契约

`desktop_capture_capability` 是主窗口获准调用的一个只读 command。它只返回以下四个字段：

```json
{
  "schemaVersion": 1,
  "backend": "x11 | wayland-portal | macos-core-graphics | windows-gdi",
  "status": "ready | system-permission-required | portal-required | no-display",
  "sourcePicker": true
}
```

`sourcePicker` 只能在 `status: "ready"` 时为 `true`。前端要求响应恰好包含这四项、枚举值属于固定集合，并冻结复制后的对象；额外字段、错误类型或不一致的状态都会被拒绝。原生端不会把显示器名称、`DISPLAY`、会话类型、路径、PID、窗口 ID 或底层错误正文放入该响应。

这个能力结果不是授权，也不替代截图 token。来源仍要经过现有的一次性原生确认、owner-scoped token、尺寸/字节限制和消费后释放；在枚举、按 token 截取及主屏快捷键截取前都会重新检查能力状态。

## 平台行为

| 平台或会话 | 能力结果 | 当前用户体验 | 未完成边界 |
| --- | --- | --- | --- |
| Linux X11 且有显示器 | `x11` / `ready` | 保留原生确认后列出来源并截图 | 多显示器、DPI、远程桌面和物理安装仍需验收 |
| Linux Wayland | `wayland-portal` / `portal-required` | 不枚举窗口、不降级为不可靠路径；界面说明需要 ScreenCast Portal | 尚未实现 ScreenCast Portal 的来源选择、PipeWire 流和 GNOME/KDE 真会话验证 |
| Linux 无 X11 显示器 | `x11` / `no-display` | 不打开系统确认，不尝试截图 | 无显示器/服务会话仍是人工项 |
| macOS | `macos-core-graphics` / `system-permission-required`（未授权时） | 用户点击“请求系统权限”后，先确认本应用本次读取，再调用系统请求；拒绝时给出系统设置指引 | 首次提示、设置后重启、DMG 安装后的实际权限状态仍需真机验收 |
| Windows | `windows-gdi` / `ready` | 继续使用现有 GDI/xcap 截图和应用内来源列表 | 未接入 Windows Graphics Capture Picker；组织策略、RDP、无显示器和多 DPI 仍需实测 |

Wayland 的拒绝是刻意的安全边界。现有 `xcap` 在该会话下可能尝试 Screenshot Portal 或其他后备路径，但这不能提供可审计的 [XDG Desktop Portal ScreenCast](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.ScreenCast.html) 来源选择流程，也不能等同于 Wayland 支持。相关依赖本身也把 Wayland 特殊场景列为限制，见 [XCap](https://github.com/nashaofu/xcap)。

macOS 用 `CGPreflightScreenCaptureAccess` 查询状态，只在明确的 UI 操作和既有原生确认之后调用 `CGRequestScreenCaptureAccess`。全局快捷键不会静默触发系统授权。应用 bundle 的最低系统版本已设为 macOS 11.0，避免把该 API 用于其已知不可依赖的旧系统；系统仍可能要求用户在“屏幕与系统音频录制”中允许应用并重新打开。参见 Apple 的 [预检 API](https://developer.apple.com/documentation/coregraphics/cgpreflightscreencaptureaccess%28%29?changes=lat_3__2_4_1_1&language=objc)、[请求 API](https://developer.apple.com/documentation/coregraphics/cgrequestscreencaptureaccess%28%29?changes=_5_7&language=objc) 和 [系统设置说明](https://support.apple.com/guide/mac-help/allow-apps-to-use-screen-and-audio-recording-mchl592e5686/mac)。

Windows 的 `ready` 只表示当前 GDI 后端没有可预检的本机阻断条件；它不是系统 picker、组织策略通过或远程桌面支持的声明。Windows Graphics Capture 的 picker 行为仍需在后续阶段按 [Windows Graphics Capture](https://learn.microsoft.com/uwp/api/windows.graphics.capture?view=winrt-22621) 单独设计和验证。

## 候选 Gate 与证据

候选矩阵升级为 schema v5，增加 `captureCapability` 和 `editorImport` 两个必需 runtime check。真实 Tauri WebView smoke 会：

1. 调用并校验有限的能力响应；
2. 用无 consent 的 IPC 调用验证来源枚举和主屏截取都被拒绝；
3. 通过示例导入确认编辑器可接收图片，并验证 PNG 剪贴板、快捷键、托盘和单实例；
4. 默认把 `capture` 记录为精确的 `manual` 权限边界结果，而不是伪造截图成功。

只有设置 `SCREENHELLO_DESKTOP_CAPTURE_INTERACTIVE=1`，并由人工批准应用确认及任何系统提示时，runtime 才允许记录 `capture.status: "passed"`、来源数量、尺寸、字节数和导入结果。普通候选 Gate 的 `runtime.png` 是 WebView 截图，用于显示 smoke 状态；它不是系统屏幕内容已被成功截取的证明。

证据收集器同时验证能力后端与 runner 平台对应、`sourcePicker` 与状态一致、手动结果的固定理由、编辑器导入结果和所有原有摘要/SBOM/包载荷边界。这样 CI 可以证明未经同意的调用被拒绝，却不会声称自动批准了系统权限。

## 本阶段完成条件

- 原生 command、Tauri capability、生成 manifest、前端 validator 和 runtime evidence 使用同一个有限 schema。
- Linux Wayland、无显示器、macOS 未授权等状态在 UI 和 IPC 中都有固定、非敏感的失败结果。
- macOS 系统请求只由显式用户操作触发；主屏快捷键和 token 截取不会绕过该限制。
- schema v5 的候选审计拒绝跨平台后端、缺失能力检查、伪造编辑器导入或将权限边界伪装为截图成功的证据。
- 真实 Wayland Portal、macOS/Windows 物理权限和策略仍保留在矩阵的人工检查中。

Phase 8 现在定义 ARM64 与 Intel 两条 macOS 签名候选的 workflow 和静态约束；它们没有执行 Screen Recording 权限、真实截图、安装或公证验收，不能改变本页的人工边界。

## 后续阶段

安装、升级、卸载和桌面状态迁移已在[跨平台桌面 Phase 5](./desktop-cross-platform-phase-5.md)建立非破坏性标记和人工验收项；Phase 6 已把签名、公证、自动更新和商店分发前的信任边界固化为可审计契约，尚未启用任一渠道。Phase 1～3 的目标、打包和 codec 约束见[跨平台桌面 Phase 1](./desktop-cross-platform-phase-1.md)、[Phase 2](./desktop-cross-platform-phase-2.md)、[Phase 3](./desktop-cross-platform-phase-3.md)和[Phase 6](./desktop-cross-platform-phase-6.md)。
