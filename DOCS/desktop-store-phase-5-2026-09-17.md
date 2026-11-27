# 商店适配第五阶段：ScreenCaptureKit 原生编译证据

日期：2026-09-17。承接[第四阶段](./desktop-store-phase-4-2026-09-17.md)。本轮通过公开仓库 macOS runner 验证 Swift 源码的实际编译，并执行不允许截图时的本机启动检查。

## 公开候选与结果

- 仓库：`web-casa/ScreenHello`。
- 专用分支：`build/screencapturekit-probe-20260917`，未合并 main、未发布 Release。
- 成功提交：`4a5881ebd0e04c0250785b12abd028e5105d4a00`。
- [成功 Actions 运行](https://github.com/web-casa/ScreenHello/actions/runs/35227236313)。
- 本次只从已公开的源码基线增加独立探针及工作流，不表示本地此前全部商店改动已同步或生成应用安装包。

| 原生主机 | 系统 / 工具链 | ARM64 编译 | x86_64 编译 | 本机未授权保护 |
| --- | --- | --- | --- | --- |
| Apple Silicon | macOS 14.8.9 / Xcode 15.4 / SDK 14.5 | 通过 | 通过 | 通过 |
| Intel | macOS 15.7.9 / Xcode 16.4 / SDK 15.5 | 通过 | 通过 | 通过 |

保护检查以**不带截图参数**启动本机架构探针，要求固定的 `capture-consent-required` 响应与退出码 2。它证明程序能在相应原生主机启动，并在应用层显式同意之前退出；不调用系统截图授权、不采集屏幕。默认命令现在除了编译，还会执行这一安全启动检查。

两个 runner 都编译两种架构，但每个 runner 只启动其本机架构，不把交叉编译写成目标硬件运行。14.8.9 的执行证据也不能冒充对原始 macOS 14.0 的完整验收。

## 下载与本地复核

产物下载至 `artifacts/sck-native-4a5881e/`，复核摘要保存于 `artifacts/sck-native-verification-4a5881e.json`（本地证据，不作为产品资源）。

本地逐一比较 Swift 源码/执行脚本哈希与远端 evidence，使用已有 `inspectBinaryHeader` 解析 Mach-O，并核对四个二进制 SHA-256：

| 编译主机 | 二进制架构 | SHA-256 |
| --- | --- | --- |
| ARM64 | ARM64 | `6a1dfb9b7b45f1f0399e1649739f28225c7305da7df0b2de6a6371e7c05aa578` |
| ARM64 | x86_64 | `878a17094707e4b528f4323ca3fd2156da523e56794414ccb654dc1b21644d71` |
| Intel | ARM64 | `44a409153267a805b8073d5454eddd79a8342cb3ffd4c9813afea72d7a7f760a` |
| Intel | x86_64 | `5f17c69acfe6f16845a88c2a7ab8e9e74d848b18718b7ab77067dabdb48a5983` |

不同 Xcode/SDK 的二进制哈希不同是预期结果；每份文件与对应构建的记录匹配。全部记录仍为 `releaseReady: false`、`capture.status: not-run`、`productionIntegration: not-run`。

## Review 与修复

[首次运行](https://github.com/web-casa/ScreenHello/actions/runs/35227067282)失败：Swift 已产出 ARM64 二进制，但 `lipo -verify_arch` 的输入顺序错误，导致没有形成成功的架构记录。将调用改为 `lipo <binary> -verify_arch <arch>`，并增加有界工具链错误输出；截图进程仍只使用严格结果解析，不输出任意原生错误内容。新提交在两个主机均重新通过，保留首次失败，不覆盖成成功。

工作流仅 contents:read、固定 GitHub-owned Action SHA、固定公开仓库 ID，不读取签名 secret，不上传商店。显式推送到公开仓库专用分支，未推送私有 origin。GitHub runner 标签已按[官方说明](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)核对。

本地六项探针单测、lint、Web 构建通过；构建仍有既有 chunk 体积提示。文档和 diff 空白检查通过。

## 尚未完成及下一步

本轮没有执行真实截图、TCC 允许/拒绝/撤销、窗口/区域截图、多屏/Retina、PNG 导出、MAS 沙箱或 ScreenHello 内部调用链。CI 不自动传入 `--capture-main-display`，因此没有生成屏幕图像。

下一步可在已验证的 API 基础上实现生产适配器，并保留现有 token/owner/超时/取消/窗口恢复边界；接入前明确 MAS 最低系统版本和旧系统策略。随后在具备用户交互授权的 Mac 上使用测试桌面验收实际截图，再生成 MAS 候选。生产当前仍使用旧截图后端，不能把探针编译通过描述为迁移完成。
