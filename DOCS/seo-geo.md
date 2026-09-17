# SEO / GEO 与公开内容站

## 当前实现与地址

2026-09-13 迁移更新：公开内容站由手写生成器改为 **Fumadocs 静态站**（`docs-site/`，Astro + Fumadocs），地址整体移到 `/docs/{locale}/{topic}/`；旧的 `/{locale}/{topic}/` 全部 301 到新地址（`_redirects` 共 126 条，覆盖无尾斜杠、目录形式与 `index.html` 形式）。发布后应核验这些旧地址的重定向；Sitemap 仍为 43 个地址（根 + 42 页）。

根 `/` 保留原编辑器、安装入口和本地数据；没有迁移 IndexedDB、草稿或项目格式。欢迎页的“帮助”在新标签打开对应语言指南（`/docs/{locale}/guide/`），不丢弃当前编辑器。文档站只在 Web 构建启用，不进入 React library 或桌面产物。

内容按指南、美化、外框、压缩、隐私五个主题组织，首页为落地页；主题顺序与 URL 顺序解耦。侧栏使用本地化主题名，页尾统一使用上一篇／下一篇。当前语言的全文搜索在浏览器内运行，长文提供本页目录，首页和指南提供编辑器入口。

七语目录为 `/docs/en/`、`/docs/zh-cn/`、`/docs/zh-tw/`、`/docs/de/`、`/docs/ko/`、`/docs/es/`、`/docs/pt-pt/`。每语六页：目录首页，以及 `beautify/`、`frames/`、`compression/`、`guide/`、`privacy/`，共 42 页。所有页面有独立正文、面向搜索意图的 `seoTitle`、description、self canonical、同主题双向 hreflang 与英文 x-default；页面内的 H1 保留自然的编辑标题。根编辑器聚焦直接使用工具，文档首页聚焦功能、本地处理与隐私，避免两者争夺相同搜索意图。根编辑器不是这些产品页的语言副本，不加入它们的 hreflang 集合。

每页输出 Open Graph 与 Twitter 大图元数据，分享图使用同一份 1200×630 本地资源。七语内容源维护独立 `reviewed` 日期，页面正文显示该日期，WebPage JSON-LD 写入相同的 `dateModified`，sitemap 的 `lastmod` 也取自同一来源。日期只在正文、事实或链接发生有意义的复核后更新。每页正文末尾提供两个语境明确的相关主题链接，URL 使用相对路径，兼容根路径和子路径部署。

内容仍以 [七语源目录](../site/content/) 的 JSON 为唯一事实源（每个 section 为 `[标题, 正文]`，并可追加 H3／表格／引用子块）：[转换器](../scripts/build-docs-content.mjs) 在构建期生成 MDX（`--check` 可检测漂移），[Fumadocs 应用](../docs-site/astro.config.mjs) 渲染静态页面，[构建后处理](../docs-site/scripts/post-process.mjs) 再注入 hreflang、JSON-LD 与 sitemap/robots/llms.txt/404/`_headers`/`_redirects`。没有远程字体、分析脚本或自动语言跳转。进入编辑器的显式 `?lang=` 参数只接受七种受支持语言；无参数或无效值保持既有本机偏好。URL 参数不携带文件名、原图或项目内容。

**CSP**：Fumadocs 是客户端 React 应用，每页会输出 3 个内联 `<script>`（island loader、hydration runtime、主题初始化）、2 个内联 `<style>` 与若干 `style="…"` 属性。因此 `/docs/*` 不再沿用旧站的 `default-src 'none'; style-src 'self'`，改为**逐块 SHA-256 hash**（当前 3 + 2 + 10 个唯一 hash），**不使用 `unsafe-inline`**。后处理会校验每个页面的内联块都被 hash 覆盖，未覆盖即构建失败，避免依赖升级引入新内联内容后被浏览器静默拒绝。

其他产物包括 sitemap.xml、robots.txt、可选 llms.txt、404.html、Cloudflare Pages 格式的 `_headers` / `_redirects`。分享图为 1200×630 的自有 SVG 衍生 PNG，不使用第三方机身或网页截图。示意图明确标为示意，不表示第三方设备包已经获准公开。favicon 配置沿用 2026-09-12 的新品牌包。

## 内容与 GEO 原则

- 用明确的文字说明工作流程、隐私、项目与草稿区别、格式和压缩限制；不制造评分、用户数、压缩率或 AI 排名承诺。
- WebApplication / WebSite / WebPage / BreadcrumbList 与正文一致；不为了评分展示虚构评论，不假定 FAQ 富结果可用。
- 公开源代码链接统一指向正式 ScreenHello 仓库，上游署名保留 Shoteasy；代码与素材许可分开说明。
- 无损 PNG 不保证文件更小；质量 100 不等于真无损；WebP 透明区域填白。当前本地内容已同步独立预算：完整预览 1,048,576 像素、压缩下载 4,194,304 像素；此修复尚未部署，验证状态见 [大图压缩下载](./compression-download.md)。
- 桌面候选、浏览器扩展和未安装素材不能写成已发布功能。新增五语已提供完整正文，尚未经过母语校对；维护者发布前应审校术语与产品状态。
- llms.txt 是可选的公开页面目录，不是索引、推荐或 AI 引用保证，也不包含用户项目或开发记录。

## PWA 与静态页面

Workbox 的导航回退仅匹配 base 根和 index.html（允许查询参数）。其他页面不会回退成编辑器；42 页正文和分享素材不加入编辑器首次预缓存。内容页目前需要网络连接，不能把“编辑器离线已就绪”解释为全部帮助页或未用过素材也离线可用。

原先已经安装的 Service Worker 必须通过既有确认式更新激活后才能应用新规则。不强制 skipWaiting，不牺牲未保存项目换取立即生效。部署升级时应验证旧 worker → 新 worker 的更新流程。

Cloudflare Pages 的生成响应规则明确要求 `sw.js` 与 `manifest.webmanifest` 使用 `Cache-Control: public, no-cache, max-age=0, must-revalidate`，要求复用前验证，而非只依赖可能被域名层 Browser Cache TTL 提高的 max-age。所有 Pages 默认域名和部署别名通过主机规则返回 noindex；正式自定义域名的可收录页面不继承该主机规则。

正式上线实测：Pages 地址已返回该规则，正式域名的 manifest 也已生效，但 `screenhello.com/sw.js` 仍返回 `public, max-age=14400, must-revalidate`。这一域名层覆盖/缓存差异尚未解决；当前部署凭据访问该域名缓存设置、Cache Rules 和 Page Rules 均被拒绝，不能声称已核实具体覆盖规则。需拥有者检查域名缓存规则及 Browser Cache TTL，并复验 SW 响应。当前版本在线使用已验证，后续版本的更新时效不能仅凭本地 `_headers` 推定。

## 开发与验证

```bash
pnpm dev
pnpm build            # Vite 自动重建 docs 站并合并到 dist/docs
pnpm build:docs       # 只构建文档站（astro build + 后处理）
pnpm check:docs-content  # 校验生成的 MDX 与 site/content/*.json 一致
pnpm audit:seo
pnpm audit:pwa
pnpm test:pwa
pnpm build:lib
pnpm audit:pwa:library
pnpm test:consumer
```

`pnpm site:social` 使用已有 Playwright Chromium 将自有 SVG 渲染为 PNG，不下载外部素材。需要本地已安装 Playwright Chromium；字体来自生成环境，生成后需视觉 review，不作为跨 OS 字节完全一致的重建保证。

预览构建：

```bash
pnpm build:preview
SCREENHELLO_SITE_INDEXABLE=false pnpm audit:seo
```

预览产物的所有 HTML 带 noindex，`_headers` 也带 X-Robots-Tag；sitemap 为空，不要求 robots 阻断抓取，因为爬虫需要读取 noindex。Vite dev/preview 的响应始终带 noindex。预览保护不是访问控制；敏感部署必须另加访问认证。不要把 noindex 预览产物当正式发布包。

子路径与独立输出验证：

```bash
SCREENHELLO_BASE_PATH=/tools/screenhello/ pnpm exec vite build --outDir artifacts/seo-subpath
SCREENHELLO_BASE_PATH=/tools/screenhello/ SCREENHELLO_SEO_OUT_DIR=artifacts/seo-subpath pnpm audit:seo
SCREENHELLO_BASE_PATH=/tools/screenhello/ SCREENHELLO_PWA_OUT_DIR=artifacts/seo-subpath pnpm exec playwright test --config playwright.pwa.config.js tests/pwa/seo.spec.js
```

`SCREENHELLO_SITE_ORIGIN` 默认 https://screenhello.com，必须是无用户名、密码、路径、query 或 hash 的 HTTPS origin。base 只接受以 `/` 开始、结束的安全目录段。预览 origin 不能通过访问请求 Host 自动改变。

审计校验生成内容一致性、42 页 metadata/同主题互链、真实本地链接、43 项 sitemap、分享图尺寸、可执行内联脚本 CSP hash 覆盖及部署路径内的本地资源。CI 已接入 `audit:seo`；浏览器与 PWA 测试不等于最低历史浏览器或搜索收录验收。

## 正式上线需要拥有者完成

以下为运维验收清单，不代表本地开发已完成外部操作：

1. 确认新版正式部署来源，不能把当前旧线上站点与本地候选混为一谈。核对现有 Analytics 的保留/删除决定；本源码未增加分析 SDK。
2. 只部署 Web `dist`，不托管仓库源目录、用户项目或临时测试文件。不要添加把所有未知路由返回编辑器的全站 SPA rewrite。
3. Cloudflare Pages 可使用生成的 `_headers` / `_redirects` 与顶层 404.html；其他托管需配置等价规则。对 HTTP、www/apex、尾斜杠、index.html 变体做单跳规范化；该站点的正式域名是 https://screenhello.com。
4. HTTPS 正文页返回 200，未知页返回真实 404，sitemap 返回 XML MIME；检查 favicon、OG 图片、canonical 和 hreflang。子路径托管时，robots.txt 仍需在域名根路径发布，并指向子路径 sitemap；仅有子目录 robots 无法控制整站爬虫。
5. 编辑器保持原有 Worker/WASM/blob 所需 CSP；不要把内容页的严格 CSP 直接套到编辑器。SW 允许重新验证，哈希资源允许长期缓存；静态内容/CSS 使用重新验证缓存。
6. 在 Google Search Console 与 Bing Webmaster Tools 验证域名所有权（优先 DNS），提交 sitemap，检查 URL Inspection 的抓取与渲染结果。本站不写入不存在的验证 token，也不自动操作账号。
7. 检查 CDN/WAF 是否允许真实 Googlebot、Bingbot、OAI-SearchBot 等所选搜索机器人。按官方 IP/身份验证规则配置，不能只信 User-Agent，也不要关闭全部防护。robots 是偏好声明，不是防火墙。
8. 搜索用途与模型训练用途分别决策。默认 robots 沿用允许抓取，不擅自更改训练政策。如维护者决定拒绝 OpenAI 训练，可单独对 GPTBot 设置 Disallow，同时继续允许 OAI-SearchBot；不要把它们混为一个开关。
9. 用真实线上移动端检查 Core Web Vitals：LCP、INP、CLS 与静态页加载。没有足够现场数据时先记录实验室数据及条件，不伪装为线上用户指标。检查外部字体/脚本是否来自旧部署。
10. 持续观察收录、查询、点击、落地页、Bing AI 引用页和引用短语；记录日期和样本，不把一次问答出现品牌当成稳定排名。无需上传图片、项目内容、文件名或添加会话录制来做这项工作。

## 官方参考

- [Google：AI features](https://developers.google.com/search/docs/appearance/ai-features)
- [Google：JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [Google：多语言页面关联](https://developers.google.com/search/docs/specialty/international/localized-versions)
- [Google：软件应用结构化数据](https://developers.google.com/search/docs/appearance/structured-data/software-app)
- [OpenAI：搜索与训练机器人](https://developers.openai.com/api/docs/bots)
- [Bing：AI Performance](https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview)
- [Vite：插件接口](https://vite.dev/guide/api-plugin)
- [Workbox：导航路由](https://developer.chrome.com/docs/workbox/modules/workbox-routing)

## 本地验收记录

2026-09-13 本地验证：

| 检查 | 结果 |
| --- | --- |
| lint / typecheck | 通过 |
| 单元测试 | 67 files / 947 tests 通过 |
| 正式根路径与子路径 Web 构建 / SEO 审计 | 全部通过；42 页，sitemap 43 项且 43 项均有 `lastmod` |
| 根路径 SEO、文档交互与部署浏览器验收 | 26 项通过 |
| 子路径文档交互与部署浏览器验收 | 13 项通过 |
| 文档内容漂移检查 | 7 语种 × 6 主题，0 个 mismatch |
| library build / 边界审计 / consumer | 通过；consumer 开发 15、生产 15 |
| 桌面前端构建 | 通过；不代表原生安装、签名或桌面发布 |
| 体积与公开导出快照 | 通过；内容 CSS 3975 bytes，42 页正文 HTML 合计 347002 bytes；仅本地快照 |

Review 已修复开发 404 误拦素材模块、未知地址 SPA 回退、英语映射与 OG locale 等问题；未发现本轮仍待修复的 Critical/Important 代码问题。没有新增框架、运行依赖或追踪 SDK。编辑器仍有既有大 chunk 提示，但保持既有预算；内容页不加载它。

静态页面深浅主题与移动布局经过截图及 axe 检查。未运行完整全产品 E2E、原生桌面运行或最低历史浏览器矩阵。本地验收不等同于部署、站长平台提交、线上搜索收录或 AI 引用效果验证；新增五语仍待母语校对。

### 构建配置回归

Web 构建现在自动重建 docs，不依赖之前执行过 `build:docs`。预览开关会同时作用于全部文档 HTML、全局和文档响应头、空 sitemap。子路径与自定义 HTTPS origin 同时传入 Astro 和后处理；部署路径由 `SCREENHELLO_BASE_PATH` 决定，canonical 不再固定为正式域名。

`pnpm audit:seo` 会检查文档 canonical 的 origin/base、全部本地链接是否越出 base、旧 URL 的 301，以及预览 noindex/空 sitemap。验证其它输出目录时使用 `SCREENHELLO_SEO_OUT_DIR`，并传入与构建相同的三个部署配置变量。
