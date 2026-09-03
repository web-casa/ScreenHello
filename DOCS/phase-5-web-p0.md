# Phase 5 Web P0：保存与复用

> 实施日期：2026-09-02。范围仅包括 Web 端的项目/预设保存与复用闭环；不包含 ProjectDocument v2、多图片、桌面、浏览器扩展、npm 公开发布或远端操作。

## 进入阶段前的复审

Phase 5 开始前先复审 Phase 4 候选 `d3291c2`。复审发现并修复了公共 `src/index.js` 的 Node 直接导入边界、library CSS 重复归属、browser target 漂移、CI 缺少严格 peer/体积/最低版本证据等问题，修复提交为 `50b9fbd`。随后 frozen strict-peer install、依赖审计、静态检查、29 个单元测试、当前三引擎 E2E、Chromium golden、双构建、清洁 tarball consumer 和体积预算全部通过，才进入 Phase 5。

## 已实现范围

### 便携项目与预设

- `.screenhello` 保存 ProjectDocument v1、原图、可选上传背景和导出设置。
- `.screenhello-preset` 保存完整 Option 风格、导出设置和可选上传背景，不包含当前原图或标注。
- 两类文件都是 workspace container v1 ZIP；容器入口固定为 `manifest.json`、主图和可选背景。
- 项目支持打开、保存和另存为；风格预设支持保存、应用、复制、重命名、删除、导入和导出。
- File System Access 可用时使用系统 picker/handle；否则使用隐藏 file input 和浏览器下载。保存流程先在用户手势内取得 handle，再异步生成 ZIP，避免丢失 transient activation。

### 最近项目、草稿和存储状态

- IndexedDB 升级到 v2，新增 `presets` 与 `recentProjects` object store，保留既有 `projects` 和 `assets`。
- 图片、预设背景和最近项目 ZIP 以 `Uint8Array` 持久化，读取时恢复 Blob；早期直接保存 Blob 的记录仍可读取。
- 最近项目按更新时间保留最多 12 条；刷新后可以从本地副本实际恢复项目，不只显示元数据。
- 项目中心列出最近项目、自动草稿和自定义预设，并允许恢复或清理；存储区域显示浏览器估算用量和持久化授权状态。
- IndexedDB 不可用、配额不足或清理失败时给出明确提示，不阻断普通编辑、项目文件下载或画布导出。

### 本地样式建议与新用户路径

- 图片添加后在最大边长 64px 的本地 Canvas 上采样边缘色与亮度，生成背景色、内描边和横/竖图外框建议。
- 三类建议独立展示，只有用户点击后才写入 Option；不发起网络请求，也不引入模型或 WASM。
- 新增独立 `innerBorder` 字段，可与基础、浏览器或设备外框同时存在；旧 ProjectDocument v1 读取时获得默认值。
- 初始页提供按需加载的打包示例图；原图只在用户点击后请求，不增加首屏图片下载。
- 项目中心显示未保存/已保存、项目库可用性、存储持久化和可理解的损坏/过大/资源缺失错误。

## 容器与图片安全边界

归档读取限制为：压缩包最多 64 MiB，单入口最多 48 MiB，声明解压总量最多 96 MiB，入口最多 3 个，manifest 最多 512 KiB。未知路径、kind/version 不符、缺少必需资源和大小不一致都会拒绝；Web Crypto 可用时还会校验 SHA-256。

归档元数据不被当作图片有效性的证据。项目主图、上传背景、草稿资源和导入预设背景在进入当前 runtime 前都要通过浏览器真实解码，并限制支持的 MIME、单资源 48 MiB、单边 32768 px、总像素 1 亿。验证失败会释放临时 object URL，且不替换当前画布。

## Library 边界

`ImageBeautifier` 新增可选 `workspace?: boolean`，默认 `false`；独立站显式开启。这样内部 library 的现有消费端不会静默增加项目按钮或 IndexedDB 最近项目/预设副作用。`persistence` 仍是单独的草稿开关，多实例 runtime 隔离不变。

Web P0 完成不等于公开 npm 包。遗留名 `rico-screenshot` 仍只用于内部 tarball consumer 验证，包名和公开版本策略继续延后决定。

## 验收结果

- Node 24.18.0 / pnpm 10.12.1 的 frozen strict-peer install 通过；`pnpm ignored-builds` 为 None，low audit 无已知漏洞。
- typecheck、零 warning lint 和 12 个测试文件 / 46 个单元测试通过。
- 当前 Chromium、Firefox、WebKit 共 19 项 E2E 通过，8 项按设计仅在 Chromium 执行而跳过；覆盖下载回退保存/重开、损坏文件不污染画布、刷新后打开最近项目、预设、本地建议和示例按需加载。
- Chromium File System Access mock 证明 picker 先于 ZIP 生成/写入；经人工检查的首屏、项目中心和 PNG 导出三份 golden 均通过。
- Web/library 双构建与每次重新安装真实 tarball 的清洁 consumer 通过；双实例、草稿隔离、快捷键和卸载重挂无回归。
- Web 入口 JS 为 1,022,248 B / gzip 321,695 B，入口 CSS gzip 11,557 B；library 全部 JS gzip 374,584 B，CSS gzip 12,505 B；最大图片 data URL 246 B，全部在既定预算内。

最终 review 修复了两个额外问题：静态资产 import 导致示例原图首屏请求，以及刷新后没有读取既有 `navigator.storage.persisted()` 授权。修复并重跑完整门禁后，无剩余 CRITICAL/HIGH/MEDIUM 问题。

## 已知限制

Playwright 当前浏览器只能提供持续回归信号，不能证明 Chrome/Edge 111、Firefox 128 和 Safari 16.4 最低版本全部兼容；Safari 16.4 真机与最低版本矩阵仍是 Web Release Gate，而不是 Phase 5 已完成事实。产品仍为纯本地单图编辑器，没有云账号、上传、同步或协作。
