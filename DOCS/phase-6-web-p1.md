# Phase 6：Web P1 多图片与专业布局

> 实施日期：2026-09-02。范围只包含单个本地项目内的多图片画布与布局，不包含批处理作业、ZIP 批量导出、桌面端、浏览器扩展、云同步或 npm 发布。

## 1. ProjectDocument v2

V2 将 V1 的单值 `image` 改为 `images[]`。每个图片图层包含：

- `id`：项目内稳定图层 ID；
- `assetId`：运行时、草稿和项目归档解析图片 Blob 的稳定资源 ID；
- `name/type/width/height`：不含 URL 的可序列化元数据；
- `transform: { x, y, scale, rotation }`：x/y 是相对项目对齐基准的偏移；
- `zIndex/locked/groupId`：层序、锁定与逻辑编组。

`option` 继续是项目级共享风格，`shapes[]` 继续是画布级标注。文档禁止包含 Blob、object URL、Leafer 节点和 DOM 状态。

V1 迁移把 `image` 转为唯一图片图层，并从旧 option 的 `offsetX/offsetY/scale/rotation` 读取几何。旧 option 字段保留用于兼容公开组件 API，但 V2 的图片几何以 `images[]` 为事实来源。

## 2. 运行时边界

- 图片资源表和图片图层表由独立 store 管理；`editor.img` 是当前活动图片的兼容视图。
- 复制图层共享同一 asset，不复制 Blob；删除后的 asset 在历史仍可引用时保留。
- 新项目替换、清空和实例销毁必须释放归属 object URL。
- 单项目最多 12 个图片图层、唯一图片总计最多 120 MP；超限导入必须失败且不污染现有项目。

## 3. 交互与布局

- LeaferJS 2.2.9 原生 selection 接受单个或数组目标；使用现有 move/scale/rotate 事件回写模型。
- 编组是模型级逻辑组：选择组内任一图片会扩展到整组，变换作为一次历史操作提交。
- 锁定图片仍可从图层面板选择和解锁，但画布上不可编辑。
- 对齐、等间距、堆叠和扇形布局只修改未锁定的选中图片；不足最小选择数时不产生历史。
- 当前依赖没有内建 snap/guide API；P1 使用项目内确定性边缘/中心吸附，不新增未审计社区插件。

## 4. 持久化与验证

- 历史快照、自动草稿、项目归档、最近项目和导出必须读取同一 `images[]`。
- 项目归档兼容旧 `assets.image`，新文件使用多图片 descriptors，并逐项校验大小、哈希、MIME、解码和像素预算。
- 资源准备全部成功后才能替换当前项目；取消、损坏或超限不得留下半应用状态。
- 退出门包括 v1 fixture、布局单测、资源释放/失败回滚、三引擎 E2E、双构建、consumer 多实例和体积预算。

## 5. 最终 review 修复

- 多文件追加改为“全部准备与预算校验成功后一次提交”；坏文件或超限会回收整批临时 URL，且追加不重算已有画布尺寸。
- 项目/草稿按 assetId 去重保存与解码；共享资源在 ZIP 中只存一份字节，descriptor 与文档身份冲突会被拒绝。
- workspace operation token 贯穿归档读取、资源准备、应用、缓存和完成提示；teardown 后的旧事务不能写回或清空新 busy 状态。
- 多图 HDR 在每个 runtime 内串行，图层移动/编组不再触发无关重算；底图快照保留所有 V2 图片并跟踪全部资源、几何与层序。
- 删除最后一层会清理持久化草稿；历史淘汰后释放不再被任何快照引用的图片资源。
- 2026-09-02 追加复审将 workspace 的项目选择、最近项目、草稿/最近项删除、预设 CRUD/导入/导出全部纳入 operation generation；teardown 后不得重新启动操作、应用过期预设、刷新已关闭的资源库或显示过期消息。
- DraftService 的排队保存任务固定捕获 persistence key 与 generation；旧任务失败不再关闭新挂载周期的自动保存或显示警告。
- 同一 `assetId` 若对应不同 runtime 图片源会以 `image-asset-conflict` 显式失败；资源所有权只在项目替换成功后转交 store，现有 workspace/draft 失败路径负责回收准备资源。

## 6. 阶段门禁结果

- 环境：Node.js 24.18.0、pnpm 10.12.1；frozen strict-peer install 通过，ignored builds 为 None，low-severity audit 为 0。
- 静态与单元：typecheck、零 warning lint 通过；15 个 Vitest 文件共 79 项通过。
- 浏览器：Chromium / Firefox / WebKit 共 22 项通过、8 项按平台设计跳过；多图原子导入、布局、历史与项目恢复三引擎通过，原单图 PNG golden 无差异。
- 产物：Web 与 library 构建通过；独立 tarball consumer 的双实例/草稿/快捷键/卸载重挂 1/1 通过。
- 体积：Web 入口 1,047,543 B / gzip 328,742 B，CSS 61,480 B / gzip 11,730 B；library 入口 728,658 B / gzip 201,754 B，CSS 64,991 B / gzip 12,676 B；最大内联 data image 246 B，均在既定预算内。
- 范围：未升级 LeaferJS，未进入 Phase 7 P2、桌面、扩展、npm 公开或任何 push/publish/release。
