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

构建只 externalize 明确的宿主 peer：React/ReactDOM、MobX/mobx-react-lite、Ant Design 与 `@ant-design/cssinjs`。LeaferJS 是内部画布实现并随 library 封装，避免宿主出现两套插件注册表。`sideEffects` 明确保留 CSS 和 library JS 的 Leafer 插件注册。`pnpm test:consumer` 会打包并在独立 package 中安装真实 tarball，而不是从仓库源码取巧导入。

## Props

| 属性 | 类型（按实现推断） | 默认值 | 说明 |
| --- | --- | --- | --- |
| `defaultImg` | `string` | `undefined` | 初始或外部更新的图片地址/data URL；变化时重新载入 |
| `headLeft` | `ReactNode` | 内置 Logo | 替换头部左侧内容 |
| `headRight` | `ReactNode` | 内置主题按钮 | 替换头部右侧内容 |
| `isDark` | `boolean` | `undefined` | 显式控制亮/暗主题；未传时读取本地主题偏好 |
| `boxClassName` | `string` | `''` | 合并到顶层容器的 className |
| `onClear` | `() => void` | `undefined` | 用户确认删除当前截图后调用 |
| `persistence` | `false` 或 `{ key: string, autoRestore?: boolean }` | `false` | 显式开启 IndexedDB 草稿；按 `key` 隔离，`autoRestore` 默认开启 |
| `workspace` | `boolean` | `false` | 显式开启项目中心、项目/预设文件、最近项目和本地样式建议；独立站默认传入 `true` |

`defaultImg` 通过 `<img>` 加载；非 data URL 会设置 `crossOrigin="Anonymous"`。远程服务器必须允许跨域，否则载入或导出可能失败。组件不会释放宿主通过 `defaultImg` 传入的 `blob:` URL；由文件导入或草稿恢复创建的 object URL 则归对应实例管理并在替换/卸载时释放。

`persistence` 默认关闭，组件不会因草稿服务访问 IndexedDB。开启后，项目变化会以 750ms 防抖保存；关联的原图和上传背景以二进制字节保存，读取时恢复为 Blob，以兼容当前三种浏览器引擎。组件卸载只释放运行时 object URL，不删除草稿。传入 `defaultImg` 时优先使用宿主图片，不自动覆盖为草稿。

`workspace` 与 `persistence` 是独立开关。开启 `workspace` 后，项目中心会使用 IndexedDB 保存最近项目和风格预设，并提供 `.screenhello` / `.screenhello-preset` 文件交换；宿主若希望自动草稿恢复，仍需同时传入独立、稳定的 `persistence.key`。保留默认值 `false` 是为了不让现有 library 消费端静默出现 UI 或本地存储副作用。

## 宿主布局

组件根节点使用 `w-full h-[100vh]` 和可重复的 `.shoteasy-app` class，不再生成固定 ID。嵌入非全屏区域时，可通过 `boxClassName` 传入宿主已有的 CSS class 覆盖高度；如果 class 只存在于消费端源码，消费端的 CSS/Tailwind 构建必须能生成它。

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

- 仅支持浏览器环境；模块和组件使用 DOM、Canvas、媒体、剪贴板及 localStorage API。
- 每个实例拥有独立 MobX root store、History、AssetStore、DraftService 与 Leafer App；全局快捷键只作用于最近点击/聚焦的实例。
- 宿主需提供满足 `peerDependencies` 的单一 React/ReactDOM、MobX 和 AntD 生态实例；LeaferJS 不属于公共 peer 契约。
- 多实例同时启用 `persistence` 时应传入不同且稳定的 `key`；相同 key 表示读写同一条本地草稿记录，不提供冲突合并。
- 多实例同时启用 `workspace` 会共用浏览器中的项目库；运行时状态仍隔离，但最近项目和预设不是实例私有命名空间。
- 内部 UI 文案为中文，当前没有统一国际化接口。
- 没有受控 option/shapes API，也没有导出完成、编辑变化等事件回调。
- 剪贴板、屏幕捕获和 EyeDropper 能力取决于浏览器与安全上下文。

## 发布信息

- 包名：`rico-screenshot`（产物文件沿用 `image-beautifier.es.js` 历史命名）
- 当前版本：`1.0.4`
- 模块格式：ES module
- 许可证：MIT
- `package.json#files`：`lib`、`LICENSE`、`README.md`

Web P0 前不公开 npm 包，`rico-screenshot` 只是内部兼容名；P0 后需要另行决定 ScreenHello 公共包名与版本策略。`pnpm release` 会直接产生外部发布副作用，除非用户明确授权发布，否则禁止运行。
