# 项目审阅（2026-09-17）

最初审阅当前工作树，包含尚未提交的上一轮桌面修复。重点阅读工作区保存与预设、命令层、导出资源生命周期、桌面 IPC/截图/文件读写及原生退出路径。以下四项描述保留发现时的行为；用户随后授权全部修复，当前状态与复核结果见文末。不是对每个文件、每个平台的完整验收。

## P1：保存期间的新修改被错误标记为已保存

位置：[WorkspaceStore](../src/stores/workspaceStore.js) 的 `saveProject()` / `_markClean()`，以及 [RightInspector](../src/components/sideBar/RightInspector.jsx) 的直接 Option setter。

`saveProject` 先生成存档，再等待文件写入和最近项目缓存，最后 `_markClean()` 将当时的当前编辑状态作为已保存基线。保存期间侧栏仍能修改 Option；operation generation 仅判断工作区生命周期，不判断内容是否变化。

已用延迟写入复现：内边距为 10 时发起保存，写入尚未结束时改为 90；解码实际传给文件写入器的存档仍是 10，当前画布为 90，但 `isDirty=false`、`projectFileStatus='saved'`。离开时可能因此跳过未保存提示。

修复方向：将实际序列化快照与它的内容签名绑定，保存完成后仅推进该快照对应的基线；后续编辑继续标记为未保存。打开项目后的异步缓存与清除 dirty 路径也需按同一原则复核。

## P1：原生退出绕过未保存保护

位置：[desktop_system.rs](../src-tauri/src/desktop_system.rs) 的托盘 Quit 直接 `app.exit(0)`；[lib.rs](../src-tauri/src/lib.rs) 没有 CloseRequested/ExitRequested 拦截；[App.jsx](../src/App.jsx) 仅注册浏览器 beforeunload。

原生进程退出没有等待保存确认或草稿 flush。自动草稿使用 750 ms 防抖，且可能发生存储失败；不能用它替代退出前的数据保护。编辑后立即从托盘退出，最近修改可能既没有写入项目文件，也没有写入草稿。原生窗口关闭也需要统一处理。

本项由当前代码和本机锁定的 Tauri 2.11.5/Tauri runtime 源码调用链确认，未运行真实用户环境的关闭/退出用例。[Tauri 官方退出 API](https://docs.rs/tauri/2.11.5/tauri/struct.AppHandle.html#method.exit) 明确通过 ExitRequested 触发退出，[ExitRequestApi](https://docs.rs/tauri/2.11.5/tauri/struct.ExitRequestApi.html) 提供拒绝退出的接口。

修复方向：将窗口关闭和应用退出接入原生拦截，复用现有保存/不保存/取消 guard，等待用户选择及必要的异步保存完成后再退出。

## P2：旧预设请求覆盖新选择，且可跨新项目生效

位置：[WorkspaceStore](../src/stores/workspaceStore.js) 的 `applyPreset()`、`resetProject()`；[WorkspacePanel](../src/components/workspace/WorkspacePanel.jsx) 的预设按钮直接调用 `applyPreset`。

预设应用既不设置 busy，也没有独立请求序号或项目身份校验。当前 operation generation 在 teardown 时才失效，新建项目不使待完成的预设失效。

两个延迟用例均已复现：先选 A 再选 B，A 晚完成会覆盖 B；预设加载期间通过实际命令入口新建项目，旧预设仍能修改新项目的 Option 并写入历史。后台图片解码会进一步扩大这一时间窗口。

修复方向：预设应用绑定请求序号和项目版本；新选择、项目切换使旧请求失效，并清理其临时图片资源。

## P2：选择器晚返回时遗失原生文件 token

位置：[WorkspaceStore](../src/stores/workspaceStore.js) 的 `openProjectPicker()`。

`openWithPicker()` 返回后先执行 `_assertOperation()`，后赋值 `pendingHandle`。若等待期间 workspace 被 teardown，检查抛错时新句柄尚未纳入 finally 的清理范围。已复现：选择器返回 selected，但 releaseHandle 没有被调用，workspace 也没有持有该句柄。

桌面原生文件目标为进程级表，最大 64 条；同一进程内运行时重建/销毁遇到该竞态会保留孤立 token，反复发生后可使文件选择或保存失败。不是每次正常打开文件都会泄漏。

修复方向：收到 selected 结果后先登记待释放句柄，再做生命周期校验，明确何时将所有权转移给打开操作。

## 修复前验证与边界（历史记录）

- `pnpm lint`、`pnpm typecheck`：通过。
- `pnpm test:unit`：90 个文件、1,339 项通过。
- `pnpm desktop:test:rust`：37 项通过。
- `pnpm audit --audit-level=low`：未报告已知漏洞；不表示项目不存在安全问题。
- 4 项临时定向用例确认保存误报、选择器泄漏、预设乱序和跨项目污染；测试断言的是当前缺陷行为，不能计作产品通过的回归测试。用例执行后从仓库移除，临时副本和日志保留在本机 `/tmp/screenhello-project-review-probe.test.js`、`/tmp/screenhello-project-review-probe-final.log`。
- 本轮没有重新运行 Web/桌面发布构建、浏览器 E2E 或 macOS/Windows 真机验收；Vitest 初始化自动执行了文档站构建。没有提交推送或发布。

这些发现集中在异步操作与项目版本、资源所有权、原生生命周期的交界处。前一轮修复的 CSP 和截图恢复问题不能作为这些路径已验证的证据。

## 授权修复与二次审阅

用户授权全部修复后，四项发现均已落实到当前工作树：

| 发现 | 实现与回归 |
| --- | --- |
| 保存误清 dirty | 同步捕获文档、资源、名称、导出设置及签名；只将实际写入的快照设为基线。延迟文件写入时继续修改内边距，验证存档仍为旧值而编辑器保持 dirty。 |
| 原生退出绕过 guard | 新增 `desktop_exit.rs`、`DesktopExitController.jsx` 和最小三命令 IPC；拦截主窗口关闭与应用退出，复用保存/不保存/取消确认，等待草稿 flush。请求绑定 main owner、订阅 token 和一次性 request ID。 |
| 预设乱序/跨项目污染 | 在 IndexedDB 读取和背景解码后检查请求序号、项目版本与运行时生命周期；新请求、打开/新建项目和 teardown 使旧结果失效。解码临时 URL 仍由既有 finally 释放。 |
| 选择器晚返回 token 泄漏 | 在生命周期检查前登记 selected handle，finally 保证未接管句柄释放；测试验证 teardown 后晚返回的句柄只释放一次。 |

二次审阅另修复了三处同类问题：打开项目后的缓存等待不再覆盖新名称或清除新修改；保存预设前捕获设置和背景所属文档；保存期间产生新修改时，退出对话框保持打开。受控替换和退出还会检查草稿 flush 前后的内容签名，内容改变则取消这次操作。

原生订阅不存在或消息发送失败时，Rust 显示明确告知可能丢失未保存内容的确认框。不会把一次旧请求、旧订阅或来自其他窗口的响应当成退出授权。系统强制结束进程、断电和已接收请求后 WebView 卡死仍不在此保证范围内；没有新增通用 process/window-close 插件权限。

永久回归用例见 [workspaceLifecycle.test.js](../tests/unit/workspaceLifecycle.test.js)、[desktopExit.test.js](../tests/unit/desktopExit.test.js)、[app.spec.js](../tests/e2e/app.spec.js) 和 `desktop_exit.rs` 内单测。Linux 原生关闭探针通过 X11 `WM_DELETE_WINDOW` 触发普通关窗事件，验证真实 Rust → Channel → React guard → 取消链路：

```bash
cc -Wall -Wextra -Werror tests/fixtures/desktop-close-x11.c -lX11 -o /tmp/screenhello-close-x11
SCREENHELLO_DESKTOP_CLOSE_HELPER=/tmp/screenhello-close-x11 pnpm desktop:test:runtime
```

该探针仅用于测试命令创建的隔离 Xvfb 显示，不应用于用户桌面。普通 runtime 测试不设置此环境变量时行为不变。Linux 本机通过不能替代 macOS 关窗/Cmd+Q、Windows 关闭/退出及真实保存对话框验收。

### 调试过程

- 首轮定向测试暴露测试自身的 MobX message mock 断言问题；改为断言传入 Store 的原始 spy。
- 首轮退出 UI 测试使用了错误的精确按钮名：Ant Design 将“取消”显示为“取 消”。按实际可访问名称修正选择器，未为测试修改产品按钮。
- 同轮 Firefox 发生 `Target crashed`；未据此修改业务代码，随后三引擎定向复跑全部预期用例通过。
- 初次 X11 探针错误地以 HTML 标题匹配原生窗口；补充匹配实际原生标题 `ScreenHello` 后，原生关闭/取消测试通过。
- 全量单测曾在未修改的发布验收夹具中出现 5/10 秒超时；另行复跑并保留原始日志，没有调大仓库超时配置或跳过失败项。

### 修复后验证

- `pnpm lint`、`pnpm typecheck`、`cargo fmt --manifest-path src-tauri/Cargo.toml --check`：通过。
- `pnpm test:unit`：92 个文件、1,357 项全部通过。最终日志：`/tmp/screenhello-fix-unit-complete.log`；默认超时和测试范围保持不变。
- `pnpm desktop:test:rust`：40 项通过。
- `pnpm build`、`pnpm build:lib`、`pnpm desktop:build`：通过；桌面仅构建本机 Linux ARM64 可执行文件，没有签名、打包或发布。构建仍提示已有的大 chunk，未修改阈值隐藏提示。
- 三引擎定向 E2E：10 项通过，2 项 Chromium 专属文件选择器场景在 Firefox/WebKit 按配置跳过。范围包括保存期间继续编辑、退出保存失败/取消、选择器调用顺序及整体项目删除保护。
- `pnpm desktop:test:ui`：三引擎、深浅主题的 6 项生产 CSP 弹层回归通过。
- `pnpm test:consumer`：开发与生产 preview 各 18 项通过，覆盖实际组件库包、多实例、卸载重挂载与项目/导出路径。
- 最终 Linux ARM64 桌面构建的 `desktop:test:runtime`（启用上述 close helper）：通过。真实窗口关闭会显示未保存对话框，取消后窗口仍可操作；同时覆盖既有菜单、尺寸、地址输入、裁剪、导出、复制与本地 Worker/WASM。日志：`/tmp/screenhello-fix-native-runtime-final.log`。
- `pnpm audit:desktop`、`pnpm audit:desktop:contract`、`pnpm audit:i18n`、`pnpm audit:pwa`、`pnpm check:docs-content`：通过；另检查本轮五份文档的相对链接，无缺失目标。PWA precache 为 54 项、3,283,961 字节。

没有以单测/Playwright 或 Linux 原生运行结果代替真实 macOS/Windows 退出流程验收。没有提交、推送、部署或生成新 DMG，已下载的旧安装包不包含这些修复。
