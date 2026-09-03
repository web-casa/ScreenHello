# Phase 7：Web P2

> 实施日期：2026-09-02～2026-09-03。Phase 7.1～7.6 已完成，发布判定为 GO。当前范围不包含桌面端、浏览器扩展、npm 公开或正式发布。

## 1. Phase 7.1 已实现范围

`src/stores/exportService.js` 现在是每个 `ScreenHelloRuntime` 独立拥有的导出入口。`DownloadBar` 只管理按钮状态和消息，不再直接拼装 Leafer 参数、下载或剪贴板调用。

- PNG 保留透明背景；JPG/WebP 固定 `quality: 0.9` 并以白色填充透明区域。
- WebP 首次使用时探测 Canvas 是否真正返回 `image/webp`；支持时继续使用 Leafer/Canvas 原生编码，不支持时按需加载同源 Worker/WASM。Safari 26.5 的实测回退产物通过 MIME 与 RIFF/WEBP 签名校验。
- 导出倍率仍为 1x/2x/3x；下载文件名仍为 `ScreenHello` 加倍率后缀。
- 下载、复制、普通 Blob 导出和 native canvas 导出共用一个实例级串行队列。
- `AbortSignal` 和 runtime generation 会阻止排队任务、迟到下载/剪贴板副作用及成功提示；Leafer 2.2.9 本身没有中止正在编码任务的接口，因此运行中的导出仍会等待其 settle，再清理资源并返回 `export-cancelled`。
- `target + size` 是供后续隔离 renderer 使用的内部契约；自定义 target 必须同时声明源尺寸。它没有从 `src/index.js` 暴露，不属于当前 npm 公共 API。
- 请求和实际结果都校验格式、MIME、倍率、宽高和预算；结果尺寸与请求不一致会显式失败，不下载错误文件。

## 2. 队列、错误与资源所有权

同一 runtime 的 render、下载和剪贴板副作用严格串行。Leafer 导出插件 2.2.9 内部还有一个跨 tree、`parallel: false` 的 `TaskProcessor`，因此当前 Leafer 全尺寸 render 在多个 runtime 间也不会并行；后续非 Leafer encoder 不得假定自动获得这层保证。

服务使用稳定错误码区分取消、格式/倍率不支持、尺寸超限、render 失败、结果无效、Canvas 无效、WebP/AVIF codec、资源释放失败、下载失败和剪贴板失败。UI 会单独解释通用尺寸上限、AVIF 专属像素上限和 AVIF 编码失败，并建议回退 PNG/WebP；复制仍固定走 PNG，不受当前 AVIF 选择影响。

图片导出通过 Leafer `onCanvas` 捕获临时 wrapper。清理会执行 wrapper `destroy()`，并把已捕获 native canvas 的宽高归零以立即释放 backing store。首轮 review 只调用 `destroy()` 时，6 次 4096×4096 连续导出的浏览器进程树 RSS 会明显累积；补上 backing-store 归零后，三引擎重复基准回到单次边界样例附近。

`exportCanvas()` 返回 `{ canvas, width, height, pixelRatio, release }`。调用者读取完成后必须调用幂等的 `release()`；runtime dispose 会兜底释放所有未归还 lease。AVIF adapter 和 WebP 条件回退在 ExportService 内部把“取 Canvas → 读取 ImageData → Worker 编码 → release”包在同一个排队 operation 中，UI 不自行组合这条链路。

## 3. Leafer 2.2.9 实际契约

结论来自已安装的 `@leafer/interface`、`@leafer-in/export` 和 `@leafer/canvas-web` 2.2.9 源码及当前三引擎运行时验证：

- `tree.export()` 返回 `Promise<IExportResult>`；`result.data` 才是 Blob、字符串、布尔值或 `ILeaferCanvas`。
- `export('canvas')` 的 `result.data` 是 Leafer canvas wrapper，原生 Canvas 通过 `wrapper.view` 取得。
- wrapper 提供 `destroy()`，但 Web 实现只移除节点并断开引用，不主动把 native canvas backing store 归零。
- 图片导出可通过 `onCanvas` 取得临时 wrapper，并在 Blob 已生成后安全释放。
- 插件没有 `AbortSignal` 参数；取消只能在应用层阻止未开始任务和导出后的副作用。
- Leafer 同步错误有时会被规范化为 resolved `{ error }`，Canvas `toBlob` 失败也可能返回空数据；服务同时处理 throw、resolved error 和无效结果。

## 4. 已冻结导出预算

硬限制由 ExportService 在 render 前和结果返回后各执行一次：

| 项目 | Phase 7.1 限制 | 依据 |
| --- | ---: | --- |
| 单边 | 8,192 px | 覆盖 8K 宽幅，同时低于既有图片输入 32,768 px 上限 |
| 单次输出 | 16,777,216 px | 4096² 或 8192×2048 |
| 单个 RGBA 面 | 64 MiB | `16,777,216 × 4 bytes`，可确定计算 |
| AVIF 单次输出 | 4,194,304 px | 2048²；在创建全尺寸 Canvas 前单独拒绝超限请求 |
| AVIF WASM | 3,600,000 B raw / 1,200,000 B gzip | Web/library 各恰好一份独立 scalar 资源，不得内联进 JS |
| 单次浏览器进程树 RSS 增量 review 线 | 384 MiB | 当前 WebKit 最大粗粒度观测 348.0 MiB，预留约 10% |

384 MiB 是基准回归 review 线，不是浏览器内可精确执行的内存配额。Canvas/编码器大部分内存在 JS heap 外，当前三引擎没有一致、可信的页面级峰值 API；因此实现用像素硬限制控制确定性输入，测试再用 50 ms 采样的浏览器进程树 RSS 作粗粒度信号。批处理另以串行 job、96 MiB 成功图片 Blob 和 97 MiB ZIP 硬上限控制批次资源，不能把 384 MiB 当作 12 个 job 可同时占用的额度。

### 时间基准

环境为 Debian 13.2 arm64、Node 24.18.0、pnpm 10.12.1、Playwright 1.62.1 当前引擎；输入是仓库内 64×48 确定性 fixture，离线运行。数值是单次样例，只用于回归方向，不是最低浏览器或用户设备 SLA。

| 样例 | Chromium | Firefox | WebKit |
| --- | ---: | ---: | ---: |
| 800×600 PNG | 20.3 ms | 31 ms | 49 ms |
| 3840×2160 PNG | 44 ms | 47 ms | 209 ms |
| 3840×2160 JPG | 59.5 ms | 56 ms | 73 ms |
| 3840×2160 WebP | 192.6 ms | 207 ms | 251 ms |
| 8192×2048 PNG | 52.1 ms | 59 ms | 420 ms |
| 4096×4096 PNG | 48.6 ms | 69 ms | 361 ms |

所有样例的 MIME、非空 Blob 和最终尺寸均通过断言。压缩后字节高度依赖画面内容，不作为内存替代指标。

Safari WebP 兜底加入后，使用相同 harness 显式把 Canvas WebP probe 改为 PNG，并断言浏览器实际请求 `webp_enc.wasm`。本机 Playwright WebKit 的 3840×2160 软件 WebP 为 564 ms；4096×4096 冷启动单次为 1,206 ms。4096² 连续 6 次全部成功，耗时依次为 1,927 / 1,157 / 1,091 / 1,074 / 1,146 / 1,088 ms；这支持软件 WebP 继续使用既有 16,777,216 像素上限。它是当前 WebKit 的回归证据，不冒充 Safari 16.4 的性能 SLA。

### RSS 参考

每个样例在新浏览器进程中单独执行。下表汇总匹配 Playwright 浏览器二进制的整个多进程树，因此基线绝对值包含浏览器和应用本身，重点看增量和重复趋势。

| 引擎 | 800×600 基线 | 最大单样例 | 最大观测增量 | 4096² 连续 6 次峰值 |
| --- | ---: | ---: | ---: | ---: |
| Chromium | 772.3 MiB | 816.2 MiB | 43.9 MiB | 840.8 MiB |
| Firefox | 1120.0 MiB | 1248.4 MiB | 128.4 MiB | 1220.3 MiB |
| WebKit | 1234.1 MiB | 1582.1 MiB | 348.0 MiB | 1581.2 MiB |

Canvas backing-store 修复前，同样的 4096² 连续 6 次峰值分别为 1130.7、1456.6、1837.6 MiB；修复后没有再呈现每次约一个 64 MiB 面的线性累积。RSS 仍受进程调度和分配器影响，不能解读为精确 Canvas 字节数。

## 5. 验证与复现

常规 E2E 始终运行 PNG/JPG/WebP、透明/白底、1x/2x/3x、native canvas 和 release 契约。重型边界基准默认跳过，避免把 16 MP 多次编码加入每次 CI；明确复核预算时执行：

```bash
SCREENHELLO_E2E_PORT=4183 \
SCREENHELLO_EXPORT_BENCHMARK=1 \
pnpm exec playwright test --grep "characterizes the reviewed single-export pixel budget" --workers=1
```

可用 `SCREENHELLO_EXPORT_BENCHMARK_CASE=square-boundary-png` 只运行一个样例，用 `SCREENHELLO_EXPORT_BENCHMARK_REPEAT=6` 做重复释放压力测试。软件 WebP 必须显式选择 `4k-webp-software` 或 `square-boundary-webp-software`；这两个标签会强制走 Worker/WASM 并验证 codec 请求，默认全样例不会把原生编码结果误标成软件结果。

Phase 7.1 最终门禁：

- frozen strict-peer install 通过，ignored builds 为 None，low audit 无已知漏洞。
- typecheck、零 warning lint 通过；Phase 7.1 复审后 16 个 Vitest 文件共 94 项通过。
- 当前 Chromium/Firefox/WebKit 共 25 项 E2E 通过、11 项按平台或显式 benchmark 设计跳过；额外显式边界 benchmark 3/3 通过。
- Web/library 双构建通过；独立 tarball consumer 双实例与卸载重挂 1/1 通过。
- Web 主入口 1,056,241 B / gzip 331,424 B；library 主入口 739,802 B / gzip 204,882 B；最大 library data image URL 246 B，均在既定预算内。

## 6. Phase 7.2 批量处理 MVP

独立站在工作区开启时显示“批量”入口。入口只加载面板；用户真正开始任务后才继续加载 `BatchExportService`、隔离 renderer 和 fflate 路径。组件库默认 `workspace=false`，不显示入口，`src/index.js` 也没有增加批量公共 API。

- `BatchStore` 归每个 runtime 独立所有，一次接受 1～12 个本地 JPEG、PNG、BMP、GIF 或 WebP 文件。
- 点击开始时同步冻结当前 `option + exportSettings + 背景资源`，或者从 DraftStore 读取一个风格预设；两条路径都不调用活动 runtime 的 `applyPreset()`。
- 每个 job 使用一个隐藏、可销毁的 Leafer App，复用 `FrameBox + Screenshot + Watermark`。自动画布逐图计算尺寸，固定画布保持风格快照尺寸；HDR 和背景模糊由隔离 task tracker 等待完成。
- job 严格串行经历 queued、preparing、rendering、encoding 和 terminal 状态；单项失败不阻断后续项。“取消当前”覆盖准备、渲染、编码和 ZIP 写入窗口并继续下一项，“取消全部”同时取消当前和剩余项。
- ZIP 使用 `fflate` 的 `Zip + ZipPassThrough`，只包含成功图片。安全文件名经过 NFC、路径/控制/保留字符清洗、120 UTF-8 bytes 截断和最终名称全局去重；格式为 `<basename>-screenhello<@ratio>.<ext>`。
- 累计成功图片 Blob 上限为 96 MiB，ZIP 上限为 97 MiB。成功 Blob 预算触顶时保留已成功 ZIP、停止剩余项；全部失败或取消不生成空 ZIP。
- 每个 job 后释放输入 object URL，批次结束销毁隔离 App/runtime/Canvas；新批次、清空或 runtime dispose 会释放内存中的旧 ZIP 引用。

Phase 7.2 最终门禁（含进入 Phase 7.3 前的再次复审）：

- Node 24.18.0 + pnpm 10.12.1 frozen strict-peer install、ignored builds None、low audit、typecheck 和零 warning lint 通过。
- 再次复审修复了一个纯本地边界问题：外部项目不能再给已知背景 key 注入跨源图片 URL；内置图从受控构建定义恢复，上传图只从 AssetStore 的本地 Blob 恢复，批量快照拒绝跨源 fetch。
- 批次 AbortSignal 现在传入隔离 renderer factory；取消全部可以中断 Leafer App ready 等待，不再依赖 10 秒初始化超时。
- 17 个 Vitest 文件共 113 项通过，覆盖文件名、ZIP/预算、1/12 job、失败隔离、当前/全部取消、重试、风格冻结、归档异常、多实例和恶意背景 URL。
- 当前 Chromium/Firefox/WebKit 共 30 项 E2E 通过、15 项按平台或显式 benchmark 设计跳过；三引擎共同覆盖混合横竖图、损坏项、部分成功 ZIP 和活动项目不变，Chromium 另覆盖 12 个真实 WebP job 与异步 HDR/背景预设。
- 12-job 浏览器用例观测到 12 次导出、最大并发 1；结束后 DOM Canvas 和跟踪中的 object URL 均回到批处理前基线。ZIP 中 12 个 WebP 均有正确签名，抽样解码尺寸为 73×55。
- Web/library 双构建和清洁 tarball consumer 1/1 通过；Web 主入口 773,975 B / gzip 244,640 B，library package entry 230,162 B / gzip 63,864 B，library 全部 JS gzip 398,368 B，最大 data image URL 246 B，均在既定预算内。

## 7. Phase 7.3 AVIF 本地编码

单图和批量菜单现支持 AVIF。ExportService 不把 `avif` 交给 Leafer：它先申请 native canvas lease、读取准确 RGBA，再把像素底层 buffer 转移给 `AvifEncoder`。adapter 功能级动态导入，同一 runtime 复用一个 module Worker，空闲 1 秒自动终止；取消、120 秒超时、编码失败或 runtime dispose 都会终止 Worker 并释放 Canvas。成功结果同时验证 `image/avif` MIME、非空 Blob 和 ISO BMFF `ftyp` 的 AVIF brand。

编码依赖精确锁定为 `@jsquash/avif@2.1.1`，只深度导入 scalar `avif_enc` glue/WASM，固定 quality 60、alpha quality 60、speed 8、8-bit。Worker 只接受与页面同源的 HTTP(S) WASM URL；不选择 pthread/MT 入口，不建立 nested Worker，也不要求 COOP/COEP。部署 CSP 需要 `worker-src 'self'` 和窄化的 `script-src 'wasm-unsafe-eval'`，不需要宽泛的 `'unsafe-eval'`；WASM 必须以正确 MIME 同源提供。

Vite 8 的 `build.lib` 会忽略 asset inline limit 并内联所有资产，因此 library 改为保留公共 ESM entry 的非 HTML build input。发布产物把 WASM 保持为 `?url&no-inline` 资产、保留 Worker URL 形态，并私有化本次构建的 preload helper；宿主负责最终复制、指纹和 preload 图。clean tarball consumer 会分别经过 Vite 开发服务和 production build/preview，且两条链路都必须实际下载 AVIF、验证延迟请求和双实例隔离。

production scalar spike 在严格 CSP、无跨源隔离条件下得到以下证据：

- 当前 Chromium/Firefox/WebKit 都只创建一个 outer Worker、只请求一个同源 `avif_enc` WASM，48×32 AVIF 可由浏览器真实解码，半透明采样均为 128。
- 最终复核的首次小图编码约为 Chromium 47.6 ms、Firefox 141 ms、WebKit 54 ms；取消约为 0～0.4 ms，transfer 后调用侧 pixel buffer 为 0 bytes，Worker 构造/终止计数完全相等。
- 3840×2160、speed 6 的早期方案在 Chromium/WebKit 分别观测约 +423.9/+511.4 MiB，并且 Firefox 单次约 34 秒，已按止损线否决。
- 最终 2048×2048、speed 8、连续 6 次复核在 Chromium/Firefox/WebKit 分别观测 +374.0/+25.7/+307.7 MiB，没有按次数线性增长；后五次约为 Chromium 0.47 秒/张、Firefox 7.7 秒/张、WebKit 0.48 秒/张。Firefox 的进程树 RSS 明显低估 WASM/共享内存，只作趋势信号。800×600 合成渐变的 RGB MAE 分别不高于 0.31/0.24/0.86，透明度另有真实解码验证。
- Web 与 library 各输出一份 3,485,872 B / gzip 1,128,053 B WASM；production consumer 同样只复制一份 WASM，并输出约 51.8 kB Worker。codec、Worker 和 WASM 均不在首屏请求中。

许可证 notice 已按安装包的 Apache-2.0 原文逐字比对写入 `THIRD_PARTY_NOTICES.md`。候选内部仍记录 libavif 1.0.1，而上游当前 release 已到 1.4.2；公开 advisory 为空不能等同于无风险。ScreenHello 只编码可信 canvas RGBA、不开放 AVIF 解码入口，并以 4 MP 硬限制降低嵌入式 codec 暴露面。

Phase 7.3 当时的 Go 是条件性的；Phase 7.6 后，同一候选提交已通过 Chrome 111、Edge 111、Firefox 128 与 `macos-14` 原生 Safari 26.5。Playwright WebKit 仍不冒充 Safari，Safari 26.5 也不冒充精确历史 Safari 16.4。

Phase 7.3 最终门禁：Node 24.18.0 / pnpm 10.12.1 frozen strict-peer install、ignored builds None、low audit、typecheck 与零 warning lint 全绿；18 个 Vitest 文件 / 125 项通过；当前三引擎 E2E 为 36 passed / 15 expected skipped；production scalar/CSP/取消 spike 3/3、4 MP 重复基准 3/3、Web/library 双构建、clean tarball consumer 开发态 1/1 与生产态 1/1、WASM 体积门和 Apache-2.0 正文 diff 均通过。Web 主入口 774,076 B / gzip 244,736 B，library package entry 279,997 B / gzip 75,422 B，最大 library JS 768,707 B；AVIF 资源保持独立且不进入首屏请求。

回滚时可移除 `avif` 白名单/菜单、adapter/Worker、依赖与 notice 条目；PNG/JPG/WebP 和统一导出/批量内核不受影响。

## 8. Phase 7.4 通用矢量设备框

设备组新增 `genericLaptop`、`genericDesktop`、`genericTablet`、`genericPhone` 四个稳定 ID 和独立 `vector-device` definition。每个定义用固定逻辑画板与 `screen{x,y,width,height,radius}` 描述，metrics 将整个设备 contain 到现有 screenshot layout box，再从同一 scale 派生屏幕开口和所有装饰。外层 `totalWidth/totalHeight`、旋转、对齐、缩放、多图 layer 几何与 batch 隔离 renderer 都沿用既有协议。

渲染只使用 Leafer `Rect`：石墨机身、灰银底座/支架、边框、圆角和阴影属于背景装饰；手机顶部 pill/镜头等需要覆盖内容的细节作为 overlay 放在截图 box 之后。背景和 overlay 共用 resize preview 与 cleanup 列表，不增加 Canvas、Worker、object URL 或监听器。侧栏缩略图使用现有 React DOM + CSS，不引入 PNG/SVG。Phase 8 资产许可复审后，旧的五个品牌 frame ID 仍可读取，但已隐藏并映射到对应无品牌矢量实现，原位图和专用渲染分支已删除。

设备图片适配值统一为 `cover/fit/stretch`。此前 UI 曾写出的 `strench` 在 ProjectDocument 规范化和 store 调用边界迁移为 `stretch`；新 UI、历史和序列化只保留 canonical 值，文档版本仍为 V2。

Phase 7.4 最终门禁：Node 24.18.0 / pnpm 10.12.1 frozen strict-peer install、ignored builds None、low audit、typecheck 与零 warning lint 全绿；19 个 Vitest 文件 / 132 项通过。当前 Chromium/Firefox/WebKit E2E 为 40 passed / 17 expected skipped，包含真实 UI 选择、四设备 × `cover/fit/stretch`、PNG/JPG/WebP/AVIF × 1x/2x/3x、genericLaptop batch 和旧 golden；新增的 Chromium 2×2 设备 golden 已人工复核。Web/library 双构建与 clean tarball consumer dev/production 通过。Web 主入口 777,434 B / gzip 245,808 B，library package entry 280,282 B / gzip 75,461 B；两端仍各只有一份 3,485,872 B AVIF WASM，资产清单没有新增设备图片。

最终 review 未发现 CRITICAL/HIGH。本波没有用户文本/HTML/URL 输入面，没有网络或二进制解析面；通用矢量节点与 renderer 生命周期归现有 runtime 所有。回滚时可单独移除四个 definition、矢量装饰和 CSS 缩略图，不触及旧 frame、ProjectDocument 或导出内核。

## 9. Phase 7.5 PWA 与分层离线缓存

Web production build 现以精确锁定的 `vite-plugin-pwa@1.3.0` 和 `workbox-window@7.4.1` 生成 manifest、Service Worker 与更新生命周期。`src/main.jsx` 仅在 production、安全上下文且存在 Service Worker 能力时挂载 PWA 控制器；`src/index.js` library 入口不导入控制器，PWA 插件在 `NODE_TYPE=lib` 时也不启用。

核心 app shell 使用显式 allowlist 生成预缓存：HTML、manifest、主 JS/CSS、必要运行 chunk、图标与 SVG。Phase 7.6 当时的 production audit 为 41 个唯一条目、2,780,400 B；Phase 8 移除第三方背景缩略图后的根路径构建为 20 个唯一条目、2,516,704 B。AVIF Worker/WASM 与低频大 chunk 不进入首次预缓存；同源 `/assets/` 下的哈希构建资源只有在实际请求成功后才进入 `CacheFirst` runtime cache，最多 64 项、30 天。匹配器拒绝非 GET、跨源、非 scope、非哈希构建资源，因此用户 `blob:`、项目、草稿和跨源响应不会进入 Cache Storage。

“离线已就绪”只在 `navigator.serviceWorker.ready` 且 registration 存在 active worker 后显示。production Chromium 测试会清空 HTTP cache 再断网，已验证核心编辑器刷新、导入/编辑/PNG 导出；未访问 AVIF 时离线明确失败且不泄漏到缓存，在线成功导出后 Worker/JS/WASM 可在完全离线下复用。更新保持 `skipWaiting=false`：dirty 项目先二次确认，导出/批量任务 busy 时阻断，确认后才激活 waiting worker 并清理旧 precache。

安装 UI 不伪造浏览器能力：Chromium 仅消费真实 `beforeinstallprompt` 且一次 prompt；iOS 给出分享菜单手动步骤；Firefox desktop 不显示虚构安装按钮。四个 192/512 normal/maskable PNG 均由既有 ScreenHello 标识确定性派生，normal 保留透明边缘，maskable 使用纯色底和中心安全区。

本波最终证据：20 个 Vitest 文件 / 138 项、typecheck、zero-warning lint、当前三引擎一 worker 40 passed / 17 expected skipped、Web build 与 PWA 静态审计、production Chromium PWA 5/5、library build、clean tarball consumer dev/production 1/1 与 74 文件边界审计全部通过。Web 主入口 785,141 B / gzip 248,194 B，Web CSS 69,597 B / gzip 13,128 B；library package entry 保持 280,282 B / gzip 75,461 B，library CSS 为 89,430 B / gzip 14,502 B，PWA artifact/runtime marker 为 0。`vite-plugin-pwa`、全部安装的 Workbox 7.4.1 包与 `@jsquash/avif` 的许可证正文由 `pnpm audit:licenses` 对安装包逐字检查。

部署要求：仅在 HTTPS/localhost 提供；服务器必须按构建 base path 正确提供 manifest、`sw.js`、Workbox runtime、JS、WASM 和图片 MIME。根路径默认 `/`；子路径可用 `SCREENHELLO_BASE_PATH=/path/ pnpm build` 构建，再用相同变量运行 `SCREENHELLO_BASE_PATH=/path/ SCREENHELLO_PWA_OUT_DIR=<输出目录> pnpm audit:pwa`。`sw.js` 应重新验证，哈希资产可 immutable；CSP 需允许同源脚本/Worker/请求及既有 `blob:` Worker/图片能力。回滚时可同时移除 Web-only PWA 插件与 `PwaController` 挂载，普通在线 Web 与 library 不受影响。

## 10. 已知限制与下一波边界

- 当前 Playwright 引擎仍只用于回归；最低 Chrome/Edge/Firefox 与原生 Safari 证据来自独立 GitHub Actions browser matrix。
- 运行中的 Leafer export 不能真正抢占，只能取消结果、副作用和 UI 回写。
- “重试失败项”只重跑失败或取消项，并用本次重试结果替换当前可下载 ZIP；需要保留首轮部分成功文件时应先下载首轮 ZIP。
- AVIF 在 4 MP 上限内仍明显慢于浏览器原生 PNG/JPG/WebP，尤其当前 Firefox 引擎；首版不开放质量/speed 高级选项。
- `@jsquash/avif` 的嵌入式 libavif 版本和 Vite 深度入口需要在依赖升级时重新 spike，不可直接漂移版本。
- 关闭 `DownloadBar` 的批量入口并移除实例级 BatchStore、动态 service/renderer 可回到 Phase 7.1；单独移除 AVIF 白名单、adapter/Worker 和依赖可回到 Phase 7.2，不涉及 ProjectDocument、草稿或项目容器迁移。
- 当前 PWA 自动化使用当前 Chromium；最低浏览器和原生 Safari 的核心编辑/四格式导出由 Phase 7.6 browser matrix 独立覆盖。
- 首次完全离线访问无法安装 app shell；AVIF 等重资源在在线成功请求前也不承诺离线可用。代码原生背景不需要额外资源缓存。
- runtime cache 最多 64 项、30 天，且浏览器可在存储压力下提前回收；“首次成功后离线复用”不是永久保存承诺，重要项目仍应保存 `.screenhello` 文件。
- Phase 7.6 的颜色弹层可访问性问题与可信浏览器证据均已关闭。桌面、扩展、npm 公开和正式发布仍未授权。

## 11. Phase 7.6 Web Release Gate

Phase 7.5 提交 `ab08b42` 的复审发现 CI 没有执行已经存在的 ignored-builds、许可、PWA production 与 library PWA 边界门禁。CI 已补齐这些检查，并新增当前三引擎 production release suite、精确最低浏览器 Selenium harness、fail-closed 证据审计器和手工原生 amd64 workflow。

当前引擎 release suite 6/6 通过，覆盖项目/预设保存、单图四格式签名、批量 ZIP、request 级本地优先、无 page error、颜色弹层打开态 WCAG A/AA、键盘焦点/返回和 reduced-motion。复审过程中修复了可见控件命名/对比度、PWA 错误卡遮挡批量操作、reduced-motion 实际配置，以及 legacy alpha `100` 与第三方面板内部控件不可命名问题。

最终本地工程门禁通过：20 files / 140 unit、当前三引擎 40 passed / 17 expected skipped、显式导出边界 3/3、PWA 5/5、release 6/6、consumer dev/production 1/1。根/子路径 PWA precache 分别为 41 项 / 2,780,400 B 与 41 项 / 2,781,776 B；library 74 文件无 PWA marker。当前 Web entry 为 790,313 B / gzip 249,792 B，library package entry 为 281,016 B / gzip 75,590 B；AVIF WASM 仍为单份 3,485,872 B。

发布门为 **GO**：候选提交 `35e3fdeb47c27d806e15411e5c0637c2607a13ca` 在原生 amd64 Chrome 111.0.5563.146、Edge 111.0.1661.62、Firefox 128.0.3 和 GitHub `macos-14` Safari 26.5 上通过同一核心编辑与四格式导出 smoke，汇总审计无失败。Safari 使用用户接受的 hosted-current 策略，未精确重放 16.4；完整判定见 [Web Release Gate](./web-release-gate.md)。
