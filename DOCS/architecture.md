# 架构与数据流

## 总体结构

React 负责控制面板和生命周期，MobX 保存跨组件状态，LeaferJS 负责实际画布节点和导出。React 图层组件不渲染 DOM，而是在 `useEffect` 中创建、更新和移除 LeaferJS 对象。

```text
图片输入
  ↓
useSetImg → imageStore resources/images[] ─┐
                    option.* ──────────────┤
                                     ↓
React View → Leafer App → Frame（最终画布）
                         ├─ Screenshot[] 图片/设备框（按 zIndex）
                         ├─ ShapeLine 标注
                         └─ Watermark 重复水印
                                     ↓
                         Leafer export → 下载/剪贴板
```

## 顶层生命周期

`src/App.jsx` 是站点和组件库共用的顶层组件：

1. `StoreProvider` 为每次挂载创建独立 `ScreenHelloRuntime`，通过 Context 下发给子组件。
2. effect 创建 Ant Design message 上下文、宿主清理回调、主题、默认图片和可选草稿服务；render 阶段不写 Store/localStorage。
3. `editor.img.src` 存在时显示 `Editor`，否则显示 `Init`。
4. 始终显示 `Header` 和 `SideBar`；无图片时，命令式 `ensureEditing()` 会提示先添加图片。
5. Error Boundary 包在 Provider 外层，捕获 render/lifecycle 错误并给出本地重试界面；错误会卸载当前 Provider/runtime，重试时创建全新实例。

独立站额外传入 `workspace`，启用项目中心；library 的该属性默认 `false`，不会改变既有消费端 UI 或存储行为。

## 状态模型

### `editor`：运行时与交互状态

`src/stores/index.js` 的工厂为每个组件实例构造一个 root-store 图；`src/stores/editor.js` 导出可实例化的 MobX 类，主要字段包括：

| 字段 | 含义 |
| --- | --- |
| `img` | 当前活动图片的兼容视图；事实来源是 `imageStore` |
| `app` | LeaferJS `App` 实例 |
| `scale` | 画布当前缩放百分比，用于 UI 显示 |
| `useTool` | 当前标注工具；空值表示选择模式 |
| `annotateColor` / `strokeWidth` | 新标注默认样式，也会更新当前选择项 |
| `shapes` | 以随机 ID 为键的标注 `Map` |
| `snap` | 放大镜使用的截图快照 |
| `theme` | `light` 或 `dark` |
| `message` / `clearFun` | Ant Design 消息实例和宿主清理回调 |

`destroy()` 会销毁 LeaferJS 应用、清空标注和快照，并退出当前工具。runtime `dispose()` 还会释放主图/背景 object URL、History、AssetStore、草稿 reaction/定时器与 IndexedDB 连接（不删除已保存草稿）。

### `imageStore`：图片资源与图层

`src/stores/imageStore.js` 将运行时资源表与可序列化图层表分离。资源表按 `assetId` 保存 src/Blob 与 object URL 所有权；图层表保存 `id`、尺寸、transform、zIndex、locked 和 groupId。`editor.img` 继续返回活动图，供旧侧栏、裁剪和 library 宿主兼容使用。

单项目最多 12 个图片图层，唯一资源总预算 1.2 亿像素。复制图层共享资源；对副本裁剪时 copy-on-write。删除后资源在历史仍可能引用时暂留，在引用它的历史快照被淘汰、History 重建基线或 runtime 销毁时清理。

`BaseSnapshotService` 以全部图片图层的资源、几何、层序和会影响底图外观的项目样式生成 revision，120 ms 防抖后只导出背景、所有图片及外框；标注、水印与区域效果会在导出期间临时隐藏。放大镜直接复用原始快照，模糊/马赛克按 `revision + 参数` 缓存变体。

### `option`：画面配置

`src/stores/option.js` 由同一 root store 构造，保存画布和截图表现：缩放/翻转、留白、圆角、阴影、独立内描边、外框、设备适配模式、背景、对齐、水印、HDR、尺寸预设和最终画布宽高。它只通过注入的 root 访问当前实例的 History/AssetStore；上传背景的 object URL 归当前实例所有。

派生属性：

- `mode`：普通图和浏览器标题栏强制使用 `cover`；设备框使用 `frameMode`。
- `waterSvg`：将水印值转换为普通 JS 数据后交给 LeaferJS。

### `workspace`：项目、预设与本地建议

`src/stores/workspaceStore.js` 只在 `workspace` 开启时工作，负责项目名/脏状态、项目打开与保存、最近项目、草稿列表、风格预设、导出设置、存储状态和样式建议。项目/预设容器工具通过动态 `import()` 加载，因此 ZIP 编解码不会进入未使用项目中心的初始执行链路。

项目中心复用实例自己的 Editor、Option、History、AssetStore 和 DraftStore，不建立第二套编辑状态。它不会自动应用建议；背景色、内描边和外框分别提交到现有 Option action，并进入现有历史链路。

### `batch`：隔离批量处理

standalone runtime 拥有实例级 `BatchStore`；只有 `workspace` 开启时显示批量入口。面板、`BatchExportService` 和隔离 renderer 分层动态加载，library 默认不会显示入口或新增公共导出。

开始任务时，BatchStore 同步冻结当前风格，或记录所选本地预设 ID 供 service 读取。service 只维护 1～12 个串行 job；每项在独立的隐藏 Leafer App 中复用 `FrameBox`、`Screenshot` 和 `Watermark`，经活动 runtime 的 ExportService `target + size` 内部契约编码，再由 fflate pass-through 写入一个 ZIP。隔离 runtime 不启用 BatchStore、workspace、草稿、历史或交互编辑器，结束时释放图片 object URL、背景资源、Canvas 和 DOM。

批处理的状态、ZIP Blob 和控制器都属于当前 runtime；它不替换活动 ImageStore/Option/History，也不保存草稿或最近项目。累计成功图片为 96 MiB、ZIP 为 97 MiB，预算触顶时保留此前成功项并停止剩余 job。

## 画布初始化与事件

`src/components/editor/View.jsx` 在容器可用时创建 LeaferJS `App`：

- `tree` 使用 viewport，承载最终可导出的内容。
- `sky` 使用 draw，编辑控制柄由 Leafer 编辑器插件管理。
- `ScrollBar` 提供滚动条。
- 容器尺寸变化或画布尺寸变化时自动执行 `zoom('fit', 100)`；若画布本身小于可用区域，则回到 100%。
- 指针/拖拽事件按 `editor.useTool` 创建标注，并持续把几何信息写回 `editor.shapes`。
- 选择、删除和缩放快捷键直接操作 LeaferJS 实例。

组件卸载时会移除尺寸监听，取消 debounce/RAF/timeout，并同步销毁旧 Leafer App。React Strict Mode 的模拟 cleanup 使用可取消的零延时 teardown，紧随其后的 setup 会复用 Store 状态但销毁残留画布；真实卸载则完成整个 runtime 的释放。

## 图层组成

### FrameBox

画布背景固定使用 20px 圆角，并由最外层 `Frame` 负责裁切，编辑器预览与导出保持一致。

`FrameBox.jsx` 创建固定宽高、裁切溢出的 Leafer `Frame`，其 `fill` 是最终背景。它把 `parent: frame` 注入所有 React 图层子组件。

### Screenshot

每个 V2 图片图层复用一个 `Screenshot.jsx` 实例，由三个主要 Leafer 节点组成：

- `container`：整体定位、缩放、阴影、描边和圆角。
- `box`：图片可见区域及留白底色。
- `image`：实际图片填充、翻转与适配模式。

`container` 承载平面旋转、缩放和位置偏移；独立 `innerBorder` 在图片可见区域内侧渲染，可与外框并存。旧草稿中的 `rotationX`/`rotationY`/`perspective` 字段会在文档规范化时移除，不再作为当前功能。

Leafer Editor 原生维护单选/多选；节点上的稳定 layer id 把 move/scale/rotate 结果回写 ImageStore。逻辑编组会扩展选择范围，锁定层在画布上不可编辑。当前 LeaferJS 2.2.9 没有项目已安装的吸附 API，因此由 ImageStore 在单图手势结束时完成画布/其他图片边缘和中心吸附。

选择浏览器外框时，会按简洁/标签/极简定义创建 Leafer `Rect`/`Text` 与项目内 SVG 图标节点；标题栏基准高度按样式区分，再乘以 `browserHeaderSize`（50%–200%，默认 100%），地址栏渲染 `browserUrl`。标题高度会从图片可用高度中扣除，保证整个浏览器框仍落在画布布局范围内。选择设备框时，会根据无品牌矢量设备的逻辑坐标计算屏幕开口；旧品牌 ID 只作为兼容别名。HDR 开启后先通过 Canvas 生成增强后的 data URL，再替换图片填充。

### ShapeLine

`ShapeLine.jsx` 根据 `type` 将 MobX 数据映射为 Leafer 图形：

| 类型 | Leafer 节点/行为 |
| --- | --- |
| `Square` | 空心圆角矩形 |
| `SquareFill` | 实心圆角矩形 |
| `Circle` | 空心椭圆 |
| `Slash` | 直线 |
| `MoveDownLeft` | 箭头 |
| `Pencil` | 曲线折线 |
| `Magnifier` | 自定义椭圆，使用画布快照作 2 倍局部填充 |
| `Step` | 带自动递增数字 SVG 的圆形 |
| `emoji` | 可缩放文本 |

放大镜需要 `editor.createSnap()`：导出截图图层、临时隐藏其他图层，再把快照回填给放大镜。快照更新使用防抖，避免连续样式调整时频繁导出。

### Watermark

侧栏把文字转换为 SVG data URL；画布图层以 `repeat` 模式平铺。`waterIndex` 为 `1` 时覆盖在截图之上，为 `-1` 时位于截图之下、仅在背景区域可见。

## 输入链路

- 文件/拖放：Ant Design Upload 的 `beforeUpload` 拦截实际上传，将 `File` 交给 `useSetImg`。
- 粘贴：`usePaste` 监听 `document` 的 `paste`，但只有最近点击/聚焦的 runtime 处理第一个受支持图片项。
- 截屏：`captureScreen` 请求桌面媒体流，将首个可播放视频帧绘制到 Canvas。
- `defaultImg`：按 data URL/URL 路径直接加载。

`useSetImg` 对所有本地文件统一执行 MIME、字节、尺寸、像素和真实解码校验，再写入 ImageStore。初次导入/更换继续走 `editor.img` 兼容入口，并在 `auto` 模式下按默认 4:3 策略建立画布；图层面板的多文件选择先全部准备、统一校验项目预算，再原子追加到现有画布，不改变既有画布尺寸。

从项目或草稿恢复的图片也经过同一 `imageValidation.js`；除单资源限制外，ImageStore 还执行项目级图层/总像素预算。多图按顺序准备，任一失败或卸载取消都会释放临时 object URL，保持原画布不变。

## 项目容器与本地持久化

`.screenhello` 和 `.screenhello-preset` 都是版本化 ZIP 容器。项目使用 `ProjectDocument v2/images[]`，每个图片 descriptor 都有独立大小和 SHA-256；读取仍兼容 V1 的 `assets.image`。读取与创建两端都限制压缩包 64 MiB、单入口 48 MiB、解压声明总量 96 MiB，并拒绝 manifest 未引用的额外入口。项目最多 12 图，因此入口上限为 14（manifest、12 图、可选背景）。

IndexedDB 数据库当前为 v2：`projects` 保存草稿文档，`assets` 保存草稿资源，`presets` 保存完整风格预设，`recentProjects` 保存便携项目副本。二进制资源统一以 `Uint8Array` 写入、读取时恢复 Blob，同时兼容早期直接保存 Blob 的记录；最近项目按更新时间保留 12 条。IndexedDB 不可用、配额不足或记录损坏时，编辑与普通导出仍可继续，项目中心显示降级状态。

本地建议由 `imageSuggestions.js` 在最大边长 64px 的 Canvas 采样上计算边缘平均色和亮度，再按方向给出外框候选。该链路没有网络请求、模型下载或自动应用。

## 导出链路

每个 `ScreenHelloRuntime` 拥有一个 `ExportService`；`DownloadBar.jsx` 只提交格式、倍率和取消信号。服务对请求执行实例级串行、预算/结果校验和资源清理，再调用当前 `app.tree` 或内部显式 `target`：

- PNG：保留透明背景。
- JPG/WebP：质量为 `0.9`，透明区域用白色填充。
- AVIF：先取得 native canvas/ImageData，再把 RGBA buffer 转移给实例级、按需加载的 scalar module Worker；质量/alpha quality 60、speed 8，保留透明度。
- 像素倍率：1、2 或 3。
- 下载：Blob 转 object URL 后触发临时 `<a download>`。
- 复制：始终导出 PNG Blob，再通过 Clipboard API 写入。

批量处理复用显式 `target + size`，因此与活动画布的单图下载/复制共享同一实例队列；ZIP 只封装已经通过 MIME、尺寸和资源清理检查的成功 Blob。批量文件名由独立安全命名器生成，不直接使用输入路径。

Leafer 2.2.9 的 `export('canvas')` 返回 `IExportResult`，其中 `result.data` 是 Leafer canvas wrapper，原生 Canvas 位于 `wrapper.view`。图片导出的临时 wrapper 在 Blob 生成后销毁，native backing store 同时归零；Canvas 结果则返回显式、幂等的 `release()`，runtime dispose 会兜底回收未归还 lease。普通格式受 8192 px 单边和 16,777,216 像素硬限制，AVIF 另受 4,194,304 像素限制。AVIF Worker 空闲 1 秒终止，只加载一个同源 WASM；详见 [Phase 7 Web P2](./phase-7-web-p2.md)。

文件/object URL、File System Access、存储估算/持久化请求、偏好存储、IndexedDB、剪贴板、屏幕捕获和下载统一经 `src/platform/browserPlatform.js` 调用。项目保存会先在用户手势中取得文件 handle，再执行异步 ZIP 编码；不支持系统 picker 时退回 `<input type=file>` 和下载。该边界来自现有真实调用点，用于隔离浏览器实现并为未来桌面适配保留替换位置；它不虚构当前不存在的桌面接口。

快捷键为 `Cmd/Ctrl+S` 下载、`Cmd/Ctrl+C` 复制；只有最近激活的实例响应，焦点位于输入框/文本域/下拉/可编辑内容时保留浏览器原生行为。

## 重要架构约束

- 每个 `ImageBeautifier` 拥有独立 runtime；组件只能通过 `useStores()` 访问 Context 中的实例，Store 只能通过 root 注入访问兄弟 Store。
- 同页多实例的全局快捷键/粘贴通过 active runtime 协调；草稿数据由调用方提供的 persistence key 隔离。
- library 仍是浏览器专用组件，不支持 SSR 直接执行；受控系统能力应经 `browserPlatform`，纯 UI/Canvas DOM 访问保留在浏览器组件内部。
- 批量处理当前只属于开启 workspace 的独立站能力；不得从 `src/index.js` 暴露 BatchStore/service 或让 library 默认出现入口。
- AVIF adapter/Worker/WASM 必须保持功能级动态加载和同源资源 URL；不得退回 Vite library mode 导致 WASM 内联，也不得启用 pthread/COOP/COEP。
- LeaferJS 节点的更新依赖多个 React effect。新增 option 字段时，需要同时检查 store、控制面板、图层 effect 和导出结果。
- `shapes` 保存的是业务快照，Leafer 节点保存实际交互状态；新增编辑行为时要保证二者同步。
