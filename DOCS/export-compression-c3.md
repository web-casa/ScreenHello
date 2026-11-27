# 导出压缩 C3：存档与批量贯通

> 本页保留 C3 历史实现与测试。当前本地下载/预览独立预算见 [大图压缩下载修复](./compression-download.md)；C4 的历史压力与解码生命周期证据仍见 [C4](./export-compression-c4.md)。

2026-09-06。C3 本地开发、review/fix 与最终回归已完成；验证结果只记录本轮实际执行内容。C4 全链路压力/公开清单及发布 Gate 不属于本阶段。单图交互与原有上限见 [C2](./export-compression-c2.md)。

## 当前行为

- `.screenhello` 项目、最近项目和风格预设保留完整压缩模式、PNG 色数及有损质量；预设复制、重命名、导入/导出和应用都复用既有通路。不修改 ProjectDocument/容器版本，不扩张自动草稿格式；自动草稿仍不是压缩偏好的备份。
- 缺压缩字段的旧存档使用标准导出，不从孤立 quality 猜测用户同意有损。非法/未知的显式压缩设置（含 null、越界参数和错误格式组合）回退标准并提示，保留可读图片与图层。项目读取、预设导入/应用和批量预设快照都保留兼容警告。
- 开始批次捕获当前已确认设置，或解析所选本地预设；完整 option JSON 深冻结，背景只持有不可变 Blob，不保留活动 runtime 的 asset ID/URL。同时固定开始时的主题，使受 Light/Dark 影响的画框描边在隔离 renderer 中一致；主题仅属于内部批次快照，不写入项目/预设格式。背景解码及隔离 renderer 初始化成功后才建立可重试快照，失败/超时需修正来源并重新开始批次。读取风格限 10 秒，取消/晚到回调不生成新快照。
- 失败/取消项重试只读取本批次快照；修改当前设置、切换/删除预设、释放原背景 URL 都不会改变重试结果。新 start、重新选文件、清空或 dispose 释放旧快照引用；服务用 WeakSet 拒绝其他服务签发的快照，不增加公共 API 或单例。
- 每次最多 12 张，串行渲染，逐项显示真实字节；汇总分别显示成功图片总字节与 ZIP 字节。重试前提示先下载需保留的旧 ZIP，新 ZIP 只包含本次重试成功项，不自动合并旧 ZIP。零成功不生成空 ZIP；96 MiB 图片 / 97 MiB ZIP 预算不变。
- 批量完整透传压缩参数。除 PNG 无损必须先编码标准 PNG 供优化/无收益比较外，独立批量压缩不生成额外对比基线、不缓存每项预览，也不外推单图节省比例。新压缩仍限 2,097,152 像素；既有标准导出和剪贴板默认不变。
- 隔离 target 的就绪由 BatchRenderSession 管理，不订阅活动画布的内容版本；活动画布变化不错误取消独立目标。仍共享所属 runtime 的 ExportService 串行队列，保留任务取消、runtime dispose 和 Canvas 回收；不是扩大并发。单图预览的版本校验不变。

主要落点：[BatchStore](../src/stores/batchStore.js)、[批量服务/风格解析](../src/stores/batchExportService.js)、[批量面板](../src/components/batch/BatchExportPanel.jsx)、[设置兼容](../src/utils/exportSettings.js)、[预设验证](../src/utils/stylePreset.js)、[存档读取](../src/utils/workspaceArchive.js)。

## 方案 Review 与修复

1. 批量仅传 format/ratio，新增压缩配置被丢掉：改为传递冻结的完整合法设置。
2. 重试通过 start(files) 重读当前来源：拆出共同执行路径，保留同一批次快照/背景所有权；重试不清快照，新批次才清。初始化失败不冒充可重试，旧 job 清理错误不会残留到下一次成功。
3. 显式 target 错借活动画布 tracker：分离内容版本与捕获互斥，保持共享队列及销毁保护；单测与真实 12 张批次在编码期间改变活动画布验证。
4. 预设规范化先丢掉非法字段、无法提示回退：验证结果独立返回警告，文件导入/本地应用/批量冻结接回 UI；旧无字段文件无警告。
5. 批量重复编码本不需要的对比基线：非预览的隔离 target 仅编码所需输出；PNG 无损保留必要基线，真实字节统计不变。
6. 中文“清空”按钮自动插空格导致 accessible name 不稳定：明确 aria-label。批量面板携带实例主题 scope，长汇总和重试提示可换行；暗色旧失败 Tag 为 4.01:1、hover 主按钮为 4.13:1，局部配色修至满足 A/AA，不改变全局主题或放宽 axe。
7. 终审发现离屏 runtime 默认浅色，未继承当前画框描边主题：在 lazy service 加载前捕获开始时主题，预设和当前风格均携带，renderer 挂载前设置；重试仍复用原主题。补两条异步加载单测，真实 12 张测试在编码中切主题，并同时检查实际 Leafer 描边与重试后的解码像素。

## 最终验证记录

环境：Node 24.18.0、pnpm 10.12.1。以下均为最后主题修复后的实际结果，不继承 C2 数字。

| 检查 | 结果 |
| --- | --- |
| lint / typecheck | 通过；lint 0 warning |
| unit | 42 files / 400 tests passed |
| 当前 Chromium / Firefox / WebKit 全量 | 193 passed / 20 既有条件跳过，含 C3 15/15；最后补修的 12 张专项另 3/3 |
| Web / library 构建 | 均通过 |
| 清洁 library consumer | development 6/6、production 6/6，包含双实例与真实批量 ZIP |
| production PWA | 8/8，包含预览及批量 codec 冷离线再次使用 |
| i18n / PWA / codec / size / license | 通过；七语 598 静态键无缺失/占位符错误 |
| low audit | No known vulnerabilities found |

本轮回归新增：项目/最近项目/预设完整往返、旧可选偏好投影与坏参数、取消/晚到预设、原背景 URL 失效、跨服务快照拒绝、12 项混合输出与仅重试两项、真实四格式解码/像素倍率、七语深浅窄屏。旧偏好投影是自动化兼容模型，不代表运行了一个完整旧版应用。

最新构建的 Web entry 为 898,226 B / gzip 278,783 B，library package entry 为 348,797 B / gzip 91,027 B，最大 library chunk 为 1,114,492 B；均通过既有体积门限。PWA precache 25 entries / 2,958,130 B，低于 3 MiB；PNG codec 仍按需缓存，不进入首屏预缓存。三份 WASM 的精确预算和 UPNG 源码哈希审计通过。Vite 仍提示部分 chunk 大于 500 kB，这是非阻断提示，不等于体积预算失败。

测试初期修正了夹具未声明 upload_image、Map 被当数组、pngjs 的 Buffer 类型及 evaluate 中的 bare module 解析；后续功能链路通过但“清空”定位失败，补按钮语义后通过。颜色问题来自真实 axe 证据，修复与复跑单独记录，不删除测试或扩展超时来放行。

复现命令（标准 Node 24 环境）：

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
SCREENHELLO_E2E_PORT=4189 pnpm test:e2e --workers=3
pnpm build
pnpm build:lib
pnpm test:consumer
pnpm test:pwa
pnpm audit:i18n
pnpm audit:pwa
pnpm audit:pwa:library
node scripts/audit-compression-build.mjs
pnpm size:report
pnpm audit:licenses
pnpm audit --audit-level=low
```

当前 Chromium/Firefox/WebKit 不代表最低版本 Chrome/Edge 111、Firefox 128 或真实 Safari。未重跑 C0 RSS 压力；原生桌面保存/截图、最低浏览器与公开仓清洁晋级仍需各自后续证据。窄屏检查是 axe A/AA 与无溢出，不是全控件 44 px 触控目标审计。本轮未运行远端 CI，未提交/推送/发布，未更新 golden。

实现依据：[MobX observable.ref](https://mobx.js.org/api.html#observableref)、[异步 actions](https://mobx.js.org/actions.html#asynchronous-actions)；沿 React 指引在点击事件中启动工作、渲染时派生合计，不以 effect 自动启动重试。
