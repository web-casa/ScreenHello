# 导出压缩 C2：单图交互

> 本页保留 C2 历史实现与测试。当前本地下载/预览独立预算见 [大图压缩下载修复](./compression-download.md)；C4 的历史压力与解码生命周期证据仍见 [C4](./export-compression-c4.md)。

2026-09-06。C2 单图压缩设置、手动预览、本地回归与 review/fix 已完成。本页为 C2 退出时的历史证据，不代表发布 Gate；后续批量重试快照的实现与验证见 [C3](./export-compression-c3.md)。内核与限制见 [C1](./export-compression-c1.md)。

## 使用与实现

- 完整导出抽屉提供标准/无损/有损合法模式：PNG 最多 256/128/64 色，JPG/WebP/AVIF 高清/均衡/更小及整数质量。无损不显示质量滑块，AVIF/JPG 不提供伪无损。格式切换重置草案，不提前提交偏好；重按已选模式/档位不会重置参数或使有效预览失效。
- 标准默认、快捷键、剪贴板 PNG 不变。用户可以直接下载或手动预览，不自动编码，不用导入原图计算节省。有效预览经同 token 下载同 Blob，画面/参数变化时清除旧结果并显示显式重试/直接导出入口。
- 对比区切换同一完整快照的标准参照和真实输出，支持 100% 滚动、浅深棋盘底。只拥有一侧解码展示，不同时常驻两个大图片；基准与结果 Blob 只在实例临时会话持有，不存档。底色/100%/语言不重编码；主题若影响画布则按 C1 失效规则处理。
- PNG 展示真实节省、大小不变或增大，PNG 无损无收益时明确保留标准 PNG；其他格式展示两侧实际字节，不把有损标准作为无损收益承诺。摘要明确透明预处理，JPG/WebP 填白不变。
- UI 请求开启内部 `verifyPreview`：在 ExportService 队列里串行解码基准和结果，验证尺寸，每侧最多 10 秒。解码失败/取消/过期会释放 src/URL，不生成 ready；不能预览时保留显式直接导出路径，不用低清图冒充实际输出。PNG/压缩编码 30 秒、绘制等待 10 秒和约 2.1 MP 上限不变。
- preparing 可通过取消、Escape 或关闭退出，底层未完成清理前服务继续 busy；handing-off 禁止应用取消/关闭、项目替换和 PWA 立即更新，直到系统完成。系统取消/失败且内容仍有效时可重试同 Blob。强制卸载不再更新界面/偏好，但不承诺撤销已经开始的保存。
- `workspace=true` 的 library 消费者共用完整面板，默认 legacy 界面不改，未新增公开 props/API。全部自有新文案覆盖七语，质量标签使用实例 `useId()`，纯键盘/窄屏可操作；仍需母语人工校对。

主要落点：[ExportPanel](../src/components/sideBar/ExportPanel.jsx)、[会话 Hook](../src/hooks/useExportPreview.js)、[结果展示](../src/components/sideBar/ExportPreviewResult.jsx)、[有界解码/展示 lease](../src/utils/exportPreview.js)、[交付命令](../src/stores/commandService.js)。

## Review 与修复

1. 仅校验编码字节不足以保证浏览器可预览：解码验证放进同一个 busy 队列，失败、超时和取消均有 cleanup，AVIF 不支持时不伪造画质预览。
2. 旧 UI 晚到 cleanup 可能误清新结果：服务增加 token 身份校验；Hook 和下载回调用代际拒绝关闭/卸载后的响应，并通过单测锁定跨 token 清理。
3. 实测切侧有“图片尚未挂载但 aria-busy 已是 false”的窗口：加载状态改为当前已展示 Blob 的同步比较，保留切侧滚动位置，不以任意睡眠绕开测试。
4. Ant Design 两字中文按钮插空格导致质量档位名称不稳定：增加明确 aria-label。
5. WebKit 暗色 hover 的预览按钮出现 4.46:1 对比度，低于 4.5:1：普通按钮文字沿用主题正文色，抽屉显式携带实例主题 scope，辅助说明使用高对比 muted token，保留蓝色边界与选中状态，不放宽 axe 规则。进一步诊断确认快速切主题会在 0.01 ms 动画尚未结算时读到新背景/旧前景；测试等待实际动画结束后审查，而不是用固定睡眠或忽略对比度项。
6. 重按当前压缩模式会丢掉已选色数：忽略同模式和相同规范化设置，避免意外重置/无意义失效。
7. 旧体积脚本只接受两份 WASM，漏计已批准的 PNG codec：按原 C0 的 180 KB raw 上限增加精确 Oxipng 校验及 85 KB gzip 限制，增加缺失/重复/多余/非法/超限测试；其他预算不变。
8. 收尾 review 发现重复触发“打开导出”命令可把草案重置，却留下旧预览：已打开面板的打开动作改为幂等，不覆盖草案/焦点目标，补真实 UI 回归。

## 本地验证

标准环境 Node 24.18.0、pnpm 10.12.1。当前引擎结果不是 Chrome/Edge 111、Firefox 128 或 Safari 16.4 最低版本验收。

| 项目 | 实际结果 |
| --- | --- |
| unit | 40 files / 364 tests passed |
| lint/typecheck | 最后修复后复跑通过，lint 0 warning |
| Web/library 构建 | 已通过；原有 >500 KB chunk 提示保留 |
| i18n | 595 静态键，无缺失/占位符错误 |
| 清洁 consumer | development/production 各 6/6，含 C2 同 Blob、兄弟实例默认隔离和卸载 |
| 全量当前三引擎 E2E | 178 passed / 20 expected skipped；含 C1/C2 共 27/27，最后修复后完整复跑 |
| 七语 × 双主题 × 390 px | 三引擎 axe A/AA 与无横向溢出通过；WebKit 专项另连续 3/3 通过 |
| PWA | 8/8，含生产构建已缓存 codec 的冷离线真实预览、同字节下载 |
| 构建/资源审计 | Web/library PWA、codec 来源/按需产物、size report 均通过；精确三份 scalar WASM |
| 许可/依赖 | license audit 通过；low audit 无已知漏洞 |

Web entry 为 896,998 B / gzip 278,558 B；library package entry 为 350,889 B / gzip 91,701 B。Oxipng WASM 为 164,172 B / gzip 76,146 B，处于 C0 的 180 KB raw 和本轮明确的 85 KB gzip 上限内；其余两份 codec 与入口预算未放宽。

首次三引擎误用了 4190 端口，Firefox 阻止 restricted port，WebKit 无法导航；改为 4189 后才取得产品验证。未关闭浏览器安全限制，未放宽断言；此环境失败不计为产品通过。

首轮全量为 176 passed / 20 skipped / 2 failed：C2 WebKit 对比度/切主题时序问题按上文修复；另一条旧项目保存/菜单测试超时，独立重复 3/3 与最终全量均通过，未改无关业务或断言。PWA 首跑还遇到冷启动已自动恢复草稿、测试却只等待空首屏的问题；修正为接受这两条合法启动路径，不关闭自动恢复。20 项跳过仍为既有引擎限定/重型基准条件，不作为通过项。

复现命令：

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
pnpm audit:licenses
pnpm audit --audit-level=low
pnpm size:report
```

未复测 C0 RSS 压力、最低浏览器、真实 Apple Safari、原生桌面保存/协议或商店发行；这些不能继承历史候选结论。没有提交、推送、远端 CI、公开晋级或发布。

实现参考：[Ant Design Drawer 官方 API](https://ant.design/components/drawer)、[HTMLImageElement.decode](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode)。依安装版本核对 `focusable`/`mask.closable`，解码失败须与编码成功分开。
