# Phase 3 基础验收

> 实施日期：2026-09-02。范围仅包括资源、library、类型和平台边界；不包含框架主版本升级、ProjectDocument v2、Web P0 功能或 npm 公开发布。

## 1. 先复审、再实施

Phase 3 开始前重新审查 Phase 2 提交 `c0c936f`。复审发现水印文字、颜色和角度会直接进入 SVG/XML 字符串，属于内容注入阻断项；现已增加 XML 转义、TinyColor 规范化和尺寸/角度数值边界，并用恶意特殊字符单测锁定。

## 2. 本地资源与按需加载

- 删除运行时 Unsplash 背景和 Google Fonts；默认首屏及核心编辑链路不访问外网。
- Phase 3 当时曾把背景原图和 WebP 缩略图本地化；Phase 8 许可复审后已全部替换为代码原生渐变，不再携带或请求该批第三方位图。
- 遗留的 `cosmic_img_*`、cloud/desktop 背景 token 会安全回退到本地默认背景，不再恢复远程 URL。
- Emoji Picker、裁剪弹窗和完整背景 Drawer 使用 React `lazy`/`Suspense`，只有交互打开时才请求对应 chunk。
- E2E 直接观察浏览器资源请求：当前首屏和选择内置背景均不会请求 `gradients/` 资源；低频 chunk 仍只在对应交互后加载。

## 3. Library 发布边界

内部遗留包名仍为 `rico-screenshot`，Web P0 前不公开 npm 包。

- 公共出口：根 ESM、`rico-screenshot/style.css`、`package.json` 和 `lib/index.d.ts`。
- 发布文件 allowlist：`lib/`、`LICENSE`、`README.md`。
- Vite 6 library mode 会忽略普通 `assetsInlineLimit`；所有产品图片显式使用 `?no-inline`。
- 生成阶段把 Vite 的相对 `new URL()` 资源引用恢复成真实 ESM asset import，使消费者的依赖优化器能够接管复制和指纹，而不是把 JS 搬走后留下失效相对路径。
- React/ReactDOM、MobX/mobx-react-lite、AntD/`@ant-design/cssinjs` 是宿主 peer。LeaferJS 是 ScreenHello 内部引擎并随库封装，防止插件注册表与 App 来自不同运行时。
- `sideEffects` 保留 CSS 和 `lib/*.js`；library JS 在加载时会注册 Leafer 插件，不能声明成纯模块。
- `pnpm test:consumer` 先生成真实 tarball，再在独立 package 强制安装并 typecheck；浏览器测试覆盖本地资源、无外网、双实例、错误隔离、草稿 key、快捷键和卸载重挂。

## 4. 类型与平台边界

- TypeScript 5.9 只作为增量检查工具；没有在一个阶段强行把业务源码整体改写成 TypeScript。
- `types/index.d.ts` 定义 `ImageBeautifierProps` 和本地草稿配置，`tests/types/public-api.test.tsx` 验证有效/无效消费写法。
- `src/index.js` 与 `src/platform/browserPlatform.js` 启用 `// @ts-check`/JSDoc。
- `browserPlatform` 只封装已经存在的文件/object URL、偏好存储、IndexedDB、剪贴板图片、display capture 和下载调用点。Canvas、DOM 渲染与 EyeDropper 没有为了未来桌面端提前发明适配接口。

## 5. 体积预算

当前 Node 24.18.0 / pnpm 10.12.1 构建结果：

| 指标 | 当前值 | Phase 3 上限 |
| --- | ---: | ---: |
| Web 主 JS raw | 1,514,943 B | 1,650,000 B |
| Web 主 JS gzip | 485,868 B | 525,000 B |
| 最大 library JS chunk raw | 881,924 B | 1,350,000 B |
| library 最大图片 data URL | 246 B | 100,000 B |

Vite 仍会对超过 500 kB 的 Web/Emoji chunk 给出通用 warning；Phase 3 使用基于实测基线的硬预算阻止回退，并保留 Emoji、裁剪器和 Drawer 的交互级拆分。

## 6. 自动验证

最终阶段门禁包括：

- `pnpm install --frozen-lockfile`
- `pnpm audit --audit-level=high`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test:unit`
- `pnpm test:e2e`
- `pnpm build` 与 `pnpm build:lib`
- `pnpm test:consumer`
- `pnpm size:report`
- `git diff --check`

GitHub Actions 同步执行 `pnpm typecheck`；根 Vite 通过 `optimizeDeps.entries: ['index.html']` 只扫描自身应用入口，`tests/consumer` 保持独立安装和启动。

最终结果：frozen install 与 high audit 通过（无已知漏洞）；typecheck、lint 通过；7 个单测文件共 26 项通过；Playwright 8 项通过、4 项非 Chromium golden 按设计跳过；Web/library 双构建、独立 tarball consumer 和体积预算全部通过。`git diff --check` 无 whitespace error。

Playwright 当前 Chromium/Firefox/WebKit 仍不代表 Chrome/Edge 111、Firefox 128、Safari 16.4 最低版本已验收，Safari 16.4 必须使用真机或可信云真机。

## 7. 明确保留到后续阶段

- 不升级 React 19、AntD 6、Tailwind 4、MobX 7、Vite 7/8 或 Cropper.js 2。
- 不实现 ProjectDocument v2、Web P0 新功能、桌面壳或 Chrome/Edge 扩展。
- 不 push、publish、release，也不向公开仓库晋级。
