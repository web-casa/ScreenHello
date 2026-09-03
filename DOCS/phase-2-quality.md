# Phase 2 质量验收

> 验收日期：2026-09-02。Phase 2 已在本地完成并通过最终门禁，尚未 push、publish 或 release。

## 范围与 review 结论

本阶段先复审 Phase 1 提交 `236a3d5`，再实施核心正确性与多实例隔离。复审未发现 CRITICAL/HIGH 问题；frozen install、high-severity audit、lint 和原单测均通过。实现严格停在 Phase 2，没有混入资源本地化、ProjectDocument v2、框架主版本升级或 Web P0 功能。

最终 review 按安全、正确性、性能、可维护性和测试顺序执行，修复了以下实现期问题：

- 删除测试专用 runtime prop，consumer 仅通过公开 `ImageBeautifier` UI 和浏览器 IndexedDB 验收。
- 修正测试 helper 抢先创建空 IndexedDB schema 的问题，测试不再污染被测应用。
- 快捷键 hook 不再使用动态依赖数组；粘贴和截屏图片解析失败会显示本地错误，不产生未处理 Promise。
- 主图记录 object URL 所有权：只释放文件导入/草稿恢复由实例创建的 URL，不释放宿主传入的 `blob:` URL。

## 已实现架构

- `createScreenHelloRuntime()` 为每次挂载创建独立的 Editor、Option、History、AssetStore、DraftStore、DraftService、BaseSnapshotService 和 Leafer App。
- React 组件通过 `StoreProvider`/`useStores()` 取得当前实例；Store 只通过注入的 root 引用兄弟 Store，不再依赖模块级业务单例。
- 根节点改为可重复的 `.shoteasy-app` 与实例数据属性；表单 ID/name 使用 React `useId()`，同页实例不产生重复 DOM ID。
- 全局粘贴和快捷键由最近点击/聚焦的 active runtime 独占，输入框、文本域、下拉框和可编辑内容保留浏览器原生按键行为。
- message、主题、默认图片、宿主回调和草稿 setup/restore 都在 effect 中同步；`editor.isEditing` 保持纯读取，提示行为移入命令方法。

## 生命周期与错误路径

| 资源/路径 | 处理方式 |
| --- | --- |
| Leafer App | 卸载时取消监听、debounce、RAF、timer，并以 `destroy(true)` 销毁当前实例画布 |
| 主图 object URL | 替换、清空或 runtime dispose 时仅释放实例拥有的 URL |
| 背景 Blob URL | AssetStore 按实例持有；切换、取消请求和销毁时释放 |
| 远程背景 | AbortController 与请求代际归实例；迟到结果不得覆盖当前选择并立即释放 |
| 草稿 | reaction/timer 可 teardown；关闭 IndexedDB 连接但不删除已保存草稿 |
| 屏幕捕获 | 成功、播放失败或 Canvas 失败都在 `finally` 停止全部媒体轨道 |
| 存储错误 | IndexedDB 不可用、配额不足、损坏草稿和资源缺失给出本地可理解提示 |
| React 错误 | Provider 外层 Error Boundary 卸载故障 runtime；重试创建新实例，不上传图片或错误数据 |

## 最终验证结果

使用 Node 24.18.0 与 pnpm 10.12.1：

| 门禁 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过，lockfile 无漂移 |
| `pnpm audit --audit-level=high` | `No known vulnerabilities found` |
| `pnpm lint` | 通过，0 warning |
| `pnpm test:unit` | 4 files，18 passed |
| `pnpm test:e2e` | 5 passed；4 个非 Chromium golden 按设计 skipped |
| `pnpm build` / `pnpm build:lib` | 通过 |
| `pnpm test:consumer` | 1 passed；双实例、草稿、快捷键、卸载重挂通过 |
| `pnpm size:report` | 通过并输出可解析 JSON |

单测覆盖 runtime/store 隔离、实例销毁、宿主 object URL 所有权、active runtime、草稿不可用/配额/损坏错误、远程背景迟到结果，以及屏幕媒体流在成功和 Canvas 失败时的释放。

consumer 使用两个公开 `ImageBeautifier` 严格模式实例，验证 A 的图片、背景、历史、主题、草稿和销毁不影响 B，草稿 key 分离，快捷键只路由给激活实例，A 卸载/重挂后获得新 runtime，最终无 page error。

## 体积与未关闭边界

| 产物 | 原始字节 | gzip 字节 |
| --- | ---: | ---: |
| Web entry JS | 2,149,464 | 650,415 |
| Web entry CSS | 50,220 | 10,688 |
| library JS | 12,812,559 | 7,147,743 |
| library CSS | 50,220 | 10,688 |

Web 主 chunk、library 图片内联、远程资源和水印 SVG 转义已在后续 Phase 3 处理，见 [Phase 3 基础验收](./phase-3-foundation.md)。本阶段的 Playwright Chromium/Firefox/WebKit 结果仍不等价于 Chrome/Edge 111、Firefox 128、Safari 16.4 最低版本验收；Safari 16.4 需在 Phase 7 前使用真机或可信云真机验证。
