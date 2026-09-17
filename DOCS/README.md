# ScreenHello 文档

本目录记录当前仓库的实际实现。ScreenHello 是运行在浏览器中的纯本地截图与图片美化编辑器，也可以构建为内部 React 组件库（遗留包名 `rico-screenshot`，导出 `ImageBeautifier`）。它没有账号、后端、上传或云同步。

## 当前版本文档

- [macOS ARM64 测试 DMG（2026-09-17）](./macos-dmg-test-build-2026-09-17.md)：本轮修复的新签名、公证测试包、下载链接、哈希及构建重试记录。

- [项目审阅与修复（2026-09-17）](./project-review-2026-09-17.md)：保存状态、原生退出、异步预设和文件句柄的复现、修复及回归验证。

- [桌面审阅核实与修复（2026-09-17）](./desktop-review-fixes-2026-09-17.md)：截图窗口恢复、语言权限、文件名与跨端契约验证。

- [大图压缩下载修复](./compression-download.md)：独立预览/下载预算、六种压缩模式、资源回收与本地验收。
- [SEO / GEO 与公开内容站](./seo-geo.md)：七语静态页面、索引控制、PWA 边界、验收命令与上线清单。

- [内置图片背景](./preset-backgrounds.md)：25 张本地素材、异步选择、历史/存档资源与离线边界。

以下文档描述仓库中已经存在的实现，应作为判断“当前是否可用”的依据：

- [项目概览](./project-overview.md)：功能边界、技术栈、目录职责与当前状态。
- [架构与数据流](./architecture.md)：MobX 状态、LeaferJS 画布、图层组合和导出链路。
- [用户功能](./user-guide.md)：导入、画布设置、标注、边框、水印、HDR 与导出。
- [真实位图设备框](./raster-device-frames.md)：可选 Surface 素材包、透视渲染、下载许可与分发边界。
- [iPhone Duo](./iphone-duo.md)：两种非手持本地样式、PSD 提取、缺包保护与验证记录。
- [开发指南](./development.md)：环境、命令、开发约定、验证方法和已知问题。
- [开发总记录](./development-record.md)：跨阶段开发过程、review 修复、验证证据和剩余发布前置条件。
- [桌面 UI 回归审计（2026-09-16）](./desktop-ui-regression-audit-2026-09-16.md)：001～005 初次审计、新 001～003 的 CSP 复现与根因更正、修复和实机待验收边界。
- [Phase 1 质量基线](./quality-baseline.md)：Node/pnpm、自动测试、构建体积、golden 与最低浏览器验收方法。
- [Phase 2 质量验收](./phase-2-quality.md)：多实例 runtime、生命周期、错误恢复和最终验证结果。
- [Phase 3 基础验收](./phase-3-foundation.md)：离线资源、动态加载、library/type/platform 边界和体积预算。
- [Phase 4 技术栈升级](./phase-4-upgrades.md)：LeaferJS、ESLint、Vite、AntD、React、MobX 与 Tailwind 的分波迁移和验收。
- [Phase 5 Web P0 保存与复用](./phase-5-web-p0.md)：项目/预设容器、最近项目、草稿管理、本地建议、异常降级与验收。
- [Phase 6 Web P1 多图片与专业布局](./phase-6-web-p1.md)：ProjectDocument v2、多图层、布局、迁移、资源预算与验收。
- [Phase 7 Web P2](./phase-7-web-p2.md)：统一导出、批量、AVIF、矢量设备框、PWA 与逐波验收记录。
- [导出压缩 C0 技术验证](./export-compression-c0.md)：独立 codec/预览实验的历史证据、已验证限制与复现命令。
- [导出压缩 C1 内核](./export-compression-c1.md)：正式内核、设置事务、完整画面就绪与资源所有权。
- [导出压缩 C2 交互](./export-compression-c2.md)：压缩模式、手动预览、100% 对比、同 Blob 下载与交互验证。
- [导出压缩 C3 存档与批量](./export-compression-c3.md)：设置往返/兼容警告、已解析风格快照、重试资源所有权与真实字节统计。
- [导出压缩 C4 全链路复验](./export-compression-c4.md)：正式产品压力、解码资源、ZIP 保存互斥、子路径离线/CSP 与公开依赖闭包；阶段状态以该页为准。
- [Web Release Gate](./web-release-gate.md)：Phase 8.5 当前候选状态、最低浏览器可信证据方法、可访问性结果和复现命令。
- [Phase 9 桌面 PoC](./phase-9-desktop-poc.md)：Tauri 2 独立入口、原生文件/图片剪贴板、安全 capability/CSP、Linux runtime 证据与未验证边界。
- [跨平台桌面 Phase 1](./desktop-cross-platform-phase-1.md)：六目标支持契约、版本来源与 Linux 基线。
- [跨平台桌面 Phase 2](./desktop-cross-platform-phase-2.md)：六目标原生候选矩阵、DMG/DEB/NSIS 载荷检查与待执行证据边界。
- [跨平台桌面 Phase 3](./desktop-cross-platform-phase-3.md)：Tauri 本地协议下的 AVIF/WebP/PNG Worker/WASM、CSP 和候选 runtime 证据。
- [跨平台桌面 Phase 4](./desktop-cross-platform-phase-4.md)：截图权限、Wayland/macOS/Windows 系统边界与 schema v5 候选证据。
- [跨平台桌面 Phase 5](./desktop-cross-platform-phase-5.md)：安装/升级/卸载边界、非破坏性本地状态标记与 schema v6 候选证据。
- [跨平台桌面 Phase 6](./desktop-cross-platform-phase-6.md)：签名、公证、更新信任根、Linux 渠道与 provenance 的发布准备契约；当前候选仍无签名。
- [跨平台桌面 Phase 7](./desktop-cross-platform-phase-7.md)：macOS ARM64 签名候选的历史阶段记录；尚未远端运行。
- [跨平台桌面 Phase 8](./desktop-cross-platform-phase-8.md)：独立 macOS Intel 签名候选、双架构静态审计与运行前边界；尚未远端运行。
- [跨平台桌面 Phase 9](./desktop-cross-platform-phase-9.md)：Windows x64 Authenticode/RFC 3161 签名候选、CurrentUser 证书库临时导入、静态审计与运行前边界；尚未远端运行。
- [跨平台桌面 Phase 10](./desktop-cross-platform-phase-10.md)：Windows ARM64 Authenticode/RFC 3161 签名候选、显式 Rust target、原生 SignTool 优先策略、静态审计与运行前边界；尚未远端运行。
- [跨平台桌面 Phase 11](./desktop-cross-platform-phase-11.md)：Linux x64/ARM64 DEB 输入、受保护的 APT Release/InRelease 签名候选、公开 keyring artifact 和隔离 APT 复验；尚未远端运行或发布。
- [跨平台桌面 Phase 12](./desktop-cross-platform-phase-12.md)：Linux DEB 二进制/ASCII armor 客户端信任包、可选双键重叠、30 天轮换约束和带外撤销响应候选；尚未远端运行、公开分发或演练。
- [跨平台桌面 Phase 13](./desktop-cross-platform-phase-13.md)：五条受保护签名候选的 GitHub SLSA provenance、Sigstore bundle 记录、最小 OIDC/attestation 权限和远端验证前置条件；尚未远端运行或发布。
- [跨平台桌面 Phase 14](./desktop-cross-platform-phase-14.md)：候选 provenance 的本地预检、严格 GitHub CLI 验证计划与候选目录外收据；尚未远端运行或验证。
- [跨平台桌面 Phase 15](./desktop-cross-platform-phase-15.md)：候选验证收据的本地重验证、最终候选重检与原子候选外交接；尚未远端运行或验证。
- [跨平台桌面 Phase 16](./desktop-cross-platform-phase-16.md)：候选绑定的平台人工验收计划、未执行模板与本地证据复核；尚未进行真实平台验收或发布。
- [跨平台桌面 Phase 17](./desktop-cross-platform-phase-17.md)：同一不可变 SHA 的五候选汇总人工验收复核；尚未进行真实平台验收或发布。
- [跨平台桌面 Phase 18](./desktop-cross-platform-phase-18.md)：将完整 Phase 17 bundle 和五份当前人工记录绑定为候选外本地发布审查档案；不授权发布或部署。
- [跨平台桌面 Phase 19](./desktop-cross-platform-phase-19.md)：将已复核审查档案重新绑定到五候选、11 个 attested payload 的本地 SHA-256 交接清单；不授权发布或部署。
- [跨平台桌面 Phase 20](./desktop-cross-platform-phase-20.md)：以固定私有候选 repository ID 和只读 GitHub API 预检签名环境、分支、Actions policy 与 secret scope；不授权发布或部署。
- [跨平台桌面 Phase 21](./desktop-cross-platform-phase-21.md)：以 GitHub Enterprise Cloud entitlement、仅第一方 SHA-pinned Actions 与仓库内 Corepack pnpm bootstrap 保护私有候选；不授权发布或部署。
- [跨平台桌面 Phase 22](./desktop-cross-platform-phase-22.md)：隔离每个 CI job 的 Corepack home、禁用项目控制的 Corepack env，并审计 workflow 级覆盖；不授权发布或部署。
- [跨平台桌面 Phase 23](./desktop-cross-platform-phase-23.md)：将六个直接下载安装包与五个必须保留 APT 路径布局的 Linux sidecar 分开，并生成候选外发布计划；不授权发布或部署。
- [跨平台桌面 Phase 24](./desktop-cross-platform-phase-24.md)：将 immutable candidate commit 的公开源码快照、版本、六个直链安装包和五个 APT sidecar 写入候选外不可覆盖交接文件；不授权发布或部署。
- [ADR 0001：Tauri 2 桌面框架](./adr/0001-tauri-desktop-framework.md)：框架选择、三平台退出门、测试 driver 隔离和正式分发前置条件。
- [组件 API](./component-api.md)：npm 库入口、`ImageBeautifier` 属性和集成限制。

## 快速定位

| 目标 | 主要文件 |
| --- | --- |
| 应用入口 | `src/main.jsx`、`src/App.jsx` |
| Tauri 桌面入口、平台适配与 Rust 壳 | `desktop/index.html`、`src/desktop/`、`src/platform/desktopPlatform.js`、`src-tauri/` |
| npm 库入口 | `src/index.js` |
| 编辑器运行时状态 | `src/stores/editor.js` |
| 图片资源与图层状态 | `src/stores/imageStore.js` |
| 美化选项状态 | `src/stores/option.js` |
| LeaferJS 画布初始化 | `src/components/editor/View.jsx` |
| 截图图层与设备框 | `src/components/editor/layers/Screenshot.jsx` |
| 多图层与布局面板 | `src/components/sideBar/ImageLayersPanel.jsx` |
| 标注图形 | `src/components/editor/layers/ShapeLine.jsx` |
| 右侧配置栏 | `src/components/sideBar/RightInspector.jsx` |
| 左侧栏目 | `src/components/sideBar/LeftRail.jsx` |
| 导出内核、队列与资源所有权 | `src/stores/exportService.js` |
| 导出与复制 UI | `src/components/sideBar/DownloadBar.jsx`、`src/components/sideBar/ExportPanel.jsx` |
| 批量队列、ZIP 与隔离 renderer | `src/stores/batchStore.js`、`src/stores/batchExportService.js`、`src/components/batch/`、`src/utils/batchExport.js` |
| 桌面/移动应用菜单与项目状态 | `src/components/header/AppMenuBar.jsx`、`src/components/header/ProjectStatus.jsx`、`src/components/header/HelpCenter.jsx` |
| 响应式标注与缩放 | `src/components/editor/BottomToolbar.jsx`、`src/components/editor/Zoom.jsx`、`src/style/main.css` |
| 本地资料库 | `src/components/workspace/WorkspacePanel.jsx`、`src/stores/workspaceStore.js` |
| 实例级命令/替换保护 | `src/stores/commandService.js`、`src/components/workspace/WorkspaceGuardDialog.jsx` |
| 项目/预设容器 | `src/utils/workspaceArchive.js`、`src/utils/workspaceFormat.js` |
| 本地持久化 | `src/stores/draftStore.js`、`src/stores/draftService.js` |
| 图片安全验证/本地建议 | `src/utils/imageValidation.js`、`src/utils/imageSuggestions.js` |
| 尺寸预设 | `src/utils/sizeConfig.js` |
| 背景预设 | `src/utils/backgroundConfig.js` |
