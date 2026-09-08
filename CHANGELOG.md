# Changelog

ScreenHello 的重要用户可见变化记录在这里。版本采用何种 SemVer 起点将在首次公共发布前确认；在此之前所有条目保留在 `Unreleased`。

## Unreleased

### Added

- 纯本地截图美化、项目/预设、多个图片图层、批量导出和 PWA 离线能力。
- PNG、JPEG、WebP、AVIF 与 1x/2x/3x 导出；不支持 Canvas WebP 的浏览器使用本地 Worker/WASM 兜底。
- Chrome/Edge 111+、Firefox 128+、Safari 16.4+ 的声明基线，以及当前/最低浏览器发布门禁。
- 可多实例隔离的内部 React library 构建与独立 consumer 验证。
- 传统 `文件 / 编辑 / 视图 / 帮助` 菜单、项目文件/本机草稿双状态、本地资料库与完整导出面板。
- 上下文本地建议、可重开的快速入门、图层缩略图/拖放/键盘排序，以及移动单菜单、标注 Sheet 和紧凑缩放。
- Tauri 2 桌面壳 PoC：独立桌面入口、main-window 最小 capability/CSP、脱敏环境 IPC、Linux 原生 WebView smoke 和 Web/PWA/library 产物隔离。
- 桌面原生文件/图片剪贴板，以及有界的显示器、窗口、区域截图；固定主屏快捷键、托盘动作与单实例恢复均复用同一编辑器命令层。

### Changed

- 独立站快捷键采用传统项目文件语义；`workspace=false` library 继续保留原下载行为。
- 最低浏览器 evidence schema 升至 v2，同一候选同时验证桌面编辑、四格式导出、纯本地请求与移动 Web 核心入口。

### Fixed

- 项目替换/打开失败时的数据保护、当前图片资源安全替换、浮层焦点归还与移动窄屏溢出。
- 颜色控件 ARIA 关系、标注 toolbar/本地上传语义，以及移动菜单 tab 的 44×44 px 触控目标。
- 首屏高负载时菜单命令早于抽屉/文件选择器动作注册而偶发无响应的问题。

### Security

- 本地资源、项目归档、SVG、背景 URL、Service Worker 缓存和公开晋级内容使用 fail-closed 校验。

[Unreleased]: https://github.com/web-casa/ScreenHello/commits/main
