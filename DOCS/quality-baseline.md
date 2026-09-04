# Phase 1 质量基线

> Phase 1 采集日期：2026-09-02；当前首屏 golden 于 Phase 8.5.3（2026-09-04）复核更新，移动响应式基线于 Phase 8.5.5（2026-09-04）完成终审。此文档记录已经运行的事实。

## 环境与版本

| 项目 | 基线 |
| --- | --- |
| 上游源码 | Shoteasy `799c454b288bc17518afc3d4a54d5588fc10c587` |
| Phase 1 前私有本地基线 | `bce533b`（规划纳入仓库，未推送） |
| 操作系统 | Debian GNU/Linux 13.2，Linux arm64 |
| Node / pnpm | Node 24.18.0 / pnpm 10.12.1 |
| 构建/测试工具 | Vite 6.4.3、`@vitejs/plugin-react-swc` 4.3.3、Vitest 3.2.6、Playwright 1.62.1 |
| locale / 测试时区 | 主机 `en_CN.UTF-8`；Playwright `zh-CN` / UTC |
| 浏览器视口 | Playwright Desktop profiles，Chromium golden 为 1280×720、device scale factor 1 |
| 当前引擎 | Chrome for Testing 151.0.7922.34、Firefox 153.0、WebKit 26.5 |

`package.json` 的 `engines` 接受 Node 24.x 和 pnpm 10.12.1～10.x；`.node-version` 与 `.nvmrc` 固定当前维护版本 24.18.0。pnpm 安装会提示 `@swc/core`、`esbuild` 的依赖 build script 被安全策略忽略；在未执行交互式批准的情况下，frozen install、lint 和双构建均已通过，因此 Phase 1 不扩大脚本执行许可。

## 已建立的自动验证

| 层 | 命令 | 已验证结果 |
| --- | --- | --- |
| 安装 | `pnpm install --frozen-lockfile` | 通过 |
| 依赖审计 | `pnpm audit --audit-level=high` | `No known vulnerabilities found` |
| 静态检查 | `pnpm lint` | 通过，0 warning |
| 单元测试 | `pnpm test:unit` | 2 files，10 passed，1 todo |
| 当前浏览器 | `pnpm test:e2e` | Chromium/Firefox/WebKit 的离线启动、导入、编辑、撤销、重做均通过；golden 仅在 Chromium 执行 |
| Web 构建 | `pnpm build` | 通过 |
| library 构建 | `pnpm build:lib` | 通过 |
| library consumer | `pnpm test:consumer` | 构建产物导入、CSS 生效、卸载通过 |
| 体积报告 | `pnpm size:report` | 通过并输出 JSON |

E2E 对非 localhost、`blob:`、`data:` 的请求执行阻断，确保 smoke 流程不上传图片、不依赖外部服务。测试 fixture 由仓库内代码确定性生成，不读取用户文件。

## Golden 基线

- `tests/e2e/app.spec.js-snapshots/initial-page-chromium-linux.png`：离线首屏，使用代码原生默认渐变；已人工查看上传、本地承诺、快速入门、截屏和示例入口的层级，并额外检查 390/768 px 无新增越界。
- `tests/e2e/app.spec.js-snapshots/export-chromium-linux.png`：64×48 自生成四象限 fixture 在代码渐变背景上的 PNG 导出；已人工查看尺寸和颜色分区。
- `tests/e2e/app.spec.js-snapshots/workspace-center-chromium-linux.png`：Phase 8.5.2 后的 560 px 本地资料库四 Tabs 空状态；文件动作和智能建议不再混入。
- `tests/e2e/app.spec.js-snapshots/generic-device-frames-chromium-linux.png`：四种代码原生无品牌设备外框导出。
- 当前 SHA-256：首屏 `1572a64e9c7701d5a940753824f7999f9e4f00a2b940532e64e3152098d1bf2d`；导出 `6b77d20505a1315834cc9940e17aef6cd99a8a66672c56ff19414b75b2087123`；本地资料库 `19f15d4f39c49c2fe875b663177f56295c3719359097a62ae483ff696190c44e`；设备外框 `2d3eee31b8778ad0f98861ada90170f3723bc125ca310735142e088095ac6724`。Phase 1 原始哈希已由 Phase 8 素材替换、Phase 8.5.2 信息架构和 Phase 8.5.3 首屏说明取代。

golden 变化只能由人工查看后使用 `playwright test --update-snapshots` 更新；CI 失败不得自动覆盖。

## Phase 8.5.4 移动增量基线

- 390×844、430×932、768×1024、1024×768、1440×900 各深浅主题共 10 组均为 axe A/AA 0 violation、页面/顶栏横向溢出 0、外部请求 0、page error 0；390/430 px 可见交互目标低于 44 px 为 0。
- 专项在 Chromium、Firefox、WebKit 共 12/12，覆盖移动单菜单、四组命令可达、后继面板焦点归还、标注 Sheet、缩放菜单、横屏、390×500 低高度、200% 文本、reduced motion 与 768/1024/1180/1280/1440 编辑区切换。
- PWA production 5/5，直接验证状态卡不与移动导出、标注、缩放入口相交；current release 三引擎 9/9，完整 E2E 94 passed / 20 expected skipped。
- 人工查看 390/430、768/1024/1440、菜单和标注 Sheet 证据；本阶段没有更新既有 golden。精确最低浏览器最终候选复验仍属于 Phase 8.5.5。

## Phase 8.5.5 最终候选本地证据

- Node 24.18.0 / pnpm 10.12.1 frozen strict-peer install、ignored builds None、low audit、license audit、typecheck 和 lint 通过；26 files / 188 unit tests passed。
- 当前 Chromium/Firefox/WebKit 为 94 passed / 20 expected skipped；production release 9/9，PWA 5/5，library consumer dev/preview 各 1/1。项目/草稿/预设、多图层、批量、PNG/JPEG/WebP/AVIF、WebP fallback、多实例与 `workspace=false` 均有覆盖。
- 390/430/768/1024/1440 × dark/light 共 10 captures 为 0 axe violation、0 外网请求、0 page error、0 页面/顶栏横向溢出；390/430 可见交互目标小于 44 px 为 0。人工复核代表图后没有更新 golden。
- 终审修复了关闭态 ColorPicker 的悬空 `aria-controls`、标注 toolbar/本地 file input 语义和移动菜单内层 `role=tab` 仅 28×22 px 的问题；复跑后不再有 ARIA incomplete，剩余 incomplete 仅为 axe 无法自动判断的渐变/图片背景对比度。
- Web entry 为 868,858 B / gzip 271,417 B；library package entry 为 322,955 B / gzip 85,011 B；PWA precache 为 20 entries / 2,620,813 B，均在门限内。
- minimum-browser evidence 已升为 schema v2，除桌面编辑/四格式/同源请求外，还强制验证移动菜单、标注、缩放、44 px 与无横向溢出。Chrome 111.0.5563.146、Edge 111.0.1661.62 本地仿真只证明 runner 功能，不作为可信发布证据。

当前发布判定为“本地 GO / 远端 HOLD”：只有把经 allowlist 验证的公开候选写入远端 ref，并由公开仓自身对同一个 `github.sha` 完成原生 amd64 三浏览器与 `macos-14` Safari 后，才能把 Phase 8.5 整体标记完成。旧 Phase 7 SHA 或本地仿真不得复用。

## 构建体积快照

| 产物 | 原始字节 | gzip 字节 | 备注 |
| --- | ---: | ---: | --- |
| Web entry JS | 2,142,572 | 648,854 | 15 个 `data:image/` |
| Web entry CSS | 49,673 | 10,559 | 1 个 `data:image/` |
| library JS | 12,803,535 | 7,145,734 | 50 个 `data:image/` |
| library CSS | 49,673 | 10,559 | 1 个 `data:image/` |

Web build 共输出 38 个图片文件；library 另有 CSS 中的 1 个图片文件。当前体积只作为零点，不代表可接受的长期预算。Web 主 chunk 超过 Vite 500 kB warning，library 将大量图片内联；两项均是 Phase 3 性能/资源工作的量化输入。

初次 review 发现 Vitest 2.1.9 的 critical advisory 和 Vite 5 无 5.x 修复的 high advisory。按“发现 CRITICAL/HIGH 先修复”的阶段规则，Phase 1 以独立安全闭环升级到 Vitest 3.2.6、Vite 6.4.3 和 React SWC plugin 4.3.3；`pnpm audit --audit-level=high` 最终为 `No known vulnerabilities found`。Vite 6 默认改变 library CSS 文件名，已通过正式的 `build.lib.cssFileName` 配置保持原公共产物 `style.css`，consumer 回归通过。

## 最低浏览器验收方法

Playwright bundled engines 不是最低版本证明。Release owner 负责在候选发布前安排并保存以下证据：执行日期、操作者、OS、浏览器完整版本、启动/导入/编辑/撤销/重做/导出结果、失败截图或日志。

| 浏览器 | 最低版本 | 执行环境 | Phase 1 状态 |
| --- | ---: | --- | --- |
| Chrome | 111 | 受控版本 VM 或可信云真机 | 方法已定义，未执行 |
| Edge | 111 | 受控 Windows VM 或可信云真机 | 方法已定义，未执行 |
| Firefox | 128 | 受控版本 VM/官方版本环境或可信云真机 | 方法已定义，未执行 |
| Safari | 16.4 | macOS 真机或可信云真机；不得用 Playwright WebKit 代替 | 方法已定义，未执行 |

Phase 7 Web Release Gate 前，上述四行必须有实际记录。P0 引入项目保存后，矩阵再加入 File System Access 可用路径与 file input/download 回退路径；当前不把尚未实现的 P0 保存功能写成已通过。

## 已发现但未在 Phase 1 混入修复的问题

- `normalizeShape()` 对空字符串数值字段没有完全兑现“默认化”的注释；单元测试以 todo 登记，进入 Phase 2 正确性处理。
- 模块级 Store 和固定 DOM ID 仍不支持可靠多实例；Phase 1 consumer 只验证单实例导入/卸载，双实例属于 Phase 2。
- 首屏仍包含 Google Fonts 和 6 个 Unsplash 快捷背景请求，不满足最终纯本地发布目标；必须在 Phase 3 本地化、移除或改为显式离线安全方案。
- 当前开发模式存在第三方图标 SVG 属性、Ant Design deprecated API 和 `findDOMNode` console warning；依赖升级波次前需建立 warning 预算并逐项清理。

> 后续状态：上述 `normalizeShape` todo、模块级 Store、固定 DOM ID、主图/背景 object URL 释放和单实例 consumer 缺口已在 Phase 2 修复；Google Fonts/Unsplash、library 资源外置与类型/platform 边界已在 [Phase 3](./phase-3-foundation.md) 处理。Phase 8 又把第三方背景缩略图/原图替换为代码渐变。除明确标注的当前 golden 外，本页数字仍保留为 Phase 1 历史基线。
