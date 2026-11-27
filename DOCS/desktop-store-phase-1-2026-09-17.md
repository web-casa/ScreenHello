# 商店适配第一阶段：桌面标识与隐私边界

日期：2026-09-17。延续 [上架调研](./desktop-store-readiness-research-2026-09-17.md)。本轮是第一阶段的代码与草案交付，完整政策发布、原生外链与商店材料尚未完成。

## 实现与 review

- 平台适配器增加可选 `kind`，浏览器为 browser、桌面为 desktop。帮助中心从当前 runtime 读取，未引入模块级业务单例或浏览器全局 Tauri 猜测；旧自定义适配器未提供该字段时保留原有 Web 行为。
- 桌面关于窗口显示 ScreenHello Desktop；隐私及恢复说明改为本地应用数据，不再要求桌面用户清理浏览器站点数据。
- 桌面隐私浮层和帮助计数明确监测仅覆盖编辑页面，不能代表原生进程、系统或 WebView 全部流量。帮助中补充 Windows WebView2 诊断/安全检查说明，不推定图片已上传。
- 三个新增文案键补齐英文、繁体中文、德语、韩语、西班牙语、葡萄牙语；简体中文使用原始键。保留 Web 与公共组件的原有默认行为。
- 新增 [桌面隐私政策草案](./desktop-privacy-policy-draft.md)，明确真实联系人、删除路径实测、公开 URL 与最终网络证据仍待补齐，不将草案冒充生效政策。

## 验证

- `pnpm lint`、`pnpm typecheck`：通过。
- `pnpm audit:i18n`：650 个键，缺失/占位符问题均为零。
- `vitest run tests/unit/desktopPlatform.test.js tests/unit/privacyMonitor.test.js`：40 项通过。
- `pnpm build`、`pnpm desktop:web:build`：通过；构建有既存的大 chunk 提示。
- 测试首次启动失败：与站点构建同时触发文档生成，产生 `ERR_MODULE_NOT_FOUND`（文档 prerender 临时 chunk）；停止并发后串行重跑通过。这是此次执行调度问题，不把首次失败隐去。
- 未运行真实 macOS/Windows GUI、安装、外链、原生联网或商店上传验收。未改公共库入口或 CSS，未运行 consumer。

## 第一阶段尚待完成

运营主体和隐私支持联系方式已向维护者询问，未收到前不编造。收到后完善完整政策、多语言与正式 URL，再落实受限的原生浏览器打开入口并做系统验收。商店语言、最低系统和素材权利仍须确认；后续沙箱文件和截图迁移见调研中的顺序。本轮没有生成新的 DMG/MSIX、推送或发布。

后续进展：受限原生浏览器入口已在[第二阶段](./desktop-store-phase-2-2026-09-17.md)实现，实际安装包打开行为仍待验收。
