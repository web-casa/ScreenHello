# ScreenHello

[ScreenHello](https://screenhello.com) 是一个纯本地、无账号的截图与图片美化编辑器。图片、项目、草稿和预设都留在浏览器中；默认工作流不上传用户内容，也不依赖云同步。

## 功能

- 点击、拖放、粘贴或屏幕捕获导入图片
- 代码原生渐变、纯色与精选背景；支持自定义纯色和上传本地背景
- 圆角、内描边、阴影、留白、缩放、翻转、裁剪和九宫格对齐
- 代码原生的浏览器窗口与无品牌笔记本、显示器、平板、手机外框
- 矩形、圆形、直线、箭头、画笔、文字、步骤、Emoji、放大镜、模糊、马赛克和聚光标注
- `.screenhello` 项目文件、最近项目、IndexedDB 本地草稿和存储状态
- 独立站桌面/平板采用“文件 / 编辑 / 视图 / 帮助”菜单、项目文件/自动草稿双状态、本地资料库 Tabs 与确认式完整导出面板
- 独立站移动端采用“菜单 / 项目状态 / 导出”紧凑顶栏、分组标注 Sheet 与缩放菜单；核心触控目标至少 44 px，并适配 safe-area、动态视口和 PWA 提示避让
- ProjectDocument v2 多图片画布：本地缩略图、选择摘要、拖放及键盘/按钮层序、多选、复制/删除、编组/锁定、对齐/吸附/等间距、堆叠与扇形布局
- 完整风格预设的保存、复制、重命名、删除以及 `.screenhello-preset` 导入/导出
- 背景、内描边和外框控制区提供仅在本机分析的上下文建议，所有建议均由用户确认后应用并可撤销
- 首屏明确说明图片不会上传，并提供可关闭、可从帮助菜单再次打开的快速入门
- 项目级撤销/重做和多实例隔离
- 水印与 HDR 风格处理
- PNG/JPG/WebP/AVIF、1x/2x/3x 导出与 PNG 剪贴板复制；AVIF 由本地 Worker/WASM 按需编码
- 独立站支持 1～12 张本地图片套用当前风格或本地预设，串行处理后下载一个安全 ZIP；支持失败隔离、取消与重试
- 独立站支持 PWA 安装与分层离线缓存；核心编辑器离线可启动，AVIF 等重资源在线成功使用一次后可离线复用
- 深色/浅色主题和键盘快捷键
- Tauri 2 桌面 PoC 已在 Linux aarch64/WebKitGTK 接入原生项目文件、图片剪贴板、显示器/窗口/区域截图、主屏快捷键、托盘与单实例；三平台真机 Gate、安装包与发布仍属后续阶段

默认运行链路不请求 Google Fonts、Unsplash 或其他远程素材；内置背景由代码绘制，不打包或请求第三方背景图。

## 本地开发

要求 Node.js 24.x 与 pnpm 10.12.1。仓库通过 `.node-version`、`.nvmrc`、`engines` 和 `packageManager` 固定这组基线。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Vite 默认在 <http://localhost:5173> 启动开发服务器。

## 质量与构建命令

| 命令 | 用途 |
| --- | --- |
| `pnpm typecheck` | 检查公共 JSDoc/TypeScript 类型边界 |
| `pnpm lint` | ESLint 静态检查 |
| `pnpm test:unit` | Vitest 单元测试 |
| `pnpm test:e2e` | Chromium/Firefox/WebKit E2E 与 golden |
| `pnpm build` | 构建 Web 站点到 `dist/` |
| `pnpm audit:pwa` | 审计 manifest、Service Worker、预缓存预算与缓存边界 |
| `pnpm test:pwa` | 在 production preview 验证安装、离线、按需缓存和安全更新 |
| `pnpm test:release:current` | 在 production preview 运行当前三引擎本地优先与可访问性门禁 |
| `pnpm test:release:minimum-browser` | 对外部 WebDriver 会话执行最低版本桌面/移动 smoke 并生成 schema v2 证据 |
| `pnpm audit:release:browsers` | 合并审计同一候选提交的四份最低浏览器证据 |
| `pnpm build:lib` | 构建内部组件包到 `lib/` |
| `pnpm audit:pwa:library` | 确认 library 构建没有 PWA 注册或缓存副作用 |
| `pnpm audit:licenses` | 逐字核对已归档的第三方许可证正文 |
| `pnpm test:consumer` | 将库打成 tarball，在独立项目中验证开发态及生产构建/预览 |
| `pnpm size:report` | 检查 Web/library 体积和资源内联预算 |
| `pnpm desktop:build` | 构建无安装包的 Tauri release 可执行文件 |
| `pnpm desktop:test:runtime` | 在 Linux WebKitGTK/Xvfb 中验证真实窗口、区域截图/导入、PNG 系统剪贴板、快捷键/托盘状态与单实例 |
| `pnpm audit:desktop` | 审计 capability、CSP、版本 pin 与 Web/桌面产物隔离 |
| `pnpm audit:desktop:workflow` | 审计三平台桌面 Gate 的只读权限、固定 runner/action、测试 driver 隔离与禁止发布边界 |
| `pnpm audit:desktop:release` | 汇总同一公开候选的三平台 evidence，并复算产物/SBOM 摘要；人工项未完成时保持非发布就绪 |

当前遗留 npm 名仍为 `rico-screenshot`，仅用于 library/consumer 验证。公共包名称、首个 SemVer 和 trusted publishing 流程尚未确认，因此 `package.json` 保持 `private: true`，发布命令会主动失败；不要将当前版本号理解为已承诺的公共 npm 版本。

## 技术栈

- React 19、Vite 8、vite-plugin-pwa/Workbox、TypeScript checkJs/JSDoc
- MobX 7、LeaferJS 2.2、Ant Design 6、Tailwind CSS 4
- fflate ZIP 容器、jSquash AVIF/WebP 本地编码、Vitest、Playwright、Node.js 24、pnpm 10
- Tauri 2.11 / Rust、xcap 桌面壳与系统能力适配；Phase 9.3 使用固定 GitHub-hosted 三平台候选 Gate，正式分发仍需人工权限、签名与公证门禁

完整架构、组件 API、开发约束和阶段验收记录见 [DOCS](DOCS/README.md)。贡献方式见 [CONTRIBUTING](CONTRIBUTING.md)，安全问题请遵循 [SECURITY](SECURITY.md)。

## 浏览器范围

计划最低支持 Chrome/Edge 111+、Firefox 128+、Safari 16.4+。同一候选提交已在原生 amd64 Chrome 111、Edge 111、Firefox 128 和 GitHub `macos-14` 原生 Safari 26.5 上通过发布矩阵；`macos-14` 是用户接受的 Safari 发布验收环境，但它不等价于精确重放历史 Safari 16.4。详见 [Web Release Gate](DOCS/web-release-gate.md)。

## 开源来源与许可

ScreenHello 基于 [ricocc/Shoteasy](https://github.com/ricocc/shoteasy) 继续开发。项目遵循 [MIT License](LICENSE)，保留上游 `Copyright (c) 2024 Chenliwen` 版权声明，并在 [NOTICE](NOTICE) 中标明 ScreenHello 的后续修改；依赖与本地编解码器归属见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)，视觉素材边界见 [ASSET_PROVENANCE](ASSET_PROVENANCE.md)。

公共源码仓库为 <https://github.com/web-casa/ScreenHello>，正式站点为 <https://screenhello.com>。
