# `ImageBeautifier` 组件 API

## 构建与导入

库入口为 `src/index.js`，仅导出命名组件 `ImageBeautifier`。

```jsx
import { ImageBeautifier } from 'rico-screenshot';
import 'rico-screenshot/style.css';

export default function Page() {
  return <ImageBeautifier />;
}
```

本地生成库产物：

```bash
pnpm build:lib
```

Vite 以 ES module 形式输出 `lib/image-beautifier.es.js`（历史产物名）和 `lib/style.css`，声明文件输出为 `lib/index.d.ts`。`exports` 公开根入口、`./style.css` 和 `./package.json`；消费端不应依赖带 hash 的内部 chunk 名。

构建只 externalize 明确的宿主 peer：React/ReactDOM、MobX/mobx-react-lite、Ant Design 与 `@ant-design/cssinjs`。其余实现依赖（LeaferJS、Radix UI、cropperjs、Emoji Mart 等）登记在 `devDependencies` 并打进产物，所以 `dependencies` 为空；LeaferJS 随 library 封装，避免宿主出现两套插件注册表。`sideEffects` 明确保留 CSS 和 library JS 的 Leafer 插件注册。`import 'rico-screenshot/style.css'` 同时携带内部控制所需的 Radix 主题变量、组件样式与应用侧的 Radix 接入桥接（`radix-bridge.css`：顶栏包裹层 `display:contents`、深色 token 对齐、44px 触控目标），宿主无需安装或引入 Radix。`pnpm test:consumer` 会打包并在独立 package 中安装真实 tarball，覆盖“宿主只引包内样式”的 Radix 样式回归，而不是从仓库源码取巧导入。

## Props

| 属性 | 类型（按实现推断） | 默认值 | 说明 |
| --- | --- | --- | --- |
| `defaultImg` | `string` | `undefined` | 初始或外部更新的图片地址/data URL；变化时重新载入 |
| `headLeft` | `ReactNode` | 内置 Logo | 替换头部左侧内容 |
| `headRight` | `ReactNode` | 内置主题与语言按钮 | 替换默认组件头部右侧内容；`workspace=true` 时保留工作区主题/语言入口 |
| `isDark` | `boolean` | `undefined` | 显式控制亮/暗主题；未传时读取本地主题偏好 |
| `boxClassName` | `string` | `''` | 合并到顶层容器的 className |
| `onClear` | `() => void` | `undefined` | 用户确认删除当前截图后调用 |
| `persistence` | `false` 或 `{ key: string, autoRestore?: boolean }` | `false` | 显式开启 IndexedDB 草稿；按 `key` 隔离，`autoRestore` 默认开启 |
| `workspace` | `boolean` | `false` | 显式开启独立站菜单、项目/预设文件、本地资料库和本地样式建议；独立站默认传入 `true` |
| `locale` | `'zh-CN' \| 'en-US' \| 'zh-TW' \| 'de-DE' \| 'ko-KR' \| 'es-ES' \| 'pt-PT'` | `'zh-CN'` | 实例 UI 语言；修改 prop 不重建 runtime，不翻译用户名称或画布内容 |
| `messages` | `Readonly<Record<string, string>>` | `{}` | 以当前中文源文案为键覆盖 UI 翻译；只接受字符串，缺失项回退至内置词典/原文 |

`defaultImg` 通过 `<img>` 加载；非 data URL 会设置 `crossOrigin="Anonymous"`。远程服务器必须允许跨域，否则载入或导出可能失败。组件不会释放宿主通过 `defaultImg` 传入的 `blob:` URL；由文件导入或草稿恢复创建的 object URL 则归对应实例管理并在替换/卸载时释放。

未导入图片时，中央图片图标和“选择图片”按钮共用当前实例的文件输入；图标是可键盘激活的按钮，整个欢迎区域接收本地图片拖放。导入、错误处理及资源所有权仍属于该实例，不新增公共 props，也不改变 `defaultImg` 或持久化默认行为。

`persistence` 默认关闭，组件不会因草稿服务访问 IndexedDB。开启后，项目变化会以 750ms 防抖保存；关联的原图、上传背景和所选内置图片背景以二进制字节保存，读取时恢复为 Blob，以兼容当前三种浏览器引擎。组件卸载只释放运行时 object URL，不删除草稿。传入 `defaultImg` 时优先使用宿主图片，不自动覆盖为草稿。

`workspace` 与 `persistence` 是独立开关。开启 `workspace` 后，独立站菜单与本地资料库会使用 IndexedDB 保存最近项目和风格预设，并提供 `.screenhello` / `.screenhello-preset` 文件交换；宿主若希望自动草稿恢复，仍需同时传入独立、稳定的 `persistence.key`。保留默认值 `false` 是为了不让现有 library 消费端静默出现这些 UI 或本地存储副作用。

`workspace=true` 会把 `Cmd/Ctrl+S` 解释为保存 `.screenhello` 项目；默认的 `workspace=false` 保持历史兼容行为，即按当前导出设置下载图片。两种模式都只响应最近点击/聚焦的 runtime，输入控件内不拦截系统快捷键。

语言与覆盖文案由实例拥有，不修改宿主 `document.lang` 或 MobX 全局配置。`messages` 的 `{0}` 等占位符按纯文本插值，不能注入 HTML；应保留原占位符。源文案键不是独立版本化的消息 ID，升级时需复核自定义覆盖。右上角提供 Light/Dark 和使用语言自称的语言选择菜单；窄屏压缩为图标/语言缩写，“帮助”对话框继续保留语言选项。独立站保存当前设备的语言偏好，组件不读取或写入此独立站语言偏好。

语言菜单支持 Enter/Space/向下键打开、方向键/Home/End 导航、Enter 选择、Escape 关闭并返回当前实例的触发按钮；Tab 可离开菜单。选中语言通过 `menuitemradio` / `aria-checked` 声明，按钮读屏名称包含当前语言及可见缩写。主题按钮的读屏名称包含切换目标 Light/Dark。

内置 locale 与 Ant Design locale 按实例同步。繁体中文采用 `zh-TW`，葡萄牙语采用 `pt-PT`（尚非独立巴西葡语词典）。七语词典随产物本地提供，切换不访问翻译服务；Web 预缓存包含词典拆包，保持原有 1 MiB 单文件和 3 MiB 核心资源预算。新增词典的键与占位符已纳入 `pnpm audit:i18n`，完整覆盖不等于母语质量验收，正式发布前仍需母语校对。

草稿无法恢复时，当前会话暂停该 key 的自动保存和清除，保留原记录。渲染异常提供普通重试和“保留草稿并以空白编辑器重试”；后者重建实例、跳过默认图和自动草稿读写，不删除旧草稿。可继续编辑、导出或另存项目文件；重新打开页面才重试原草稿。

## 宿主布局

开启 `workspace` 的组件使用与独立站相同的压缩/预览抽屉，支持七语、同 Blob 下载与实例隔离。默认 `workspace=false` 继续使用原格式/倍率快捷下载界面，不自动改变既有嵌入行为。未新增公开导出服务或预览 token API；原 props、库入口、快捷键和默认质量不变。压缩偏好随既有项目/预设保存，自动草稿不包含这些偏好。

开启 `workspace` 后，批量同样使用已确认的完整压缩设置。C3 重试只复用所属实例已解析的风格/背景快照，不因后来修改设置或删除预设而改变；新 ZIP 只包含此次重试成功项，需保留的旧 ZIP 应提前下载。没有新增 BatchStore、快照或内部 service 的公共导出；详情见 [C3](./export-compression-c3.md)。C4 新模式/完整预览上限为 1,048,576 像素，标准导出上限不变；ZIP 保存中的互斥与资源释放规则见 [C4](./export-compression-c4.md)。

组件根节点使用 `w-full h-[100vh]` 和可重复的 `.shoteasy-app` class，不再生成固定 ID。嵌入非全屏区域时，可通过 `boxClassName` 传入宿主已有的 CSS class 覆盖高度；如果 class 只存在于消费端源码，消费端的 CSS/Tailwind 构建必须能生成它。

顶栏外观按钮按所在顶栏的实际宽度压缩，而非仅按浏览器窗口宽度。较窄容器中的工作区复用紧凑应用菜单，避免宽屏页面内嵌 640 px 编辑器时裁掉语言入口；这不改变侧栏现有的视口断点策略。

```jsx
<ImageBeautifier
  defaultImg={imageDataUrl}
  isDark={theme === 'dark'}
  boxClassName="h-[720px]"
  headLeft={<strong>My Editor</strong>}
  onClear={() => setImageDataUrl(null)}
  persistence={{ key: 'my-editor', autoRestore: true }}
  workspace
/>
```

## 集成限制

编辑器界面及用户命令现在仅提供AVIF标准导出，工作区与批次将旧AVIF压缩偏好转为同格式/倍率标准设置，不显示质量或预览操作。组件Props、底层归档解析与直接ExportService契约保持兼容；这些低层接口仍可读取历史压缩参数，不等于用户界面继续提供AVIF压缩。内部`webExportSafety`及底层历史预算未放宽，标准AVIF仍最多4,194,304像素。性能/发布状态见 [导出修复](./compression-download.md)，本次未发布npm包或更新官网。

Surface Studio / Surface Pro 与五款历史 MacBook/iMac/iPad/iPhone 是构建时可选的本地位图素材，不是新增的公开 props 或素材授权。Surface Pro 的内部 ID 仍是 `surface-pro-8`；五款历史素材使用新增 `*-bitmap` ID，具体授权尚待核实。默认公开源码不附带此包；安装包的本地 library 产物可显示真实设备，并按实例在下载/复制前提示许可状态。原矢量选项移入折叠的“简约设备框”，已有项目渲染不变。项目只存设备 ID；没有素材包时隐藏新建选项，并阻止既有设备项目降级导出。宿主必须保留组件 CSS 与资产目录，不能只复制入口 JS。详见 [可选真实位图设备框](./raster-device-frames.md)。

- 仅支持浏览器环境；模块和组件使用 DOM、Canvas、媒体、剪贴板及 localStorage API。
- 每个实例拥有独立 MobX root store、History、AssetStore、DraftService 与 Leafer App；全局快捷键只作用于最近点击/聚焦的实例。
- 宿主需提供满足 `peerDependencies` 的单一 React/ReactDOM、MobX 和 AntD 生态实例；LeaferJS 不属于公共 peer 契约。
- Devices.css 机型的位图素材**不随 library 产物发布**，但保留设备 ID、名称和几何元数据，并标记为不可用。新建列表隐藏这些机型；打开站点保存的相关项目时保留原 ID，图片导出报 `device-render-failed`，用户需改用可用外框后导出，不会静默丢掉机身。其它可选本地设备包是否进入 library 取决于构建环境。当前没有宿主注入设备素材包的公共 API。
- Radix UI（导出栏与右侧检查器的按钮、滑块、开关、分段控件）同样是内部实现：JS 与它需要的 Radix 主题样式、接入桥接样式都随 `lib/style.css` 封装，宿主不需要安装 `@radix-ui/themes`，也不需要额外引入任何 Radix 样式表。构建只保留用到的 `tokens.css` + `components.css`，并在构建期裁掉未使用的调色板与未渲染组件的规则（保留集见 `config/radixCss.mjs`），也不包含 Radix 布局组件与 `rt-r-*` 工具类，所以不要在导出栏或右侧检查器的 Radix 子树里使用 Radix 布局组件（`Flex`/`Grid`/`Section`/`Box` 等），新增 Radix 控件时需同步扩保留集。
- 多实例同时启用 `persistence` 时应传入不同且稳定的 `key`；相同 key 表示读写同一条本地草稿记录，不提供冲突合并。
- 多实例同时启用 `workspace` 会共用浏览器中的项目库；运行时状态仍隔离，但最近项目和预设不是实例私有命名空间。
- 应用自有 UI 支持上述七种语言；用户内容、旧项目中的名称不翻译。Emoji Mart 选择器与表情搜索词库保留既有英文模式，避免其模块级 I18n 在多实例间互相覆盖或按 locale 请求 CDN。PWA 安装元数据固定中文，系统自带按钮语言由操作系统决定。桌面 Rust 原生托盘/应用提示词典仍仅简体中文与英文，新增五语的原生应用文案暂回退英文，不代表原生端已完成七语翻译。
- 没有受控 option/shapes API，也没有导出完成、编辑变化等事件回调。
- 剪贴板、屏幕捕获和 EyeDropper 能力取决于浏览器与安全上下文。

## 发布信息

- 包名：`rico-screenshot`（产物文件沿用 `image-beautifier.es.js` 历史命名）
- 当前版本：`1.0.4`
- 模块格式：ES module
- 许可证：MIT
- `package.json#files`：`lib`、`LICENSE`、`README.md`

Web P0 前不公开 npm 包，`rico-screenshot` 只是内部兼容名；P0 后需要另行决定 ScreenHello 公共包名与版本策略。当前 `pnpm release` 与 `prepublishOnly` 均由 `scripts/release-not-configured.mjs` 非零退出阻断，不执行 npm 发布；解除保护或真正发布必须先取得明确授权。
