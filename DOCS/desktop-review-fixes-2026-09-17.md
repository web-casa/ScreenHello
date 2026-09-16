# 桌面静态审阅核实与修复（2026-09-17）

本轮基于当前代码核实外部 review，并修复确认有价值的行为与验证缺口。安全模块的静态审阅、签名公证和构建成功均不能代替最终安装包的交互验收。此前菜单和弹层的实际根因仍见 [CSP 复测记录](./desktop-ui-regression-audit-2026-09-16.md)。

## 实际改动

- 截图函数在隐藏前读取可见、最小化及焦点状态。已经隐藏或最小化时不执行 hide/show/focus，也不等待隐藏动画；普通非焦点窗口只调用 show，原先有焦点的窗口额外请求焦点。注意本机依赖源码中 Tao 的 macOS show 路径调用 make_key_and_order_front_sync，因此省略 set_focus 不保证跨平台无激活；该行为仍需真机验收。即使截图返回错误或后台任务返回 JoinError，仍尝试恢复；截图错误优先于恢复错误。托盘/快捷键入口仍主动唤起编辑器，这是既有入口行为，不等于支持后台静默截图。release 的 panic=abort 会终止进程，不在恢复保证内。
- 原生语言更新统一通过 owner 校验后修改应用级状态，测试覆盖非 main 窗口不能修改初始或已有语言。语言仍是应用级配置；没有为了假设性风险把 AtomicBool 改成 Mutex。
- 保存对话框建议名称先按 `/` 和反斜杠提取最后一个分量，再执行原有字符清洗、长度限制和扩展名处理；空名称回退 ScreenHello。实际系统对话框选择的路径不受此变更影响。
- Unix 测试验证父目录为目录符号链接时，CreateNew 仍拒绝覆盖，ReplaceConfirmed 允许覆盖；父目录链接指向文件时拒绝写入。该测试不证明能抵御父目录被并发替换的 TOCTOU 攻击。
- JS 使用命名 token header 常量，单测核对 Rust/JS 的文件大小、选择数量、截图字节、像素、来源数量和 header。修改任一端必须同时检查另一端，并运行 `desktopPlatform.test.js` 与 Rust 测试；未增加生成代码步骤。
- capability 描述说明三项图片资源/剪贴板权限的用途；权限集合没有扩大。

## 保留的现有护栏与审计修正

- 订阅失败的 catch 已有 active 检查，没有重复修复。
- 发布契约已有 package.json、Tauri、Cargo.toml、Cargo.lock 版本一致性检查，没有另建重复机制。
- `tauri.phase9.conf.json` 用于显式启用打包，Windows signed-candidate 配置用于签名候选；均被工作流引用，保留原位置和内容。
- 保留非 macOS 权限路径的可处理错误，不改为 panic；没有为尚不存在的 i18n 插值需求重写消息接口。
- 运行 `audit:desktop` 时发现两项既有审计假阳性：构建命令断言尚未包含静态 AntD CSS 检查；共享隐私分类器中的 `ipc.localhost` 字面量被误判成原生桥接混入 Web。同步命令断言，移除单独域名字面量判定，保留实际原生命令和 `__TAURI_INTERNALS__` 的禁止规则。语言入口审计同步新的 owner 校验调用。

## 验证

- `pnpm lint`、`pnpm typecheck`：通过。
- `pnpm exec vitest run tests/unit/desktopPlatform.test.js tests/unit/desktopBridge.test.js tests/unit/desktopReleaseContractAudit.test.js`：3 文件、54 项通过。
- `pnpm desktop:test:rust`：37 项通过。
- `pnpm build`、`pnpm desktop:build`：通过；后者生成本地 Linux ARM64 release 程序。构建仍有 chunk 大小提示，不影响成功状态。
- `pnpm audit:desktop:contract`、修正后的 `pnpm audit:desktop`：通过，无 failures。首次桌面审计失败后核实并修正旧断言，未绕过实际桥接检查。
- `pnpm desktop:test:ui`：构建完成后的最终独立运行 6 项通过（45.4 秒），覆盖 Chromium/Firefox/WebKit 深浅主题及生产 CSP；这不是旧版浏览器或真实 macOS WKWebView 的验收。
- `pnpm desktop:test:runtime`：Linux ARM64 原生运行通过（14.7 秒），菜单、尺寸、裁剪和导出等现有交互检查通过。该测试未启用交互式截图授权，截图项明确为 manual，不声称实际截图或隐藏/最小化恢复已完成真机验证；窗口策略和错误优先级由 Rust 单测覆盖。
- `pnpm check:docs-content`：7 语言、6 主题、49 文件通过；`git diff --check` 通过。

真实 macOS/Windows 的窗口焦点策略、权限对话框、干净安装仍需对应环境验收；Linux 和浏览器引擎自动化不替代这些证据。本轮不发布新 DMG，也不表示此前下载的 DMG 已包含本轮修复。
