# 导出压缩 C0：编码器与预览技术验证

> 本页保留 C0 历史实现与测试。当前本地下载/预览独立预算见 [大图压缩下载修复](./compression-download.md)；C4 的历史压力与解码生命周期证据仍见 [C4](./export-compression-c4.md)。

> 本文是 C0 历史快照。后续正式内核集成与当前状态见 [C1](./export-compression-c1.md)；下文“尚未接入”均描述 C0 当时。当前源码的依赖/资产复核使用 `node tests/spikes/compression/audit.mjs --product-c1`，以允许已晋入内核的独立 PNG codec，但仍禁止实验聚合 Worker 混入产品。

2026-09-06。**C0 隔离技术验证及 review/fix 完成，可在下述限制内进入 C1；不等于产品压缩功能已完成或发布 Gate 通过。** 尚未接入正式导出面板、快捷导出、项目设置或批量任务。原来的标准导出行为保持不变。实验位于 [tests/spikes/compression](../tests/spikes/compression/)，不属于公共组件 API。

## 技术选择与修复

| 路径 | 本次验证的选择 | 限制 |
| --- | --- | --- |
| PNG 无损 | `@jsquash/oxipng@2.3.0`，直接使用 scalar `codec/pkg`，level 2、interlace=false、optimiseAlpha=false | 包内 README 声明底层 Oxipng v3.0.0；未独立从二进制识别版本，以包 integrity、源码和 WASM SHA 固定来源 |
| PNG 有损 | `upng-js@2.1.0`，一次 RGBA 量化，最多 64/128/256 色，初始 256 色 | 使用两项固定源码转换，见下文；不新增 APNG、解码上传入口或抖动参数 |
| WebP 无损 | 现有 `@jsquash/webp@1.5.0` scalar codec；lossless=1、near_lossless=100、exact=1、thread_level=0 | 相对现有白底编码输入逐像素无损，不改变 WebP 白底策略；实验固定 quality=80 作为编码 effort，不显示无损画质滑块 |
| 有损质量 | JPG Canvas、WebP scalar、AVIF 现有 scalar 参数路径 | 建议高清/均衡/更小：JPG、WebP 为 90/80/60，AVIF 为 80/60/40；AVIF alpha 固定 60、speed 8、subsample 3、bitDepth 8 |
| 独立验码 | `pngjs@7.0.0` 仅 Node 测试使用 | PNG 不以同一 codec 自编自解证明正确；WebP 白底结果用浏览器解码逐像素比较 |

`upng-js` 依赖的实际版本是 `pako@1.0.11`。Apache/MIT/Zlib 原文及修改说明已加入 [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md)。lockfile 固定 npm integrity；`audit.mjs` 记录实际源码/资源 SHA。

UPNG 原始文件 SHA-256：`b7c0bdb021dffeb82f1ac27c6762f939f967a9e4e0886518fef649331b612164`。仅在实验构建启用 [upngCjsPlugin.mjs](../tests/spikes/compression/upngCjsPlugin.mjs)，源码变化立即拒绝构建并要求重审：

1. Rolldown 改写 require 调用却保留 `typeof require` 探测，导致 module Worker 误走 `window.pako`。只替换该固定入口分支，不增加全局 window/require shim。
2. 原版以 `rawBytes+100` 分配输出，会截断 1px 透明 PNG 的 IEND CRC。静态路径改为按压缩 IDAT、PLTE/tRNS 和固定 chunk 长度精确分配，明确拒绝多帧；不改变量化或像素算法。

这不是未修改的 upstream 产物，C1 必须保留两项兼容修复与回归，或用另一个已通过同等验证的实现替换。UPNG 内部已做 alpha 预乘，不再额外预乘/二次量化。主分支源码中的 UZIP 风险不用于描述这个 npm 发行版本。

## 冻结给 C1 的初始约束

- 新压缩/完整预览先采用 **2,097,152 像素、单边 8192** 上限；精确边界为 2048×1024，刚超限在分配前拒绝。不得自动缩尺寸或降低倍率。C0 上限不是对旧 ExportService 的修改：标准 PNG/JPG/WebP 仍为 16,777,216 像素，标准 AVIF 仍为 4,194,304。
- 4 MP 初始方案被否决：WebKit 噪声 PNG 无损约 +449.2 MiB、WebP 无损约 +466.0 MiB，超过原有单次 384 MiB RSS review 线。2 MP 的实际采样记录见下方证据，不能继承原有有损模式的大图性能证明。
- 新 codec 超时 30 秒；就绪等待建议上限 10 秒，超过时显式失败。Firefox 的 PNG 无损大图约需 9～10 秒，因此预览保持手动、任务可取消，不能把 timeout 当交互速度承诺。C1 恢复现有约 1 秒 Worker 空闲释放；实验为了测热启动，在六次连续循环结束后统一 dispose。
- 当前双实例各 2 MP 的噪声压力已测，WebKit 合计约 +476 MiB；384 MiB 是单次观测线，不是两实例的总额度。已修正早期漏采 Firefox 辅助线程子进程的问题，旧低读数废弃；RSS 仍是近似进程树观测，不得据此承诺移动设备、任意实例数或所有 WebView 内存安全。
- PNG 有损对文字、渐变和半透明可能产生可见变化；更多颜色不保证所有指标单调改善。用户自行选择模式，下载相同预览结果；无损优化无收益时保留基准 PNG 的产品逻辑留给 C1，不把 codec 输出字节直接当“已节省”。
- 保留旧质量、默认模式和白底/透明策略；新质量预设是可调整起点，不跨格式比较数字。新 PNG scalar WASM 为 164,172 B（gzip 76,146 B），C1 给其 raw 上限 180,000 B；实验聚合 Worker 约 109 kB（library 未压缩约 260 kB），不代表正式按格式拆分后的体积预算。

## 验证范围与证据

环境：Linux aarch64、Node 24.18.0 / pnpm 10.12.1，Playwright Chromium 151.0.7922.34、Firefox 153.0、WebKit 26.5。`lscpu` 暴露 16 个逻辑 CPU、Apple vendor，但型号缺失，不能推断具体芯片；Node 报告 CPU model=unknown。它们不是 Chrome/Edge 111、Firefox 128 或 Apple Safari 16.4 的精确验收。

最终 2048×1024 压力矩阵：每引擎截图/噪声 × PNG 无损/PNG 减色/WebP 无损，共 6 组，每组连续 6 次；RSS 包含基准捕获与解码对照，50 ms 采样，并在阶段边界主动采样。`rssSampler=all-thread-child-tree-v2` 遍历全部线程的子进程，避免漏采 Firefox forkserver；共享页可能重复计数，仍非精确分配计量。时间为所有组中最慢的一次，不是日常图片的平均耗时。

| 当前引擎 | 编码阶段峰值增量 | 解码对照阶段峰值增量 | 单操作整体最大增量 | 最慢一次（含启动） | 双实例合计增量 |
| --- | --- | --- | --- | --- | --- |
| Chromium | 167.8 MiB | 201.0 MiB | 201.0 MiB | 2.89 s | 349.5 MiB |
| Firefox | 170.3 MiB | 153.8 MiB | 170.3 MiB | 9.82 s | 265.9 MiB |
| WebKit | 268.2 MiB | 191.2 MiB | 268.2 MiB | 1.17 s | 475.6 MiB |

各列分别取本引擎各组最大观测值，不能相加。单操作观测没有超过 384 MiB review 线；双实例数据独立记录，不能套用单操作阈值。`phaseDeltaRssMiB` 分别保留 source/encoding/decode/released 阶段峰值；decode 包含编码后仍驻留的 Worker 和双画布，不能解释为解码器独占增量。释放后的即时 RSS 不保证马上回到基线。没有把近似 RSS 或当前 Linux WebKit 当成真机内存验收。

- 当前三引擎各 41 个真实样本/格式/质量组合，共 123 个；包含透明 1px、少色、截图文字/细线/渐变/阴影、现有本地图像和确定性噪声。
- PNG 优化独立解码，包含浏览器 Canvas 会隐藏的透明 RGB 与半透明原始 PNG；WebP 无损相对白底输入逐像素一致。取消发生在 Worker 已开始处理之后，另测启动超时、重试、双 client 参数隔离和全部 Worker 释放。
- 同一完整编辑器树的两图、标注、HDR 快照经 PNG 无损后保持像素一致；标注确实改变导出图，Canvas lease 为 0、两个实例文档不被编码修改。此项只证明捕获路径可用，不代替 C1 的渲染代际/失败回退/失效状态机。
- 实验使用产品实际 runtime-cache 匹配规则和独立小型 SW app shell；临时源站真实拒绝请求且普通响应 no-store，证实未缓存不可用、预热后离线重载仍能编码。没有依赖不完整的 `context.setOffline` 模拟作为唯一证据，也没有改变产品 SW 配置。
- library 实验复用真实 library 资产重写插件，再由独立 consumer 进行第二次生产构建；PNG/WASM URL、两个 client 与极小 PNG 真实解码通过。正式产品构建未出现实验 Worker/Oxipng 资产，现有 PWA 预算没有扩大。
- 存档夹具证明：向现有便携项目注入新压缩偏好后，旧 reader 保留画面并忽略新字段；不把此项称为尚未实现的新 reader 或 C3 全链路往返通过。
- 现有产品回归：全量 unit **37 files / 316 tests**；lint/typecheck；Web/library build、PWA 双审计、size report；导出 E2E **18 passed / 9 expected skipped**；清洁 tarball consumer dev/preview **各 4/4**；frozen strict-peer 安装（本轮带 `--ignore-scripts`）、low audit 与许可核对。旧 16 MP 重型 E2E 默认跳过，新 2 MP 基准单独显式运行。

机器可读结果在忽略目录 `artifacts/compression-evidence/`：`correctness.json`、各引擎正确性记录、`scene.json`、`offline.json`、`library.json`、`dependency-assets.json`。**最终单操作使用 `benchmark-2048x1024-{chromium,firefox,webkit}.json` 三份 v2 采样记录**，双实例为 `benchmark-2048x1024-pair.json`。无引擎后缀的早期单操作报告仍是旧采样器，不能复用其中 Firefox 数据；失败的初始 `benchmark-2048.json` 保留用于解释为何收紧上限。PNG 与对照截图可供检查，但不提交用户图片或生成的大体积证据。

## 复现命令

先安装锁定依赖并构建隔离 Web 入口，在独立终端保持以下 preview 运行（不要占用已有服务端口）：

```bash
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm exec vite build --config tests/spikes/compression/vite.config.js
pnpm exec vite preview --config tests/spikes/compression/vite.config.js --host 127.0.0.1 --port 4196 --strictPort
```

另一个终端执行。不要在基准过程中重建同一个实验目录；基准 RSS 采样需要 Linux `/proc`，并非跨平台内存测量工具。

```bash
node tests/spikes/compression/verify.mjs
node tests/spikes/compression/verify-offline.mjs
node tests/spikes/compression/verify-scene.mjs
SCREENHELLO_COMPRESSION_ENGINE=chromium node tests/spikes/compression/benchmark.mjs
SCREENHELLO_COMPRESSION_ENGINE=firefox node tests/spikes/compression/benchmark.mjs
SCREENHELLO_COMPRESSION_ENGINE=webkit node tests/spikes/compression/benchmark.mjs
SCREENHELLO_COMPRESSION_PAIR=1 node tests/spikes/compression/benchmark.mjs
pnpm exec vite build --config tests/spikes/compression/library.config.mjs
pnpm exec vite build --config tests/spikes/compression/consumer/vite.config.js
node tests/spikes/compression/verify-library.mjs
pnpm build
pnpm build:lib
node tests/spikes/compression/audit.mjs
pnpm test:unit tests/unit/compressionSpike.test.js
```

`SCREENHELLO_COMPRESSION_URL` 可指定已有实验 preview，`SCREENHELLO_COMPRESSION_ENGINE` 可缩小正确性/基准引擎范围；完整结论必须覆盖三引擎。离线/library 验证自动启动并关闭自己的临时 loopback 静态源。所有命令都不执行发布。

## 后续边界

C1 才把 codec、参数模型和可取消任务接进实例级导出内核，复用既有结果校验/平台保存保护，按格式按需加载；不可直接把实验聚合 client 当作生产服务。正式渲染就绪/失效、偏好成功提交、UI、存档和批量分别属于 C1～C3。当前质量档位在不同浏览器的实际编码语义也需该阶段端到端锁定。

本阶段不修改 `config/public-export-manifest.json` 晋级清单，不公开 npm API，不推送或发布。新实验/测试/维护文档的公开选择在后续清理与 C4 单独审查。真实最低浏览器、Apple Safari、桌面 WebView、新候选发布矩阵及 C4 完整产品验收尚未执行。

接口与上游来源：[jSquash Oxipng](https://github.com/jamsinclair/jSquash/tree/main/packages/oxipng)、[UPNG](https://github.com/photopea/UPNG.js)、[Google WebP 编码选项](https://developers.google.com/speed/webp/docs/cwebp)；实际实现判断以锁定包、固定转换及本地编码证据为准。
