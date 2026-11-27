# 导出压缩 C4：产品链路与候选复验

> 本页为 C4 历史验收。后续下载/预览预算拆分见 [大图压缩下载修复](./compression-download.md)，不修改下文既有压力测量结果。
C4 Web 本地开发与 review/fix 完成（2026-09-07）；本页只记录实际本地证据，不代表公开发布、最低浏览器或原生桌面 Gate。上阶段实现见 [C3](./export-compression-c3.md)。

C4 当时新增压缩/完整预览上限为 **1,048,576 像素（1024×1024）**，单边 8192 不变。标准直接导出的原 16 MP / AVIF 4 MP 上限不变；不自动降倍率或用低清代理冒充完整预览。C0～C3 的 2 MP 限制是历史快照。

## 本阶段检查

- 真实 App / ExportPanel / Worker 的生产构建，而非 C0 的替代编码器；完整预览、100% 切侧、关闭后资源、最大尺寸连续六次与双实例分开记录。
- 近似 Linux 浏览器进程树 RSS 包含全部线程子进程，50 ms 采样。384 MiB 是单操作 review 线，不是浏览器可执行配额或两个实例的总额度；不使用强制 GC 取得通过结果。
- 公开代码的配置、测试、维护文档、素材许可和构建依赖闭包；正式导出仍要求 clean commit，本地未提交副本明确不可发布，不能自动晋级。
- 当前三引擎、production PWA、子路径/CSP、library consumer、桌面前端与格式校验；无新的远端或真实 Safari 证据时保持独立待验。

## 当前发现

首轮 2048×1024 正式预览在 Chromium 六组 × 六次均完成，但累计峰值 RSS 增量 450～549 MiB，超过审查线；应用 owned Canvas/context/prepared 引用归零不等于 RSS 立即回收。延长旧路径到 24 次后，后半段 RSS 趋于平台，但峰值仍达约 890 MiB 增量，不认定为已证明的永久泄漏，也不因此放行。

已修复/调整：

- 预览校验用 `ImageBitmap.close()` 显式释放图形资源，显示端仅保留一个 Canvas，切侧/关闭时将尺寸归零；取消后迟到的位图仍关闭。能力缺失时保留 HTMLImage/URL 回退。展示不改变下载 Blob，原同 Blob 下载回归仍保留。
- 试验过 GPU 默认 2D 与 bitmaprenderer；后者在部分引擎增加驻留，未采用。最终 2D 请求 `willReadFrequently` 的 CPU-backed 提示，不能把提示当作浏览器强制配额。WebP Worker 保温 5 s 后回收，避免快速预览反复初始化；取消、错误和卸载立即终止。
- 上述修改后 2 MP WebKit/WebP 仍出现约 393 MiB 超线；1.5 MP 全矩阵仍有一组 388.4 MiB。不提高 384 MiB 门槛，按计划将新模式/完整预览收紧到 1 MP。最终两轮各 18 组复验通过，最大增量分别为 366.1 / 366.8 MiB；第二轮含最后的 Bitmap 取消微任务所有权修复。失败和各试验 JSON 保留在本地证据目录，不以一次低值覆盖结论。
- ZIP 保存增加实例级交付互斥，平台保存 Promise 未结束时，重复保存、选图/风格变更、清空/重启、替换项目与 PWA 更新被阻止；系统取消或保存失败可以重试原 ZIP，卸载后迟到失败不再提示。浏览器 anchor 回退只能确认已交给下载机制，不等同最终落盘，也不能观察下载管理器后续取消。
- 修复公开 allowlist 的新配置/codec 审计/单测/维护文档/素材闭包；CI 双构建后执行 `audit:compression`。本地未提交副本独立标记不可发布、默认审计拒绝；正式 clean-commit 导出规则不变。输出目标先解析父级真实路径，阻止 symlink 逃逸；已有目录拒绝覆盖。
- 公开内容审计接受确实包含导出文件的 Markdown 目录链接。C0 测试改用真实包解析，不硬编码 pnpm 安装路径；二阶段 consumer 用显式生成库别名，不误把生成物当作已提交源文件。

位图所有权按 [WHATWG Canvas/ImageBitmap 规范](https://html.spec.whatwg.org/multipage/canvas.html#the-imagebitmaprenderingcontext-interface) 与 [ImageBitmap.close](https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmap) 复核，仍以各引擎实测为准。

## 可复现入口

```bash
pnpm test:compression:build
pnpm test:compression:stress
SCREENHELLO_COMPRESSION_PAIR=1 pnpm test:compression:stress
node tests/compression-product/verify-lifecycle.mjs
SCREENHELLO_BASE_PATH=/screenhello/ pnpm exec vite build --outDir artifacts/compression-subpath
node tests/compression-product/verify-deployment.mjs
pnpm build
pnpm build:lib
pnpm audit:compression
```

压力入口位于 [tests/compression-product](../tests/compression-product/)，生成物和结果写入忽略的 artifacts 目录；默认不进入日常 E2E。可用 `SCREENHELLO_COMPRESSION_ENGINE`、`SCREENHELLO_COMPRESSION_MODE`、`SCREENHELLO_COMPRESSION_REPEAT`（6～24）、`SCREENHELLO_COMPRESSION_LABEL` 缩小诊断范围并区分结果，正式复验仍需全矩阵。运行压力时不要重建同一产物目录。实现采用 [Playwright BrowserServer](https://playwright.dev/docs/api/class-browserserver) 的进程句柄，不把 Node 自身 RSS 当作浏览器内存。

## 最终压力与生命周期证据

环境为 Linux arm64、16 CPU，当前 Chromium 151.0.7922.34 / Firefox 153.0 / WebKit 26.5。单实例使用 1024×1024 的截图（含文字/1 px 线）与确定性噪声，PNG 无损、PNG 有损及 WebP 无损分别连续六次完整 UI 预览，包含编码、双侧顺序校验、100% 切侧和关闭。首次冷加载与后续热循环分别保留耗时采样，不重建测试中的产物。

| 引擎 | 六组单实例最大 RSS 增量 | 六次双实例合计增量 | 12 张批量与 ZIP 下载增量 |
| --- | ---: | ---: | ---: |
| Chromium | 279.7 MiB | 240.6 MiB | 280.5 MiB |
| Firefox | 295.9 MiB | 123.8 MiB | 159.1 MiB |
| WebKit | 366.8 MiB | 171.6 MiB | 599.1 MiB |

- 最终单实例矩阵 18/18 组 × 6 次通过 384 MiB review 线。双实例是两个真实 runtime 同时 prepare/validate/release，不声称同时渲染两个可见预览；批量串行保留 12 份输出再打 ZIP。两种工作负载独立记录，**不能宣称整批内存也低于 384 MiB**，或以双实例低值外推任意实例数。
- 三引擎各六轮真实 PNG Worker 计算中取消、立即终止和重新编码通过；随后各 12 张最大尺寸批量、真实下载流、ZIP 条目/尺寸/字节检查通过。三组图片合计约 21.66～21.78 MiB，ZIP 约 21.66～21.78 MiB，仍受原有 96 / 97 MiB 文件字节预算保护；文件字节预算不是 RSS 配额。
- 结束后两实例的 Canvas leases、导出 contexts、prepared/busy、Worker 均释放；批量的自有 URL、隐藏渲染根也归零。无外部请求、无 pageerror；资源引用归零不表示浏览器 RSS 立即回到基线。
- 最终 JSON：`benchmark-1024x1024-c4-reviewed.json`、`benchmark-1024x1024-pair-c4-final.json`、`lifecycle.json`，位于本地忽略的 `artifacts/compression-product-evidence/`。RSS 为进程树近似值，可能重复计算共享驻留页，不是每个对象的精确分配量或所有设备保证。

## 自动化与部署验证

- 最后源码 lint/typecheck 与 **42 files / 417 unit** 通过。真实 PNG palette/tRNS 样本经独立解码后走现有 desktopPlatform 的 image-png / token / raw-byte 保存契约，字节不变、未增加 IPC；该项使用平台 stub，不证明真实 OS 文件系统原子性。
- 1 MP + 最后 Bitmap 修复的隔离副本通过全部 **18 个 Web clean-room 命令**：严格锁文件/peer 安装、ignored-builds、low audit、许可、lint/typecheck、unit、i18n、完整当前三引擎 E2E **199 passed / 20 expected skipped**、Web/PWA 构建与审计、PWA **8/8**、current release **9/9**、library 构建/边界、codec、consumer development/production 各 **6/6** 和 size。Web scope 不含另外五个 Rust/原生桌面命令；当前引擎 release smoke 不是最低浏览器 Gate。
- 全量隔离检查后仅补两处测试边界/原生 PNG 契约、批量测量脚本与维护文档，不改变已验产品字节；最终副本另做差异、内容与 unit 检查。副本明确 `sourcePolicy=local-worktree-preview`、`releaseReady=false`，不含私有计划/AI 过程记录。没有正式导出、提交、推送或发布。
- low audit 无已知漏洞，ignored-builds 无遗漏，许可审计通过；七语静态审计 598 键、无缺失/占位符错误。保留 PWA 核心 3 MiB、codec 按需加载及原有资源预算，未通过放宽阈值处理构建警告。
- 最后产品子路径 `/screenhello/` + 严格 CSP 三引擎专项通过：真正拒绝源站请求，冷未缓存失败可见；联网重载后预热，源站再次不可用时冷重载仍可完成 PNG 无损/有损、WebP 无损预览和下载；两个 WASM 已缓存，无跨子路径/外部请求、pageerror 或 CSP 违规。缺失 lazy module 的恢复需重载新模块环境，不承诺失败 import 在同一页面自动恢复。
- C0 二阶段 library/consumer 的生成库别名复验在三个引擎通过；这只补构建资产闭包，产品性能仍以上述正式 App 数据为准。

测试方法修正也保留记录：WebKit 模拟 offline 曾触发 internal navigation error，改用真正 origin unavailable；批量测试曾将整份 ZIP 转为数字数组送出浏览器，造成额外分配，现改为真实下载流，旧读数不作为产品证据。命令接口名、Bitmap/HTMLImage 双路径拦截、Window API 接收者和草稿恢复竞态均按真实契约修复夹具，未删除失败场景或放宽断言。透明边缘展示比较使用双方独立浏览器解码，避免将 PNG straight-alpha 原始字节与 Canvas 预乘结果混比；源码 codec 的独立 RGBA 校验及同 Blob 字节交付断言仍保留。

## 仍需独立验收的边界

- 本轮未运行原生 amd64 最低 Chrome/Edge 111、Firefox 128 或真实 Apple Safari；当前三引擎不能代替它们，历史 SHA 的远端 Gate 不转移到本次修改。
- **桌面 WASM 已进入候选 Gate，尚无远端支持证据**：Tauri CSP 的两个 `script-src` 已只增加 `wasm-unsafe-eval`，三个 codec Worker 共享同协议、同 host 的 URL 校验，显式支持 `tauri://localhost` 和 `http://tauri.localhost`，并拒绝 asset/file/data、跨 host 和跨端口资源。真实 Tauri WebView smoke 直接编码 AVIF/WebP/PNG，生产构建还审计三份 Worker/WASM 资产；详情见[跨平台桌面 Phase 3](./desktop-cross-platform-phase-3.md)。这仍不能替代六个 OS×架构 candidate 的远端 runtime、安装或签名证据，也不能开放任意协议或 `unsafe-eval` 来掩盖失败。
- 本地 Web C4 完成不代表桌面、应用商店、签名、公证、远端候选或正式发布放行。下一步应先验收 Web 使用体验和候选浏览器，再进入独立桌面适配门。
