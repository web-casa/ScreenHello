# 商店适配第六阶段：MAS ScreenCaptureKit 适配器

日期：2026-09-17。承接[第五阶段原生探针](./desktop-store-phase-5-2026-09-17.md)。本轮把单帧截图接入现有 Rust 控制器，尚不是已经通过真实截图或商店审核的候选。

## 渠道与系统边界

`mac-app-store` feature 启用 `screen-capture-kit`；仅 macOS 编译 ScreenCaptureKit 适配器。MAS 打包配置与 `MACOSX_DEPLOYMENT_TARGET` 均设置为 14.0，最终 Info.plist 检查同一最低版本。单独启用该 feature 的 macOS 开发构建也必须显式设置 deployment target ≥14，否则 build.rs 拒绝构建。

普通直装渠道没有启用此 feature，原有 macOS 11.0 默认配置和 xcap 路径保留。此选择将 MAS 的支持范围限定为 macOS 14+，没有把独立探针的最低系统版本无条件应用到所有渠道。产品最低系统的实机验收仍待完成。

## 实现与 review

- 使用锁定的 `objc2-screen-capture-kit 0.3.2` 与现有 objc2 生态，直接绑定系统 API，不引入 Swift bridge 或独立截图子进程。
- `desktop_capture.rs` 继续负责现有权限检查、owner/token/过期/一次性消费、主屏原生授权、并发限制与窗口隐藏/恢复。适配器没有独立 IPC、权限授予入口或任意来源参数暴露给前端。
- 新 `macos_capture.rs` 通过当前 SCShareableContent 重新查找 native ID，分别构造显示器与独立窗口 filter，再调用 SCScreenshotManager；区域截图只允许显示器，坐标保持已有的显示器逻辑点契约。窗口/显示器列表暂时仍由 xcap 枚举；这里没有声称整个枚举层也已迁移。
- ScreenCaptureKit 分支失败不会自动回退 CGWindowListCreateImage。系统拒绝权限和来源失效应向上返回，不通过旧 API 绕过。
- 从 filter 的 pointPixelScale 计算输出像素，并在分配/截图前校验有限数值、尺寸、缩放上限与 33,177,600 像素预算。输出再次检查尺寸，之后复用现有 PNG 编码和 48 MiB 输出限制。
- 回调内将 CGImage 转为 sRGB RGBA，显式释放 CoreGraphics bitmap context 后才访问其 Vec 缓冲区，再将预乘 alpha 转为 image/PNG 所需的直通 alpha。没有将借用的 Objective-C/CG 指针跨 channel 传递。
- 截图在已有 blocking worker 中等待，15 秒超时。超时后标记请求失效，晚到的枚举回调不再发起后续截图，图片回调不再复制/交付结果；系统已经开始的截图不能声称已被 OS 取消。
- `macos-screen-capture-kit` backend 标识同步到前端严格白名单和三个运行/发布证据校验器；原有 backend 继续可识别。

## 测试与证据

- 本地相关 JS 测试：56 项通过，包含新 backend 接受和未知 backend 拒绝，以及现有发布证据/商店配置契约。
- Linux 默认 feature 与 `cargo test --lib --features mac-app-store`：各 45 项通过，仅代表非 macOS 逻辑、feature 组合和几何预算测试。
- lint、typecheck、Web/桌面前端构建、Rust 格式检查：通过。构建有既有大 chunk 提示。
- 新增 macOS 合成像素测试：检查两行不同颜色的 RGBA 顺序、透明度转换及输出尺寸拒绝，不请求截图权限、不读取屏幕。
- 原生最终验证：[Actions 35229530568](https://github.com/web-casa/ScreenHello/actions/runs/35229530568)，提交 `1370b1ef6806acf9311fd4f88e31db8a25533a16`。macOS 14 ARM64 和 macOS 15 Intel 均通过，各 45 项测试，包含合成像素测试；没有执行真实截图。最终原生日志未见 warning，保存在本地 `artifacts/sck-adapter-native-1370b1e.log`。
- 前一轮原生测试也通过，但有两处 CoreGraphics 字节序常量的弃用警告；换为 `CGImageByteOrderInfo::Order32Big` 后在新提交重新验证两种主机。没有用屏蔽警告代替修复。
- 桌面审计首次因仍要求旧 CoreGraphics feature 字符串而失败，已同步精确版本/feature 检查，并加入新绑定的固定版本约束；重跑通过。
- 复核时发现之前添加 import 导致 `@ts-check` 不再处于文件顶部，已恢复正确位置，补充参数注释与 catch 类型收窄，再运行 typecheck 通过。

公开验证分支为 `build/screencapturekit-adapter-20260917`；它用于原生集成测试，不是完整发布分支。本地先前所有 UI/文案/政策改动并未全部同步到该分支。没有合并 main、生成新签名 DMG/PKG 或提交商店。

## 未执行的必要验收

1. 两种硬件上的实际屏幕、窗口与区域截图；Retina、混合缩放多屏、负坐标、窗口移动、最小化或关闭后的失效。
2. TCC 允许、拒绝、撤销权限；真实 MAS sandbox 文件导出与截图功能协作。
3. 视觉正确性：行方向、窗口阴影、透明边缘、色彩空间、SDR/HDR 系统设置；合成像素单测不能替代实际截图。
4. 超时/迟到回调、多次取消、窗口恢复、退出与资源占用压力；SCContentFilter 的尺寸或位置在枚举后变化时应失败或按当前合法范围处理。
5. 最终 MAS PKG 的最低系统、二进制依赖、签名与实际安装，绑定候选源码和哈希。MAS 14+ 是本轮实现选择，不代表已验收所有 macOS 14 小版本。

生产接口已接入，但真实截图与发布验收未完成，不能以编译/单测通过宣称可正式上架。
