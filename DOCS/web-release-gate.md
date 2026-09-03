# Web Release Gate

> 评估日期：2026-09-03。当前结论：**GO，Phase 7.6 发布门通过**。工程门禁、颜色面板可访问性修复和同一候选提交的四浏览器可信证据均已通过；进入 Phase 8 仍需单独启动，不由本结论自动执行。

## 1. 判定规则

ScreenHello 的 Web Release Gate 采用 fail-closed：四个最低浏览器目标、当前引擎回归、构建/许可/体积门、核心用户链路、本地优先与可访问性必须同时有证据。缺文件、版本不精确、候选提交不一致、非可信执行环境或把 Playwright WebKit 当成 Safari，都会判定失败。

最低支持范围仍为 Chrome 111+、Edge 111+、Firefox 128+、Safari 16.4+。Chrome/Edge/Firefox 使用返回的 WebDriver capabilities 核对真实浏览器名和完整版本；Safari 接受 Apple 设备、可信浏览器云或用户确认的 GitHub `macos-14` 原生 Safari，并记录 runner、平台与实际版本。`macos-14` 采用“实际 Safari 版本不低于 16.4”的策略，不伪称精确重放 Safari 16.4。四份证据必须对应同一个 40 位 Git commit SHA。

## 2. 已通过的本地工程证据

- Node 24 的当前 Chromium/Firefox/WebKit production release suite 为 9/9：项目/预设保存、PNG/JPG/WebP/AVIF 单图签名、批量 ZIP、request 级同源与私有标记审计、无 page error、编辑器稳定状态 WCAG 2 A/AA 与 2.1 A/AA、键盘入口、reduced-motion，以及 Canvas 无 WebP 编码时的同源本地回退。
- Phase 7.5 复审发现并修复 CI 漏项：持续集成现在会执行 ignored-builds、low audit、第三方许可、PWA 静态审计、production PWA 回归、library PWA 边界和当前 release suite。
- 已修复实际产品问题：可见 slider/颜色触发器缺少可读名称、暗色文本对比不足、reduced-motion 没有真正生效，以及 PWA 错误卡遮挡批量 ZIP 操作。
- 现有 Phase 1～7.5 回归继续覆盖项目/预设 v1/v2、草稿/最近项目、双实例、clean tarball consumer、导出 golden/取消/失败、内存/性能预算、PWA 离线与 library 无 Service Worker 副作用。
- 本轮最终本地门禁为 frozen strict-peer install、low audit 无已知漏洞、许可证文本一致、23 files / 152 unit、release 9/9、consumer dev/production 各 1/1、PWA 与 library 边界通过。根路径 PWA precache 为 41 项 / 2,782,893 B；library 77 文件没有 PWA artifact/runtime marker。当前 Web entry 为 790,411 B / gzip 249,815 B，library package entry 为 281,016 B / gzip 75,587 B。
- Safari 26.5 的 Canvas 请求 `image/webp` 时实际返回 `image/png`。ScreenHello 现在只在该能力探测失败时按需加载同源 WebP Worker/WASM，校验 RIFF/WEBP 后下载；281,261 B 的 WebP WASM 不进入 PWA precache，原生支持 WebP 编码的浏览器继续走原路径。
- 首次公开前的隔离候选完整 CI 已通过，覆盖依赖/许可、typecheck、lint、unit、当前三引擎 E2E、Web/PWA、release、library、consumer 和体积门。正式公共仓必须从自身 clean checkout 重跑；私有测试仓记录不作为长期公开证据链接。
- 2048² AVIF 连续 6 次 production 基准未线性累积：Chromium/Firefox/WebKit 峰值增量分别为 360.5/25.2/326.1 MiB，后五次约 0.47～0.49 秒、8.05～8.41 秒、0.51～0.54 秒。

这些本地结果与下一节的真实浏览器矩阵是两层独立证据；Playwright WebKit 本身仍不被当作 Safari。

## 3. 最低浏览器证据状态

| 目标 | 可信执行环境 | 实测版本 | 当前状态 |
| --- | --- | --- | --- |
| Chrome 111 | GitHub `ubuntu-24.04` 原生 amd64 + digest-pinned Selenium | 111.0.5563.146 | 通过 |
| Edge 111 | GitHub `ubuntu-24.04` 原生 amd64 + digest-pinned Selenium | 111.0.1661.62 (`msedge`) | 通过 |
| Firefox 128 | GitHub `ubuntu-24.04` 原生 amd64 + digest-pinned Selenium | 128.0.3 | 通过 |
| Safari 16.4+ | GitHub `macos-14` + 系统 SafariDriver | Safari 26.5 / macOS 14 | 通过用户确认的 hosted-current 验收；未精确重放 16.4 |

候选提交 `35e3fdeb47c27d806e15411e5c0637c2607a13ca` 的四份证据均通过导入、编辑、撤销/重做、PNG/JPEG/WebP/AVIF 签名、MIME、非空输出及同源请求检查，汇总审计 `failures` 为空。Safari 会话第一次尝试即成功；其原生 WebP 探测明确记录 `observedMimeType: image/png`，最终软件回退输出 `image/webp`。

首次公开前通过的 browser matrix 同时执行三个原生 amd64 目标和 `macos-14` Safari。正式公共候选仍须运行仓库内同一 workflow 并保留公开 run/evidence。精确 Safari 16.4 仍是未覆盖的历史下界风险；当前接受的是 `macos-14` hosted-current Safari，不应改写成“已精确验证 16.4”。

## 4. 可访问性修复状态

复审确认 Ant Design 6.6.2 没有为颜色弹层内部 slider/input 提供公开的可读名称接口，项目旧默认值还把不透明 alpha 错写成 `100`。ScreenHello 现在通过公开 `panelRender` 保留 AntD 的触发器、Popover 和定位逻辑，只替换为自有的原生 color/text/range 面板；旧值在 ProjectDocument 恢复入口和 OptionStore 写入入口统一迁移为合法 alpha `1`。

默认与自定义触发器均声明 dialog 关系；Enter/Space 可打开，打开后焦点进入原生颜色控件，HEX/alpha 修改保持既有 TinyColor 回调契约，Escape 关闭并返回触发器。当前 Chromium/Firefox/WebKit 在弹层打开状态的 axe WCAG 2 A/AA 与 2.1 A/AA 扫描均为零违规，且测试明确断言 alpha 为 `100%` 而非 `10000%`。修复没有使用 axe exclusion，也没有修改 AntD 私有 DOM。

axe 的 `incomplete` 项仍需人工复核；自动扫描不能替代完整的屏幕阅读器、焦点顺序和 Safari/VoiceOver 检查。

## 5. 复现与合并证据

当前引擎 production gate：

```bash
pnpm build
pnpm test:release:current
```

单个最低浏览器 WebDriver 会话：

```bash
SELENIUM_REMOTE_URL=http://127.0.0.1:4444 \
SCREENHELLO_BROWSER_TARGET=chrome-111 \
SCREENHELLO_RELEASE_BASE_URL=http://host.docker.internal:4197 \
SCREENHELLO_BROWSER_SOURCE='<pinned image or trusted provider>' \
SCREENHELLO_BROWSER_EXECUTION=native-amd64 \
SCREENHELLO_RELEASE_CANDIDATE='<40-character commit SHA>' \
pnpm test:release:minimum-browser
```

GitHub hosted Safari 验收通过手工 workflow 执行：

```bash
gh workflow run web-release-browser-matrix.yml --ref '<release-candidate branch or tag>'
```

workflow 在 `macos-14` 上执行系统 `safaridriver --enable`，由 Selenium 连接本机 Safari；不需要云凭据。若未来需要恢复精确 Safari 16.4 验收，应另外使用可固定该版本的 Apple 设备或可信浏览器云，并继续通过环境变量注入凭据，不能写入仓库。

收集同一候选提交的四个 JSON 后执行：

```bash
SCREENHELLO_RELEASE_CANDIDATE='<same 40-character commit SHA>' pnpm audit:release:browsers
```

证据默认写入忽略提交的 `artifacts/release/browser-matrix/`。provider options 只从环境读取，报告只记录 capability key，不记录其值；runner 还会从 source、错误和浏览器日志中清除 WebDriver endpoint 及已识别的 username/password/access-key/token/secret。审计器会拒绝失败记录、错误版本/MIME、非可信架构、非固定原生镜像、候选提交不一致、缺失 Safari 环境说明以及任何标记为 Playwright WebKit 的 Safari 结果。

## 6. 结论与后续边界

在用户接受 `macos-14` hosted-current Safari 作为 Apple 验收环境后，候选提交 `35e3fdeb47c27d806e15411e5c0637c2607a13ca` 的四浏览器证据和 fail-closed 汇总审计均通过，Phase 7.6 与整个 Phase 7 可以标记 complete。

本结论不自动授权 deploy、npm publish、正式公开仓库晋级、桌面版或 Chrome/Edge 扩展，也不把 Safari 26.5 结果夸大为精确 Safari 16.4 证据。下一阶段应在新的 Phase 8 启动指令和范围 review 后进行。

## 7. 依据

- [Playwright 浏览器说明](https://playwright.dev/docs/browsers)：区分 bundled browser 与 branded browser / Safari。
- [Selenium Docker 官方文档](https://github.com/SeleniumHQ/docker-selenium)：镜像、架构和 ARM64 模拟限制。
- [BrowserStack Selenium 浏览器版本选择](https://www.browserstack.com/docs/automate/selenium/select-browsers-and-devices)：可信云执行时应显式指定浏览器、版本与平台。
- [Apple：在 macOS 启用 WebDriver](https://developer.apple.com/documentation/safari-developer-tools/macos-enabling-webdriver)：系统 SafariDriver 启用方式。
- [GitHub Actions macOS 14 镜像](https://github.com/actions/runner-images/blob/main/images/macos/macos-14-Readme.md)：hosted runner 的当前软件清单。
