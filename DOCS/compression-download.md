# 大图压缩下载：预览与下载预算隔离

## 当前产品决策：AVIF仅标准导出

2026-09-09：用户决定取消AVIF非标准导出。编辑器只保留AVIF标准下载，不显示压缩、质量或预览操作；标准保留4,194,304像素及120秒有界编码路径。旧工作区/项目/预设设置应用、快速导出与批次快照统一按同格式/倍率标准设置处理，原始归档不改写。PNG/JPG/WebP压缩及预览不变。标准AVIF不等于无损，首次仍需加载约3.5MB同源WASM，极慢网络仍可能超时。

底层`validateExportSettings`/归档解码/直接ExportService兼容历史参数；用户侧使用`normalizeEditorExportSettings`。这不是继续开发AVIF压缩，也不是放宽安全线。新版发布功能证据scope为`foreground-compression-download/v3`，检查AVIF标准下载和移除的控件；旧v2仅能说明旧候选。当前更改尚未部署，后文全部为各自阶段的历史背景和证据，不能覆盖此决策。

## 历史故障与验收记录

2026-09-09新增阻断：隔离HTTPS预览18cd0a74在当前Chromium151首次AVIF有损导出时，即使最终73×55也复现超时。浏览器Worker所需WASM实际读取52.962秒，有损30秒预算从加载前已开始；同会话标准路径（120秒预算）随后成功下载并独立解码。脚本/WASM返回200、无观测到的CSP违规，Node原件摘要正确；不能用PNG/WebP通过或小图尺寸解释为正常。需要分离有界编码器加载与编码计时，并补慢加载/取消回归；尚未实施或部署修复。下文HTTPS-OFFLINE-PASS严格只指当时PNG/WebP三种模式，不代表AVIF可用性通过。

最新状态：HF1 部分交付候选已接入独立 Web 策略，PNG/JPG/WebP 五种压缩保留 4MP，AVIF 压缩暂限 1MP；库/桌面与标准导出默认不变。功能验证及发布缺口见文末 HF1；尚未部署，不能将以下 CE 历史数据当作新候选通过。

验收工具更新：MG1 已实现显式内存 V2 采集与独立判定，见[使用说明](#mg1内存验收v2工具)。HF2五模式30组/180下载按旧线通过；标准AVIF Chromium24次截图471.2MiB仍保留警报，小图AVIF/PWA/真实设备等仍待补证。下面CE/MA各节为各自候选历史，不能互相覆盖或代表官网已更新。

最新MG2：预定本地补证及工具修复完成，结论仍EVIDENCE-HOLD，见[MG2结果](#mg2本地补证与工具修复)。96次下载成功，9/10组内存证据有效；生产/PWA24项通过，但仍有采样空档、AVIF警报和未确认原因的间歇测试失败，尚不具备发布条件。

最新MG3：目标设备交接工具已完成，本机无实际Safari/原生amd64执行环境或已指定移动设备；实机验收未执行，仍EVIDENCE-HOLD。工具用法见[MG3交接](#mg3目标设备交接)，不等于官网已更新。

2026-09-08，**本地功能修复可预览 / 跨引擎性能验收 HOLD / 未部署**。MW 取得 getImageData 分配栈，PX 两种读取替换未获采用；最新 CE 确认并移除一次 AVIF 冗余输出复制，当前候选 Chromium 24 次截图仍为 451.1 MiB，未达标，见文末。不能将下载成功、局部减少拷贝或较低复查值等同完整验收通过。正式站先前部署记录不等于已含此变更。

## 故障与修复

- 内置 PC 示例最终画面约 2223×1667，超过 C4 的 1,048,576 像素完整预览预算。该预算错误地同时限制直接下载，导致 PNG/WebP 无损与有损、JPG/AVIF 有损按钮全部不可用；小图六种模式能实际下载，并非所有编码器损坏。
- 预览维持 `MAX_PREVIEW_PIXELS=1_048_576`。直接压缩及批量每张输出使用 `MAX_COMPRESSED_PIXELS=4_194_304`，单边仍不超过 8192。四层统一：UI、ExportService、编码器适配器、Worker。标准 PNG/JPG/WebP 16,777,216、AVIF 4,194,304 像素不变。
- 直接下载不再先编码不使用的标准参照；仅 PNG 无损仍需标准 PNG 输入并保留无收益回退。直接有损/WebP 无损的内部 `referenceBlob` 与比较统计为 null，不虚构节省率。完整预览仍从同一场景生成两份 Blob、确认后下载同一 Blob。
- Worker 接管独立像素后，直接导出的 Canvas 提前释放；PNG 无损在取得标准 PNG 后释放。release 幂等，取消、过期、失败和运行时销毁仍通过现有队列和所有权保护。
- 大图 WebP 压缩完成后立即终止 Worker，避免连续下载保留增长的 WASM 堆；小图保留原 5 秒空闲回收策略。没有启用线程、外部编码服务或静默缩小图片。
- CPU 预算按最终像素量分档：每 1,048,576 像素 30 秒，最大 120 秒。Service 与 PNG/WebP/AVIF 适配器共享计算函数；小图与完整预览仍为 30 秒，标准导出原有超时不变。
- 七语提示区分预览限制和下载限制；真正超限时在下载按钮旁说明，并以实例独立 ID 关联无障碍描述。静态七语帮助同步。

## 验证方法及已发现的问题

- Review 使用现有代码审查与 React 性能规则，保持按需 codec、派生 UI 状态、实例所有权，未引入新全局状态。通用风格技能附带 Python 脚本不适用于本项目，实际使用仓库 ESLint/typecheck 与回归测试。方案先 review 后实施，见本地规划记录。
- 新增真实内置 PC 示例的六种压缩模式下载及解码尺寸回归；已有透明 PNG、JPG/WebP 白底、倍率、同 Blob 下载、取消、双实例与批量回归继续执行。
- 压力测试复用生产 App/ExportPanel/Worker，2048×2048 截图与高噪声各六种模式，每组连续下载六次，三引擎独立进程树 RSS 采样。命令：

```bash
pnpm test:compression:build
SCREENHELLO_COMPRESSION_DIRECT=1 SCREENHELLO_COMPRESSION_LABEL=cd3 pnpm test:compression:stress
```

- 不开启 direct 开关时，原完整预览压力默认仍为 1 MP，不能被下载新预算带到 4 MP。
- 初次 Chromium 高噪声 WebP 无损 RSS 增量 391.8 MiB，超过原 384 MiB 检查线，未判定通过；据此补修大图 Worker 回收及 Canvas 提前释放。报告保留在本地 `artifacts/compression-product-evidence/`。
- 压力脚本连接浏览器服务器时 Download.path 不可用，修为流式读取实际下载字节；不把大图转为浏览器数字数组来测内存。测试端口占用时选用空闲端口，不停止用户预览。

## 压力 review：暂不满足发布条件

- `cd3`：Chromium 两类图 × 六模式的 12 组及 Firefox 前 11 组通过 384 MiB 检查线，但 Firefox/高噪声/AVIF 因旧超时中断。因此原命令 exit 1，不称为全矩阵通过。
- `cd4` Firefox/高噪声/AVIF：按像素扩展 CPU 预算后连续六次下载通过，耗时 28.37～30.251 s（实际跨过旧 30 s 线），RSS 增量 205.4 MiB。未改输出尺寸/质量。
- `cd4` WebKit：12 组全部连续下载成功，但仅 3 组低于 384 MiB 检查线；9 组内存超线，最大 477 MiB（截图 AVIF），命令 exit 1。资源所有权检查、Worker 空闲回收和页面错误检查通过，不能据此断言浏览器进程 RSS 达标或不存在所有泄漏。
- `cd5` 试验：让 PNG/AVIF 大图也立即销毁 Worker，WebKit/截图/AVIF 六次峰值反而为 554 MiB；未采纳该试验，已精确撤回这两项策略，保留有实测收益的大图 WebP 回收及 Canvas 提前释放。
- 4 MP 目前是本地候选功能预算，不是已通过全浏览器性能 Gate 的正式承诺。没有提高 384 MiB 检查线、隐藏失败或部署候选。下一步需继续隔离 WebKit 的 Canvas / Worker 堆及浏览器延迟回收开销，再决定优化后的预算；若需改变资源门槛，应先明确审议，而非改数字让测试通过。
- 原始证据：`artifacts/compression-product-evidence/benchmark-2048x2048-direct-cd3.json`、`benchmark-2048x2048-direct-firefox-avif-lossy-noise-cd4.json`、`benchmark-2048x2048-direct-webkit-cd4.json`、`benchmark-2048x2048-direct-webkit-avif-lossy-screenshot-cd5.json`。该目录为本地测试产物，不进入公开源码。

## 下载修复 CD 的功能与构建检查（历史候选）

以下记录对应 CD 阶段；后续 MA 验收和 MO 优化的实测结果见各自章节，不混用构建或测试数量。

- lint、typecheck、47 files / 486 unit，通过；新增独立预算/CPU 分档边界、不生成无用参照、提前释放 Canvas 恰好一次和大图 WebP Worker 即时回收测试。
- CPU 预算修复后的当前三引擎相关 E2E **69/69** 通过：压缩/预览/批量完整回归，含内置 PC 大图六模式、手机七语超限提示（390×844 下载按钮及描述不出屏）。此前 66/66、24/24 与 3/3 是中间复验记录，不重复相加冒充互不重复用例。
- 最后 Web 与 library 构建通过；有既有大 chunk 提示，未宣称构建无警告。压缩 scalar/lazy、PWA、library PWA 边界、42 页 SEO、第三方许可和体积检查通过。
- PWA 29/29，consumer development/production 各 15/15，最后构建后复验通过。consumer 使用已缓存依赖离线严格 peer 安装，无外部发布。
- 七语 619 键无缺失或占位符错误。13 份相关文档相对链接检查无失效，README/SEO 说明也已同步当前本地状态；C0～C4 历史限制均明确标注。相关 diff whitespace 检查通过。
- 本地公开导出闭包 463 文件审计通过，releaseReady=false，仅审计不晋级。源码预览 4197 保留，实际 2223×1667 下生成预览禁用、压缩下载启用，未改变输入或输出尺寸。

## 发布与支持边界

- 仍只有 PNG/JPG/WebP/AVIF 四种静态格式；本轮解决压缩下载不可用，不新增 GIF 等格式。
- 未自动降低倍率或改变有损/无损设置。超过压缩限制需用户明确调整尺寸或切换可承载该尺寸的标准格式；AVIF 标准也有 4 MP 上限。
- 4 MP 压力矩阵使用各模式默认质量（PNG 有损 256 色、JPG/WebP 90、AVIF 60），不声称穷举所有质量/色数/比例/设备组合。高噪声、大尺寸处理可能较慢，30～120 秒分档超时与取消保护保留；超过时间会提示调整尺寸，而非静默输出低清图。
- 当前 Linux Chromium/Firefox/WebKit 证据不代表最低浏览器或真 Safari；本轮无桌面原生测试、公开仓晋级或生产部署。

## 优化前内存验收 MA（2026-09-08，验收完成 / HOLD）

MA 当轮仅验收，不修改业务代码或部署。上述 `cd3`～`cd5` 保留为历史证据；标签 `ma-current` 使用当时生产测试构建重新执行完整矩阵。后续优化与其证据在下方 MO 节，不能混用候选。

```bash
TMPDIR=/var/tmp pnpm test:compression:build
TMPDIR=/var/tmp SCREENHELLO_COMPRESSION_DIRECT=1 SCREENHELLO_COMPRESSION_LABEL=ma-current pnpm test:compression:stress
TMPDIR=/var/tmp SCREENHELLO_COMPRESSION_MODE=avif-lossy SCREENHELLO_COMPRESSION_KIND=screenshot SCREENHELLO_COMPRESSION_LABEL=ma-current node tests/compression-product/diagnose-memory.mjs
TMPDIR=/var/tmp SCREENHELLO_COMPRESSION_MODE=webp-lossless SCREENHELLO_COMPRESSION_KIND=noise SCREENHELLO_COMPRESSION_LABEL=ma-current node tests/compression-product/diagnose-memory.mjs
TMPDIR=/var/tmp SCREENHELLO_COMPRESSION_MODE=avif-lossy SCREENHELLO_COMPRESSION_KIND=screenshot SCREENHELLO_COMPRESSION_REPEAT=24 SCREENHELLO_COMPRESSION_LABEL=ma-current node tests/compression-product/diagnose-memory.mjs
```

- 正式检查沿用原脚本：2048×2048、两类图片、六模式、每组六次真实下载，浏览器全线程子进程树 RSS 每 50 ms 采样。384 MiB 指打开导出面板后基线到操作峰值的**增量**，不是整个浏览器绝对内存上限。
- 新诊断脚本额外记录产物 SHA-256、RSS/PSS 分进程、Canvas 数/像素量、Blob URL 数/字节、导出上下文/Canvas lease/准备结果/Worker 状态；观察 Worker 空闲、空闲 5/35 秒及卸载后 5/35 秒。
- URL 监测只记录原始值，不保留 Blob。卸载后等待 runtime dispose，再移除测试 harness 对 Store 的引用；没有强制 GC、主动内存压力或手动清理产品应自行释放的资源。
- 诊断有额外采样开销，不替代无诊断插桩的原矩阵。RSS 可重复计入不同进程映射的共享页，PSS 按共享比例分摊，只用于解释；不能改用较低的 PSS 让既有 RSS Gate 通过。定义参考 [Linux /proc 文档](https://docs.kernel.org/filesystems/proc.html)。

### 本轮完整矩阵

环境：Linux arm64 / 16 CPU、Node 24.18.0、pnpm 10.12.1；Chromium 151.0.7922.34、Firefox 153.0、Playwright WebKit 26.5。每组新建浏览器进程，测试 harness 中保留第二个空实例，不是生产单实例页面的绝对内存基准。

| 引擎 | 下载成功 | RSS 增量达标组 | 最大增量 |
| --- | --- | --- | --- |
| Chromium | 72/72 | 12/12 | 373.3 MiB |
| Firefox | 72/72 | 12/12 | 247.0 MiB |
| WebKit | 72/72 | 6/12 | 493.4 MiB |

WebKit 超标为截图 PNG 有损 389.5、WebP 无损 459.0、AVIF 493.4 MiB；高噪声 PNG 无损 441.9、WebP 无损 414.1、AVIF 418.5 MiB。所有 36 组已运行完毕，命令因 6 组超线返回 exit 1，非下载超时或漏跑。所有组导出 lease/context/prepared/busy 清理与 Worker 空闲退出断言通过，页面错误和外部请求均为零。

较历史 `cd4` 的 9 组失败变为本轮 6 组，不代表业务代码已修复；同代码内存测量存在波动，Chromium 最大值也仅留 10.7 MiB 余量。仍需以优化后的重复矩阵判断稳定性。

### 空闲与卸载诊断

以下是独立诊断的稀疏**绝对 RSS**，不是正式矩阵增量，单位 MiB：

| WebKit 场景 | 操作前 | 最后下载后 | 空闲 35 秒 | 卸载再等 35 秒 |
| --- | --- | --- | --- | --- |
| AVIF 截图，6 次 | 937.7 | 1442.7 | 1206.9 | 1198.7 |
| WebP 无损高噪声，6 次 | 1143.9 | 1551.4 | 1079.5 | 1071.7 |
| AVIF 截图，24 次 | 935.7 | 1635.2 | 1153.2 | 1147.5 |

- 两组 Worker 空闲后均无已登记的导出上下文、Canvas lease、准备结果或运行中的编码 Worker；35 秒后只剩编辑中原图 URL，卸载后 URL 与 DOM Canvas 归零。DOM Canvas 计数不等同浏览器所有离屏/已分离原生资源的计数。
- WebP 高噪声诊断观察到自然回落至基线以下，证明本次高峰不等于永久持有；但不能免除其操作峰值超线。
- AVIF 6 次卸载后 RSS 仍高约 261 MiB，PSS 由 791.9 变为 1018.5 MiB，亦未回到原基线。URL 总字节在最后下载后仅 87,386 bytes，因此不能只用下载 Blob 的延迟释放或共享页计数解释残留。没有堆/原生分配归因证据，不能宣称已证明泄漏或已排除泄漏。
- AVIF 24 次全部下载成功，诊断采样峰值 1721.0 MiB、相对其高频采样起点增加 795.9 MiB。第 20 次下载后 1721.0、第 21 次 1509.2 MiB，出现自然回落而非全程单调增长；停止操作、Worker 退出后回落到 1155.1 MiB，卸载再等 35 秒为 1147.5 MiB。不能用较低的最终占用忽略更高峰值，也不能将 24 次单轮观察声称为长期无泄漏证明。
- 增长主要落在 `WPEWebProcess`：该 24 次诊断从基线 728.8 增到第 20 次 1507.7 MiB；这只定位到 Web 内容进程，尚不能进一步区分 WASM、JS 堆、Canvas/图像缓存及原生分配器缓存。其他进程相对稳定。
- 三份诊断均 exit 0，只表示下载/资源观察断言完成；脚本故意不将诊断峰值另作正式 Gate。没有改动既有 384 MiB 检查线。

原始完整矩阵：`artifacts/compression-product-evidence/benchmark-2048x2048-direct-ma-current.json`。诊断：同目录 `memory-diagnostic-webkit-{mode}-{kind}-repeat{6|24}-ma-current.json`，每份保留构建 SHA-256、逐次状态、RSS/PSS 进程明细及错误字段。属于本地测试产物，不进入公开代码。

三份诊断使用同一构建目录指纹：`702b3cbd864a4cc90a14f158779978e4543e9c09068423a5bea7e86246b1fbd5`。未在矩阵与诊断之间重建。诊断单列起始高频 RSS 与稍后的 PSS/资源检查点，二者并非同时采样；上表使用后者，不能从它反算高频峰值增量。

### 验收结论与下一步

**当前候选未通过内存验收，发布保持 HOLD，本轮未部署。** 资源所有权检查通过不代表进程内存预算达标。下一步应针对 WebKit 内容进程的大图编码瞬时分配和连续编码回收时机作分配归因及优化，再复跑原 36 组矩阵与长序列；不应先放宽阈值、静默缩图或把 PSS 当成替代 Gate。PNG/AVIF 大图每次立即销毁 Worker 的历史失败试验也不可直接重上。

本轮只新增测试诊断脚本及更新验收/规划记录，不修改产品源代码；生产测试构建、lint、47 files / 488 unit 通过（构建仍有既有 chunk 警告）。本轮没有重跑所有功能 E2E、正式 Web/library/consumer 构建或真实 Safari，前文历史检查不能冒充本轮实测。

## WebKit 内存优化 MO（2026-09-08，本轮优化与复验完成 / 长序列 HOLD）

### 方案与保留改动

1. `ExportService._renderCanvas` 在 Leafer 创建导出 context 时传入 `willReadFrequently: true`，合并目标所属 Leafer 的原有 contextSettings 与本次渲染选项，不覆盖 alpha/colorSpace/desynchronized 等配置，也不修改宿主原对象。原先在读取像素时才把该选项传给 `getContext`，不能重配已创建的 context。仅导出快照路径变更，不改交互画布或全局 Leafer 原型；透明/白底、尺寸、质量与队列/取消保护不变。依据 [MDN getContext](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext) 与本地固定 Leafer 2.2.9 导出源码核对。
2. AVIF Worker 在同步编码和输出复制/交付结束后，通过 `structuredClone(null, { transfer: [pixels] })` detach 已消费且由该 Worker 独占的输入。null 是有意的：只解除输入所有权，不保留另一份可达克隆、不复制像素。失败也清理；共享内存、已 detach 或无此 API 时不做此操作。保持既有 Worker 1 秒空闲退出与原 scalar codec，不动 WASM heap/输出缓冲区。这是有界资源释放，不是强制 GC；依据 [Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects) 和 [Worker structuredClone](https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/structuredClone)。
3. 增补测试：在 Canvas 创建时检查读回参数；PNG 标准/压缩无损逐像素一致（含文字标注、透明边缘），以及 Worker 成功、失败、输入无效、共享内存、已 detach、API 缺失六类所有权路径。诊断新增可选 `SCREENHELLO_MEMORY_CANVAS_TRACE=1` 弱引用追踪，不持有画布强引用，不用于替代原正式矩阵。

### 已完成对照与未采用实验

- `mo1-readback`：只做 Canvas 提示前移，WebKit 12 组全部下载成功，内存 11/12 达标，仍有截图 AVIF 451.1 MiB；单组另一次为 412.2 MiB。较 MA 6/12 有改善，边界组仍需复测。
- `mo1-trace`：AVIF 截图六次后共创建 14 个 DOM Canvas，Worker 空闲时仅 4 个存活，已分离 Canvas 合计 45,001 像素。该样本不支持大图导出 Canvas 持续残留的假设，未据此修改第三方销毁函数，也不能由 WeakRef 观察推断全部原生资源无泄漏。
- `mo2-reuse2`：每两次大图编码重建 AVIF Worker，增量仍为 416.0 MiB，未达到目标，已精确撤回计数/重建策略。
- Node 独立 codec 对照：同一固定 AVIF module 连续六次编码的线性内存为 223,608,832 bytes，并非逐次膨胀。仅实验中将 Emscripten 几何增长从 20% 改到 5% 后容量为 195,100,672 bytes，但 RSS 未获得对应下降，未修改正式 glue/依赖/构建策略。Node 结果不替代 WebKit 实测。
- `mo3-detach`：加入独占输入 detach 后单组截图 AVIF 356.7 MiB 达标，但完整 WebKit 矩阵同组又为 420.9 MiB；完整复验仍不能据前一个较低结果判为 GO。所有原始成功与失败均保留。
- `mo3-final` 的 24 次 AVIF 诊断：峰值增量 430.1 MiB（MA 为 795.9），稀疏基线 RSS 937.7、卸载 35 秒 945.4 MiB；PSS 791.1→792.8 MiB，接近初始值。原始构建指纹 `7466f6e7945270bb4cf07c0033be508923d4433f4b015aea271f197a4ec40162`。这是合并宿主 Canvas 配置的 review 补修之前的结果，不冒充补修后最终候选的长序列验收。

### 最终验证

复验命令（同一冻结后的生产测试构建；矩阵与诊断顺序执行，不并行跑其它浏览器测试）：

```bash
TMPDIR=/var/tmp pnpm test:compression:build
TMPDIR=/var/tmp SCREENHELLO_COMPRESSION_DIRECT=1 SCREENHELLO_COMPRESSION_LABEL=mo-final pnpm test:compression:stress
TMPDIR=/var/tmp SCREENHELLO_COMPRESSION_MODE=avif-lossy SCREENHELLO_COMPRESSION_KIND=screenshot SCREENHELLO_COMPRESSION_REPEAT=24 SCREENHELLO_COMPRESSION_LABEL=mo-final node tests/compression-product/diagnose-memory.mjs
```

- 重跑时使用新标签保留原证据；诊断脚本 exit 0 只证明流程和资源检查通过，其峰值仍须单独核对 384 MiB 检查线。
- 宿主配置合并 review 补修后的最终源码：lint/typecheck、48 files / 496 unit、三引擎 69/69 压缩/预览/批量 E2E、Web/library/生产测试 harness 构建均通过。Worker 六项及两项宿主/隔离 target 配置测试均通过，新增测试进入公开源码白名单。
- consumer development/production 各 15/15、PWA 29/29 通过；公开测试白名单补齐后再次 48 files / 496 unit 通过。本地公开源码闭包 465 文件审计通过（releaseReady=false，仅本地检查）。之前 MO1/MO3 的成功结果保留为中间证据，不重复相加为互不重复用例。
- 最终正式矩阵 `benchmark-2048x2048-direct-mo-final.json` 完成，命令 exit 0；36 组 / 216 次实际下载，所有实例导出上下文/Canvas lease/准备结果/编码 Worker 在规定清理点归零，无页面错误或外域请求。

| 最终候选引擎 | 384 MiB 增量门通过 | 最大 RSS 增量 |
| --- | --- | --- |
| Chromium 151.0.7922.34 | 12/12 | 372.7 MiB |
| Firefox 153.0 | 12/12 | 236.2 MiB |
| WebKit 26.5 | 12/12 | 363.6 MiB |

### 最终长序列与结论

- 同构建 `memory-diagnostic-webkit-avif-lossy-screenshot-repeat24-mo-final.json` 完成，24 次下载成功，诊断 exit 0，无页面错误或外域请求。高频 RSS 起点 934.5 MiB、峰值 1371.8 MiB，**增量 437.3 MiB，仍高于 384 MiB**。较 MA 的 795.9 MiB 下降约 45%，但不足以解除长序列风险。
- 稀疏绝对 RSS：基线 935.1、最后下载后 1208.5、Worker 空闲后 1034.2、空闲 35 秒 1028.4、卸载再等 35 秒 1022.1 MiB。卸载末尾比该稀疏基线高约 87.0 MiB；PSS 789.2→871.2 MiB，亦未完全复原。不能用中间 `mo3-final` 更低的卸载结果替代最终候选，也不能据 RSS 单独认定某个 JS/codec 泄漏。
- Worker 均按原策略退出；空闲 35 秒只剩原图 URL，卸载后 URL/DOM Canvas 归零，已登记的 Canvas lease/上下文/准备结果没有残留。资源所有权通过不等于进程内存预算通过。
- 最终矩阵与长序列之间未重建；诊断记录构建目录 SHA-256 为 `67d855916b07be6e5c72413dd35f1d71a7a7def1afb35c3f9a834f3fd8926c65`。原始产物在 `artifacts/compression-product-evidence/`，保留全部 MA/MO 成功与失败，不进入公开源码。

**结论：六次下载正式矩阵 36/36 通过；24 次连续 AVIF 仍超线，发布保持 HOLD。** 本轮局部优化、兼容性 review 补修与复验已完成，不等于全部性能缺陷修复完成。未改 384 MiB 检查线、4 MP 输出、1 MP 预览预算、质量或尺寸，未强制 GC，未推送或部署。

下一轮建议先对 WebKit 内容进程的剩余分配做原生级归因，并在可用的真实 Safari 环境对照 Canvas/WASM/分配器的回收行为，再决定实现；不重复盲调 Worker 重建次数或以单次低值放行。本轮 Linux arm64 当前引擎测试不代表最低浏览器、真实 Safari 或原生桌面验收；未重跑全产品 E2E。

## 剩余内存归因与局部动效优化 MP（2026-09-08，本轮修复/review/复验完成 / 跨引擎 HOLD）

### 归因方法与结果

MP 使用 MO 最终构建先做只读原生映射采样和阶段隔离，而非继续调整 Worker 重建次数。`tests/compression-product/native-memory.mjs` 读取 Linux smaps，区分虚拟 Size、驻留 RSS、PSS、私有脏页和匿名页，保留最大 40 个映射及全部分组；读取失败或缺关键字段不冒充零。依据 [Linux /proc 文档](https://docs.kernel.org/filesystems/proc.html)。匿名映射没有 Canvas/WASM 标签，不能仅凭地址或大小认定对象归属。

Playwright 的公开 `newCDPSession` 只支持 Chromium；WebKit 自有 Memory 域受构建选项限制，未向产品引入私有协议依赖或强制 GC。本机未找到 heaptrack/perf/gdb/valgrind，真实 Safari 尚未接入；这里不是调用栈级分配剖析，也不能替代 Apple 环境。接口依据 [Playwright CDP](https://playwright.dev/docs/api/class-browsercontext#browser-context-new-cdp-session) 与 [WebKit Memory 协议](https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/inspector/protocol/Memory.json)。

所有以下对照均为 2048×2048 截图、24 次操作、独立浏览器进程；单位 MiB。阶段实验改变了工作负载/基线，只用于定位，数值不可直接相加，也不能代替正式 Gate。

| 对照 | 峰值 RSS 增量 | 说明 |
| --- | --- | --- |
| 原完整下载 + smaps（mp-native） | 455.5 | 24 次真实下载；私有匿名页主导增长 |
| 只渲染/读回（stage-render） | 117.8 | 真实 exportCanvas/getImageData，释放输入，无编码/下载 |
| 只 AVIF 编码（stage-encode） | 253.6 | 真实适配器/Worker；固定来源像素计入本组基线，无下载 |
| 真实渲染+编码、不交付（stage-pipeline） | 272.1 | 真实 exportImage，不关闭重开面板、不保存文件 |
| 只关闭/重开导出面板（stage-ui） | 244.0 | 无编码/导出 Canvas，仍有明显增长 |
| 已有 reduced-motion 偏好，UI-only | 74.7 | 影响全站动效，仅作诊断 |
| 已有 reduced-motion 偏好，完整下载 | 272.0 | 24 次真实下载，不能冒充默认媒体偏好验收 |
| 仅抽屉 wrapper/mask 短动效，完整下载 | 268.9 | 默认媒体偏好、测试 CSS 覆盖，24 次真实下载 |

`mp-native` 的 WPEWebProcess 私有匿名页从约 540.1 MiB 增至第 20 次 954.5 MiB，Worker 空闲后明显回落；下载 Blob 和共享图像区不是该样本的主要增长来源。结合阶段与动效对照，证据支持**反复开关导出抽屉的动效/合成开销与编码工作集叠加**是重要因素，不等于证明某个 WebKit 内部分配器泄漏。

### 已撤回试验与正式局部调整

- 试过保留 Drawer React 组件，使用 open/destroyOnHidden 管理关闭：UI 增量仅从 244.0 小幅变为 237.1，但基线更高，完整 24 下载增量反而为 525.2。已经精确撤回，保留独立构建指纹 `372c94d5503b600adbc8621b7736b67c934344917da3ccd5087accf1589d2625` 与失败证据。没有把通用 React 性能建议当成实测结论。
- 正式改动只给 ExportPanel 增加 `shoteasy-export-overlay` 独立 root class，将其 `.ant-drawer-content-wrapper` / `.ant-drawer-mask` 动效设为 0.01 ms、无延迟。导出面板立即呈现；其它抽屉、按钮和全站动效不受影响，原关闭/焦点/取消/实例隔离及清理逻辑不变。不保留隐藏的预览 DOM，也不改变编码质量/尺寸/预算。
- 新增三引擎 E2E：在默认 no-preference 媒体设置下检查局部动效、其它 overlay 不受影响、三次 Escape 关闭/重开及焦点回到导出按钮。已有无损像素、透明/白底、取消、预览、批量、多实例回归继续执行。

### 复现与证据保护

```bash
node --test tests/compression-product/native-memory.test.mjs
TMPDIR=/var/tmp SCREENHELLO_MEMORY_NATIVE_TRACE=1 SCREENHELLO_COMPRESSION_REPEAT=24 SCREENHELLO_COMPRESSION_LABEL=mp-native-new node tests/compression-product/diagnose-memory.mjs
TMPDIR=/var/tmp SCREENHELLO_MEMORY_STAGE=render SCREENHELLO_COMPRESSION_REPEAT=24 SCREENHELLO_COMPRESSION_LABEL=mp-isolate-new node tests/compression-product/diagnose-memory.mjs
```

- `SCREENHELLO_MEMORY_STAGE` 支持 full（默认真实下载）、render、encode、pipeline、ui；后四项仅支持 AVIF 诊断，不冒称下载。
- `SCREENHELLO_MEMORY_NATIVE_TRACE=1` / `SCREENHELLO_MEMORY_CANVAS_TRACE=1` 为可选采样；`SCREENHELLO_MEMORY_REDUCED_MOTION=1` 与 `SCREENHELLO_MEMORY_EXPORT_MOTION_ONLY=1` 仅为对照。**正式 Gate 不设置这些诊断覆盖项**。
- `SCREENHELLO_MEMORY_BUILD` 可指定已有独立测试构建；报告保存构建目录 SHA-256，不能只凭标签判断候选。MP 原始归因构建指纹与 MO 相同：`67d855916b07be6e5c72413dd35f1d71a7a7def1afb35c3f9a834f3fd8926c65`。
- 诊断标签重复时在启动浏览器前拒绝，报告排他写入、写入失败仍清理浏览器。所有产物保存在 `artifacts/compression-product-evidence/`，不进入公开代码。

### 最终验证

局部动效代码已接入；lint/typecheck、48 files / 496 unit、Web/library/harness 构建、72/72 三引擎压缩/预览/批量 E2E 通过。smaps 解析 3 项独立 Node 测试、重复证据标签拒绝检查及 467 文件本地公开源码闭包审计通过；源码副本 releaseReady=false。构建保留既有 chunk 警告。

consumer development/production 各 15/15、PWA 29/29 通过。最终正式矩阵 `benchmark-2048x2048-direct-mp-final.json` 完成 36 组 / 216 次真实下载，无页面错误/外域请求，实例已登记导出资源与 Worker 按规定清理。未设置诊断 CSS/媒体偏好/原生映射覆盖；完整执行后因一组超线 exit 1。

| MP 最终候选引擎 | 384 MiB 增量门通过 | 最大 RSS 增量 |
| --- | --- | --- |
| Chromium 151.0.7922.34 | 11/12 | 384.7 MiB |
| Firefox 153.0 | 12/12 | 258.7 MiB |
| WebKit 26.5 | 12/12 | 277.1 MiB |

Chromium 高噪声 AVIF 超线 0.7 MiB，截图 AVIF 383.4 MiB 亦接近上界；不能因超线较小或测量近似而豁免。独立复查 `benchmark-2048x2048-direct-chromium-avif-lossy-noise-mp-confirm.json` 为 315.1 MiB、6 次下载通过，说明有明显波动，不能用较低复查值覆盖完整矩阵失败，也不能据这两个样本判定具体回收原因。

最终默认媒体偏好、无测试 CSS 覆盖、无 Canvas/native 额外插桩的 WebKit 长序列如下。两次均为真实 24 次 AVIF 下载，命令 exit 0，零页面错误/外域请求，空闲后 Worker 退出，卸载后 URL/DOM Canvas 归零：

| 最终 WebKit 长序列 | 峰值 RSS 增量 | 稀疏基线绝对 RSS | 卸载 35 秒绝对 RSS |
| --- | --- | --- | --- |
| mp-final，24 次 | 277.6 MiB | 941.3 MiB | 962.4 MiB |
| mp-confirm，24 次 | 267.1 MiB | 936.8 MiB | 841.0 MiB |

- 两次长序列、正式矩阵与 Chromium 复查之间没有重建；最终目录 SHA-256 为 `e3f328b4163bb79dad93fec98a741bc3479fc32290b50f70f50dd789f6f6b361`。原始 JSON 为 `memory-diagnostic-webkit-avif-lossy-screenshot-repeat24-{mp-final|mp-confirm}.json`。
- 与上一轮 MO 的 437.3 MiB 比较，较高的一次最终峰值增量下降约 36.5%。第一轮卸载 RSS/PSS 仍比本轮稀疏基线高约 21.1/20.5 MiB，第二轮回落至基线以下；这不是长期无泄漏证明，也不能把较低卸载值冒充操作峰值。
- 最终业务改动只有导出 overlay 的独立样式作用域与短动效，保留 MO 的像素所有权修复；Drawer 保留组件试验已撤回，未改编码器、格式、质量、尺寸、384 MiB 线、4 MP 压缩/1 MP 预览预算，未强制 GC。

**结论：WebKit 指定长序列本轮已达标；跨引擎发布 Gate 仍 HOLD。** 本轮局部修复、review 与复验完成，但 CD3 全部性能退出门未关闭。下一步针对 Chromium AVIF 的临界波动进行固定候选的独立 A/B 与内存归因，再决定是否需要额外调整；不靠重复跑出低值或放宽门槛放行。

本轮 216 次矩阵下载、48 次最终 WebKit 长序列下载和 6 次 Chromium 复查全部成功，实验样本单独保留不混算。未推送或部署，未重跑全产品 E2E、真实 Safari/最低浏览器或原生桌面验证。本地源码预览仍为 http://127.0.0.1:4197/。

## Chromium 临界波动归因 MC（2026-09-08，本轮诊断/review/复验完成 / HOLD）

本轮保持 MP 产品构建不变，先保存其精确副本，目录 SHA-256 仍为 `e3f328b4163bb79dad93fec98a741bc3479fc32290b50f70f50dd789f6f6b361`。只改测试诊断和文档，不调整输出质量、尺寸、预算或 Worker 回收策略。

### 已核实的波动与方法

- MP 高噪声 AVIF 失败的基线/峰值为 950.6/1335.3 MiB；复查为 998.7/1313.8 MiB。增量相差 69.6 MiB，其中 48.1 来自基线差、21.5 来自峰值差。不能简单归因编码器，也不以提高基线、等待回收、PSS 替代或重跑低值消除原失败。
- 诊断增加 `SCREENHELLO_COMPRESSION_ENGINE=chromium`，默认仍是 WebKit；新增 `SCREENHELLO_MEMORY_CDP_TRACE=1` 只读查询页面 isolate 的 JS heap/backing storage 与 DOM 计数。无 Worker 堆覆盖，不把它当整个浏览器内存；禁止强制 GC、heap snapshot、`prepareForLeakDetection` 或模拟内存压力。接口依据 [Playwright CDP](https://playwright.dev/docs/api/class-browsercontext#browser-context-new-cdp-session)、[Runtime.getHeapUsage](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-getHeapUsage)、[Memory.getDOMCounters](https://chromedevtools.github.io/devtools-protocol/tot/Memory/#method-getDOMCounters)。不支持或字段无效时记录 unavailable，不冒充零。
- `SCREENHELLO_MEMORY_LEGACY_EXPORT_MOTION=1` 仅在该 MP 构建中将导出 wrapper/mask 动效覆盖为 300 ms，报告实测 computed duration；这是反事实，不是原 MO 二进制，不进入正式 Gate。不能与其它动效覆盖同时启用。
- Linux 进程角色兼容 NUL 分隔 argv 和 Chromium 重写的空格分隔进程标题，只保存角色而非完整参数。首两个 MC 报告的旧 NUL-only 角色字段未识别，不能用于区分 renderer/GPU；后续已修复并补测试，原报告不覆写。
- 原 benchmark 的 `verify-decode` 标签仅表示 `_renderImage` 返回后的阶段；直接 AVIF 路径不执行预览 decode，不能据标签推断解码器泄漏。

### 阶段与动效对照

Chromium 24 次截图 full + CDP/smaps 诊断增量 421.3 MiB，基线 776.5、峰值 1197.8。稀疏 RSS 为 778.7→空闲 35 秒 773.3→卸载 35 秒 577.3 MiB；页面 JS used 约 27.6→第 24 次 52.2→空闲 22.0 MiB，页面 backing storage 约 2.3→2.2 MiB。DOM/监听计数自然下降；这些结果不支持“页面所有对象持续单调不回收”，但不能排除所有泄漏，也不能忽略峰值。

真实渲染+编码、不交付/重开面板的 24 次 pipeline 对照为 368.6 MiB，基线 802.4、峰值 1171.0。渲染/编码组合本身已接近预算，不能把 full 与 pipeline 的差直接当作 UI 成本；两组工作负载、基线和采样开销不同。

相同 full/CDP/smaps 设置下的旧动效反事实为 352.8 MiB（基线 824.4、峰值 1177.2），24 次下载成功且实际 computed duration 为 300 ms。与默认动效的 68.5 MiB 增量差中，47.9 来自更高基线，峰值仅低 20.6。**未恢复慢动效**：不能把基线前已发生的分配当成收益，单次差异也不足以证明稳定改善。第三组已正确识别 renderer/GPU，卸载 35 秒总 RSS 546.7 MiB；原始文件为 `memory-diagnostic-chromium-avif-lossy-screenshot-repeat24-mc-legacy.json`。

复现（需先有生产测试构建，使用新标签保留证据；诊断退出成功不代表峰值达标）：

```bash
node --test tests/compression-product/cdp-memory.test.mjs tests/compression-product/native-memory.test.mjs
TMPDIR=/var/tmp SCREENHELLO_COMPRESSION_ENGINE=chromium SCREENHELLO_MEMORY_CDP_TRACE=1 SCREENHELLO_MEMORY_NATIVE_TRACE=1 SCREENHELLO_COMPRESSION_REPEAT=24 SCREENHELLO_COMPRESSION_LABEL=mc-attribution-new node tests/compression-product/diagnose-memory.mjs
```

原始 JSON 位于 `artifacts/compression-product-evidence/`：`memory-diagnostic-chromium-avif-lossy-screenshot-repeat24-mc-attribution.json` 与 `memory-diagnostic-chromium-avif-lossy-screenshot-repeat24-stage-pipeline-mc-isolate.json`。测试产物不进入公开源码。

### 原脚本无诊断覆盖复验

未重建产品 harness，未修改 `benchmark.mjs`、采样起点/频率、384 MiB 线或下载流程；仅使用其已有 24 次长序列参数。没有 CDP/smaps/Canvas 插桩或测试 CSS/媒体覆盖：

```bash
TMPDIR=/var/tmp SCREENHELLO_COMPRESSION_DIRECT=1 SCREENHELLO_COMPRESSION_ENGINE=chromium SCREENHELLO_COMPRESSION_MODE=avif-lossy SCREENHELLO_COMPRESSION_REPEAT=24 SCREENHELLO_COMPRESSION_LABEL=mc-final-new pnpm test:compression:stress
```

| Chromium 151.0.7922.34，2048×2048 | 实际下载 | 基线 RSS | 峰值 RSS | 增量 / 384 MiB 线 |
| --- | --- | --- | --- | --- |
| 截图 AVIF | 24/24 | 790.8 MiB | 1207.5 MiB | **416.7 MiB / 不通过** |
| 高噪声 AVIF | 24/24 | 982.4 MiB | 1361.0 MiB | 378.6 MiB / 通过 |

两组零页面错误/外域请求，规定清理点的上下文、Canvas lease、准备结果与 Worker 全部归零。命令完成全部 48 次下载后因截图组超线退出 1，不是中断。证据 `benchmark-2048x2048-direct-chromium-avif-lossy-repeat24-mc-final.json`，与历史 MP 的 384.7 MiB 失败一起保留。

**结论仍 HOLD：不只是六次下载中的 0.7 MiB 边界噪声，当前构建存在可复现的 Chromium 长序列峰值风险。** 现有源码复核未发现新的 Canvas/像素/Worker 所有权缺口；没有依据改 codec 回收次数或恢复慢动画，本轮不留猜测性产品修改。下一步优先针对渲染与 AVIF 编码组合的瞬时分配做更细阶段归因/有界优化，不靠提高基线、强制 GC、缩图、降质或只保留低值放行。

### Review 修复与验证范围

- 诊断启动失败、CDP/browser 关闭或报告写入失败时，仍逐层尝试关闭测试 browser/server/origin；重复标签在启动浏览器前拒绝。修复空格分隔进程角色、协议异常/无效数字不可冒充零，以及读取动效时依赖新 class 导致旧构建不兼容的问题。
- lint/typecheck、48 files / 496 unit、7 项诊断 Node 测试与 Web 构建通过，保留既有 chunk 警告。非法引擎、非 Chromium CDP、冲突动效覆盖及重复标签四个预检拒绝通过；当前/旧 class 测试构建的 wrapper 定位实际检查通过。
- 默认不设 engine/CDP/native/动效覆盖的 WebKit 兼容回归：6 次真实 AVIF 下载，峰值增量 251.7 MiB；自然空闲、卸载后 URL/DOM Canvas/Worker 清零，零页面错误/外域请求。证据 `memory-diagnostic-webkit-avif-lossy-screenshot-repeat6-mc-compat.json`；此项验证诊断默认行为，不能替代真实 Safari。
- 本地公开源码闭包 469 文件审计通过，releaseReady=false，仅生成本地验证副本。产品 harness 指纹未变；本轮未修改业务源码、CSS、codec、正式 benchmark、包/CI 配置，也没有推送或部署。
- 未重跑完整三引擎 36 组矩阵、全产品 E2E、library/consumer/PWA 浏览器测试、最低浏览器、真实 Safari 或原生桌面。MP 的相关历史结果不冒称本轮新实测。

## 渲染/AVIF 工作集 MW（2026-09-08，本轮诊断与试验完成 / 性能 HOLD）

本轮复用冻结的 MP/MC 产品构建与已有阶段诊断，先拆分渲染/像素读回和编码，再做两项单变量试验。没有更改 384 MiB 线、4 MP 输出、质量/编码选项或默认 UI 节奏。

| Chromium 截图，2048×2048，各 24 次 | 基线 RSS | 峰值 RSS | 增量 | 性质 |
| --- | --- | --- | --- | --- |
| render-only + CDP/smaps | 809.8 MiB | 967.2 MiB | 157.4 MiB | 真实 exportCanvas/getImageData，无编码/交付 |
| encode-only + CDP/smaps | 861.1 MiB | 1153.3 MiB | 292.2 MiB | 固定来源像素计入基线，真实适配器/Worker，无交付 |

两者都出现约 16 MiB 逐次上升后自然回落；这与一张 4 MP RGBA 缓冲区的大小吻合，是线索而非对象归属证明。两组基线/工作负载不同，不能把增量直接相加。全部阶段调用、自然空闲与卸载资源检查通过。

### 已撤回的两项独立试验

1. **AVIF Worker 消费后 `pixels.transfer(0)`**：在支持该方法时以零长度目标代替同尺寸 structured-clone detach；旧浏览器保留原 fallback。编码和输出交付后才清理，保留相同 codec/尺寸/质量；8 项相关所有权测试通过。依据 [MDN transfer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer/transfer) 和 [V8 零长度分支](https://github.com/v8/v8/blob/main/src/builtins/builtins-arraybuffer.cc)。但原 benchmark 的 24 次真实下载峰值增量 **765.0 MiB**，明显恶化，已撤回新增实现和试验测试，不能把 API 层释放等同进程 RSS 必然下降。
2. **导出 snapshot 释放前 `context.reset()`**：恢复原 Worker 后，单独在已拥有的快照清理路径重置绘制状态，原 destroy/宽高归零仍执行，不触及交互画布或全局原型。依据 [MDN reset](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/reset) 与本地 Leafer 2.2.9 源码。27 项相关单测通过，但 24 次真实下载仍为 **434.3 MiB**，未达标，亦已撤回。

两组均完整下载成功，命令因为内存超线退出 1；不据成功下载保留优化。失败构建另存本地，源码已逐字恢复、产品 harness 恢复为 `e3f328b4163bb79dad93fec98a741bc3479fc32290b50f70f50dd789f6f6b361`。未改第三方 glue/WASM 或编码分块，也未采用之前失败的 Worker 重建策略。

原始产物保留在 `artifacts/compression-product-evidence/`：`memory-diagnostic-chromium-avif-lossy-screenshot-repeat24-stage-{render|encode}-mw-isolate.json`、`benchmark-2048x2048-direct-chromium-avif-lossy-screenshot-repeat24-mw-{transfer|reset}.json`。

### 原生分配采样

诊断新增显式开关 `SCREENHELLO_MEMORY_CDP_ALLOCATIONS=1`，仅 Chromium，自动启用 CDP；64 KiB 随机采样间隔，在基线/最后操作/空闲/卸载检查点保存原始分配栈与模块信息。使用 `Memory.startSampling/getSamplingProfile/stopSampling`，无 GC、heap snapshot 或内存压力模拟；采样启动/读取/停止失败明确记录，不能冒充零或完整成功。依据 [Chrome Memory 协议](https://chromedevtools.github.io/devtools-protocol/tot/Memory/)。采样归属量不是 RSS，不替代正式 Gate，调用栈是否可用以当前二进制实测为准。

默认 headless shell 的 24 次诊断增量 418.0 MiB；五次 profile 查询全部成功却返回空 samples/modules，**没有取得有效分配调用栈**。这不是“原生分配为零”或“没有泄漏”的证据。解析器已补 `coverage=empty-unproven` 与回归，区分接口可调用和采样覆盖；原始 JSON 保留，不覆写旧结果。

另提供 `SCREENHELLO_MEMORY_CHROMIUM_CHANNEL=chromium`，仅允许本机随 Playwright 安装的完整 Chromium 作为诊断对照，报告明确保存 channel；默认不设置、正式 benchmark 不改变。依据 [Playwright 两种无头模式](https://playwright.dev/docs/browsers#chromium-new-headless-mode)，完整 Chromium 与默认 headless shell 是不同运行模式，结果不能混用或替代原 Gate。

```bash
node --test tests/compression-product/cdp-memory.test.mjs tests/compression-product/native-memory.test.mjs
TMPDIR=/var/tmp SCREENHELLO_COMPRESSION_ENGINE=chromium SCREENHELLO_MEMORY_CDP_ALLOCATIONS=1 SCREENHELLO_COMPRESSION_REPEAT=24 SCREENHELLO_COMPRESSION_LABEL=mw-allocations-new node tests/compression-product/diagnose-memory.mjs
```

### 有效原生分配证据与下一方向

本机完整 Chromium 的独立六次对照成功获得符号调用栈（非默认 headless shell，不能替代其 Gate）：

- 第六次下载后共 133 个原生样本，其中 **6 个独立样本的 size 均为 16,777,216 bytes，合计 96 MiB**。大块分配栈一致指向 `blink::ArrayBufferContents` → `DOMArrayBuffer::CreateUninitializedOrNull` → `DOMTypedArray` → `ImageData::ValidateAndCreate` → `BaseRenderingContext2D::getImageDataInternal`。
- 这些样本明确提供了 `getImageData` 像素缓冲的分配来源；在下一次 Worker 空闲检查点已消失。检查点同时发生自然回收，不能仅凭先后顺序断言是 Worker terminate 单独释放，也不能排除其它未覆盖的 Wasm/原生分配。
- 该六次诊断的基线/峰值/增量为 1290.5/1651.6/361.1 MiB；真实下载、错误/外域及卸载资源检查通过。它与默认 shell 的基线和运行模式不同，不能用其较低增量覆盖 MC 的正式失败。`profile.total` 是采样归属量，不是 RSS；上述 96 MiB 来自六个实际 size 字段，不声称等于整体超线量。
- 原始报告：`memory-diagnostic-chromium-avif-lossy-screenshot-repeat6-mw-full-chromium.json`；默认 shell 对照为 `memory-diagnostic-chromium-avif-lossy-screenshot-repeat24-mw-allocations.json`。调用栈源于本机实际采样，不是推测的浏览器内部路径。

下一项有证据支持的工作是**优化像素读取/跨 Worker 传递链路**，评估可显式释放的读取方式或有界缓冲，先做逐像素/输出字节一致性、透明/色彩及旧浏览器回退试验，再决定接入。不能继续只改变输入 detach、Wasm 堆增长、Canvas reset 或 Worker 重建次数。此为后续方案，不是已实现功能。

### 最终 Review 与验证范围

- 保留改动仅为诊断 helper、测试、诊断脚本和文档；两项产品试验及附加试验测试已精确恢复，与 MC 副本逐字核对一致。正式 benchmark 未改，冻结产品构建 SHA256 仍为 `e3f328b4163bb79dad93fec98a741bc3479fc32290b50f70f50dd789f6f6b361`。
- Review 补充空采样覆盖标志、受限显式 channel、原始模式记录与采样失败说明；四项 CLI 预检确认非 Chromium channel、任意 channel、非 Chromium 原生采样及重复证据标签均在启动浏览器前拒绝。
- lint/typecheck、48 files / 496 unit、9 项诊断 Node 测试、Web 构建通过；保留既有 chunk 警告。用户本地预览仍可访问。
- 本轮未重跑完整三引擎矩阵、全产品 E2E、library/consumer/PWA、最低版本、真实 Safari 或桌面测试；历史结果不算本轮新验收。两项原 benchmark 试验共 48 次真实下载均成功但内存失败，失败结果完整保留。
- **当前产品仍按 MC 的 Chromium 截图 416.7 MiB 失败保持 HOLD**。本轮完成的是有证据的归因、试验淘汰和诊断工具修正，不是性能缺陷已修复；没有推送、公开晋级或部署。
- 本地公开源码闭包审计通过（469 文件，releaseReady=false），仅生成本地验证副本，不包含私有规划与实验产物，也不等同发布就绪。

## 像素读取/传递 PX（2026-09-08，本地试验，性能 HOLD）

### 方案 Review 与边界修正

依据 MW 的 getImageData 分配栈，首先试验把已拥有的导出快照转为 ImageBitmap，交给现有 AVIF Worker，在 Worker 内用临时 OffscreenCanvas 读取 RGBA；位图 close、临时 Canvas 宽高归零，编码参数和原 Worker 空闲周期不变。只涉及直接压缩 AVIF，不改标准导出、完整预览、其它格式或旧注入 encoder。所有权依据 [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) 与 [ImageBitmap.close](https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmap/close)。把分配移动到 Worker 不保证整个浏览器 RSS 下降，必须另行实测。

三引擎字节探针使用 513×257 随机 RGBA、半透明文字/色块、alpha=true/false、sRGB/Display-P3 四种上下文；比较原读取与候选读取的每个通道，并使用真实 AVIF codec 比较最终文件字节。

- 初版在 Chromium 的 alpha=false 来源出现 386,558 个通道差异，AVIF 字节不同；给 Worker 传递相同 alpha 配置仍未消除。不能据 `drawImage` 成功认定像素无损。
- Review 修正为仅在明确的 alpha=true + sRGB 来源启用，其它上下文、能力缺失或位图创建失败均回退原 RGBA 路径。修正后的三引擎、每引擎四种上下文均通过逐字节和 AVIF 字节比较；不使用像素容差或重新设置宿主颜色配置。
- 创建位图期间仍由原导出队列持有快照，完成后核验取消/过期状态，关闭迟到位图；不让取消后的下一请求复用尚未完成的快照。适配器共享原串行、超时与取消协议，不新增编码 Worker 或业务单例。

### 原 benchmark 结果：未采纳产品改动

| Chromium 151，2048×2048 截图 AVIF，24 次 | 基线 RSS | 峰值 RSS | 增量 | 结果 |
| --- | --- | --- | --- | --- |
| PX Worker 位图读取候选 | 774.5 MiB | 1191.2 MiB | **416.7 MiB** | 全部下载成功，384 MiB 内存线失败 |

实际产品快照为 alpha=true/sRGB，额外非压力检查确认 createImageBitmap 被调用，排除因回退导致候选未生效。未改正式脚本、次数、采样起点/频率、质量、尺寸、UI 动效或阈值，没有强制 GC。其与 MC 恰好同为 416.7 MiB 增量，但两者绝对基线/峰值不同，不能当成同一次报告。

原始失败报告：`artifacts/compression-product-evidence/benchmark-2048x2048-direct-chromium-avif-lossy-screenshot-repeat24-px-bitmap.json`。试验源码和构建另存本地；业务三文件及适配器/Service 试验测试已精确撤回，正式 harness 已重新构建并核对为原 `e3f328b4163bb79dad93fec98a741bc3479fc32290b50f70f50dd789f6f6b361`。**不保留这项产品优化，也不解除 HOLD。**

### VideoFrame 仅做字节可行性检查

第二项仅验证 `new VideoFrame(canvas, { timestamp: 0, alpha: 'keep' })` 和 `copyTo` 到固定大小 Uint8ClampedArray，显式请求 RGBA/sRGB、offset=0/stride=2052，finally 关闭 VideoFrame；没有接入 Service/Worker 或进行第二项产品性能试验。接口定义见 [VideoFrame.copyTo](https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame/copyTo)。API 可调用不等于新选项在最低版本可用，更不代表输出与 Canvas 原读取相同。

| 当前引擎，513×257 固定随机 RGBA | alpha=true 通道差异 | alpha=false 通道差异 |
| --- | --- | --- |
| Chromium | 382,467 | 387,458 |
| Firefox | 383,742 | 0 |
| WebKit | 257,088 | 257,088 |

当前直接读取方案不满足像素契约，未采纳；不以单一不透明样本通过推广到透明图，也不在未验证情况下加入反预乘、色彩转换或降低比较标准。这不是证明所有 VideoFrame 方案永远不可行，而是拒绝当前不安全的替换。

### 保留内容与后续方向

- 保留 `tests/compression-product/bitmap-pixels.mjs`、对应单测、Worker fixture 与 `tests/e2e/pixel-readback.spec.js`，全部属于诊断，不被生产入口导入。WebCodecs 探针把差异写入测试 JSON 附件；该探针通过只表示观察完成，不表示像素契约或产品性能通过。
- Review 修复诊断中的缺失 API 检查、错误分支关闭、Worker postMessage 失败的计时器清理，并明确 alpha/色域回退边界。原始失败记录保留，未把失败的业务代码留在正式编辑器中。
- 下一阶段如继续，应先建立像素输入、Wasm 输入拷贝与编码工作集的可验证分配边界，评估是否需要 codec 级改动；不再把同进程内换读取位置当作已证明的优化。修改 codec 或使用新像素 API 前仍需原字节/透明/色彩与兼容性门。

### 最终验证与状态

- lint/typecheck、49 files / 505 unit、9 项诊断 Node 测试、Web 与生产 harness 构建通过，保留既有 chunk 警告。
- 三引擎共 15 项相关 E2E 通过：9 个原导出回归覆盖透明 PNG、JPG/WebP 白底、倍率/尺寸、同 Blob 交付、完整画面与多实例；3 个 Bitmap 候选/回退字节契约；3 个 WebCodecs 观察探针。观察探针不是像素契约或性能放行。
- 公开清单补入新诊断单测，避免整理源码时只带 helper 而遗漏测试；仅本地闭包验证，不进行公开晋级。新诊断不被 Web/library 业务入口导入。
- 本轮没有重跑完整内存矩阵、全产品 E2E、library/consumer/PWA、最低浏览器、真实 Safari 或桌面验收。恢复的原候选仍受 MC 正式失败约束；用户预览保留，无推送、部署或发布。

## AVIF 编码边界 CE（2026-09-08，本轮局部修复与 review 完成 / 性能 HOLD）

### 固定模块的实际分配证据

`tests/compression-product/codec-boundary.mjs` 使用安装的 @jsquash/avif 2.1.1 scalar glue/Wasm，不修改依赖或重新编译；记录两份产物 SHA256。诊断仅在实例化回调中包装实际 glue 指定的 malloc/free 导出，未知 glue 明确拒绝，不猜导出名。它只能看到 **JS→Wasm 导出调用**，看不到 Wasm 内部直接 malloc，也不把线性内存容量当 RSS 或存活分配量。

- 截图/固定高噪声 2048×2048 各六次：每次输入 wire 分配为 **16,777,221 bytes**（RGBA 长度加长度字段/结束字节），返回后对应 free 已调用；这是固定 glue 的 std::string 绑定拷贝，不能在现有接口下简单删掉。
- 两类图的线性内存均从 16,777,216 bytes 升至 **223,608,832 bytes**，后续五次容量不再增长。只能据此排除这组样本中的逐次容量增长，不能证明内部没有泄漏或峰值符合浏览器预算。
- 输出均是完整、独立于输入及 Wasm heap 的 Uint8Array；每次转移输出后再编码，文件 SHA256 一致、原输入 SHA256 不变。该诊断截图输出 1,016 bytes，高噪声输出 **4,723,183 bytes（约 4.5 MiB）**。
- 固定版本的 `encode.js` 本身直接返回 `module.encode(...).buffer`；当前 Worker 还会完整 slice 一次。输出独立性由实际模块验证，不仅依赖上游 C++ 描述。Embind 内存视图不能随意释放或转移，参考 [官方内存视图说明](https://emscripten.org/docs/porting/connecting_cpp_and_javascript/embind.html#memory-views)。

复现：`SCREENHELLO_CODEC_LABEL=ce-boundary-new node tests/compression-product/codec-boundary.mjs`（标签只允许小写英文字母、数字、连字符，最多 40 字符）。证据 `artifacts/compression-product-evidence/codec-boundary-ce-boundary.json`；重复标签在编码前拒绝，不覆写历史结果。

### 局部修正与安全回退

AVIF Worker 在确认输出占满普通 ArrayBuffer、既不属于输入也不属于可识别的模块 HEAPU8 时，直接转移编码器拥有的输出，省去一次完整结果复制。输入别名、Wasm heap、局部视图、共享内存及未知 heap 情况继续复制当前视图，防止 detach 编码器堆或将前后缀无关字节交付给用户。

这项修正不改变像素读取、编码参数、文件内容、Worker 空闲策略、超时、质量、尺寸或公开组件 API。六类新增所有权回归覆盖正常输出转移后继续编码，以及五种复制回退；既有失败/取消/输入清理测试保留。

### Chromium 原压力门及固定对照

| 场景，24 次真实下载 | 基线 RSS | 峰值 RSS | 增量 | 384 MiB 线 |
| --- | --- | --- | --- | --- |
| CE 候选截图 | 794.2 | 1245.3 | **451.1 MiB** | 失败 |
| CE 候选高噪声 | 998.3 | 1373.9 | 375.6 MiB | 通过 |
| 精确原构建截图对照 | 771.0 | 1257.7 | **486.7 MiB** | 失败 |

两类候选共 48 次、原构建对照 24 次下载均成功，命令因截图内存失败退出 1。对照是在候选失败后预先记录的单次固定检查，不用于替代或覆盖候选失败；两者顺序运行，未强制 GC 或更改采样、质量、尺寸、UI 动效/时间。

候选与原构建截图差 35.6 MiB，其中 23.2 来自基线差、峰值只差 12.4 MiB；不能把这当作删除约 1 KiB 输出复制带来的稳定 RSS 改善。保留“减少一次已证实的重复输出分配”的局部收益，**不宣称峰值问题已解决，也不解除 HOLD**。高噪声 375.6 与历史 378.6 的小幅差异同样不是稳定性能证明。

证据：`benchmark-2048x2048-direct-chromium-avif-lossy-repeat24-ce-output.json` 与 `benchmark-2048x2048-direct-chromium-avif-lossy-screenshot-repeat24-ce-control.json`，位于 `artifacts/compression-product-evidence/`。原对照与 CE 候选构建分别保存，正式 benchmark 源码未改。

### 同候选其它引擎定向检查

| 当前引擎，每类六次 AVIF 下载 | 截图增量 | 高噪声增量 | 结果 |
| --- | --- | --- | --- |
| Firefox | 236.6 MiB | 186.1 MiB | 两组均通过 |
| WebKit | 260.7 MiB | 188.2 MiB | 两组均通过 |

共 24 次真实下载成功，规定资源清理/错误/外域检查通过，原始文件分别为 `benchmark-2048x2048-direct-firefox-avif-lossy-ce-output.json` 与 `benchmark-2048x2048-direct-webkit-avif-lossy-ce-output.json`。这不是完整格式矩阵或最低版本验收，不能覆盖 Chromium 截图失败。本机 Node 与 Chromium ELF 核实为原生 ARM64，不是 amd64 或真实 Safari 环境。

所有 CE 压力数据使用同一产品 harness，SHA256 为 `cf2915d40586e72c24b7e8db526e7695ddea6e8b72414c6b059e270a8832ebc1`；原构建对照为 `e3f328b4163bb79dad93fec98a741bc3479fc32290b50f70f50dd789f6f6b361`。Worker 改动之外的 Service、适配器、codec/Wasm 和正式 benchmark 均未变更。

### Review 修复与最终验证

- 保留独立输出免重复复制；补输入/堆别名、局部视图、共享缓冲、未知堆的复制回退，验证实际转移 detach 后仍能再次编码。原有 codec 失败、非法输入、取消与 teardown 的清理语义不变。
- 固定模块诊断记录胶水/Wasm SHA256、分配观察范围和输入/输出 hash；非法标签、重复证据在编码前拒绝，review 补稳定错误消息，避免依赖 Node 默认断言文案。它不改变生产模块、引入强制 GC 或替代正式压力测试。
- lint/typecheck、49 files / 511 unit、9 项诊断 Node、27 项三引擎导出 E2E、Web/library 构建、压缩产物审计、PWA/library 边界审计通过。相关 E2E 覆盖真实大示例六种压缩下载、透明 PNG、JPG/WebP 白底、倍率/最终尺寸、完整场景及多实例。
- 真实 tarball consumer 的开发与生产预览模式各 15 项通过；新增诊断已包含在 474 文件本地公开源码闭包中，releaseReady=false。公开副本、构建/测试均仅在本地，未推送、晋级或部署；用户预览保留。
- 未重跑完整 36 组格式内存矩阵、全产品 E2E、PWA 浏览器离线矩阵、最低版本、真实 Safari 或桌面验收。**当前整体仍 HOLD**，不是 Web 发布通过。
- 后续若继续，应先对固定 codec 源码和工具链制定内部存活分配诊断 PoC，定位绑定拷贝、转换和 AV1 编码各自工作集；目前导出 wrapper 不覆盖内部 malloc，不能直接据此决定重编译或更改编码选项。

## CA：内部诊断的来源前置（2026-09-08，本地；性能仍 HOLD）

已新增 [固定来源清单](../tests/compression-product/codec-source-lock.json) 与 [只读校验工具](../tests/compression-product/codec-provenance.mjs)。它核对安装版本、npm tarball SHA512、registry gitHead、提交中 scalar glue/Wasm、七份构建配方，以及固定依赖元数据；不执行上游脚本、解包或替换产品依赖。

固定 npm 2.1.1 的 gitHead 为 `b7fa9ac9ec02f224847ad23d19d115f9e296a368`，该提交的两个 scalar 产物与安装文件 SHA256 相同。配方要求 Emscripten 3.1.57、libavif 1.0.1、libaom 3.7.0 与指定 libwebp commit。这证明产物来源对应，**不证明源码重新编译可复现或存在签名构建证明**。参考 [固定上游配方](https://github.com/jamsinclair/jSquash/tree/b7fa9ac9ec02f224847ad23d19d115f9e296a368/packages/avif/codec)。

Review 与实际下载发现两个前置问题：

- 上游 Dockerfile 的 apt 安装未固定，配方下载源码未校验；SDK 3.1.57 manifest 是 linux/amd64，而本机是 ARM64。目前只记录了镜像 digest，未拉取/执行。
- Googlesource 生成的 libaom/libwebp gzip 与 tar 字节会变化。libwebp 样本的文件条目时间戳随请求变化，不能简单把整包 hash 一次固定或每次更新放行；已转为固定 commit/tree，**完整 Git 对象/源码清单尚未获取验证，重编译仍未就绪**。libavif tarball 则独立校验固定 SHA256。

运行 `SCREENHELLO_CODEC_LABEL=ca-check-new node tests/compression-product/codec-provenance.mjs`；证据保存到 `artifacts/compression-product-evidence/codec-provenance-<label>.json`。标签限小写字母、数字、连字符，最长 40 字符；原子占用结果文件，重复标签在请求前拒绝。请求限 45 秒/16 MiB，失败记录保留，不自动重试。退出 0 只代表脚本规定的来源检查通过，报告中的 `rebuildReady/rebuilt/internalAllocationsMeasured/releaseReady` 仍为 false。

下一步是固定完整源码与工具链，先构建未插桩对照，再加有界 `mallinfo()` 阶段快照；它统计 allocator 占用，不是逐次 requested bytes、Wasm 容量或 RSS，也看不到快照间的瞬时峰值。完整追踪还需验证 aligned/realloc 等路径，不能把旧版 `--tracing` 当作全覆盖。接口依据见 [Emscripten 内存调试](https://emscripten.org/docs/porting/Debugging.html#memory)，实际行为须核对 [3.1.57 dlmalloc](https://github.com/emscripten-core/emscripten/blob/3.1.57/system/lib/dlmalloc.c)。

本轮未更改生产源码、依赖、编码参数、内存预算或正式压力测试。CE 的 Chromium 451.1 MiB 失败仍有效；没有新的内存通过结论，也未部署。

本轮实际验证：`codec-provenance-ca-final.json` 来源检查通过；此前 `ca-source` 归档摘要失败与 `ca-reviewed` 网络超时均保留。lint/typecheck、Web 构建、49 files / 511 unit、18 项诊断 Node 测试（其中 9 项本轮新增）通过。未重跑本轮 E2E、library/consumer/PWA、完整内存矩阵、最低浏览器、真实 Safari 或桌面验收。

## HF1：Web 部分交付候选（2026-09-08，本地，未部署）

拥有者确认先恢复 PNG 无损/有损、WebP 无损/有损、JPG 有损五种大图压缩下载；AVIF 大图压缩暂缓。`main.jsx` 通过现有 StoreProvider 的 Runtime 选项显式启用 `webExportSafety`，不是 `ImageBeautifier` 新 prop。组件库/桌面不自动启用，旧公共 API、默认质量与存档保持不变。

- 纯设置 helper 与每实例 ExportService 共同提供压缩尺寸限制：Web AVIF 为 1,048,576 像素，其余格式和未启用该策略的实例为 4,194,304。服务策略构造后只读，不从请求、项目或预设恢复；UI 派生同一值，不用 effect 复制状态。底层 codec/Worker 物理硬上限、线程、超时和质量不变。
- `_prepareScene` 在捕获导出 Canvas 前校验；直接/快速/隔离批量 target 均由同一服务约束。批量编辑场景仍会初始化，但超限时不创建导出 Canvas、不读取导出 RGBA、不调用 encoder。旧压缩偏好照常读取，失败和重试不静默缩图、切格式或改写设置。
- `downloadPreparedImage` 额外核验准备结果的实际最终尺寸，忽略请求伪报尺寸；计算不二次乘倍率。尺寸在请求校验时逐边向上取整，和 UI/最终画布尺寸一致，避免小数边界漏检。
- Web 大图 AVIF 压缩采用独立错误码 `export-web-avif-compression-size-too-large`；导出面板、快速导出错误、批量列表显示一致的七语说明。七语静态压缩页同步格式上限，避免页面继续承诺全部压缩格式都支持 4MP。
- 标准 AVIF 上限没有改动，但同样使用原 Wasm 编码器，不能当作避险替代；HF2 需要独立的标准 AVIF 压力证据。库维持原默认也不是宣称其内存问题已解决。

HF1 仅是实施与功能回归阶段。HF2 还需冻结候选、五模式 30 组正式无插桩压力、标准 AVIF 长序列/小图 AVIF 和生产 PWA/缓存验证；历史 CE 451.1 MiB 失败不消失。正式部署另需确认，当前官网仍是旧约 105 万像素统一限制版本。

HF1 最终验证：49 files / 522 unit、33 项三引擎相关 E2E、consumer 开发/生产预览各 15、lint/typecheck、Web/library 构建及压缩/PWA/library-PWA/i18n/42 页 SEO 审计通过。另在无内部 Runtime 暴露的生产构建中，Chromium 实际下载五模式文件且验证大图 AVIF 压缩不可用，pageerror 为 0。此处 PWA 为产物审计，不是新增离线浏览器验收；未运行 HF2 正式压力、最低版本、真实 Safari 或桌面验证，不部署。

## MG1：内存验收V2工具

MG1仅新增本地验收工具，不改变导出参数、预算、编码器或产品界面。历史384MiB为回归警报，不是浏览器安全配额；新版也不换成512/768MiB。没有真实设备/功能/完整场景证据不能GO，没有部署授权不能上传。

### 先登记，再采集

先冻结Web产物与 `artifacts/compression-product` harness。不要在采样过程中重建、运行其他测试、强制GC或为抬高基线预热。以下路径是操作示例，应使用自己的冻结目录与未使用的标签；命令只读本地产物。

```bash
SCREENHELLO_COMPRESSION_WEB_BUILD=artifacts/frozen-web \
  node tests/compression-product/register-memory.mjs \
  artifacts/compression-product-evidence/mg2-manifest.json release

TMPDIR=/var/tmp \
SCREENHELLO_COMPRESSION_WEB_BUILD=artifacts/frozen-web \
SCREENHELLO_COMPRESSION_MEMORY_POLICY=screenhello-export-memory/v2 \
SCREENHELLO_COMPRESSION_MANIFEST=artifacts/compression-product-evidence/mg2-manifest.json \
SCREENHELLO_COMPRESSION_PROFILE=web \
SCREENHELLO_COMPRESSION_DIRECT=1 \
SCREENHELLO_COMPRESSION_ENGINE=chromium \
SCREENHELLO_COMPRESSION_KIND=screenshot \
SCREENHELLO_COMPRESSION_MODE=avif-standard \
SCREENHELLO_COMPRESSION_REPEAT=24 \
SCREENHELLO_COMPRESSION_LABEL=mg2-first \
  pnpm test:compression:stress
```

- `register-memory.mjs OUTPUT [release|instrumentation]`：默认release，固定首轮10场景（标准AVIF Chromium两组24次、小图有损AVIF三引擎各两组6次、两组最高风险五模式抽查6次）、5个功能/发布门及3类目标设备。instrumentation只有64² PNG无损6次，始终不是release GO。
- 来源指纹分别记录Web产物、harness、当前生产输入路径集和runner；不是Git HEAD，不证明源码与旧构建天然一致，来源审查仍必须完成。Web路径默认dist，正式补证建议显式指定冻结副本，登记和采集使用同一路径。
- V2每次必须明确engine/kind/mode/direct/profile，场景及重复次数须在清单内。清单缺失、未知规则、候选/环境变化会在浏览器启动前拒绝。后续改变工具也应重新登记，不能追改已完成清单。
- 未指定MEMORY_POLICY时保持legacy；384超线仍exit1，旧输出数组/字段不升级。不能只设置manifest暗中切换规则。
- V2输出为原标签JSON路径加 `.v2/` 目录，含registration、checkpoint、complete或failure；同名目录/文件拒绝覆盖。checkpoint为完整原子文件；中断时保留部分证据，不将缺complete当通过。`complete`只表示该次调用完成，非全部矩阵完成。
- V2采集exit0只表示采集完成，**不是内存验收GO**；失败仍非零并保留证据。不要用忽略退出码的写法掩盖失败。

### 独立只读判定

新建本地输入JSON，例如与证据文件放在同一目录：

```json
{
  "manifest": "mg2-manifest.json",
  "reports": ["benchmark-2048x2048-direct-chromium-avif-standard-screenshot-repeat24-mg2-first.json.v2/complete.json"],
  "supplements": []
}
```

```bash
node tests/compression-product/evaluate-memory.mjs \
  artifacts/compression-product-evidence/mg2-input.json \
  artifacts/compression-product-evidence/mg2-verdict.json
node --test tests/compression-product/benchmark-contract.test.mjs \
  tests/compression-product/memory-policy.test.mjs
```

输入的相对路径以输入JSON所在目录为基准。上例只有1/10场景，因此必定HOLD；正式聚合必须列出全部必需场景，失败证据不可删除或筛走。旧报告只读保留，但不补造V2样本；重复场景不能挑最好一次自动通过，有条件确认应另存诊断/审查附件，旧失败不因此消失。

退出码：GO=0、REVIEW-HOLD=2、FAIL-HOLD=3、EVIDENCE-HOLD=4。硬失败优先；必需资料缺失、损坏文件或无效采样不能GO；未处置警报不能GO。即使GO，`deploymentAuthorized`也始终false。

`supplements` 是本地审查JSON路径数组，每份需kind（gate/device/review）、status（pass/fail）、reviewer、reason、manifestSha256（清单原文件SHA-256）、candidateSha256（清单candidate对象JSON序列化SHA-256）、evidenceFile及evidenceSha256。附件路径相对该审查JSON，工具重新读取核对摘要，不信任传入的attachmentVerified。

- gate/device还要id，必须匹配清单requiredGates/requiredDevices；未知机型、缺少实测就保持缺失，不伪造pass。
- review还要scenarioId、reportSha256（原始完整报告文件摘要），以及assessment下resources、trend、comparableBaseline、deviceStability、headroom五项非空说明；不能以通用approved标志绕过。
- 每场景都需审查会话总量与设备余量，即使导出增量很低。上述记录是可追溯的人工作证，不是密码学身份认证或自动证明实测内容属实。功能门需独立的实际解码/尺寸/MIME/透明、拒绝/取消/恢复/隔离、生产路径、PWA与许可/来源证据，不能把压力脚本中的文件大小/扩展名检查当全部功能验收。

### 测量与当前边界

保留导图/布局完成、导出面板打开后的原始baseline与384布尔值；导航前至最终idle复用同一条50ms采样流，记录单调时间、墙钟、读取耗时/状态和PID树。正常退出子进程与根不可读分开，不以0MiB代表不可得。全部会话超过1秒采样空档、时钟异常或缺失关键边界均INVALID；不改变产品内存配额。

逐次下载/释放记录后，等待产品自有Worker空闲退出，再固定观察5/15/30秒，不强制回收或等到低值才结束。报告同时列会话总峰值、导出增量、逐次峰值与释放曲线、idle值；24次按四组六次展示中位数/范围。持续上移是需解释的REVIEW，不直接宣称内存泄漏；RSS不回基线也不单独证明泄漏。

本轮64²工具探针6下载成功；最大间隙65.42ms、单次读取最长1.87ms，完整性检查有效。增量141.2MiB，尾段增长仍提示review，最终EVIDENCE-HOLD符合预期。此数据不代表4MP压力、目标低内存设备、Safari或发布验收通过。当前本地为Linux arm64，原生amd64最低浏览器、macOS14实际Safari、代表性移动设备资料仍待补齐。

## MG2：本地补证与工具修复

本阶段不修改生产源码、导出限额、Worker参数或依赖，也不部署。相同冻结harness完成预登记10组、96次真实下载；标准AVIF Chromium截图/噪声各24次，小图AVIF三引擎各两组6次，以及两组高风险五模式抽查各6次。

- 标准AVIF截图：总RSS峰值1208.8MiB、导出增量411.6MiB；噪声：总峰值1383.1MiB、增量379.1MiB。两组四段释放中位数及最后六次都不持续上移，30秒idle分别716.5/786.4MiB。411.6仍为警报，不认定已证明设备安全；没有仅因超384而重测。
- 小图AVIF六组下载均成功。Chromium截图/噪声六次释放值尾段上移，仍需审查；Firefox噪声组的采样读取和空档约1093ms，超过原1秒质量条件，内存证据保持INVALID，其低RSS不能放行。
- 修复采样器两处误判：根进程的辅助线程正常退出不再当根不可读；墙钟与单调时间都改为读取前记录，并显式标注`wallClockPosition`。根/主线程缺失与权限错误仍无效。对MG1生成的V2报告，只根据已记录路径解释线程竞态，并按原readMs对齐历史时钟边界，不改原始JSON、RSS、时间戳或384布尔值；真正时间跳变/空档仍无效。
- 独立评估新增`evaluatorSha256`；采集runner摘要与评估器摘要分列。修正后9/10组采样有效，不等于9组已获得发布批准。所有场景的目标设备余量审查仍待完成。

新增 `tests/pwa/production-downloads.spec.js`，只操作冻结生产页面，不使用开发store。PC示例五模式及标准AVIF、小图有损AVIF、PNG2x共8次下载实际校验magic bytes与解码尺寸，另检查大图有损AVIF拒绝，9项全过；连同既有PWA共24项通过。可针对自己的冻结副本执行：

```bash
TMPDIR=/var/tmp SCREENHELLO_PWA_OUT_DIR=artifacts/frozen-web-copy \
SCREENHELLO_PWA_PORT=4295 SCREENHELLO_BASE_PATH=/ \
  pnpm exec playwright test --config playwright.pwa.config.js \
  tests/pwa/pwa.spec.js tests/pwa/production-downloads.spec.js \
  --workers=1 --output=artifacts/mg2-pwa
```

PWA更新用例会临时改写所选副本sw.js并恢复，必须用副本，不指向唯一冻结原件。该命令是localhost验收，不是上传部署，也不代表Safari实测。

可靠性缺口仍保留：相关E2E并行首轮80通过/4浏览器crash或导航关闭/3显式可视基线跳过；失败用例单worker确认全部通过，但未确认首轮根因。严格CSP+原站返回503的恢复测试，Chromium/Firefox首轮通过，WebKit首轮预览失败；新增preload/SW/alert诊断的WebKit单引擎复测通过，但没有生产修复证据，因此不能声称恢复问题已解决。

最终80项Node、522项unit、lint/typecheck、Web构建、许可/PWA/压缩产物审计通过；公开源码隔离导出485文件审计通过但releaseReady=false。原始报告和冻结产物摘要均未改写。独立判定仍EVIDENCE-HOLD：需可信环境补Firefox噪声采样、复核间歇失败、完成原生amd64/真实Safari及代表性移动设备和来源/发布材料，不能以本地下载成功代替这些门。

## MG3：目标设备交接

`prepare-device-check.mjs` 只准备手动验收交接，不运行浏览器、不联网、不复制网站/素材，也不生成device/gate的pass记录。它读取已有release清单，核对整个冻结Web的摘要，生成五个目标（Chrome111、Edge111、Firefox128、macOS14真实Safari、拥有者指定的移动设备）的16项检查和待填写草表。

```bash
node tests/compression-product/prepare-device-check.mjs \
  artifacts/compression-product-evidence/release-registration.json \
  artifacts/frozen-web-copy \
  artifacts/compression-product-evidence/device-handoff-new
node --test tests/compression-product/device-handoff.test.mjs
```

将前两个参数换成自己的实际清单与匹配的Web目录；输出目录必须不存在、父目录须存在，且不能位于冻结Web内（含符号链接别名）。工具拒绝instrumentation清单、不匹配的Web、Web内的符号链接和覆盖已有输出。`handoff.json` 最后写入，缺它的中断目录不是完成交接；保留失败目录，用不同名称重新准备，不能覆盖操作者已填内容。

- `handoff.json`：不可覆盖的准备记录，绑定清单原字节摘要、历史候选和当前交接工具摘要；不将准备时间当实测时间。退出0仅说明准备成功，记录始终EVIDENCE-HOLD、deviceTestsExecuted=false、deploymentAuthorized=false。
- `device-worksheet.json`：可编辑草表。`handoffContentSha256` 是handoff对象的JSON序列化摘要（不是带缩进文件字节摘要）；device/gate判定器不把该草表当实测通过。先填写操作者、机型/系统/架构、实际浏览器完整版本、执行途径、候选测试地址/摘要与输入设置，再另行冻结正式预登记。未知RAM/RSS填明确不可得理由，不猜测、不填0。
- 每场景首轮最多一次；标准AVIF连续场景含六次导出，其他复合场景的动作数不能混称一次下载。必须保存实际输出、解码尺寸/MIME/透明检查、逐次耗时、项目保留/页面重载、界面响应/取消恢复与系统压力证据。硬失败停止相应场景，不自动追加直到通过。
- 当前官网不是该冻结候选。应在隔离的测试地址/localhost服务中使用核对过的副本；移动端需要可访问的安全测试地址，接入/上传另行确认。不要清除真实用户草稿或在唯一冻结原件上运行会改写SW的测试。
- 现有最低浏览器workflow可作为后续环境途径，但会重建指定提交，旧smoke未覆盖本清单全部压缩场景；旧SHA通过、桌面响应式模拟和Playwright WebKit均不能替代当前实机证据。手测附件需独立review后才可按MG1补证接口登记，内容摘要不是设备真实性证明。

MG3交接工具合约8项通过；工具总计88项、unit522项、lint/typecheck及Web构建通过。本阶段不重复MG2压力，不更改V2规则/产品限制，不宣称已解决Firefox采样空档或MG2间歇失败。所需实机及警报处置缺失时继续HOLD。

公开候选的最低浏览器工作流另记录实际commit、Web/source/runner摘要和host环境（`tests/release/record-candidate.mjs`），只接受此流程的原生Linux x64或macOS14且无可选设备包的源码构建；不继承带包的本地冻结摘要。Selenium移动检查已同步五个顶栏按钮，并将主题/语言纳入可见性及44px尺寸验证；核心菜单/项目/导出契约仍保留，新增appearanceActions字段。该标准格式兼容性矩阵不代表完整压缩/内存或实体移动设备通过。

最低浏览器smoke仅验证前台编辑：保留原编辑器window handle，下载后再次操作前通过WebDriver切回，并要求页面visible且hasFocus；隐藏时拒绝继续点击。Firefox128诊断发现WebP下载后页面hidden，后续AVIF尚未启动Worker就触发10秒画面就绪超时，不能误报为120秒编码失败。Firefox的临时WebDriver配置明确将四种MIME保存到下载目录，关闭下载面板自动展开及已下载文件内部预览，避免其异步抢走前台；不改变用户浏览器配置、渲染节流、编码器或安全检查，真实anchor交付和时限保留。报告标记downloadProfile、foregroundExports（含窗口数）和有界exportTrace；失败也保留已经完成的下载与内部abort码，不记录图片像素/Worker消息。`firefox_only=true`只能用于定向诊断，不能替代完整四目标矩阵。产品在后台的rAF/渲染等待可能被浏览器暂停，当前未保证后台导出；此runner修复不代表后台体验已解决。

2026-09-09前台smoke确认：公开ac9c39b的Chrome111、Edge111、Firefox128和macOS14真实Safari26.6四目标均通过，绑定同一b6905026 Web字节，独立证据审计无失败。Linux测试地址不是安全上下文，未验收HTTPS权限；且未包含压缩/内存/实体移动/可选设备包，MG3整体仍EVIDENCE-HOLD，未部署。

### 目标浏览器压缩检查（可选扩展）

Web Release Browser Matrix新增`compression_checks`输入（默认false）。开启后标准smoke之外，每目标固定8次下载：小图有损AVIF、PNG无损2x、PNG有损预览下载；PC内置示例五种压缩模式各一次，另检查大图有损AVIF拒绝和主动标准选择。没有自动重试或内存压力采样。

`tests/release/compression-downloads.mjs`只操作正式UI，预登记fixture摘要和次数、记录实际质量/色数/倍率、面板与原生解码尺寸、MIME/签名/大小/透明角点、前台与编辑器状态，逐项保留部分结果。预览通过Blob身份和实际字节数检查同一结果交付。测试解码立即关闭bitmap/归零抽样Canvas，不把测量开销算作内存结论；anchor交付不等于已核实操作系统落盘。

`compression-contract.mjs`独立校验非空固定清单与8项完整结果，不能只提交status=passed；运行证据审计时设置`SCREENHELLO_COMPRESSION_CHECKS=true`会要求全部目标具备压缩证据。未设置时仍接受旧标准smoke，但出现压缩报告就必须合法。当前实施不包含4MP标准AVIF连续/取消恢复/批量/离线与HTTPS权限/移动实机，不能作为完整MG3通过。

Edge111例外：其原生AVIF支持尚不可用（[微软记录从Edge121新增支持](https://learn.microsoft.com/zh-cn/microsoft-edge/web-platform/site-impacting-changes)）。仅已登记的小图AVIF下载可交给测试进程已有的锁定`@jsquash/avif`解码器验证文件，保留原生decodeError与独立decoder名称；其他格式/目标解码失败仍阻断。独立Node worker限10秒、输入128KiB，结束即销毁，报告不存Base64。此测试措施不改变Web产物，不证明Edge111可原生预览AVIF；产品预览兼容性仍待处理。

2026-09-09有界确认：bfac94e候选的Chrome111、Edge111、Firefox128、macOS14真实Safari26.6全部完成上述8项与拒绝检查，并通过独立证据审计。Web产物摘要仍b6905026，与前台标准smoke相同。Edge小AVIF文件由独立decoder验证，原生预览没有通过；这不是Safari16.4精确版本、内存或完整MG3验收。没有据此部署。

### AVIF预览能力降级（当前本地实现）

打开完整导出面板并选中可预览尺寸的AVIF时，会用自生成2×1本地样本检测实际预览链路，最多等待3秒；检查中或当前无法显示时，预览按钮禁用并提供七语说明，直接AVIF下载仍可用。关闭、切换其他格式或卸载会终止等待，晚到bitmap仍由既有解码所有者关闭，Canvas/URL及时释放；没有共享业务缓存或新增生产WASM decoder。

这是显示能力降级而非补齐原生AVIF支持，不自动换格式/质量、不改变任何尺寸预算。样本通过之后，实际预览的两个Blob仍须原有尺寸/解码校验；异常与超时不被误当作有效预览。可重新打开面板或切回格式再次检测。

目标浏览器压缩报告scope升级为`foreground-compression-download/v2`，固定8下载之外记录`avifPreviewCapability`，区分“有提示且只禁用预览”和“可预览”，两种情况都要求直接下载可用。新审计不能借旧v1结果证明新能力；旧候选记录按历史工具/摘要保留。完整MG3/内存/实体移动与部署状态不因此改变。

2026-09-09新候选e1fe292已通过四目标确认：Edge111显示降级提示，预览禁用但8项压缩下载通过；Chrome111/Firefox128/Safari26.6探测通过、预览入口可用。四平台Web摘要2acf10a6…18f3e一致，独立v2证据审计通过；完整MG3仍HOLD，未部署。

### 目标浏览器取消/恢复检查（可选扩展）

工作流`recovery_checks=true`必须同时开启`compression_checks=true`。在固定PC示例压缩检查后追加一次标准AVIF任务取消和一次同尺寸PNG标准下载。`tests/release/cancel-observer.mjs`只观察真实Worker提交/结果/终止及UI取消点击，不修改消息、转移列表、调度或产品Store；任务已返回结果、取消后仍下载、未终止Worker、项目图层变化或页面重载均不能算通过。

`cancel-recovery.mjs`预登记固定场景与fixture摘要、每阶段保存部分结果；`cancel-contract.mjs`独立验证时间顺序、一次提交/恢复下载、同页/图层保留以及PNG尺寸/MIME。`SCREENHELLO_RECOVERY_CHECKS=true`使证据审计要求全部目标具备该证据，不能仅凭顶层passed。Worker接到postMessage只证明已提交，不证明WASM函数已开始；API终止不等于证明RSS立即归还。最多16条标量任务记录，溢出拒绝通过，不记录用户像素。

本扩展不测标准AVIF连续6次、批量取消、RSS/系统压力、实体移动或HTTPS权限，也不改变业务限额/发布决定。首轮结果及确认应绑定各自候选摘要，不能复用旧无取消报告声称通过。

2026-09-09 c5b02da候选首轮四目标确认通过：Chrome/Edge111、Firefox128、macOS14 Safari26.6均在PC标准AVIF任务提交后取消，未交付AVIF且对应Worker终止；原图层信息不变，同页面PNG恢复下载解码2223×1667。实际Web摘要仍2acf10a6…18f3e，独立压缩+取消证据审计通过。此处只证明已提交任务可取消与恢复，非WASM内部执行/RSS回收或完整MG3通过；未部署。

### 批量取消与恢复：本地生产回归

`tests/release/batch-recovery.spec.js` 已纳入 `pnpm test:release:current`。先构建 Web，再在 production preview 中以真实 UI 设置当前 AVIF 风格、上传两项输入；不读写测试 Store，不替换编码结果或延迟 Worker。

- “取消全部”：首项 PC AVIF 提交后取消，第二项不启动、ZIP 不可下载；同页重新选择两张小图后可完成新的 ZIP。
- “取消当前”：首项取消后第二项继续，ZIP 只能包含成功的第二项。
- 注册和实际 ZIP 均保存为测试附件；独立合约检查终止/串行/新 Worker、原图层、文件名/条目数/摘要/实际解码尺寸与透明角点。小 AVIF 独立解码仍限每文件128KiB/10秒，ZIP总计256KiB，拒绝额外或重复条目，不新增生产 decoder。

两场景均禁用自动 retry / repeatEach。定向运行可在构建后执行 `pnpm test:release:current batch-recovery.spec.js`；端口冲突用 `SCREENHELLO_RELEASE_PORT` 指定空闲端口，证据采集时为 `--output` 和 JSON reporter 指定新的独立目录，保留旧结果。

2026-09-09本地阶段：Linux arm64 当前 Chromium/Firefox/WebKit 首轮与最终工具确认各6/6通过，实际 ZIP 再次独立解码/摘要核对通过；取消任务2223×1667，恢复条目73×55且透明。仅测试/配置更新，未改产品或部署。这份本地证据不代表最低版本、真实Safari、RSS回收或完整MG3通过；后续目标批量矩阵结果见下节。

### 目标浏览器批量扩展（默认关闭）

公开浏览器矩阵新增 `batch_checks` / `SCREENHELLO_BATCH_CHECKS=true`。标准四格式后复用已成功下载 AVIF 的小图项目，每目标增加两种取消场景、两个 ZIP 交付，不修改产品设置或限额；可与 `compression_checks`、`recovery_checks` 同时开启。Firefox 仅临时 WebDriver profile 加入 ZIP 自动保存类型，生产浏览器设置不变。

`batch-recovery.mjs` 负责真实 UI 编排；`batch-zip-observer.mjs` 保留原生 anchor/URL 行为，仅暂存最多两个256KiB以内ZIP的字节，落盘后移除Base64。原始 ZIP 用独占写入保存为 `<target>-batch-all.zip` / `<target>-batch-current.zip`，即使解码失败也保留。它证明交给下载入口的文件字节，不等于证明操作系统保存完成。

目标证据使用独立 `target-browser-batch-recovery/v1` scope，绑定两种模式、一次尝试、实际浏览器版本、候选 commit/Web/runner/host 与 fixture 摘要。收集四份 `<target>.json` 和八份ZIP到同一证据目录后，`SCREENHELLO_BATCH_CHECKS=true pnpm audit:release:browsers` 会要求批量证据完整，并重新读取/解码原件、核对条目和摘要，缺文件不通过。保留对应候选附件用于再次核对构建身份；同 commit 下 Web 或 runner 不一致也拒绝。

2026-09-09：023179d候选的[最终四目标矩阵](https://github.com/web-casa/ScreenHello/actions/runs/34309441362)已通过，含Chrome/Edge111、Firefox128与macOS14真实Safari26.6。八ZIP共十二AVIF条目经独立重读/解码及摘要核对通过，Web摘要仍2acf10a6…18f3e。此前两轮测试时序/FileList失败记录保留，修正后按同一候选完整确认，未拼接旧结果。本结论不包括精确Safari16.4、RSS/系统压力、连续AVIF或完整MG3；未部署。

## MG3 本地连续标准 AVIF 回归

`tests/release/continuous-avif.config.js` 为独立 opt-in：当前三引擎各在同页导入 PC 示例，标准AVIF/1x/2223×1667连续下载六次。没有自动重试、页面重建、强制GC或Store调用；首个失败停止后续引擎，不放宽编码参数。它不加入默认release smoke。

先 `pnpm build`，再以空闲 `SCREENHELLO_RELEASE_PORT` 运行 `pnpm exec playwright test --config tests/release/continuous-avif.config.js`。必须为 `--output` 及 JSON reporter 指定新的独立目录，不能与构建/其他浏览器测试并行。

证据绑定测试前后Web/source/runner摘要、固定fixture与真实Worker顺序、每次图层/前台状态、下载流原件及独立解码。六次结束后才逐文件解码，测试专用PC入口限制8MiB/10秒，旧小图128KiB门不变；文件尺寸和透明角点必须符合约定。输出目录中的三份 `continuous-evidence.json` 可作为参数传给 `node tests/release/audit-continuous-avif.mjs`，重新读取18个原始AVIF并核对摘要/解码结果；缺引擎、混候选或缺原件都不通过。

此工具仅验证当前引擎本地生产功能连续性，不采集RSS、不代表目标最低浏览器/真实Safari、24次内存趋势、实体移动或完整MG3通过，也不授权部署。

2026-09-09本地最终确认：Linux arm64当前Chromium151/Firefox153/WebKit26.5各六次通过，18原件再解码2223×1667，透明角点/不透明中心/非单色内容和同会话像素一致性通过；701unit/lint/types/Webbuild通过。工具review增强内容防漏检，业务代码未改、未部署。证据仍只属于本地当前引擎，目标浏览器连续场景待适配与验收。

## MG3 目标浏览器连续 AVIF 检查

工作流新增默认关闭的 `continuous_checks`（依赖 `compression_checks`）。在原有压缩检查建立的PC项目上，每目标执行一次六连标准AVIF/1x/2223×1667；原四格式/压缩/可选取消及批量/移动检查保留，不重载、不调用Store、不提高预算。

测试只在连续场景启用有界Blob观察，保留真实anchor click，逐项排他保存 `<target>-continuous-1.avif` 至 `-6.avif`。跳过主观察器的浏览器原生解码，六次之后才使用测试端独立decoder验证尺寸、透明角点、不透明中心、非单色内容及同会话像素一致性；这不意味着Edge111支持原生AVIF预览。单文件8MiB/解码10秒、原小图128KiB门不变。原件证明交付字节，不声称OS保存完成。

报告 `continuousAvif` 使用 `target-browser-continuous-avif/v1`，绑定candidate commit/Web/source/runner/host、实际浏览器版本、图片摘要与完整六次结果。收集四报告及24原始AVIF至同目录后，`SCREENHELLO_CONTINUOUS_CHECKS=true pnpm audit:release:browsers` 要求全部目标证据并重新解码原件；缺文件、少跑、混候选或输出变化不通过。未启用时不强求历史报告具备新字段，出现字段则必须有效。

2026-09-09：e1f2cb5候选的[首轮目标连续矩阵](https://github.com/web-casa/ScreenHello/actions/runs/34313811944)四目标全部通过，无场景重试；24张2223×1667 AVIF原件二次解码/透明度/内容及同会话六次像素一致性通过，四份候选及公开实际Web/source/runner摘要一致。原批量8ZIP/12小AVIF和标准/压缩/单次取消/移动smoke同候选通过。Safari实际26.6而非精确16.4；Web仍2acf10a6…18f3e，未部署。完整MG3/目标内存/24次趋势/PWA与实体移动证据仍独立保留。

## 原生 Firefox 噪声内存补证

浏览器工作流增加默认关闭的 `memory_firefox_probe`。开启后仅运行公开仓 Linux x64 `ubuntu-24.04` 独立 job，跳过原最低浏览器/Safari功能矩阵；固定锁文件内当前 Playwright Firefox、1024×1024噪声、有损AVIF、六次真实下载。它不是Firefox128最低版本重放，也不是完整十场景内存矩阵。

`run-native-firefox-memory.mjs` 在安装和两种构建完成后登记候选/host/工作流摘要、run ID与第一次attempt；拒绝继承其他场景参数、复用证据目录或直接rerun。运行现有instrumented harness：用Store设置固定fixture和读取资源状态，RSS采样覆盖浏览器进程树；Web构建另作摘要绑定，不冒充未经插桩的生产UI。下载仅检查非空流和后缀，不保存原图或新增解码证据。

现有V2判定保持50ms采样、1000ms最大间隔/读取门、384MiB历史审查线和5/15/30秒idle观察。Linux `/proc/meminfo`、`/proc/pressure/memory`、`/proc/vmstat` 前后快照补充主机RAM/Swap/PSI/oom_kill上下文；不可读保留null与原因，系统计数不归因浏览器，前后快照不是期间峰值。RSS为近似进程树总量，可能重复计共享页。

CI附件包括登记、清单、完整曲线/资源和前后系统快照；`evaluateNativeMemorySupplement` 可重读原件独立复算。采样无效或功能失败使job失败；有效采集最多为 `MEASURED-REVIEW-HOLD`，完整release判定仍 `EVIDENCE-HOLD`，不授权部署。旧无效记录保留，不能用本候选覆盖旧环境结果。

2026-09-09：[首次原生补证](https://github.com/web-casa/ScreenHello/actions/runs/34315216140)成功，1ec3a1a候选/Linux x64/Firefox153.0六次全部下载。2103样本最大间隔58.484ms，无无效采样/功能或资源失败；进程树总峰值1151.7MiB、导出增量111.6MiB、30秒idle966.9MiB。主机oom_kill和PSI累计均未增加，约16GiB机器不代表低内存设备。原件独立重算/公开候选与工作流摘要核对通过；`session-headroom-review`及完整MG3仍HOLD。没有产品修改、main合并或部署。

## PWA 冷缓存失联与恢复

`tests/compression-product/verify-pwa-recovery.mjs BUILD OUTPUT WEB_SHA256 [ENGINE]` 对冻结的根路径Web构建检查严格CSP、首次codec请求真实503、联网刷新恢复以及暖缓存离线重新加载。必须提供预期Web摘要和不存在的输出目录；默认当前Chromium/Firefox/WebKit串行、失败停止，无自动重试。它使用localhost安全上下文，不代表公开HTTPS、最低浏览器、真实Safari或完整更新验收。旧verify-deployment报告保留不改写。

每阶段保存服务器响应、浏览器错误/可见性、缓存列表及PNG无损/PNG有损/WebP无损六张真实下载。原件有大小上限、签名、摘要、独立页面解码与在线/离线像素一致性检查；首次失败必须关联到未缓存的PNG JS及真实503，不能以任意alert代替。测试服务器请求日志默认关闭，只在本工具显式开启，避免改变既有内存基准分配；manifest返回application/manifest+json。

当前Web构建通过`config/codecPreload.mjs`排除三个编码器动态入口的JS预加载，保留CSS及其他页面优化；真实dynamic import与Worker仍按需，不预缓存WASM、不自动重试或刷新。此修复针对恢复后无新网络请求却再次模块导入失败的现象，与[WebKit的失败预加载缓存问题](https://bugs.webkit.org/show_bug.cgi?id=270357)相符。稳定策略摘要加入chunk哈希，避免内容改变却复用旧immutable URL。library和桌面入口不启用这项Web策略；库消费者的预加载策略仍由宿主构建器决定。

测试临时目录必须有足够空间及inode；发生`/tmp` ENOSPC时先检查`df -h`和`df -i`，可为该次测试设置一个独立磁盘`TMPDIR`，不要清空共享/tmp或盲目重跑。失败报告和启动日志应保留；环境崩溃不算产品通过，也不能无证据归因为OOM。此修复尚未部署至正式域名，不继承先前公开候选的最低浏览器/内存通过记录；后续隔离预览证据见下文。

2026-09-09修复候选Web `5c65dbc5…83032` 已在本地当前Chromium151/Firefox153/WebKit26.5三引擎通过上述恢复流程，18个73×55下载原件重读/解码与在线离线像素一致性通过。另四项核心shell/PNG批量/AVIF缓存/dirty等待更新回归通过，更新fixture恢复后Web摘要一致。结论为`LOCAL-RECOVERY-PASS`，完整release仍HOLD；旧失败保留，目标功能复验及HTTPS入口预检见下一节。

## 修复候选的目标复验与 HTTPS 入口身份

浏览器工作流新增可选字符串 `expected_web_sha256`。非空时只接受64位小写十六进制，并在启动浏览器前校验实际 `dist` 摘要；不匹配直接失败。候选报告同时记录预期摘要与匹配状态，旧调用省略时保留兼容，但不能声称通过了预期摘要门。

只读工具 `node tests/release/check-https-entrypoints.mjs BUILD OUTPUT_JSON EXPECTED_WEB_SHA256` 要求已有输出父目录，拒绝覆盖报告或写入构建目录。当前只允许 `https://screenhello.com` 的 `/`、`/sw.js`、`/manifest.webmanifest` 三个入口，逐一读取一次，不重试、不跟随重定向、不携带Cookie；使用正常证书/主机名验证，每响应至多1MiB、每次请求含DNS阶段至多15秒。显式销毁超时请求，符合[Node 24 HTTP超时说明](https://nodejs.org/docs/latest-v24.x/api/http.html#requestsettimeouttimeout-callback)，不把timeout事件当作自动取消。

工具检查状态、MIME、入口字节摘要，保留TLS/CSP/缓存头；这些头只是现场记录，尚不代表CSP/缓存策略合格。`ENTRYPOINTS-MATCH`也只代表三个入口，完整资源闭包、浏览器PWA离线/更新、权限与发布门仍HOLD；不匹配或网络错误返回非零状态。

2026-09-09首次生产预检：TLS1.3证书验证通过、三入口200及MIME正确，但首页和sw字节不匹配新Web5c65dbc5，manifest匹配。结论`CANDIDATE-MISMATCH-HOLD`，未部署。另观测到sw响应max-age=14400及入口未返回CSP头，后续预览部署应单独核对实际缓存/安全头，不能由本入口身份检查代替。

公开测试分支50702a8的[四目标矩阵](https://github.com/web-casa/ScreenHello/actions/runs/34320860957)首轮全部通过：Chrome111.0.5563.146、Edge111.0.1661.62、Firefox128.0.3和macOS14真实Safari26.6，后者不是精确16.4验收。标准/压缩/取消/批量/六连AVIF同候选通过；四份候选预期摘要门均通过，实际Web/source/runner与公开工作区独立重算一致。24原始AVIF和8ZIP二次解码/内容审计通过。它是功能复验，不是上述503恢复场景在真实Safari上的重放，也不是HTTPS或内存验收；main及官网未更新，完整release仍HOLD。

## 隔离 HTTPS 预览验收

`tests/release/prepare-https-preview.mjs PUBLIC_ROOT OUTPUT_DIR EXPECTED_WEB_SHA256` 从指定公开候选的dist排他生成上传目录，仅补预览响应头与LICENSE/第三方许可附件，逐文件保证应用字节不变，上传包摘要另行登记。它不执行部署，不读取凭据，不上传源码/过程记录/设备包。输出目录不可复用；原始候选不能位于输出目录内。

`tests/release/check-https-preview.mjs BUILD ORIGIN OUTPUT_JSON EXPECTED_UPLOAD_SHA256` 最多四并发读取完整静态清单，逐文件核对摘要、TLS、MIME及noindex/CSP/缓存；单响应最多4MiB/15秒，无重定向或重试。Pages不会直接提供_headers/_redirects，所以用实际响应核对这些规则；404.html用不存在的路由验证404及返回内容，不把直接访问/404的200算作不存在路由通过。当前仅允许明确的ScreenHello部署ID域名或专用mg3-pwa-20260909别名；不接受正式域名、其他项目或任意URL。

`tests/release/verify-https-preview.mjs STATIC_REPORT OUTPUT_DIR EXPECTED_UPLOAD_SHA256 [ENGINE]` 要求静态校验先通过，保存首次登记、每引擎错误/缓存/网络开关状态和6个PNG/WebP原件，独立解码73×55并比较在线/离线像素。默认当前Chromium/Firefox/WebKit，每引擎一个会话，不重试；不是最低版本/真Safari或性能验收。

Firefox现场发现`context.setOffline(true)`使页面请求失败，但未阻断Service Worker取回冷缓存编码器，因此不能仅以页面sentinel失败判定离线。最终工具使用loopback CONNECT代理，只允许本次预览域名443；端到端TLS不解密、不安装证书、不改变系统代理。切断已有隧道后拒绝新连接，并核对离线期间upstream计数没有增加及确有拒绝。Chromium/Firefox抛TypeError，WebKit可暴露空503响应，两者必须同时满足独立网关计数；200/404/超时/有上游正文/计数不一致均失败。该503来自测试网关，不能称Cloudflare原站返回503。代理行为依据[Playwright配置文档](https://playwright.dev/docs/network#http-proxy)。

响应头必须合并到已有/sw.js块，不能重复同一路径使旧Cache-Control丢失。HTTPS工具先记录原始状态错误再销毁响应，避免同步aborted覆盖308等真实原因。首次失败保留；路径、TLS/大小/状态、防覆盖、真实socket拒绝/断开/恢复均有单测。

预览已发布到[隔离环境](https://mg3-pwa-20260909.screenhello-preview.pages.dev)，固定部署[18cd0a74](https://18cd0a74.screenhello-preview.pages.dev)。159个静态响应摘要、MIME、noindex/CSP/cache通过；仅预览上线，不代表screenhello.com已更新。跨部署waiting/dirty/busy更新、真实目标HTTPS和实体移动余量仍是后续门；本轮两次部署只修了响应头，没有改变SW主体，不能算跨版本更新测试。

2026-09-09最终统一矩阵：当前Chromium151.0.7922.34、Firefox153.0、WebKit26.5全部通过冷缓存失联失败、联网恢复及暖缓存离线重载下载；18份PNG无损/PNG有损/WebP无损原件另行重读、摘要和73×55解码核对通过，同引擎在线/离线像素一致。上传闭包与公开候选Web摘要独立重算一致，浏览器无CSP违规/页面异常/外域请求。结论为HTTPS-OFFLINE-PASS，完整发布仍HOLD；不包含AVIF专项、最低版本/真实SafariHTTPS、跨版本更新或内存验收。
