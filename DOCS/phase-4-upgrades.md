# Phase 4 技术栈分波升级

> 实施日期：2026-09-02。每个主变量单独提交、单独回归；不包含 Web P0、ProjectDocument v2、Cropper.js 2、pnpm 主版本、桌面或浏览器扩展。

## 复审入口

Phase 4 开始前复审 Phase 3 提交 `81aa1ee`，发现步骤序号 `numSvg()` 仍会把可由本地项目文档恢复的文字直接拼入 SVG `foreignObject`。修复提交 `05c2226` 已复用 XML 转义并加入恶意输入测试；修复后完整门禁通过。

复审后的比较基线：Web 主 JS 1,514,951 B / gzip 485,854 B；library 最大 JS chunk 881,935 B；最大图片 data URL 246 B。

## U3：LeaferJS 2.2.9

- 所有 `leafer-ui`、`@leafer-ui/*`、`@leafer-in/*` 从 2.1.10 同步锁定为 2.2.9。
- 依赖树检查确认全部 Leafer 官方包均为 2.2.9，没有混入旧版运行时。
- audit、typecheck、lint、27 个 unit、当前 Chromium/Firefox/WebKit 功能 E2E、Chromium 首屏/导出 golden、Web/library build 和清洁 tarball consumer 全部通过。
- Web 主 JS 1,519,536 B / gzip 487,411 B；library 最大 JS chunk 887,797 B / gzip 234,177 B；仍低于既定预算，最大图片 data URL 246 B。
- 未修改图层数据结构、ProjectDocument 或多图片模型。

## U4：ESLint 9 flat config

- ESLint 8.57.1 升至 9.39.5，旧 `.eslintrc.cjs` 替换为原生 `eslint.config.js`；没有引入 FlatCompat。
- `@eslint/js` 固定为 9.39.5，Hooks 插件升至 7.1.1，React Refresh 插件升至 0.5.5，并按插件实际 schema 把 `customHOCs` 迁为 `extraHOCs`。
- 全局恢复 `react-hooks/exhaustive-deps`；只对命令式 Leafer 生命周期所在的 `View.jsx` 与 `editor/layers/**/*.jsx` 保留明确文件级例外，其他 React 文件补齐稳定 store 依赖。
- 清理未使用的 catch 绑定，Node/browser globals 通过 `globals` 包在 flat config 中明确声明。
- lint 结果为 0 error / 0 warning；audit、typecheck、27 个 unit、当前三引擎 E2E、Chromium golden、双构建、consumer 和体积预算全部通过，运行时产物体积无实质变化。
- ESLint 10.9.1 暂不强装：当前 `eslint-plugin-react@7.37.5` 的正式 peer 上限仍为 ESLint `^9.7`。等官方声明 ESLint 10 兼容后再做独立升级，不用 peer override 掩盖。

## U5a：Vite 7

- 首选 7.3.1 在安装后被 audit 检出 3 个 high advisory，未继续 E2E/构建；查询 registry 后改为最新安全补丁 7.3.6。
- Vite 7.3.6 保持 `rollupOptions`、自定义 library asset import hook、React SWC 4.3.3 和 Vitest 3.2.6 不变，确保本步只观察 Vite 主版本。
- typecheck、lint、27 unit、当前三引擎 E2E、Chromium golden、Web/library build 和清洁 consumer 全部通过。
- Web 主 JS 1,507,817 B / gzip 484,180 B；library 最大 JS chunk 880,611 B / gzip 232,164 B；较 U4 略有下降。
- high/critical audit 为 0；Vite 7 间接依赖的 esbuild 0.27.7 有一个 Windows-only dev server low advisory，Vite 8/Oxc 步骤继续验证是否消除，不使用 override 改传递依赖。

## U5b：Vite 8 / Rolldown / Vitest 4

- Vite 升至 8.2.2、Vitest 升至 4.1.11，library 配置从弃用的 `rollupOptions` 迁为 `rolldownOptions`；显式固定 Vite peer 范围内且已修复 advisory 的 esbuild 0.28.2，low audit 为 0。
- Vite 8 对 ESM importer 使用一致的 CommonJS 默认导入语义。遗留的 `mage-icons-react@0.7.0-beta` 没有 ESM/exports 入口，因此在既有 Icon 层局部解包 callable default，并新增两个单测；没有启用全局 legacy interop。
- library 构建使用 Rolldown 官方 `esmExternalRequirePlugin` 独占 peer external，把 bundled CJS 图标内部的 `require("react")` 转为 ESM namespace import；顶层 `external` 不再与插件重复声明。
- frozen install、audit、typecheck、lint、29 unit、当前三引擎 8 个功能 E2E、Chromium 两项 golden、Web/library build、清洁 tarball consumer 和双实例隔离全部通过。
- Web 主 JS 1,463,515 B / gzip 460,470 B；library entry 659,862 B / gzip 185,675 B，总 JS gzip 349,426 B；最大图片 data URL 246 B，均在预算内。
- `@vitejs/plugin-react-swc` 在无 SWC plugins 时会提示切换到 React/Oxc；遵守单变量原则，另设 U5c，不与 bundler 迁移合并。

## U5c：React plugin / Oxc

- `@vitejs/plugin-react-swc@4.3.3` 替换为 `@vitejs/plugin-react@6.1.1`，根 Vite 与清洁 consumer 配置同步；依赖树不再包含 `@swc/core`。
- 保持默认 `react()`，未安装 optional Compiler peers，也未启用 React Compiler；本步只替换 JSX/Fast Refresh transformer。
- 独立 consumer 过去从父级工作区隐式取得 Vite/plugin；现把 Vite 8.2.2 和 React plugin 6.1.1 声明为 fixture devDependencies，清洁安装不再依赖根 package 的偶然依赖。
- low audit、typecheck、lint、29 unit、当前三引擎 E2E、Chromium golden、双构建、清洁 tarball consumer 与体积预算全部通过；构建 hash 与体积指标相对 U5b 不变。

## U6：Ant Design 6 / cssinjs 2

- AntD 精确升级至 6.6.2、`@ant-design/cssinjs` 至 2.1.2，依赖树只有一套 cssinjs；library peer 契约同步为 AntD `>=6.6.2 <7`、cssinjs `>=2.1.2 <3`。
- 依据浏览器运行时警告迁移 Divider `orientation`、Drawer `size`、Button `iconPlacement`、Modal `destroyOnHidden`，Popover 改用 semantic `classNames/styles`；删除对旧 `.ant-popover-inner(-content)` DOM 的样式依赖。
- `EmojiSelect` 使用 `forwardRef` 将外层 Tooltip/Trigger 的 ref 传到真实 Button，不再依赖 findDOMNode fallback；consumer 会把 AntD deprecated warning 与函数组件 ref warning 视为失败。
- 新增当前三引擎的尺寸 Popover、左右移动 Drawer 交互验证；既有 Chromium 首屏和 PNG 导出 golden 无变化。
- frozen install、low audit、typecheck、lint、29 unit、11 个三引擎功能 E2E、双构建、清洁 tarball consumer/双实例和体积预算全绿。
- Web 主 JS 964,772 B / gzip 306,250 B；library entry 660,224 B / gzip 185,808 B，总 JS gzip 349,559 B；最大 data URL 246 B。

## U7：React 19.2

- React/DOM 精确升级至 19.2.8，类型同步为 `@types/react` 19.2.18、`@types/react-dom` 19.2.5；library peer 契约同步为 React/DOM `>=19.2.8 <20`。React Compiler 未安装、未启用。
- 静态扫描确认源码已使用 `createRoot`，没有 React 19 删除的 `render`、`hydrate`、`findDOMNode`、`unmountComponentAtNode`，也没有函数组件 `propTypes/defaultProps` 或会意外返回值的 ref callback。
- `@emoji-mart/react@1.1.1` 的 peer 只到 React 18，已移除该薄封装，改用同版本 `emoji-mart` 官方框架无关 Picker/update API；三引擎断言实际 custom element 可见。
- `react-cropper@2.3.3` 的 `zoomTo` prop effect 在 React 19 StrictMode 重连时会访问已销毁实例；缩放初始化迁至 Cropper 的 `ready` 事件，三个引擎的裁剪弹窗回归通过。
- `mage-icons-react@0.7.0-beta` 仍把五种 SVG 属性写成非法 kebab-case 且直接依赖 React 18；用受版本/checksum 约束的 pnpm patch 修正属性，并把其内部 React override 到 19.2.8。根与 consumer 各自使用只含 `.` 的 workspace 配置，既承载补丁又保持 fixture 独立安装。
- frozen install、low audit、typecheck、lint、29 unit、当前三引擎 11 个功能 E2E、Chromium golden、双构建、清洁 tarball consumer/双实例与体积预算全绿。
- Web 主 JS 964,091 B / gzip 306,191 B；library entry 660,224 B / gzip 185,809 B，总 JS gzip 349,503 B；最大 data URL 246 B。

## U8：MobX 7 / mobx-react-lite 5

- `mobx` 精确升级至 7.0.3、`mobx-react-lite` 至 5.0.3；library peer 契约同步为 MobX `>=7.0.3 <8`、lite `>=5.0.3 <6`，依赖树各一套。
- 按 MobX 7 changelog 扫描 Proxy fallback、`useProxies`、`{ proxy: false }`、legacy decorators、namespaced annotations、旧 `trace`；源码均未使用。现有 `makeAutoObservable`、`action`、`runInAction`、`toJS` 可直接保留。
- frozen install、low audit、typecheck、lint、29 unit、当前三引擎 11 个功能 E2E、Chromium golden、双构建、清洁 tarball consumer/双实例与体积预算全绿。
- Web 主 JS 964,091 B / gzip 306,195 B；library 指标与 U7 相同（entry gzip 185,809 B、总 JS gzip 349,503 B）；最大 data URL 246 B。

## U9：Tailwind CSS 4

- Tailwind CSS 与 `@tailwindcss/vite` 精确升级至 4.3.3，`tailwind-merge` 同步至 3.6.0；删除旧 PostCSS/Autoprefixer 直依赖与两份 JS/PostCSS 配置。
- Vite 同时服务 Web 与 library 的插件链加入 Tailwind Vite plugin；CSS 使用 `@import "tailwindcss" source("../")` 把扫描根明确限定为 `src`，不依赖执行目录或自动扫描整个仓库。
- 按 Ant Design 6 官方 Tailwind v4 兼容方案采用 `theme, base, antd, components, utilities` 顺序，并启用 `<StyleProvider layer>`；三引擎测试确认运行时确实注入 `@layer antd`。
- 旧 JS config 只配置了 content、未使用的 container 定制和未被任何 `dark:` utility 使用的 selector；已由显式 source 取代，不保留空壳 `@config`。源码无 v4 已改名 utility，bare border 均有显式颜色。
- 官方 upgrade CLI 在 Linux arm64/Node 24 上因其 tree-sitter native 预构建缺失而无法启动，未改工作区；迁移依据官方文档手工完成并逐行 review。
- frozen install、low audit、typecheck、lint、29 unit、当前三引擎 11 个功能 E2E、Chromium golden、双构建、清洁 tarball consumer/双实例与体积预算全绿。
- Web 主 JS 964,100 B / gzip 306,204 B，主 CSS 55,753 B / gzip 10,937 B；library entry gzip 185,826 B、总 JS gzip 351,648 B，CSS gzip 11,885 B；最大 data URL 246 B。

## 完成状态

U3～U9 已全部完成。ESLint 10 仍因 `eslint-plugin-react` 正式 peer 上限而延期，不以 override 强装。总 Review 已把构建 target 显式固定到已确认浏览器线，并将严格 peer/low audit 同步到 CI 和清洁 consumer。

最终门禁结果：Node 24.18.0 / pnpm 10.12.1 frozen strict-peer install、ignored builds None、low audit、typecheck、零警告 lint、29 unit、当前三引擎 11 项功能 E2E、Chromium 两份 golden、Web/library build、清洁 tarball consumer/双实例和体积预算全部通过。最终体积为 Web JS gzip 306,204 B、CSS gzip 10,937 B；library JS 总 gzip 351,648 B、CSS gzip 11,885 B；最大图片 data URL 246 B。

最低浏览器版本的真实环境验收仍属于 Web Release Gate；当前 Playwright 引擎结果不等价于 Chrome/Edge 111、Firefox 128、Safari 16.4 已通过。
