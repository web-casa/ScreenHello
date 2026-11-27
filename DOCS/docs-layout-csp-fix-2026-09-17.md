# 文档页面错位：生产 CSP 修复

日期：2026-09-17。状态：本地修复、构建回归与官网部署后验证通过。

## 复现与原因

在真实 https://screenhello.com/docs/zh-cn/privacy/ 上，用 Chromium 1440×1000 复现侧栏偏到右侧并遮挡正文。浏览器多次报告 `Applying inline style violates ... Content Security Policy`；侧栏的边界为 x=270、width=1170，正文从 x=405 开始，两者重叠。

`docs-site/src/lib/csp.mjs` 把静态 style 标签和属性的 hash 都写入 `style-src`，但没有属性 hash 所需的 `unsafe-hashes`。Fumadocs 的根网格通过内联 style 定义，因而布局被浏览器拒绝；组件 hydration 后新增的样式也不在静态 hash 清单中。只补 `unsafe-hashes` 不能完整覆盖运行时样式。

原单测验证“hash 存在”，却没有证明浏览器实际接受样式。大部分交互测试运行在 Vite preview 下，未执行 Cloudflare `_headers`；唯一带 CSP 的搜索测试未断言控制台错误、侧栏与正文的几何关系。这使页面可见性和构建检查通过，但线上布局仍错误。

## 修复

- 仅对文档路由使用 `style-src 'self' 'unsafe-inline'`，允许组件内联样式；不混合样式 hash，避免浏览器忽略 `unsafe-inline`。
- 可执行脚本继续使用同源及构建期 hash 白名单；其他资源、连接和 frame 限制保持原策略。这是明确允许内联 CSS 的取舍，不声称与原样式限制同等严格。
- 构建后处理和 SEO 审计同步区分脚本与样式；静态样式清单仍作产物一致性检查。
- 文档交互测试统一注入生成的生产 CSP，新增 390/1440 宽度隐私页遮挡、溢出、搜索及控制台检查；新增未授权内联脚本必须被拦截的浏览器反向用例。

## 验证

- `pnpm build`：通过，包含 42 页文档。首次执行被旧的 `docs-csp-unsafe-inline` 全指令检查阻断；同步脚本/样式策略检查后重新构建通过。
- `pnpm lint`：通过。
- `pnpm exec vitest run tests/unit/docsSite.test.js tests/unit/docsSearch.test.js tests/unit/seo.test.js`：48 项通过。
- `pnpm exec playwright test --config playwright.pwa.config.js tests/pwa/docs-usability.spec.js`：15 项通过，覆盖七语言搜索、明暗主题、桌面/移动布局、离线搜索及脚本拦截。
- `node scripts/audit-seo-build.mjs`：42 页检查通过。
- 修复前截图：`artifacts/privacy-layout/live-desktop.png`；修复后截图位于 `artifacts/pwa-playwright/docs-usability-privacy-*/`。

本轮浏览器测试为当前 Chromium，不代表真实 Safari、最低版本浏览器或正式域名已修复。部署采用线上基线的隔离工作树，见下方记录；主工作树与 GitHub 分支未推送。隐私页面内容仍以 Web 说明为主，桌面政策补齐是另一项未完成工作。


## 官网部署记录

- Cloudflare Pages 项目：`screenhello-preview`，生产分支 `main`，正式域名 `https://screenhello.com`。
- 先前生产部署：`55689f3d-c207-4826-ab0f-7089f31a6e4c`，基线 `d7b730c5c1af027947377b1010ad830d74b83099`。
- 隔离工作树：`/tmp/screenhello-docs-csp-deploy-20260917`。该基线使用 `docs/`，所以将当前 `docs-site/` 修复映射回对应目录，只包含 CSP 生成、审计与测试变更。
- 本地部署提交：`562fe10c06f3502ac761730dd451f7e6f8da4f8d`；补齐移动搜索定位与 hydration 等待后的提交为 `f4abe2da24e2e3aeac148ab718ee1910631b8238`。未推送远端。
- 预览：https://e8c81189.screenhello-preview.pages.dev 。通过实际响应头的布局与搜索检查后发布生产。
- 新生产部署：https://a4f4a668.screenhello-preview.pages.dev ，已映射正式域名。Wrangler 上传 0 个新增静态文件（294 个全部已存在），更新 `_headers` / `_redirects`；编辑器首页、Service Worker 和隐私页 HTML 在发布前与旧生产逐字节一致。
- 隔离构建、lint、48 项单测、42 页 SEO 审计与 15 项浏览器检查通过。依赖复用本地已安装版本，未改变锁文件；最终静态文件全部命中 Cloudflare 现有资源。
- 真实预览验证时发现移动搜索选择器匹配两处节点，以及初始化前点击不响应的测试时序问题；已限定 `#nd-subnav [data-search]` 并等待 Astro hydration 后再操作，重新通过测试。
- 正式域名验证：390/1440 宽度正文无遮挡、无横向溢出、搜索结果可用、控制台零错误，七语言隐私页全部 HTTP 200 且收到修复后的 CSP。
- 发布后再次确认编辑器首页和 Service Worker 与先前生产一致。证据：`artifacts/privacy-layout/production-verification.json`、`production-editor-integrity.json`、`production-390.png`、`production-1440.png`。

本次只部署布局修复，不包含主工作树中尚未发布的桌面、商店开发或桌面隐私政策草案。
