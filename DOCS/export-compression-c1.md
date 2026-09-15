# 导出压缩 C1：内核与状态契约

> 本页保留 C1 历史实现与测试。当前本地下载/预览独立预算见 [大图压缩下载修复](./compression-download.md)；C4 的历史压力与解码生命周期证据仍见 [C4](./export-compression-c4.md)。

> 以下保留 C1 退出时的历史证据；后续压缩与预览界面见 [C2](./export-compression-c2.md)，不能把本页测试数当作当前候选结果。

2026-09-06。C1 内核开发和本地 review/fix 完成。**尚未开放压缩选项和预览界面（C2），不是发布 Gate。** C0 实验结论见 [技术验证](./export-compression-c0.md)。公共 `ImageBeautifier` props、库入口和默认导出质量没有改变。

## 已实现

- [设置契约](../src/utils/exportSettings.js)：旧 standard 继续序列化为 `{format, ratio}`；显式非标准设置才带 `compression`、`quality` 或 `paletteColors`。运行时拒绝非法组合、非整数质量和不支持的颜色数；读档保留可读图片/图层，将非法压缩设置恢复为标准导出。项目、风格预设与本地 workspace 已接通字段；完整兼容警告与批量重试快照验收仍属 C3。
- [实例级内核](../src/stores/exportService.js)：PNG 无损优化、PNG 256/128/64 色有损量化、WebP 真无损，以及 JPG/WebP/AVIF 有损质量。PNG 无损优化后不更小时保留原标准 PNG，报告 `noGain`；有损结果更大时如实保留负节省量，不伪装成更小。
- 压缩与完整预览从同一次完整画面捕获生成标准参照与输出，保留标注、区域效果、多图片、水印及外框；PNG 保留透明度，JPG/WebP 继续白底。复制图片独立走标准 PNG，不继承压缩参数。
- [绘制追踪](../src/stores/renderTaskTracker.js)：内容版本与绘制版本分离，先提交文字/几何编辑并刷新防抖任务，等待 React 效果、HDR、背景模糊、底图/区域变体和 Leafer 绘制收敛，再冻结输出。内容改变不无限追赶；冻结后节点绘制改变、项目替换或相关实例失活会拒绝过期交付。
- 底图快照临时隐藏标注的操作与最终捕获互斥；它不是最终导出树的替代品。HDR/背景模糊回退明确记录警告；区域效果失败会阻止导出，以免遗漏遮挡。
- `prepareImage` / `downloadPreparedImage` 是内部服务契约：实例持有不可伪造的对象 token，结果与设置只读，下载使用同一个 Blob，不接受外部替换的 Blob。改变内容/设置时拒绝旧结果；成功后消费 token，系统取消或保存失败后仅在结果仍有效时保留重试。
- 命令显式冻结本次设置，平台成功交付后才写回同一份偏好；取消、失败和已卸载实例不写回，不调用 `markClean`。导出设置改变仍使项目变脏。浏览器的“成功”仅指交给下载机制，不能保证用户最终落盘。
- 平台保存开始后进入 `handing-off`，一直忙到平台 Promise 结束。取消按钮、关闭、项目替换和 PWA 更新不声称能撤回已开始的写入；强制卸载仍可能完成系统写入，但不再提交晚到偏好或通知。

## 限制与加载

| 路径 | 像素上限 | 质量/参数 |
| --- | --- | --- |
| 标准 PNG/JPG/WebP | 16,777,216 | 原默认不变；JPG/WebP 90 |
| 标准 AVIF | 4,194,304 | 原默认 60 |
| 新压缩模式或完整预览 | 2,097,152 | PNG 颜色数 256/128/64；有损质量整数 1～100 |

全部路径单边不超过 8192。新模式编码阶段总超时 30 秒，就绪等待 10 秒；不自动缩尺寸、不擅自降倍率。不可取消的底层捕获必须由队列继续持有到返回，不能在取消时假装资源已经释放。

- Oxipng 固定 `@jsquash/oxipng@2.3.0` scalar，level 2、interlace=false、optimiseAlpha=false。只打包约 164 KB 的单线程 WASM。
- UPNG 固定 `upng-js@2.1.0` 与实际 `pako@1.0.11`；[构建转换](../config/upngCodecPlugin.mjs) 保留 C0 的两项固定 SHA 修复，覆盖 production Worker 和 Vite 8 development dependency optimizer。源码漂移拒绝构建，不添加全局 `window/require` shim。
- WebP 真无损固定 `lossless=1`、`near_lossless=100`、`exact=1`、`thread_level=0`；quality=80 只作为此分支的编码 effort。AVIF 仍使用已有 scalar 参数，其 alpha 设置不变。
- Worker/WASM 按需加载，空闲约 1 秒回收；PNG codec 不进入 PWA 预缓存。共享 `exportSettings`/`exportAsync` 静态模块加入核心离线缓存，codec 首次使用后由同源运行时缓存保存。`pngjs` 只用于测试，不打包到产品。

## Review 与修复

1. 发现旧命令在保存之前提交偏好：改为显式请求和成功后的完整替换，补取消、失败、重复提交与 dirty 回归。
2. 发现异步效果/底图临时隐藏可污染捕获：增加普通 runtime tracker、paint/content 版本、可清理的 flusher、任务等待与捕获互斥；底图变体同时校验快照身份和任务代际。
3. 首次开发服务器测试全部 PNG Worker 失败：生产构建转换不能替代 CJS 开发预构建。改为在 Vite 8 `optimizeDeps.rolldownOptions.plugins` 使用同一固定源码转换，并显式预构建 UPNG；三引擎真实测试复验。
4. 发现共享模块被拆成新 chunk 后未列入 PWA shell：补核心清单并验证冷启动离线；没有把 codec/WASM 全部提前缓存。
5. Review 补上只读预览结果、跨实例 token 拒绝、失活/paint 过期、晚到 Worker 响应和系统取消后的有效 Blob 重试，避免任意 Blob 注入和错误消费会话。
6. 全量回归发现此前 Ambient Shelf/主题语言改动未更新旧首屏 golden。人工对照新旧图后只同步该截图基准，不改已选设计。首次失败记录不作为通过证据。

## 验证

标准环境：Node 24.18.0、pnpm 10.12.1；当前本机浏览器引擎测试，不等于 Chrome/Edge 111、Firefox 128 或 Safari 16.4 最低版本验收。

| 验证 | 本轮结果 |
| --- | --- |
| lint / typecheck | 通过，lint 0 error / 0 warning |
| 全量 unit | 38 files / 347 tests passed |
| 全量当前三引擎 E2E | 160 passed / 20 按既有引擎或重型基准条件 skipped |
| 最后请求快照/清理修复后的 C1 专项 E2E | 9 passed，透明/白底、真实编码、完整效果、同 Blob、双实例 |
| Web / library 构建 | 通过；保留既有大 chunk 提示，不宣称零警告构建 |
| 清洁 tarball consumer | development 5/5、production preview 5/5；含经真实项目 UI 触发的生产 PNG Worker |
| PWA | 8/8；新增 PNG 按需加载、清空 HTTP cache 后冷离线重开与压缩 |
| PWA / library / compression 资产审计 | 通过；25 个核心预缓存条目，约 2.92 MB，PNG codec 不预缓存 |
| i18n | 549 个静态键，无缺失或占位符错误 |
| 依赖与许可 | low audit 无已知漏洞；既有许可审计与 unit 中精确 codec notice 核对通过 |
| desktop:web:build | 通过；只验证桌面 Web bundle，不等于原生运行/保存验收 |

全量 E2E 完成后对最后的小范围请求复制/清理修复再次运行 C1 专项、unit、构建与消费/离线检查。修复包括避免调用方晚改请求影响结果、清理失败作为 `releaseCause` 保留而不覆盖主要编码错误；lint 指出 finally 不应抛错后，统一在清理结束后返回或抛错。没有据此宣称最低版本或原生桌面验证。复现命令：

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
SCREENHELLO_E2E_PORT=4189 pnpm test:e2e
pnpm build
pnpm build:lib
pnpm test:consumer
pnpm test:pwa
pnpm audit:pwa
pnpm audit:pwa:library
node scripts/audit-compression-build.mjs
pnpm audit:licenses
pnpm audit --audit-level=low
```

本阶段不重新声明 C0 的 RSS 数字为新候选性能保证；新 UI/批量整体压力和真实最低浏览器、Apple Safari、原生桌面文件保存/资源协议仍须后续阶段验收。没有提交、推送、公开晋级、npm 发布或桌面发行。

下一阶段 C2：在现有导出抽屉加入模式、PNG 色数/有损质量与手动压缩预览，消费本阶段 token/同 Blob 交付接口，并完成七语言、深浅主题、窄屏、焦点和取消交互验收。
