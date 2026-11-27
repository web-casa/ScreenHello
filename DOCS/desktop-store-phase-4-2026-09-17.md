# 商店适配第四阶段：ScreenCaptureKit 技术验证入口

日期：2026-09-17。承接 [MAS 保存目录授权](./desktop-store-phase-3-2026-09-17.md)。本轮完成 API 核对、独立验证工具和运行结果校验，**没有切换生产截图后端，尚未执行 macOS 编译与截图**。

## 核对结果与版本决策

1. 当前 xcap 0.9.8 使用 CGWindowListCreateImage；查询日 [xcap 上游 capture.rs](https://github.com/nashaofu/xcap/blob/master/src/macos/capture.rs) 也仍调用此 API。因此不能通过单纯升级 xcap 宣称已经完成迁移。
2. Apple 的 [SCScreenshotManager](https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager) 官方 DocC 元数据列出 macOS 14.0 起可用；已核对 [captureImage 的异步签名](https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager/captureimage(contentfilter:configuration:completionhandler:))，它返回 CGImage。ScreenCaptureKit 框架存在不等于该单帧 API 在所有旧系统可用。
3. 当前产品最低 macOS 11.0 不变。建议未来 MAS 使用 macOS 14+ 的单帧路径，但需要结合实际支持决策、Intel/Apple Silicon 验收后调整；不能把探针的 14.0 编译目标静默写入所有直装包。
4. [screencapturekit-rs](https://github.com/doom-fish/screencapturekit-rs) 是可选 Rust 封装，上游还包含 Swift bridge 与多个系统版本 feature。尚未将它加入项目依赖，避免在没有原生编译证据时同时升级工具链与生产后端。另一条候选路线是使用现有 objc2 生态的绑定；均须核对回调生命周期、弱链接、线程和最低 SDK 后再定案。

## 独立工具

新增 `scripts/native/screencapturekit-probe.swift` 和 `scripts/screencapturekit-probe.mjs`，不链接进 Tauri 应用、没有新增产品 IPC 权限或生产能力声明。

在装有完整 Xcode、选定 command line tools 的 Mac 上，使用项目固定 Node/pnpm：

```bash
# 只编译两个架构，不请求截图权限或读取屏幕。
pnpm desktop:probe:sck --output artifacts/sck-build-001

# 明确同意截取当前主屏；仍会经过 macOS 系统授权。
# 每次使用新的输出目录，避免覆盖已有验证证据。
pnpm desktop:probe:sck --output artifacts/sck-capture-001 --capture-main-display
```

第一条对 ARM64 和 x86_64 分别以 macOS 14.0 为最低目标编译，检查 Mach-O 架构，记录源码/执行脚本/二进制 SHA-256、Xcode/SDK/系统版本。

第二条只执行当前主机架构的探针：明确参数后才检查/请求屏幕捕获权限，定位主屏，按原生像素尺寸配置 SCScreenshotManager，验证输出尺寸。没有音频捕获，不输出窗口标题、屏幕 ID、图片字节或截图文件；图像仅短暂存在该独立进程内存。编译两个架构不等于两种硬件均已运行截图。

父进程为截图探针设置 30 秒超时。拒绝权限、找不到主屏、像素预算超限、尺寸不符、异常响应、进程失败或超时均不写成通过；过滤原生错误详情，避免日志带入本地路径或窗口信息。系统授权耗时超过期限也算本次失败，应完成系统授权后用新目录重跑。

输出 `evidence.json` 始终保留 `releaseReady: false` 和 `productionIntegration: not-run`。默认 capture 为 not-run；编译失败只保留已经完成的架构记录，命令非零退出。环境发现阶段失败可能还未产生 evidence.json，不能把目录存在当作验证成功。

## 验证边界

- 本地六项单测通过：双架构编译参数、拒绝未知架构、结果字段/像素预算、拒绝权限与超时、非 macOS 主机拒绝运行。
- `pnpm lint`、`pnpm build` 和 diff 空白检查通过；构建仍有既有大 chunk 提示。
- 本机 Linux 实际调用明确返回 `sck-probe-native-macos-required` 并非零退出；没有创建假成功证据。
- Swift 源码依据官方 API 签名编写，但本机没有 Apple SDK 或 Swift 编译器，**Swift 编译、两个架构运行、TCC 与 MAS 沙箱均未执行**。
- 探针只检查主屏单帧 API 与尺寸，不验证图像视觉正确性、窗口截图、区域截图、HDR、混合缩放多屏、应用隐藏恢复或资源释放压力。
- 这是独立 CLI，权限可能归属于终端或探针进程；通过也不证明 ScreenHello 的 bundle identity/TCC、MAS 沙箱或现有 token 授权链通过。

## 接入前必须完成

1. 在真实 Mac 上编译探针，并在 Apple Silicon/Intel 分别执行允许、拒绝、撤销权限、无显示器与预算超限检查。仅使用不含敏感信息的测试桌面；本工具不保存截图，因此视觉验收需后续专门方案。
2. 决定 MAS 最低系统版本和直装旧系统策略。若选 14.0，先更新渠道配置与证据校验，不无条件修改公共默认最低版本。
3. 独立封装生产截图适配器，保留现有 owner/token/时效/一次性消费、主屏原生意图、取消、窗口恢复与 PNG 大小校验。
4. 将 ScreenCaptureKit 的点坐标、原生像素、缩放、多屏负坐标和窗口范围与现有 region 契约逐项对齐；失败不得自动回退旧 API 以掩盖权限拒绝。
5. 双端一致地更新 backend 标识、schema 校验与验收脚本，再生成真实 MAS 候选。只有候选运行证据齐全后才能描述为生产迁移完成。

后续更新：双主机原生编译和未授权启动保护已在[第五阶段](./desktop-store-phase-5-2026-09-17.md)通过。默认入口现在还执行不带截图参数的启动保护检查；真实截图和生产接入仍未执行。
