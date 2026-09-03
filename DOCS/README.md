# ScreenHello 文档

本目录记录当前仓库的实际实现。ScreenHello 是运行在浏览器中的纯本地截图与图片美化编辑器，也可以构建为内部 React 组件库（遗留包名 `rico-screenshot`，导出 `ImageBeautifier`）。它没有账号、后端、上传或云同步。

## 当前版本文档

以下文档描述仓库中已经存在的实现，应作为判断“当前是否可用”的依据：

- [项目概览](./project-overview.md)：功能边界、技术栈、目录职责与当前状态。
- [架构与数据流](./architecture.md)：MobX 状态、LeaferJS 画布、图层组合和导出链路。
- [用户功能](./user-guide.md)：导入、画布设置、标注、边框、水印、HDR 与导出。
- [开发指南](./development.md)：环境、命令、开发约定、验证方法和已知问题。
- [Phase 1 质量基线](./quality-baseline.md)：Node/pnpm、自动测试、构建体积、golden 与最低浏览器验收方法。
- [Phase 2 质量验收](./phase-2-quality.md)：多实例 runtime、生命周期、错误恢复和最终验证结果。
- [Phase 3 基础验收](./phase-3-foundation.md)：离线资源、动态加载、library/type/platform 边界和体积预算。
- [Phase 4 技术栈升级](./phase-4-upgrades.md)：LeaferJS、ESLint、Vite、AntD、React、MobX 与 Tailwind 的分波迁移和验收。
- [Phase 5 Web P0 保存与复用](./phase-5-web-p0.md)：项目/预设容器、最近项目、草稿管理、本地建议、异常降级与验收。
- [Phase 6 Web P1 多图片与专业布局](./phase-6-web-p1.md)：ProjectDocument v2、多图层、布局、迁移、资源预算与验收。
- [Phase 7 Web P2](./phase-7-web-p2.md)：统一导出、批量、AVIF、矢量设备框、PWA 与逐波验收记录。
- [Web Release Gate](./web-release-gate.md)：当前发布判定、最低浏览器可信证据方法、颜色面板可访问性结果和复现命令。
- [组件 API](./component-api.md)：npm 库入口、`ImageBeautifier` 属性和集成限制。

## 快速定位

| 目标 | 主要文件 |
| --- | --- |
| 应用入口 | `src/main.jsx`、`src/App.jsx` |
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
| 导出与复制 UI | `src/components/sideBar/DownloadBar.jsx` |
| 批量队列、ZIP 与隔离 renderer | `src/stores/batchStore.js`、`src/stores/batchExportService.js`、`src/components/batch/`、`src/utils/batchExport.js` |
| 项目中心 | `src/components/workspace/WorkspacePanel.jsx`、`src/stores/workspaceStore.js` |
| 项目/预设容器 | `src/utils/workspaceArchive.js`、`src/utils/workspaceFormat.js` |
| 本地持久化 | `src/stores/draftStore.js`、`src/stores/draftService.js` |
| 图片安全验证/本地建议 | `src/utils/imageValidation.js`、`src/utils/imageSuggestions.js` |
| 尺寸预设 | `src/utils/sizeConfig.js` |
| 背景预设 | `src/utils/backgroundConfig.js` |
